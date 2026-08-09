import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from "@/components/ui/resizable"
import { cn } from "@/lib/utils"
import { MessagesSquare, RotateCw, SquareTerminal } from "lucide-react"

import type { AgentKind, ClaudePermissionMode } from "@shared/api"
import { SESSION_TYPES } from "@/lib/terminal/catalog"
import { useClaudeLimits } from "@/lib/terminal/limits"
import {
  useTerminal,
  type TerminalSession,
  type SessionView,
} from "@/lib/terminal/store"
import { ChatComposer } from "./chat-composer"
import { ChatView, UsageBar, useTranscript } from "./chat-view"
import { TerminalView, type TerminalHandle } from "../terminal-view"

/** What a session's start resolves to, either way it got there — an installer
 * run, or the session itself. */
type Started = {
  id: string
  /** The conversation the pty is actually running, for the chat to follow. */
  claudeSessionId: string | null
}

/**
 * Starts a pty, under the conversation this tab already has if it has one.
 *
 * `known` is that conversation, set on a restart. The main process turns it
 * into `--resume` when the CLI has a transcript for it and `--session-id` when
 * it does not, so a restart keeps the conversation and only the settings
 * change. An id is minted only when there is nothing to continue — the CLI
 * refuses `--session-id` for one it has already used ("Session ID … is already
 * in use").
 *
 * Every session is started this way. A pty is never reattached: they are
 * killed when the app quits (`electron/terminal.ts`), so that a session always
 * runs the command the current build would give it rather than whatever flags
 * it happened to be started with.
 */
async function createSession(
  projectId: string,
  cols: number,
  rows: number,
  kind: AgentKind,
  known: string | null
): Promise<Started> {
  const claudeSessionId =
    known ?? (kind === "claude" ? crypto.randomUUID() : null)
  const id = await window.desktop.terminalCreate(
    projectId,
    cols,
    rows,
    kind,
    claudeSessionId ?? undefined
  )
  return { id, claudeSessionId }
}

/**
 * The mode the CLI's own status line is showing, read out of the terminal
 * stream.
 *
 * The transcript is the authoritative record but a turn behind: the CLI writes
 * `permission-mode` as a prompt is *submitted*, so a mode cycled with
 * Shift+Tab would not reach the composer until the next message. The status
 * line changes immediately, and this app already has every byte of it.
 *
 * Reading a TUI's own chrome is as brittle as it sounds — a reworded status
 * line stops this working. It fails in the only acceptable direction: the
 * control keeps showing the last mode it was sure of, which is what it did
 * before this existed. The `⏸`/`⏵` glyphs are required so that the same words
 * appearing in a reply the agent has printed cannot be mistaken for the
 * indicator.
 */
const MODE_LINE =
  /[\u23f8\u23f5]+\s*(manual mode|accept edits|plan mode|auto mode) on/g

const MODE_NAMES: Record<string, ClaudePermissionMode> = {
  "manual mode": "default",
  "accept edits": "acceptEdits",
  "plan mode": "plan",
  "auto mode": "auto",
}

/**
 * The last mode named in `chunk`, or null.
 *
 * `tail` carries the end of the previous chunk, because a redraw can put the
 * indicator across a read boundary — the same reason the transcript mirror
 * holds a partial line.
 */
function readModeLine(
  tail: { current: string },
  chunk: string
): ClaudePermissionMode | null {
  const text = tail.current + chunk
  tail.current = text.slice(-80)

  let found: ClaudePermissionMode | null = null
  for (const match of text.matchAll(MODE_LINE)) {
    found = MODE_NAMES[match[1]!] ?? found
  }
  return found
}

/**
 * One session in the Terminal panel, on the host and in the open project's
 * directory.
 *
 * Deliberately outside the sandbox: a shell — and the CLIs run from one — edit
 * the very files shown in the editor, and they are installed on the machine
 * rather than in the project's container. That also means toggling the sandbox
 * leaves a session alone — unlike a container's shell, it is not keyed on the
 * runtime.
 */
