import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  Ban,
  Check,
  History,
  MessageCircleQuestion,
  Radio,
  Settings2,
  Wrench,
} from "lucide-react"

import type {
  ClaudePermissionMode,
  ClaudeUsageLimits,
  TranscriptBlock,
  TranscriptEntry,
  TranscriptSessionSummary,
  TranscriptUsage,
} from "@shared/api"
import { useTerminal } from "@/lib/terminal/store"
import { relativeTime } from "@/lib/terminal/conversations"
import { writtenPaths } from "@/lib/terminal/touched"
import {
  ASK_USER_QUESTION,
  parseAnswers,
  parseQuestions,
  type AskedQuestion,
} from "@/lib/terminal/question"
import { parseUserMessage } from "@/lib/terminal/slash-command"
import { clamp, describeInput } from "@/lib/terminal/tool-input"
import { Meter } from "../meter"
import { MarkdownView } from "../markdown-view"
import { TouchedFiles } from "./touched-files"
import "./slash-command.css"

/** Whether tool calls show up in the transcript at all, remembered across
 * runs — not per folder, since it is a taste about how busy the transcript
 * looks rather than something tied to what a session is working on.
 *
 * The stored key still says `claudeGui`, which this app no longer has: it is
 * what is already on disk for everyone using the app, and renaming it would
 * silently reset a setting rather than move it. */
const SHOW_TOOL_CALLS_KEY = "claudeGui.showToolCalls"
/** Same as `SHOW_TOOL_CALLS_KEY`, but for the model's thinking blocks. */
const SHOW_THINKING_KEY = "claudeGui.showThinking"

/**
 * One entry in the transcript.
 *
 * Flat rather than nested by turn: the pane only ever appends, and a tool call
 * whose result arrives in a later batch is far easier to fill in when it is
 * its own row than when it is buried inside a message.
 */
type Entry =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "thinking"; text: string }
  | {
      id: string
      kind: "tool"
      toolUseId: string
      name: string
      input: unknown
      /** Null until the tool has run — what draws the pending spinner. */
      result: { text: string; isError: boolean } | null
    }

let counter = 0
/** Entry keys, which only have to be unique within one mounted pane. */
function nextId(): string {
  counter += 1
  return `e${counter}`
}

function blockToEntry(block: TranscriptBlock): Entry {
  if (block.type === "tool-use") {
    return {
      id: nextId(),
      kind: "tool",
      toolUseId: block.toolUseId,
      name: block.name,
      input: block.input,
      result: null,
    }
  }
  return { id: nextId(), kind: block.type, text: block.text }
}

/**
 * Folds a batch of transcript entries into the ones already on screen.
 *
 * A tool's result is folded into the call it answers rather than kept as its
 * own row, and the two can arrive in different batches — the CLI writes the
 * call when it is made and the result whenever the tool finishes, which for a
 * long command is many appends later. That is the whole reason this takes the
 * current list rather than converting a batch on its own.
 */
function applyEntries(current: Entry[], incoming: TranscriptEntry[]): Entry[] {
  const entries = [...current]

  for (const item of incoming) {
    if (item.type === "user") {
      entries.push({ id: nextId(), kind: "user", text: item.text })
      continue
    }

    if (item.type === "assistant") {
      entries.push(...item.blocks.map(blockToEntry))
      continue
    }

    const at = entries.findIndex(
      (entry) =>
        entry.kind === "tool" &&
        entry.toolUseId === item.toolUseId &&
        entry.result === null
    )
    const call = at === -1 ? null : entries[at]
    // Replaced rather than mutated: `current` is React state, and the rows
    // above this one must keep their identity so they do not re-render.
    if (call?.kind === "tool") {
      entries[at] = {
        ...call,
        result: { text: item.text, isError: item.isError },
      }
    }
  }

  return entries
}

/**
 * The transcript behind a `claude` tab, and the state the pane and its
 * composer both need.
 *
 * A hook rather than state inside `ChatView` because the composer sits beside
 * the terminal, not the chat (see `terminal-session-view.tsx`): whether a turn
 * is in flight, and what permission mode it is running under, have to be known
 * above whichever pane happens to be on screen.
 */
