import { create } from "zustand"

import type { AgentKind, AgentToolStatus } from "@shared/api"
import * as repo from "../db/projects"
import { useStudio } from "../store"

/**
 * One session in the Terminal panel: a pty in the main process, and the
 * handful of things the UI around it has to agree on.
 *
 * Kept per project rather than globally, because a session's cwd is decided
 * when it starts and cannot be moved afterwards — a `claude` still talking to
 * the project it was opened in is the honest thing to show when someone
 * switches away and back.
 */
export type TerminalSession = {
  id: string
  projectId: string
  kind: AgentKind
  /**
   * How the session is drawn. Only a view: both are the same pty running the
   * same conversation, so toggling starts and stops nothing.
   *
   * `terminal` for every kind but `claude`, which has nothing else to offer.
   */
  view: SessionView
  /**
   * The CLI session id this tab's `claude` runs under, passed to it as
   * `--session-id` and so also the name of the transcript the chat view
   * tails. Null until the pty has been started, and for every other kind.
   *
   * Minted where the pty is created and never reused: the CLI refuses an id
   * that already has a transcript ("Session ID … is already in use"), so a
   * restart — or a reattach that missed and fell back to a fresh session —
   * has to be a new conversation rather than the old id a second time. Kept
   * here rather than in the main process because it is also what gets
   * remembered: a reattached pty is never started by a command again, so this
   * is the only record of which conversation it is.
   */
  claudeSessionId: string | null
  /**
   * An install run rather than the tool itself: the same pane and the same
   * events, running the CLI's installer. Its exit is what re-checks whether the
   * tool is there.
   */
  installing: boolean
  /** Bumped to remount the pane, which is what starting the session over is. */
  attempt: number
  exited: boolean
  /** Set once the user renames the session; null shows the generated label. */
  name: string | null
  /** The pty daemon's own id for the live pty behind this tab, once a
   * create or attach has resolved — what gets remembered for next launch. */
  terminalId: string | null
}

/** Which of the two ways a session can be drawn is on screen. */
export type SessionView = "chat" | "terminal"

type TerminalState = {
  sessions: TerminalSession[]
  /** The session on screen, which may belong to a project that is not open. */
  activeId: string | null
  /** Null until the picker has asked; each answer costs a login shell. */
  tools: AgentToolStatus[] | null
  checkingTools: boolean

  /** Opens a session and puts it on screen. Returns its id. */
  open: (
    projectId: string,
    kind: AgentKind,
    options?: {
      installing?: boolean
      claudeSessionId?: string
      view?: SessionView
    }
  ) => string
  select: (id: string) => void
  /** Switches how a session is drawn. Touches no process. */
  setView: (id: string, view: SessionView) => void
  rename: (id: string, name: string) => void
  /** Records the real id behind a tab once its pty has started, along with
   * the conversation that pty is running — a fresh one, or the remembered one
   * it was told to resume. */
  setTerminalId: (
    id: string,
    terminalId: string,
    claudeSessionId: string | null
  ) => void
  close: (id: string) => void
  /** Closes every other session of the same project. */
  closeOthers: (id: string) => void
  /** Closes every session of one project, leaving other projects' alone. */
  closeAll: (projectId: string) => void
  /** Reorders one project's sessions, for the tab strip's drag and drop.
   * `ids` must be every id that project already has, in the new order. */
  reorder: (projectId: string, ids: string[]) => void
  restart: (id: string) => void
  /**
   * Puts a tab onto a conversation it is not currently running, and starts its
   * pty over on that one.
   *
   * "Chat with this session" cannot be a view: a pty runs exactly one
   * conversation, so continuing an older one means replacing the tab's own id
   * and letting the restart resume it (`--resume`, via `hasTranscript` in
   * `electron/ipc.ts`). Nothing is lost by switching — the conversation being
   * left is on disk, and picking it from the drawer brings it back the same
   * way. What it does cost is the process: a turn in flight is interrupted,
   * the same as any other restart.
   */
  resumeSession: (id: string, claudeSessionId: string) => void
  setExited: (id: string, exited: boolean) => void
  refreshTools: () => Promise<void>
  /** Reopens whatever sessions were open the last time the app quit — fresh
   * ones, since a pty cannot be reattached across a restart any more than
   * across a project switch. Safe to call more than once; only the first
   * call does anything. */
  restore: () => Promise<void>
}

