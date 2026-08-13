import { create } from "zustand"

import type { AgentKind, AgentToolStatus } from "@shared/api"
import * as repo from "../workspace"
import { useStudio } from "../store"

/**
 * One session in the Terminal panel: a pty in the main process, and the
 * handful of things the UI around it has to agree on.
 *
 * The folder is recorded rather than implied, because a session's cwd is
 * decided when it starts and cannot be moved afterwards. Every folder's
 * sessions are listed together — the panel is the workspace's terminal, not
 * one folder's, and what a tab says it runs in is `folderId`.
 */
export type TerminalSession = {
  id: string
  folderId: string
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
  /**
   * Closed by the user: the pty is gone and the tab is out of the strip, but
   * the entry stays in the sidebar under its folder.
   *
   * Distinct from `exited`, which is the process ending on its own while the
   * tab carries on. Closing used to drop the session outright, and for a
   * `claude` tab that was the wrong thing to imply: the conversation is not
   * the studio's to delete — the CLI wrote it to
   * `~/.claude/projects/…/<session-id>.jsonl` and it is still there — so what
   * closing actually did was hide the only handle onto it behind four steps
   * through a running session's Past sessions drawer. A closed row is that
   * handle, and `forget` is how it goes for good.
   */
  closed: boolean
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
  /** The session on screen, or null when there is none. */
  activeId: string | null
  /** Null until the picker has asked; each answer costs a login shell. */
  tools: AgentToolStatus[] | null
  checkingTools: boolean
  /**
   * The pending New session picker: the folder it should start in, or null for
   * "wherever the active session is". Null itself is the picker shut.
   *
   * In the store rather than in a component's own state because two things ask
   * for a session — the `+` on Explorer's Sessions list, and `New session here…`
   * on a folder — and the dialog is mounted by the workbench, which outlives
   * whichever sidebar it was asked for from.
   */
  picking: { folderId: string | null } | null
  openPicker: (folderId: string | null) => void
  closePicker: () => void

  /** Opens a session and puts it on screen. Returns its id. */
  open: (
    folderId: string,
    kind: AgentKind,
    options?: {
      installing?: boolean
      claudeSessionId?: string
      view?: SessionView
      /** A name the session already had, when this is a remembered one being
       * reopened. A new session has none and shows its generated label. */
      name?: string | null
      /**
       * Opens the session without taking the pane or the selection.
       *
       * For `restore`, which is not a user action: reopening five sessions at
       * launch used to put the pane on the terminal and leave the last one
       * active, so whichever tab was on screen last time lost to whatever was
       * restored last — and, because taking the pane also writes it down, the
       * remembered pane was overwritten on every launch.
       */
      background?: boolean
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
  /** Ends the pty and takes the tab off the strip, leaving the row in the
   * sidebar. A session with nothing worth keeping — an install run, or one
   * whose pty never started — is dropped instead. */
  close: (id: string) => void
  /** Closes every session but this one. */
  closeOthers: (id: string) => void
  closeAll: () => void
  /** Drops a closed session for good. The `claude` transcript on disk is the
   * CLI's own file and is left alone; what goes is this app's handle onto it. */
  forget: (id: string) => void
  /** Reorders the sessions, for the tab strip's drag and drop. `ids` must be
   * every id already open, in the new order. */
  reorder: (ids: string[]) => void
  /** Starts a session's pty over — and reopens it, if it was closed. Both are
   * the same act: a pty cannot be resumed, only run again, and for `claude`
   * "again" means `--resume` onto the conversation it was having. */
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
   * ones, since a pty cannot be reattached across a restart. Safe to call
   * more than once; only the first call does anything. */
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
  folderId: string
  kind: AgentKind
  /** The CLI session the tab was having, reopened with `--resume` so the chat
   * carries on where it left off. Absent for kinds that have none, and for a
   * session remembered by a build from before this was recorded. */
  claudeSessionId?: string | null
  /** Comes back as a row in the sidebar rather than as a running pty. Absent
   * from anything an older build wrote, which is read as "was open". */
  closed?: boolean
  /** Only a renamed session has one, and only it can carry the name across a
   * launch — the generated label is worked out from the list each render. */
  name?: string | null
  /** Marks the one session that was on screen. Absent from anything an older
   * build wrote, and from every entry once the active session is a closed row —
   * `restore` then falls back the way the panel itself does. */
  active?: boolean
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
function persistSessions(sessions: TerminalSession[], activeId: string | null) {
  const remembered: RememberedSession[] = sessions
    // A closed session has no `terminalId` — that is what closing takes away —
    // so it is remembered on its own terms. Anything with neither is a tab
    // still connecting for the first time, which there is nothing to reopen.
    .filter(
      (session) =>
        !session.installing && (session.terminalId !== null || session.closed)
    )
    .map((session) => ({
      folderId: session.folderId,
      kind: session.kind,
      claudeSessionId: session.claudeSessionId,
      closed: session.closed,
      name: session.name,
      active: session.id === activeId,
    }))
  void window.desktop
    .setSetting(SESSIONS_KEY, JSON.stringify(remembered))
    .catch((error) => {
      console.error("Could not save terminal sessions", error)
    })
}

/** Keeps only what `restore` can actually use — a folder that is still in the
 * workspace and a kind this app still knows about. The two optional fields are
 * checked as well as the required ones: `name` is rendered, and a settings file
 * is a file on disk like any other. */
function isRememberedSession(value: unknown): value is RememberedSession {
  const record = value as Partial<RememberedSession> | null
  return (
    typeof record?.folderId === "string" &&
    typeof record.kind === "string" &&
    SESSION_KINDS.has(record.kind) &&
    (record.closed === undefined || typeof record.closed === "boolean") &&
    (record.name === undefined ||
      record.name === null ||
      typeof record.name === "string") &&
    (record.active === undefined || typeof record.active === "boolean")
  )
}

/**
 * A session record, before anything has been started for it.
 *
 * Shared by `open` and `restore` because the two differ in what they do with
 * it, not in what it is: one puts it on screen and lets the pane start a pty,
 * the other adds a closed row that no pane will mount.
 */
function makeSession(
  folderId: string,
  kind: AgentKind,
  options?: {
    installing?: boolean
    claudeSessionId?: string | null
    view?: SessionView
    closed?: boolean
    name?: string | null
  }
): TerminalSession {
  return {
    id: crypto.randomUUID(),
    folderId,
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
    closed: options?.closed ?? false,
    name: options?.name ?? null,
    terminalId: null,
  }
}

/**
 * Closes every session `hit` picks out, and works out what is left on screen.
 *
 * The three close actions differ only in which sessions they name, so they
 * share this rather than each getting the rule about what survives closing
 * slightly wrong. What survives is a row: `terminalId` goes because the pty
 * does — unmounting the pane is what kills it — and the conversation id stays,
 * because it is the whole reason the row is worth keeping.
 *
 * Two kinds are dropped rather than closed. An install run is a shell running
 * npm, and a closed one would offer to replay an installer nobody asked to run
 * twice; a session whose pty never started has neither output nor a
 * conversation, so there is nothing behind the row.
 */
function closing(
  state: { sessions: TerminalSession[]; activeId: string | null },
  hit: (session: TerminalSession) => boolean
): { sessions: TerminalSession[]; activeId: string | null } {
  const sessions = state.sessions.flatMap((session) => {
    if (!hit(session) || session.closed) return [session]
    if (session.installing || session.terminalId === null) return []
    return [{ ...session, closed: true, terminalId: null, exited: false }]
  })

  const live = sessions.filter((session) => !session.closed)
  const activeId = live.some((session) => session.id === state.activeId)
    ? state.activeId
    : (live.at(-1)?.id ?? null)

  return { sessions, activeId }
}

let restorePromise: Promise<void> | null = null

export const useTerminal = create<TerminalState>((set, get) => {
  // A folder dropped from the workspace takes its sessions with it: the pty
  // runs in a directory the studio no longer points at, and a tab for it would
  // be one nothing else in the app can say anything about.
  useStudio.subscribe((studio) => {
    const kept = new Set(studio.folders.map((folder) => folder.id))
    const { sessions } = get()

    if (sessions.every((session) => kept.has(session.folderId))) return

    for (const session of sessions) {
      if (!kept.has(session.folderId) && session.terminalId) {
        void window.desktop.terminalKill(session.terminalId).catch(() => {})
      }
    }
    const remaining = sessions.filter((session) => kept.has(session.folderId))
    set((state) => ({
      sessions: remaining,
      activeId: remaining.some((session) => session.id === state.activeId)
        ? state.activeId
        : (remaining.at(-1)?.id ?? null),
    }))
    persistSessions(remaining, get().activeId)
  })

  return {
    sessions: [],
    activeId: null,
    tools: null,
    checkingTools: false,
    picking: null,

    openPicker(folderId) {
      set({ picking: { folderId } })
    },

    closePicker() {
      set({ picking: null })
    },

    open(folderId, kind, options) {
      if (!options?.background) useStudio.getState().showPane("terminal")

      const session = makeSession(folderId, kind, options)

      set((state) => ({
        sessions: [...state.sessions, session],
        activeId: options?.background ? state.activeId : session.id,
      }))
      persistSessions(get().sessions, get().activeId)

      return session.id
    },

    select(id) {
      useStudio.getState().showPane("terminal")
      set({ activeId: id })
      // Which tab is on screen is remembered, so switching tabs is a write like
      // opening or closing one. Without this the marker was only ever written
      // by whatever action happened to come next — closing another session,
      // renaming one — so a reload landed on the right tab or the wrong one
      // depending on what had been done since the click.
      persistSessions(get().sessions, id)
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
      set((state) => closing(state, (session) => session.id === id))
      persistSessions(get().sessions, get().activeId)
    },

    closeOthers(id) {
      set((state) => closing(state, (session) => session.id !== id))
      persistSessions(get().sessions, get().activeId)
    },

    closeAll() {
      set((state) => closing(state, () => true))
      persistSessions(get().sessions, get().activeId)
    },

    forget(id) {
      set((state) => ({
        sessions: state.sessions.filter((session) => session.id !== id),
      }))
      persistSessions(get().sessions, get().activeId)
    },

    reorder(ids) {
      set((state) => {
        const byId = new Map(
          state.sessions.map((session) => [session.id, session])
        )
        const reordered = ids
          .map((id) => byId.get(id))
          .filter(
            (session): session is TerminalSession => session !== undefined
          )
        // A stale or partial list — one that does not name every tab it claims
        // to — is left alone rather than dropping any.
        if (reordered.length !== ids.length) return state

        // Only the strip's own tabs are named, so the closed rows are put back
        // after them. That is also where they read best in the sidebar: what is
        // running first, then what is only still listed.
        const named = new Set(ids)
        const rest = state.sessions.filter((session) => !named.has(session.id))
        return { sessions: [...reordered, ...rest] }
      })
    },

    restart(id) {
      useStudio.getState().showPane("terminal")
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === id
            ? {
                ...session,
                attempt: session.attempt + 1,
                exited: false,
                closed: false,
              }
            : session
        ),
        activeId: id,
      }))
      persistSessions(get().sessions, get().activeId)
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
      persistSessions(get().sessions, get().activeId)
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
      persistSessions(get().sessions, get().activeId)
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

        // A folder removed since the app last quit is not one to reopen a
        // session against — never trusted blindly, the same as anything else
        // read back off disk.
        const { folders } = await repo.getWorkspace()
        const known = new Set(folders.map((folder) => folder.id))

        /** The session that was on screen, once it has been reopened. */
        let active: string | null = null

        for (const item of parsed) {
          if (!isRememberedSession(item) || !known.has(item.folderId)) continue

          // A closed one is added rather than opened: `open` starts a pty,
          // which is exactly what a row nobody has asked to run again must
          // not do.
          if (item.closed) {
            set((state) => ({
              sessions: [
                ...state.sessions,
                makeSession(item.folderId, item.kind, {
                  claudeSessionId: item.claudeSessionId,
                  closed: true,
                  name: item.name,
                }),
              ],
            }))
            continue
          }

          const id = get().open(item.folderId, item.kind, {
            claudeSessionId: item.claudeSessionId ?? undefined,
            name: item.name,
            // Restoring is not a user action: it must not take the pane from
            // whichever panel the last launch left on screen, and the tab that
            // ends up active is the remembered one rather than the last read.
            background: true,
          })
          if (item.active) active = id
        }

        // Nothing marked, or what was marked is a closed row now: the panel's
        // own fallback — the most recent session — applies, which is what
        // `activeSessionOf` does with a null.
        set((state) => ({ activeId: active ?? state.activeId }))

        // Written back because every `open` above already wrote the strip out
        // with no session active — reopening in the background leaves `activeId`
        // alone by design — so a launch where nothing else happens would erase
        // the very marker it just read.
        persistSessions(get().sessions, get().activeId)
      })()
      return restorePromise
    },
  }
})

/**
 * The sessions with a pty behind them — the tabs, as against the closed rows
 * the sidebar also lists.
 *
 * Everything outside the sidebar wants this rather than `sessions`: a closed
 * session is not a tab in the strip, is not mounted in the pane, and is not a
 * conversation another tab is holding open.
 */
export function liveSessions(sessions: TerminalSession[]): TerminalSession[] {
  return sessions.filter((session) => !session.closed)
}

/**
 * Which session is on screen.
 *
 * The most recent stands in whenever `activeId` names one that has since been
 * closed — a panel with tabs and nothing selected has nothing to draw. Closed
 * ones are never the answer: there is no pane mounted for them.
 */
export function activeSessionOf(
  sessions: TerminalSession[],
  activeId: string | null
): TerminalSession | null {
  const live = liveSessions(sessions)
  return live.find((session) => session.id === activeId) ?? live.at(-1) ?? null
}