export function useTranscript(session: {
  /**
   * What the mirror's events are tagged with. A session tab passes its own id;
   * a read-only conversation tab passes something of its own, since two tabs
   * may be following the same file.
   */
  id: string
  folderId: string
  claudeSessionId: string | null
}) {
  const { id, folderId, claudeSessionId } = session

  /**
   * The conversation being followed.
   *
   * For a session tab this is always the one its own pty is running: picking
   * another from the drawer restarts the pty onto it (`resumeSession` in
   * `lib/terminal/store.ts`), so what is read and what is written to are the
   * same conversation and the composer is never pointed elsewhere. A
   * conversation opened from the Explorer sidebar has no pty at all and is read
   * and nothing else — see `conversation-view.tsx`.
   */
  const target = claudeSessionId

  /**
   * The transcript, tagged with the conversation it was read from.
   *
   * Tagged rather than cleared when `target` changes: clearing would mean
   * writing state from an effect, and the rows on screen would still be the
   * previous conversation's for the render in between. Carrying the id makes
   * "these entries are not this conversation's" something the render can see.
   */
  const [feed, setFeed] = useState<{
    target: string | null
    entries: Entry[]
    /** Whether the agent owes a reply, as the CLI itself recorded it. */
    working: boolean
    /** The mode the session is in, which the CLI records on every change —
     * including a Shift+Tab at its own prompt. */
    permissionMode: ClaudePermissionMode | null
    /** What this conversation has spent, as the CLI recorded it. */
    usage: TranscriptUsage | null
  }>({
    target: null,
    entries: [],
    working: false,
    permissionMode: null,
    usage: null,
  })
  const onTarget = feed.target === target
  const entries = onTarget ? feed.entries : []

  /**
   * Messages handed to the pty but not yet read back out of the transcript.
   *
   * The round trip is a beat long — the CLI writes the line once it has taken
   * the message — and a message that vanished for that beat would read as one
   * that was not sent at all.
   *
   * Tagged with its conversation for the same reason the feed is: switching
   * the tab to another one restarts the pty, and a message the previous
   * `claude` never took is not one the new conversation is about to echo.
   */
  const [sent, setSent] = useState<{ target: string | null; texts: string[] }>({
    target: null,
    texts: [],
  })
  const pending = sent.target === target ? sent.texts : []

  useEffect(() => {
    if (target === null) return

    const unsubscribe = window.desktop.onTranscriptEvent((event) => {
      if (event.mirrorId !== id) return

      setFeed((current) => ({
        target,
        working: event.working,
        permissionMode: event.permissionMode,
        usage: event.usage,
        entries: applyEntries(
          // A `reset`, or the first event for a conversation this pane was
          // only just pointed at: either way what is held belongs to another
          // transcript and must not be appended to.
          event.type === "reset" || current.target !== target
            ? []
            : current.entries,
          event.entries
        ),
      }))

      // A user turn coming back out of the transcript is the CLI having taken
      // one of the messages above. Matched by text where it can be — a slash
      // command is stored as tags rather than as it was typed, so an unmatched
      // user turn clears the lot rather than leaving a bubble that will never
      // be matched by anything.
      const echoed = event.entries.filter((entry) => entry.type === "user")
      if (echoed.length === 0) return
      setSent((current) => {
        if (current.target !== target) return current
        let rest = current.texts
        let matched = false
        for (const entry of echoed) {
          const at = rest.findIndex(
            (text) => text.trim() === (entry as { text: string }).text.trim()
          )
          if (at === -1) continue
          matched = true
          rest = rest.filter((_, index) => index !== at)
        }
        return { target, texts: matched ? rest : [] }
      })
    })

    void window.desktop.transcriptWatch(id, folderId, target)

    return () => {
      unsubscribe()
      void window.desktop.transcriptUnwatch(id)
    }
  }, [id, folderId, target])

  /**
   * Whether the agent is mid-turn.
   *
   * Read from the transcript rather than inferred from its shape: the CLI
   * records a `stop_reason` on every assistant message, and only `tool_use`
   * means another is coming. An earlier version of this guessed from the last
   * entry instead, and was wrong for the ordinary case of a reply still being
   * written — nothing about a finished tool call says whether the agent is
   * done.
   *
   * A message just sent counts too: it is not in the file yet, but the turn it
   * starts has already begun.
   */
  const working = (onTarget && feed.working) || pending.length > 0

  const markSent = useCallback(
    (text: string) => {
      setSent((current) => ({
        target,
        texts: current.target === target ? [...current.texts, text] : [text],
      }))
    },
    [target]
  )

  /**
   * The files this conversation has written, from its own tool calls.
   *
   * Derived here rather than in the chat view because two things want it and
   * neither is that view: the strip that lists them, and the session's own
   * effect that re-reads them off disk — which has to run while the *terminal*
   * view is the one on screen, since that is where a turn is usually watched.
   *
   * Keyed on the held entries rather than the rendered ones so the identity is
   * stable between renders: an effect depending on this must not fire again
   * because a render produced a second empty array.
   */
  const touched = useMemo(
    () =>
      onTarget
        ? writtenPaths(
            feed.entries.filter(
              (entry): entry is Extract<Entry, { kind: "tool" }> =>
                entry.kind === "tool"
            )
          )
        : NO_PATHS,
    [onTarget, feed.entries]
  )

  return {
    entries,
    pending,
    working,
    target,
    touched,
    // Both belong to the conversation the pane is on, which is also the one
    // the pty is running — so neither needs qualifying beyond the feed still
    // being the previous conversation's for the render after a switch.
    usage: onTarget ? feed.usage : null,
    permissionMode: onTarget ? feed.permissionMode : null,
    markSent,
  }
}