export function TerminalSessionView({
  session,
  visible,
}: {
  session: TerminalSession
  /** Whether this session's tab is the one on screen. Every session stays
   * mounted — a pty taken out of the tree would end, not hide — so panes that
   * only matter when read take this rather than assuming they are. */
  visible: boolean
}) {
  // The id arrives asynchronously, but keystrokes can be typed before it does,
  // so writes go through a ref rather than state.
  const terminalId = useRef<string | null>(null)
  // Whether the composer below has something to write to yet — a ref alone
  // wouldn't re-render the Send button's disabled state.
  const [ready, setReady] = useState(false)
  const setExited = useTerminal((state) => state.setExited)
  const setTerminalId = useTerminal((state) => state.setTerminalId)
  const restart = useTerminal((state) => state.restart)
  const resumeSession = useTerminal((state) => state.resumeSession)
  const refreshTools = useTerminal((state) => state.refreshTools)

  const setView = useTerminal((state) => state.setView)

  const { id, projectId, kind, installing, claudeSessionId } = session

  // An install run is a pty whatever kind asked for it — it is the CLI's own
  // installer, printing to a pane the user can read and answer — so only a
  // started session is offered the chat.
  const claudeSession = kind === "claude" && !installing
  const chat = claudeSession && session.view === "chat"

  /** The composer's panel, collapsed to nothing while the chat is showing —
   * the only way to take its space back without unmounting it. */
  const composerPanel = usePanelRef()
  useEffect(() => {
    if (chat) composerPanel.current?.collapse()
    else composerPanel.current?.expand()
  }, [chat, composerPanel])

  // Followed whichever view is on screen: the composer needs to know whether a
  // turn is in flight even while the terminal is what is being shown.
  const transcript = useTranscript(session)
  // Account-wide rather than this session's, and shared with every other tab
  // reading it — see `lib/terminal/limits.ts`.
  const limits = useClaudeLimits()

  /** The mode the CLI's status line last showed — see `readModeLine`. Null
   * until it has shown one, when the transcript's slower answer stands in. */
  const [cycledMode, setCycledMode] = useState<ClaudePermissionMode | null>(
    null
  )
  const modeTail = useRef("")

  const onReady = useCallback(
    (terminal: TerminalHandle) => {
      let disposed = false
      let unsubscribeData: (() => void) | undefined
      let unsubscribeExit: (() => void) | undefined

      setReady(false)
      // A restart is a different process, so whatever its predecessor's status
      // line last said is not about this one.
      setCycledMode(null)
      modeTail.current = ""

      const start: Promise<Started> = installing
        ? window.desktop
            .agentInstall(terminal.cols, terminal.rows, kind)
            .then((created) => ({
              id: created,
              // An install run is a shell running npm, not a conversation.
              claudeSessionId: null,
            }))
        : createSession(
            projectId,
            terminal.cols,
            terminal.rows,
            kind,
            // Set on a restart: the conversation this tab was already having.
            claudeSessionId
          )

      void start
        .then(({ id: created, claudeSessionId: running }) => {
          // The pane unmounted while the session was starting; it would
          // otherwise be left running with nothing reading it.
          if (disposed) {
            void window.desktop.terminalKill(created)
            return
          }

          terminalId.current = created
          setTerminalId(id, created, running)
          setReady(true)

          unsubscribeData = window.desktop.onTerminalData((event) => {
            if (event.terminalId !== created) return
            terminal.write(event.chunk)

            if (kind !== "claude" || installing) return
            const mode = readModeLine(modeTail, event.chunk)
            if (mode) setCycledMode(mode)
          })

          unsubscribeExit = window.desktop.onTerminalExit((event) => {
            if (event.terminalId !== created) return
            terminalId.current = null
            setReady(false)
            setExited(id, true)
            terminal.write(
              `\r\n\x1b[90m[exited with ${event.exitCode}]\x1b[0m\r\n`
            )
            // An installer that has just finished is the one moment the
            // picker's answer is certainly stale.
            if (installing) void refreshTools()
          })
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          setReady(false)
          setExited(id, true)
          terminal.write(`\x1b[31m${message}\x1b[0m\r\n`)
        })

      terminal.onData((data) => {
        const current = terminalId.current
        if (current) void window.desktop.terminalWrite(current, data)
      })

      return () => {
        disposed = true
        unsubscribeData?.()
        unsubscribeExit?.()

        const current = terminalId.current
        terminalId.current = null
        if (current) void window.desktop.terminalKill(current)
      }
    },
    [
      id,
      projectId,
      kind,
      installing,
      claudeSessionId,
      setExited,
      setTerminalId,
      refreshTools,
    ]
  )

  const onResize = useCallback((size: { cols: number; rows: number }) => {
    const current = terminalId.current
    if (current)
      void window.desktop.terminalResize(current, size.cols, size.rows)
  }, [])

  /**
   * Injects a composed message as if it had been typed and then Enter
   * pressed — bracketed paste is what keeps a multi-line message from being
   * read as several separately-submitted lines (the same mechanism a real
   * terminal emulator uses for a clipboard paste, which these CLIs already
   * handle correctly). Any literal ESC byte is stripped first: it is the
   * only thing that could break that framing, and never something a
   * composed message legitimately needs to contain.
   */
  function sendToTerminal(text: string) {
    const current = terminalId.current
    if (!current) return
    const sanitized = text.replaceAll("\x1b", "")
    void window.desktop.terminalWrite(current, `\x1b[200~${sanitized}\x1b[201~`)
    void window.desktop.terminalWrite(current, "\r")
  }

  /** What Escape at the CLI's own prompt does: ends the turn, not the session.
   * The only interrupt an outside UI has for a TUI — there is no control
   * channel, so this is a keystroke like any other. */
  function interruptTerminal() {
    const current = terminalId.current
    if (current) void window.desktop.terminalWrite(current, "\x1b")
  }

  const terminalView = (
    <TerminalView
      // Remounting is what starts the session over, so the key carries the
      // attempt: "Restart" replaces a session that has ended.
      key={`${id}:${session.attempt}`}
      onReady={onReady}
      onResize={onResize}
    />
  )

  /** The pane above the composer: the terminal, the chat, or both with one
   * hidden — the pty must stay mounted either way, since it *is* the session
   * and unmounting it would end the conversation rather than hide it.
   * `invisible` keeps its layout, which xterm needs to hold a size that still
   * matches what the CLI was told. */
  const pane = claudeSession ? (
    <div className="relative h-full w-full">
      <div
        className={cn("absolute inset-0 flex flex-col", chat && "invisible")}
      >
        <div className="min-h-0 flex-1">{terminalView}</div>
        {/* Only under the terminal: this is the view a message is written
            in, so it is the only one where any of these numbers is a
            question about to be answered. */}
        <UsageBar usage={transcript.usage} limits={limits} />
      </div>
      <div className={cn("absolute inset-0", !chat && "invisible")}>
        <ChatView
          projectId={projectId}
          transcript={transcript}
          visible={visible && chat}
          // Restarts this tab's pty onto the picked conversation, which is
          // what makes it one the composer below can talk to.
          onResume={(picked) => resumeSession(id, picked)}
        />
      </div>
    </div>
  ) : (
    terminalView
  )

  function sendFromComposer(text: string) {
    if (claudeSession) transcript.markSent(text)
    sendToTerminal(text)
  }

  return (
    <div className="relative flex h-full w-full flex-col">
      {claudeSession && (
        <ViewSwitch
          view={session.view}
          onChange={(next) => setView(id, next)}
        />
      )}

      <div className="min-h-0 flex-1">
        {/* The group stays mounted whichever view is showing, and only the
            composer's panel comes and goes: `pane` moving between two places
            in the tree would unmount the pty, which *is* the session. */}
        <ResizablePanelGroup orientation="vertical" className="h-full">
          <ResizablePanel minSize={30} defaultSize={60}>
            {pane}
          </ResizablePanel>
          {/* The composer belongs to the terminal view: it writes into the
              CLI's own prompt, so the chat — which only reads the transcript —
              gives the whole pane over to what it is there to show. A plain
              terminal session has no composer at all; its prompt is right
              there.

              Collapsed rather than unmounted, because an unmounted composer
              loses a half-written message and its attachments — they are its
              own state. Collapsed rather than hidden with a class, too: a
              `Panel`'s `className` lands on a div *inside* the panel, while
              the panel itself keeps an inline `display: flex` no class can
              reach, so hiding it emptied the box without giving back the
              40% it was holding. `collapse()` is the library's own answer,
              and the size the handle was dragged to comes back with
              `expand()`. */}
          {kind !== "terminal" && (
            <>
              <ResizableHandle className={cn(chat && "hidden")} />
              {/* Defaults small, like an actual chat input — Crepe's own
                  placeholder/toolbar/block-menu chrome reads as an oversized,
                  mostly-empty box at the 30% this used to default to. Still
                  a `ResizablePanel`, so dragging the handle for more room
                  still works exactly as before. */}
              <ResizablePanel
                minSize={10}
                defaultSize={40}
                collapsible
                collapsedSize={0}
                panelRef={composerPanel}
              >
                <ChatComposer
                  onSend={sendFromComposer}
                  disabled={!ready || session.exited}
                  // Inferred from the transcript even though the terminal is
                  // what is on screen — it is the same session either way.
                  busy={claudeSession && transcript.working}
                  // Escape at the CLI's own prompt: ends the turn, not the
                  // session. Only Claude Code, whose turn this can identify.
                  onInterrupt={claudeSession ? interruptTerminal : undefined}
                  // Only Claude Code: the `/` menu is built from that CLI's own
                  // commands and skills, which a plain shell has none of.
                  claudeProjectId={kind === "claude" ? projectId : null}
                  // This composer writes into the CLI's own prompt, so a `/…`
                  // line it sends is run as a command rather than read as text.
                  runsSlashCommands={kind === "claude"}
                  // Model is the one the CLI will change from its own prompt.
                  // Permission mode gets no callback: it stays a startup flag
                  // on purpose (see `agentCommandWith`), so it needs the
                  // restart below — which resumes the same conversation.
                  onApplyModel={
                    kind === "claude"
                      ? (model) => sendFromComposer(`/model ${model}`)
                      : undefined
                  }
                  // The composer's permission mode only reaches the CLI at
                  // startup, so it needs a way to start the session over —
                  // the same `restart` the exited-session button uses.
                  onRestart={() => restart(id)}
                  // What the session is actually in, so cycling it with
                  // Shift+Tab in the terminal moves this control too.
                  // The status line first, since it is the one that moves the
                  // moment the mode does; the transcript's record stands in
                  // until the CLI has drawn one.
                  permissionMode={
                    claudeSession
                      ? (cycledMode ?? transcript.permissionMode)
                      : null
                  }
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {session.exited && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => restart(id)}
          className="absolute top-2 right-3 h-6 gap-1 px-2 text-xs"
        >
          <RotateCw className="size-3" />
          {installing ? `Run again` : `Restart ${SESSION_TYPES[kind].label}`}
        </Button>
      )}
    </div>
  )
}

/**
 * Terminal or chat, for a Claude Code session.
 *
 * Deliberately not a per-project setting: which one is useful changes within a
 * single session — the chat to read what happened, the terminal to answer a
 * permission prompt — so it is a control on the pane rather than a preference
 * buried in settings.
 */
function ViewSwitch({
  view,
  onChange,
}: {
  view: SessionView
  onChange: (view: SessionView) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b bg-muted/40 px-2 py-1">
      {(
        [
          ["terminal", "Terminal", SquareTerminal],
          ["chat", "Chat", MessagesSquare],
        ] as const
      ).map(([value, label, Icon]) => (
        <Button
          key={value}
          type="button"
          size="xs"
          variant={view === value ? "secondary" : "ghost"}
          onClick={() => onChange(value)}
          aria-pressed={view === value}
          className="h-6 gap-1 px-2 text-xs"
        >
          <Icon className="size-3" />
          {label}
        </Button>
      ))}
    </div>
  )
}