/**
 * What's remembered of a session — which tabs to reopen, not which ptys to
 * reclaim. The pty itself is gone: they are killed when the app quits, so what
 * carries across a launch is the *conversation*, resumed under a new process.
 *
 * An install run is not remembered: replaying an installer on every launch
 * would be a surprise, not a convenience — nor is a session with no
 * `terminalId` yet, which is one still connecting for the first time.
 */
type RememberedSession = {
  projectId: string
  kind: AgentKind
  /** The CLI session the tab was having, reopened with `--resume` so the chat
   * carries on where it left off. Absent for kinds that have none, and for a
   * session remembered by a build from before this was recorded. */
  claudeSessionId?: string | null
}

/** Still `agent.` from when the panel had that name: this is a settings key
 * already written to disk, and renaming it would silently drop the sessions
 * every existing install has remembered. */
const SESSIONS_KEY = "agent.sessions"

/**
 * The kinds a remembered session may name.
 *
 * Every kind has a pty now, so this is only a guard against what an older
 * build wrote — `claude-gui` and `codex` were once kinds of their own here, and
 * an entry naming one is dropped rather than reopened as something it was not.
 */
const SESSION_KINDS = new Set<AgentKind>(["terminal", "claude"])

/** Saves which sessions are worth reopening next launch. Fire-and-forget,
 * like every other write in this store — a session someone is actively
 * typing into is not worth blocking on a settings write. */
function persistSessions(sessions: TerminalSession[]) {
  const remembered: RememberedSession[] = sessions
    .filter((session) => !session.installing && session.terminalId !== null)
    .map((session) => ({
      projectId: session.projectId,
      kind: session.kind,
      claudeSessionId: session.claudeSessionId,
    }))
  void window.desktop
    .setSetting(SESSIONS_KEY, JSON.stringify(remembered))
    .catch((error) => {
      console.error("Could not save terminal sessions", error)
    })
}

/** Keeps only what `restore` can actually use — a project that still exists
 * and a kind this app still knows about. */
function isRememberedSession(value: unknown): value is RememberedSession {
  const record = value as Partial<RememberedSession> | null
  return (
    typeof record?.projectId === "string" &&
    typeof record.kind === "string" &&
    SESSION_KINDS.has(record.kind)
  )
}

let restorePromise: Promise<void> | null = null