/** One array for every "nothing here", so an effect keyed on it does not see a
 * new value on every render. */
const NO_PATHS: string[] = []

export type Transcript = ReturnType<typeof useTranscript>

/**
 * A `claude` session drawn as a chat.
 *
 * Not a session of its own: the conversation is the one running in this tab's
 * pty, read from the transcript the CLI writes as it goes
 * (`electron/transcript.ts`). Nothing here starts or stops a `claude`, which
 * is what lets the user switch between this and the terminal view mid-turn
 * without the agent noticing.
 *
 * Draws the conversation and nothing else: this is the view for reading what
 * happened, and the composer belongs to the terminal view, which is where a
 * message is written and a prompt is answered.
 *
 * What the terminal view has and this does not, both of them consequences of
 * reading a file rather than driving the CLI: replies appear a message at a
 * time rather than being typed out, and permission prompts are answered at
 * the CLI's own prompt — in the terminal view — rather than in a dialog here.
 */
/**
 * How much of a turn is drawn — tool calls and thinking — remembered in the
 * settings.
 *
 * A hook rather than state in `ChatView` because the read-only conversation
 * view draws the same transcript with the same two switches, and someone who
 * turned tool calls off did not mean "off in this pane only".
 */
export function useTranscriptDisplay() {
  const [showToolCalls, setShowToolCallsState] = useState(true)
  const [showThinking, setShowThinkingState] = useState(true)

  useEffect(() => {
    let cancelled = false
    void window.desktop.getSetting(SHOW_TOOL_CALLS_KEY).then((stored) => {
      if (cancelled || stored === null) return
      setShowToolCallsState(stored === "true")
    })
    void window.desktop.getSetting(SHOW_THINKING_KEY).then((stored) => {
      if (cancelled || stored === null) return
      setShowThinkingState(stored === "true")
    })
    return () => {
      cancelled = true
    }
  }, [])

  function setShowToolCalls(next: boolean) {
    setShowToolCallsState(next)
    void window.desktop.setSetting(SHOW_TOOL_CALLS_KEY, String(next))
  }

  function setShowThinking(next: boolean) {
    setShowThinkingState(next)
    void window.desktop.setSetting(SHOW_THINKING_KEY, String(next))
  }

  return {
    showToolCalls,
    setShowToolCalls,
    showThinking,
    setShowThinking,
  }
}

export function ChatView({
  folderId,
  transcript,
  visible,
  onResume,
}: {
  folderId: string
  transcript: Transcript
  /** Whether the chat is the view on screen, for the pane that has to follow
   * the conversation only while someone is reading it. */
  visible: boolean
  /** Puts the tab on another of the folder's conversations, restarting its
   * pty onto it — which is what makes the drawer's pick something you can
   * then talk to rather than only read. */
  onResume: (claudeSessionId: string) => void
}) {
  const { entries, pending, working, target } = transcript
  const { showToolCalls, setShowToolCalls, showThinking, setShowThinking } =
    useTranscriptDisplay()

  return (
    <div className="flex h-full flex-col">
      <Header
        working={working}
        claudeSessionId={target}
        folderId={folderId}
        onResume={onResume}
        showToolCalls={showToolCalls}
        onShowToolCallsChange={setShowToolCalls}
        showThinking={showThinking}
        onShowThinkingChange={setShowThinking}
      />
      <TranscriptFeed
        entries={entries}
        pending={pending}
        conversation={target}
        emptyNotice={
          target !== null
            ? "Ask for something below. Anything the agent needs permission for is asked in the Terminal view."
            : "This session has no transcript to follow. Continue one from Past sessions, or start a new Claude Code session."
        }
        visible={visible}
        showToolCalls={showToolCalls}
        showThinking={showThinking}
      />

      {/* Under the transcript rather than over it: the newest turn is at the
          bottom, so the file just written is next to the file list that names
          it — and to the composer below, where the next instruction goes. */}
      <TouchedFiles paths={transcript.touched} />
    </div>
  )
}

/**
 * How much context the conversation is carrying, on the assumption of a
 * 200k window.
 *
 * The transcript says how many tokens went out but never what the ceiling
 * was, and the model name does not settle it either: the 1M window is a beta
 * header rather than a different model id, so a session running with it writes
 * exactly the same lines. Rather than get it wrong in the direction that
 * matters — a bar reading "180k / 200k" on a session with most of its room
 * left — the ceiling is raised once the context is observed above it. Every
 * current model is 200k without the header.
 */
const CONTEXT_WINDOW = 200_000
const LARGE_CONTEXT_WINDOW = 1_000_000

function contextWindow(contextTokens: number): number {
  return contextTokens > CONTEXT_WINDOW ? LARGE_CONTEXT_WINDOW : CONTEXT_WINDOW
}

