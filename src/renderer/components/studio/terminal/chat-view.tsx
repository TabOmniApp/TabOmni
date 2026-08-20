import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { Ban, Check, MessageCircleQuestion, Wrench } from "lucide-react"

import type { TranscriptBlock, TranscriptEntry } from "@shared/api"
import { useSettings } from "@/lib/settings"
import { writtenPaths } from "@/lib/terminal/touched"
import {
  ASK_USER_QUESTION,
  parseAnswers,
  parseQuestions,
  type AskedQuestion,
} from "@/lib/terminal/question"
import { parseUserMessage } from "@/lib/terminal/slash-command"
import { clamp, describeInput } from "@/lib/terminal/tool-input"
import { MarkdownView } from "../markdown-view"
import { TouchedFiles } from "./touched-files"
import "./slash-command.css"

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
   * The conversation being followed: always the one this tab's own pty is
   * running, so what is read and what is written to are the same conversation
   * and the composer is never pointed elsewhere.
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
  }>({
    target: null,
    entries: [],
    working: false,
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
 * This session's conversation, and nothing around it.
 *
 * Deliberately without a header of its own. There was one — a "Following this
 * session" line, the conversation's id, a Display settings dialog and a Past
 * sessions drawer — and every part of it was either saying what the tab strip
 * and the view switch already say, or offering a second home for something that
 * has a first one. The two switches are rows in Settings › Chat, which is where
 * a preference that outlives the pane belongs; the drawer let this tab follow
 * *another* conversation, which is the one thing this view is not for. What is
 * left is the transcript, given the whole pane.
 */
export function ChatView({
  transcript,
  visible,
}: {
  transcript: Transcript
  /** Whether the chat is the view on screen, for the pane that has to follow
   * the conversation only while someone is reading it. */
  visible: boolean
}) {
  const { entries, pending, target } = transcript
  const showToolCalls = useSettings((state) => state.showToolCalls)
  const showThinking = useSettings((state) => state.showThinking)

  return (
    <div className="flex h-full flex-col">
      <TranscriptFeed
        entries={entries}
        pending={pending}
        conversation={target}
        emptyNotice={
          target !== null
            ? "Ask for something below. Anything the agent needs permission for is asked in the Terminal view."
            : "This session has no transcript to follow. Start a new Claude Code session."
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

/** The turns themselves, scrolled. */
function TranscriptFeed({
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