export const useTerminal = create<TerminalState>((set, get) => ({
  sessions: [],
  activeId: null,
  tools: null,
  checkingTools: false,

  open(projectId, kind, options) {
    useStudio.getState().showPane("terminal")

    const session: TerminalSession = {
      id: crypto.randomUUID(),
      projectId,
      kind,
      // The terminal is where a session can actually be worked — it is the
      // only view with the composer, and the only one that can answer a
      // permission prompt — so it opens there, with the chat one click away.
      view: options?.view ?? "terminal",
      // Only ever the remembered one here — a new session's is minted when its
      // pty is actually started, since an id the CLI never ran under would
      // name a transcript that does not exist.
      claudeSessionId: options?.claudeSessionId ?? null,
      installing: options?.installing ?? false,
      attempt: 0,
      exited: false,
      name: null,
      terminalId: null,
    }

    set((state) => ({
      sessions: [...state.sessions, session],
      activeId: session.id,
    }))
    persistSessions(get().sessions)

    return session.id
  },

  select(id) {
    useStudio.getState().showPane("terminal")
    set({ activeId: id })
  },

  setView(id, view) {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, view } : session
      ),
    }))
  },

  rename(id, name) {
    const trimmed = name.trim()
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, name: trimmed || null } : session
      ),
    }))
  },

  close(id) {
    set((state) => {
      const sessions = state.sessions.filter((session) => session.id !== id)
      if (state.activeId !== id) return { sessions }

      // Falls back within the project the closed session belonged to, so
      // closing a tab never swings the panel over to another project's.
      const closed = state.sessions.find((session) => session.id === id)
      const siblings = sessions.filter(
        (session) => session.projectId === closed?.projectId
      )
      return { sessions, activeId: siblings.at(-1)?.id ?? null }
    })
    persistSessions(get().sessions)
  },

  closeOthers(id) {
    set((state) => {
      const kept = state.sessions.find((session) => session.id === id)
      return {
        sessions: state.sessions.filter(
          (session) =>
            session.id === id || session.projectId !== kept?.projectId
        ),
        activeId: id,
      }
    })
    persistSessions(get().sessions)
  },

  closeAll(projectId) {
    set((state) => {
      const sessions = state.sessions.filter(
        (session) => session.projectId !== projectId
      )
      const active = sessions.some((session) => session.id === state.activeId)
      return { sessions, activeId: active ? state.activeId : null }
    })
    persistSessions(get().sessions)
  },

  reorder(projectId, ids) {
    set((state) => {
      const own = state.sessions.filter(
        (session) => session.projectId === projectId
      )
      const byId = new Map(own.map((session) => [session.id, session]))
      const reordered = ids
        .map((id) => byId.get(id))
        .filter((session): session is TerminalSession => session !== undefined)
      // A stale or partial list — one that does not name exactly this
      // project's sessions — is left alone rather than dropping any.
      if (reordered.length !== own.length) return state

      let cursor = 0
      return {
        sessions: state.sessions.map((session) =>
          session.projectId === projectId ? reordered[cursor++]! : session
        ),
      }
    })
  },

  restart(id) {
    useStudio.getState().showPane("terminal")
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id
          ? { ...session, attempt: session.attempt + 1, exited: false }
          : session
      ),
      activeId: id,
    }))
  },

  resumeSession(id, claudeSessionId) {
    useStudio.getState().showPane("terminal")
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id
          ? {
              ...session,
              claudeSessionId,
              // The same remount `restart` relies on — the pane's key carries
              // the attempt, so this is what starts the pty over.
              attempt: session.attempt + 1,
              exited: false,
            }
          : session
      ),
      activeId: id,
    }))
    persistSessions(get().sessions)
  },

  setExited(id, exited) {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, exited } : session
      ),
    }))
  },

  setTerminalId(id, terminalId, claudeSessionId) {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id
          ? { ...session, terminalId, claudeSessionId }
          : session
      ),
    }))
    persistSessions(get().sessions)
  },

  async refreshTools() {
    if (get().checkingTools) return
    set({ checkingTools: true })
    try {
      set({ tools: await window.desktop.agentTools() })
    } finally {
      set({ checkingTools: false })
    }
  },

  restore() {
    restorePromise ??= (async () => {
      const raw = await window.desktop.getSetting(SESSIONS_KEY)
      if (!raw) return

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return
      }
      if (!Array.isArray(parsed)) return

      // A project deleted since the app last quit is not one to reopen a
      // session against — never trusted blindly, the same as anything else
      // read back off disk.
      const projects = await repo.listProjects()
      const known = new Set(projects.map((project) => project.id))

      for (const item of parsed) {
        if (!isRememberedSession(item) || !known.has(item.projectId)) continue
        get().open(item.projectId, item.kind, {
          claudeSessionId: item.claudeSessionId ?? undefined,
        })
      }
    })()
    return restorePromise
  },
}))

/** A project's sessions, oldest first — what its tab strip and sidebar list. */
export function sessionsOf(
  sessions: TerminalSession[],
  projectId: string | null
): TerminalSession[] {
  if (!projectId) return []
  return sessions.filter((session) => session.projectId === projectId)
}

/**
 * Which of a project's sessions is on screen.
 *
 * `activeId` is studio-wide, so after switching projects it names a session
 * this project does not have; the most recent of its own stands in.
 */
export function activeSessionOf(
  sessions: TerminalSession[],
  projectId: string | null,
  activeId: string | null
): TerminalSession | null {
  const own = sessionsOf(sessions, projectId)
  return own.find((session) => session.id === activeId) ?? own.at(-1) ?? null
}