/** Tokens at the width a status bar has for them: three significant figures
 * at most, since the difference between 34.5k and 34.6k is not one anybody
 * reads a bar for. */
function compact(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return String(tokens)
}

/** `claude-opus-4-8` as `opus 4.8` — the name the picker and the CLI's own
 * status line use, rather than the API id nothing else in the app shows. */
function shortModel(model: string): string {
  const named = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model)
  if (!named) return model
  const [, family, major, minor] = named
  return minor ? `${family} ${major}.${minor}` : `${family} ${major}`
}

/**
 * What the conversation has cost it, along the bottom of the terminal.
 *
 * The context number is the part worth a glance mid-session: it is the one
 * that decides whether the next message will fit or set off a compaction, and
 * it falls when the CLI compacts. The totals beside it are the whole
 * conversation's, so they only ever climb.
 *
 * Under the terminal only. That is the view a message is written in, so it is
 * the only one where any of this is a question about to be answered; the chat
 * is for reading back through what happened, and gives the width to the
 * conversation.
 */
export function UsageBar({
  usage,
  limits,
}: {
  usage: TranscriptUsage | null
  /** The account's allowance, which belongs to no one conversation — see
   * `useClaudeLimits`. Null until the CLI has cached one. */
  limits: ClaudeUsageLimits | null
}) {
  // Before the first reply there is nothing to say about the conversation.
  // The allowance is worth showing anyway: "have I got the budget" is a
  // question with an answer before the first message, not only after it.
  if (!usage && !limits) return null

  const window = usage ? contextWindow(usage.contextTokens) : 0
  const filled = usage ? Math.min(1, usage.contextTokens / window) : 0

  return (
    <div className="flex shrink-0 items-center gap-2 border-t bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
      {usage && (
        <>
          <Meter percent={filled * 100} label="Context used" className="w-16" />

          <span
            className="shrink-0 tabular-nums"
            title="Everything the last request carried, against the model's context window"
          >
            {compact(usage.contextTokens)} / {compact(window)}
          </span>

          <span className="text-muted-foreground/40">·</span>

          <span
            className="shrink-0 tabular-nums"
            title={[
              `Input ${usage.inputTokens.toLocaleString()}`,
              `Output ${usage.outputTokens.toLocaleString()}`,
              `Cache write ${usage.cacheCreationTokens.toLocaleString()}`,
              `Cache read ${usage.cacheReadTokens.toLocaleString()}`,
            ].join("\n")}
          >
            ↑ {compact(usage.inputTokens + usage.cacheCreationTokens)} ↓{" "}
            {compact(usage.outputTokens)}
          </span>
        </>
      )}

      <LimitsReadout limits={limits} />

      {usage?.model && (
        <span className="ml-auto min-w-0 truncate" title={usage.model}>
          {shortModel(usage.model)}
        </span>
      )}
    </div>
  )
}

/** One of the account's windows, as far as the row is concerned. */
type LimitWindow = {
  /** `5h`, `7d` — the window itself, which is what makes the figure mean
   * something. */
  label: string
  title: string
  percent: number
  resetsAt: string | null
}

/**
 * The account's five-hour and weekly allowance, each with a meter of its own.
 *
 * Not this conversation's — it is the whole account's, spent by every `claude`
 * the user runs, which is exactly why it is worth having here: the tab in
 * front of you is not the only thing drawing on it.
 *
 * A cached figure, not a live one. The CLI refreshes it on its own schedule
 * and this app only reads what it wrote (`electron/claude-usage.ts`), so how
 * old it is goes in the tooltip rather than being quietly dropped — an
 * hour-old number shown as current is worse than one labelled as old.
 */
function LimitsReadout({ limits }: { limits: ClaudeUsageLimits | null }) {
  if (!limits) return null

  const windows: LimitWindow[] = []
  if (limits.sessionPercent !== null)
    windows.push({
      label: "5h",
      title: "Five-hour limit used",
      percent: limits.sessionPercent,
      resetsAt: limits.sessionResetsAt,
    })
  if (limits.weeklyPercent !== null)
    windows.push({
      label: "7d",
      title: "Weekly limit used",
      percent: limits.weeklyPercent,
      resetsAt: limits.weeklyResetsAt,
    })
  if (windows.length === 0) return null

  const title = [
    `Session (5h): ${percentText(limits.sessionPercent)}${resetText(limits.sessionResetsAt)}`,
    `Weekly: ${percentText(limits.weeklyPercent)}${resetText(limits.weeklyResetsAt)}`,
    "",
    `Account-wide, as of ${fetchedText(limits.fetchedAt)}.`,
    "Claude Code refreshes this on its own schedule; this reads its cache.",
  ].join("\n")

  return (
    <>
      <span className="text-muted-foreground/40">·</span>
      {windows.map((entry) => (
        <span
          key={entry.label}
          className="flex shrink-0 items-center gap-1.5"
          title={title}
        >
          {/* The window, not an abbreviation of the word "session": a
              percentage of an unnamed allowance says nothing. */}
          <span className="text-muted-foreground/70">{entry.label}</span>
          <Meter percent={entry.percent} label={entry.title} className="w-8" />
          {/* The meter alone answers "how close", the number answers "how
              close exactly" — and the colour is left to the meter so that
              one reading is not shouted twice. */}
          <span className="tabular-nums">{Math.round(entry.percent)}%</span>
        </span>
      ))}
    </>
  )
}

function percentText(percent: number | null): string {
  return percent === null ? "unknown" : `${percent}% used`
}

/** ` · resets 21:40` — the date too when it is not today, which the weekly
 * window usually is not. */
function resetText(iso: string | null): string {
  if (!iso) return ""
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ""

  const sameDay = at.toDateString() === new Date().toDateString()
  return ` · resets ${at.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(sameDay ? {} : { weekday: "short" }),
  })}`
}

function fetchedText(fetchedAt: number | null): string {
  if (fetchedAt === null) return "an unknown time"
  const minutes = Math.round((Date.now() - fetchedAt) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours === 1 ? "an hour ago" : `${hours} hours ago`
}

function Header({
  working,
  claudeSessionId,
  folderId,
  onResume,
  showToolCalls,
  onShowToolCallsChange,
  showThinking,
  onShowThinkingChange,
}: {
  working: boolean
  claudeSessionId: string | null
  folderId: string
  onResume: (claudeSessionId: string) => void
  showToolCalls: boolean
  onShowToolCallsChange: (next: boolean) => void
  showThinking: boolean
  onShowThinkingChange: (next: boolean) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
      {/* No spinner here, and none at the tail of the transcript either. A
          turn can run for minutes, and this view is the one you switch to in
          order to read: something spinning the whole time is motion at the
          edge of the eye that says nothing the word below does not. The
          composer, in the terminal view, still has its own busy state and
          its Stop. */}
      <Radio className="size-3.5 shrink-0 text-muted-foreground" />

      <span className="min-w-0 truncate text-xs text-muted-foreground">
        {working
          ? "Following this session — working"
          : "Following this session"}
      </span>

      {/* The CLI's own session id, so the conversation on screen can also be
          found with `claude --resume` from a terminal of the user's own. */}
      {claudeSessionId && (
        <span
          className="hidden shrink-0 font-mono text-[10px] text-muted-foreground/70 sm:inline"
          title={`claude --resume ${claudeSessionId}`}
        >
          {claudeSessionId.slice(0, 8)}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        <SessionsButton
          folderId={folderId}
          currentSessionId={claudeSessionId}
          onResume={onResume}
        />

        <Dialog>
          <DialogTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                title="Display settings"
                aria-label="Display settings"
                className="size-6"
              >
                <Settings2 className="size-3" />
              </Button>
            }
          />
          <DialogContent className="min-h-48 min-w-80 sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Display settings</DialogTitle>
            </DialogHeader>

            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="show-tool-calls">Show tool calls</Label>
              <Switch
                id="show-tool-calls"
                checked={showToolCalls}
                onCheckedChange={onShowToolCallsChange}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="show-thinking">Show thinking</Label>
              <Switch
                id="show-thinking"
                checked={showThinking}
                onCheckedChange={onShowThinkingChange}
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

/**
 * The drawer of past sessions: every conversation the CLI has on disk for
 * this folder, not just the one this tab is running.
 *
 * Picking one puts the tab on it — the pty restarts and resumes it, so the
 * conversation read is the conversation talked to. It is also the way back
 * from `/clear`, which starts a new conversation under a new id that this pane
 * has no way to be told about: the new session is simply the top of this list.
 *
 * Reading the list is deferred to the drawer opening rather than done on
 * mount — a repository can have years of these, and most sessions never look at
 * them.
 */
function SessionsButton({
  folderId,
  currentSessionId,
  onResume,
}: {
  folderId: string
  /** What this tab is already running, which there is nothing to restart onto. */
  currentSessionId: string | null
  onResume: (claudeSessionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<TranscriptSessionSummary[] | null>(
    null
  )

  /**
   * Conversations another tab of this folder already has open.
   *
   * Two `claude` processes resumed onto one conversation would both append to
   * the same transcript, and neither would be reading the other's lines. Those
   * are listed but not offered — the tab already holding one is where it can
   * be continued.
   */
  const openSessions = useTerminal((state) => state.sessions)
  const taken = useMemo(() => {
    const ids = new Set<string>()
    for (const session of openSessions) {
      // A closed row holds nothing: its pty is gone, so the conversation it
      // was having is free to be picked up here.
      if (session.closed) continue
      if (session.folderId !== folderId) continue
      if (
        session.claudeSessionId &&
        session.claudeSessionId !== currentSessionId
      )
        ids.add(session.claudeSessionId)
    }
    return ids
  }, [openSessions, folderId, currentSessionId])

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    setSessions(null)
    void window.desktop.claudeListSessions(folderId).then(setSessions)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            title="Past sessions"
            aria-label="Past sessions"
            className="size-6"
          >
            <History className="size-3" />
          </Button>
        }
      />
      <DrawerContent className="flex flex-col">
        <DrawerHeader>
          <DrawerTitle>Past sessions</DrawerTitle>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {sessions === null ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              No past sessions found for this folder.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {sessions.map((entry) => {
                const current = entry.id === currentSessionId
                const elsewhere = taken.has(entry.id)
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      disabled={current || elsewhere}
                      onClick={() => {
                        setOpen(false)
                        onResume(entry.id)
                      }}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left",
                        current || elsewhere
                          ? "cursor-default opacity-50"
                          : "hover:bg-muted"
                      )}
                    >
                      <span className="line-clamp-2 text-xs">
                        {entry.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {relativeTime(entry.updatedAt)}
                        {current
                          ? " — this tab"
                          : elsewhere
                            ? " — open in another tab"
                            : ""}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

/**
 * The turns themselves, scrolled.
 *
 * Exported because the read-only conversation view draws the same list from the
 * same events — what differs between the two is the strip above it and whether
 * there is a composer, not how a turn is drawn.
 */
export function TranscriptFeed({
  entries,
  pending,
  conversation,
  emptyNotice,
  visible,
  showToolCalls,
  showThinking,
}: {
  entries: Entry[]
  pending: string[]
  /** Which conversation is on screen, so that switching to another one starts
   * at its newest turn rather than carrying the last one's scroll over. */
  conversation: string | null
  /** What an empty transcript says. The reason differs per caller — a session
   * with nothing asked of it yet, or a file that has gone — and neither is
   * this component's to guess at. */
  emptyNotice: string
  /** Whether this pane is the one on screen — a hidden one keeps its layout,
   * so it can be scrolled, but scrolling it is work nobody sees. */
  visible: boolean
  showToolCalls: boolean
  showThinking: boolean
}) {
  const viewport = useRef<HTMLDivElement | null>(null)
  const content = useRef<HTMLDivElement | null>(null)

  /**
   * Whether the newest turn should keep being scrolled to.
   *
   * Not unconditional, now that the drawer can put a long finished
   * conversation in here: scrolling up to read something is a real thing to be
   * doing, and growing content that yanked the view back down would make it
   * impossible.
   */
  const stuck = useRef(true)

  useEffect(() => {
    const box = viewport.current
    const inner = content.current
    if (!box || !inner) return

    // `scrollTop` rather than `scrollIntoView`, which scrolls *every*
    // scrollable ancestor — with each session's pane stacked absolutely over
    // the others, that reaches panes this one has no business moving.
    const stick = () => {
      box.scrollTop = box.scrollHeight
    }

    // A pane that filled in while it was hidden has the right height and the
    // wrong scroll position, so being shown is itself a reason to re-stick —
    // and to take the user back to the live end of the conversation.
    if (visible) {
      stuck.current = true
      stick()
    }

    // Read from the user's own scrolling rather than recomputed when content
    // arrives: by the time a `ResizeObserver` fires, the box has already grown
    // and "how far from the bottom" no longer answers the question. Our own
    // `stick()` lands exactly at the bottom, so it leaves this true.
    const onScroll = () => {
      // A few pixels of slack: a fractional scroll height, or a pane whose
      // layout rounds differently, should still count as at the bottom.
      stuck.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24
    }
    box.addEventListener("scroll", onScroll, { passive: true })

    /*
     * Driven by the content's own height rather than by a list of state that
     * ought to change it. Two things went wrong with the latter: the spinner
     * appearing is a height change with no new entry behind it, and markdown
     * settles a frame after the entry that carried it. A `ResizeObserver` sees
     * every one of those without having to name them.
     */
    const observer = new ResizeObserver(() => {
      if (visible && stuck.current) stick()
    })
    observer.observe(inner)

    return () => {
      box.removeEventListener("scroll", onScroll)
      observer.disconnect()
    }
  }, [visible])

  /**
   * Back to the newest turn whenever the tab changes conversation.
   *
   * `stuck` is the user's own position, and it has no meaning across a switch:
   * having scrolled up to read something, then picking another session from
   * the drawer, would otherwise open that conversation at whatever offset the
   * last one was left at — the top of it, once the shorter empty state has
   * clamped `scrollTop`. The sticking itself is left to the `ResizeObserver`
   * above, which is what sees the new transcript actually arrive.
   */
  useEffect(() => {
    stuck.current = true
    const box = viewport.current
    if (box) box.scrollTop = box.scrollHeight
  }, [conversation])

  // Between tool calls the model often narrates what it is about to do —
  // useful while `describeInput`/`clamp` are showing raw commands and output
  // right below, close to noise once those are hidden. With tool details
  // off, only the last text of each run up to the next user message (the
  // actual answer) earns a place on screen.
  const staleTextIds = useMemo(() => {
    const stale = new Set<string>()
    if (showToolCalls) return stale
    let lastTextId: string | null = null
    for (const entry of entries) {
      if (entry.kind === "user") {
        lastTextId = null
        continue
      }
      if (entry.kind !== "text") continue
      if (lastTextId !== null) stale.add(lastTextId)
      lastTextId = entry.id
    }
    return stale
  }, [entries, showToolCalls])

  const empty = entries.length === 0 && pending.length === 0

  // The empty state renders *inside* the viewport rather than in place of it.
  // Returning a different tree unmounted the scrolled box, and the effect
  // above — keyed on `visible`, which a conversation switch does not change —
  // never ran again to observe the one that replaced it. Every switch passes
  // through empty for a beat, so the pane it left behind had no observer and
  // no scroll listener at all.
  return (
    <div
      ref={viewport}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto",
        empty ? "flex items-center justify-center px-6" : "px-3 py-3"
      )}
    >
      <div ref={content} className="flex w-full flex-col gap-3">
        {empty ? (
          <p className="mx-auto max-w-sm text-center text-xs text-muted-foreground">
            {emptyNotice}
          </p>
        ) : (
          <>
            {entries.map((entry) =>
              staleTextIds.has(entry.id) ? null : (
                <EntryView
                  key={entry.id}
                  entry={entry}
                  showToolCalls={showToolCalls}
                  showThinking={showThinking}
                />
              )
            )}

            {/* A message the CLI has taken but not yet written back. Dimmed,
                so it is not read as part of the conversation until it is one. */}
            {pending.map((text, index) => (
              // Index keys: the list is only ever appended to and filtered by
              // index, and a message is not identified by its text — the same
              // follow-up twice is a fair thing to send.
              <UserMessage
                key={index}
                text={text}
                className="max-w-[85%] opacity-60"
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function EntryView({
  entry,
  showToolCalls,
  showThinking,
}: {
  entry: Entry
  showToolCalls: boolean
  showThinking: boolean
}) {
  switch (entry.kind) {
    case "user":
      return <UserMessage text={entry.text} />

    case "text":
      return <MarkdownView source={entry.text} />

    case "thinking":
      return showThinking ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Thinking</summary>
          <p className="mt-1 break-words whitespace-pre-wrap italic">
            {entry.text}
          </p>
        </details>
      ) : null

    case "tool": {
      // The one tool call that is not a tool call as far as the reader is
      // concerned: the agent is asking *them* something, and the session is
      // stopped until it is answered. Drawn whatever "Show tool calls" says,
      // because hiding it is precisely what makes the chat look stalled.
      const asked =
        entry.name === ASK_USER_QUESTION ? parseQuestions(entry.input) : null
      if (asked) return <QuestionCard questions={asked} result={entry.result} />

      // Off, an ordinary tool call is not worth a place on screen at all —
      // the spinner during the turn and the final text after it already say
      // that something happened.
      return showToolCalls ? <ToolCard entry={entry} /> : null
    }
  }
}

/**
 * An `AskUserQuestion` the agent is waiting on, or the answer it got.
 *
 * Read-only, like the rest of this pane: the choice is made at the CLI's own
 * prompt in the terminal view, the same as a permission prompt.
 */
function QuestionCard({
  questions,
  result,
}: {
  questions: AskedQuestion[]
  result: Extract<Entry, { kind: "tool" }>["result"]
}) {
  // No result yet is the whole point of this card: the agent has stopped and
  // the session is waiting on the terminal view.
  const pending = result === null
  const answers = useMemo(
    () =>
      result === null ? new Map<string, string>() : parseAnswers(result.text),
    [result]
  )

  return (
    <div
      className={cn(
        "rounded-lg border",
        pending ? "border-warning/60 bg-warning/5" : "bg-muted/30"
      )}
    >
      <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
        <MessageCircleQuestion
          className={cn(
            "size-3.5 shrink-0",
            pending ? "text-warning" : "text-muted-foreground"
          )}
        />
        <span className="text-xs font-medium">
          {pending ? "Waiting for your answer" : "You answered"}
        </span>
        {pending && (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            Answer in the Terminal view
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 px-2.5 py-2">
        {questions.map((asked) => {
          const chosen = answers.get(asked.question)
          return (
            <div key={asked.question} className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2">
                {asked.header && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {asked.header}
                  </span>
                )}
                <span className="text-xs font-medium">{asked.question}</span>
              </div>

              <ul className="flex flex-col gap-1">
                {asked.options.map((option, index) => {
                  // The answer is the label the CLI wrote back, so an option
                  // is the chosen one when the two read the same. A custom
                  // answer ("Other") matches nothing here and is shown on its
                  // own below, rather than silently marking no option at all.
                  const picked = chosen === option.label
                  const body = (
                    <>
                      <span className="shrink-0 pt-px font-mono text-[10px] text-muted-foreground">
                        {index + 1}.
                      </span>
                      <div className="min-w-0 text-left">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs">{option.label}</span>
                          {picked && (
                            <Check className="size-3 shrink-0 text-muted-foreground" />
                          )}
                        </div>
                        {option.description && (
                          <p className="text-[11px] text-muted-foreground">
                            {option.description}
                          </p>
                        )}
                      </div>
                    </>
                  )

                  const shape = cn(
                    "flex w-full gap-2 rounded-md border px-2 py-1",
                    picked
                      ? "border-foreground/30 bg-background"
                      : "border-transparent",
                    // Once answered, the roads not taken are still worth
                    // having on screen — but not at the same weight.
                    !pending && !picked && "opacity-50"
                  )

                  return (
                    <li key={option.label}>
                      <div className={shape}>{body}</div>
                    </li>
                  )
                })}
              </ul>

              {/* "Other" at the CLI's prompt, or an answer whose wording this
                  could not match back to an option. Either way it is what the
                  agent was actually told, so it belongs on screen. */}
              {chosen !== undefined &&
                !asked.options.some((option) => option.label === chosen) && (
                  <p className="text-[11px] text-muted-foreground">
                    Answered: {chosen}
                  </p>
                )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One user turn — usually prose, but a slash command has to be unwrapped
 * first (`lib/terminal/slash-command.ts` explains what the CLI does to one).
 *
 * A command is drawn as the `/name` it was invoked as rather than as the tags
 * it is stored in, and highlighted: in a transcript of prose, the one line the
 * user did not write in prose is worth finding at a glance.
 */
function UserMessage({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const parts = useMemo(() => parseUserMessage(text), [text])

  // Everything the turn held was the CLI talking to itself (a lone caveat, an
  // empty `command-args`), and an empty bubble says less than no bubble.
  if (parts.length === 0) return null

  return (
    <div
      className={cn(
        "flex max-w-[85%] flex-col items-end gap-1.5 self-end",
        className
      )}
    >
      {parts.map((part, index) => {
        // Index keys: parts are derived from one immutable string, so the list
        // is rebuilt whole or not at all and never reordered in place.
        const key = index

        if (part.kind === "command") {
          return (
            <div
              key={key}
              // `items-start`, so the chip labels the arguments under it
              // instead of floating off at the bubble's right edge.
              className="flex max-w-full flex-col items-start gap-1 rounded-lg border bg-muted/60 px-3 py-2"
            >
              <code className="slash-chip rounded px-1.5 py-0.5 font-mono text-xs font-medium">
                /{part.name}
              </code>
              {/* The arguments as typed, not as markdown: they are a literal
                  string handed to the command, and a `*` in them is a `*`. */}
              {part.args !== "" && (
                <span className="text-sm break-words whitespace-pre-wrap">
                  {part.args}
                </span>
              )}
            </div>
          )
        }

        if (part.kind === "output") {
          // A local command's own printout — recorded as a user turn, but
          // nobody's message, so it gets neither the bubble nor the markdown.
          return (
            <pre
              key={key}
              className="max-w-full overflow-x-auto rounded-md border border-dashed px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground"
            >
              {clamp(part.text)}
            </pre>
          )
        }

        // Markdown here too: the composer is a markdown editor, so this is what
        // the user actually wrote rather than the source they typed to get it.
        return (
          <div
            key={key}
            className="max-w-full rounded-lg border bg-muted/60 px-3 py-2"
          >
            <MarkdownView source={part.text} />
          </div>
        )
      })}
    </div>
  )
}

function ToolCard({ entry }: { entry: Extract<Entry, { kind: "tool" }> }) {
  const { result } = entry

  return (
    <details className="group rounded-lg border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 select-none group-open:border-b [&::-webkit-details-marker]:hidden">
        <Wrench className="size-3 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">{entry.name}</span>
        <span className="ml-auto shrink-0">
          {result === null ? (
            <Spinner className="size-3 text-muted-foreground" />
          ) : result.isError ? (
            <Ban className="size-3 text-destructive" />
          ) : (
            <Check className="size-3 text-muted-foreground" />
          )}
        </span>
      </summary>

      <pre className="overflow-x-auto px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap">
        {describeInput(entry.input)}
      </pre>

      {result !== null && result.text !== "" && (
        <pre
          className={cn(
            "overflow-x-auto border-t px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap",
            result.isError ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {clamp(result.text)}
        </pre>
      )}
    </details>
  )
}
