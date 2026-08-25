import { useState } from "react"
import {
  Brain,
  Check,
  Coins,
  Copy,
  FileText,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react"

import type { AssistantMessage } from "@shared/api"
import { iconFor } from "@/lib/files/icons"
import { nameOf } from "@/lib/files/paths"
import { useSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { AGENT_TOOL } from "@/lib/worktree-chat/activity"
import { usageDetail, usageLine } from "@/lib/worktree-chat/usage"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { MarkdownView } from "../markdown-view"
import { IconButton } from "../icon-button"
import { MentionText } from "./chat-composer"
import { toolLabel, toolMark } from "./chat-marks"

/**
 * One line of an agent conversation.
 *
 * One file for every role rather than a component per role: a turn arrives as
 * `AssistantMessage`s, and a tool call, a decision, an error and a reply have to
 * read as one conversation.
 *
 * A tool call is a row rather than a bubble, and only the user's line gets one:
 * whose turn it is has to be readable without reading it.
 *
 * **A tool row is four things, not a string.** An icon saying which kind of tool
 * it was, what the model said it was doing, the file it was about drawn as a
 * chip with its own file-type icon, and what came back. They are separate
 * because they are read at different speeds: the icons are scanned, the chips
 * are looked for, and the argument is read only when one of the first two
 * caught the eye. A single line of `Read /Users/…/worktrees/<uuid>/…/x.tsx`
 * defeats all three.
 */
export function ChatMessage({ of }: { of: AssistantMessage }) {
  // Settings › Chat, under the key a chat view that no longer exists wrote.
  // Read here rather than by the pane: the switch is about the rows, and the
  // rows are this file.
  const showToolCalls = useSettings((state) => state.showToolCalls)
  const showThinking = useSettings((state) => state.showThinking)

  if (of.role === "user") {
    return (
      <div className="relative ml-4">
        <div className="rounded-lg rounded-br-sm bg-accent/60 py-1.5 pr-8 pl-2.5 text-xs">
          <MentionText text={of.text} />
        </div>
        <CopyMessage text={of.text} />
      </div>
    )
  }

  if (of.role === "thinking") {
    if (!showThinking) return null
    return (
      <div className="flex items-baseline gap-1.5 px-1 text-[0.7rem] text-muted-foreground">
        <Brain className="size-3 shrink-0 translate-y-0.5" />
        <span className="shrink-0 font-medium">Thinking</span>
        {/* One line of it, in a box of its own. The whole of a reasoning block
            is paragraphs, and a chat that ran it out in full would be the
            model's working louder than its answer. */}
        <span className="min-w-0 truncate rounded bg-muted/60 px-1.5 py-0.5 opacity-80">
          {of.text}
        </span>
      </div>
    )
  }

  if (of.role === "tool") {
    if (!showToolCalls) return null
    return <ToolRow of={of} />
  }

  if (of.role === "ask") {
    // A row like a tool call rather than a bubble, and for the same reason: it
    // is a note about the turn rather than either side speaking. Under
    // `showToolCalls` too — somebody who has turned the machinery off does not
    // want half of it back — except that a refusal changed what the turn did,
    // so it says so either way.
    const refused = of.text.startsWith("Refused")
    if (!showToolCalls && !refused) return null
    return (
      <div
        className={cn(
          "flex items-baseline gap-1.5 px-1 text-[0.7rem]",
          refused ? "text-destructive/80" : "text-muted-foreground"
        )}
      >
        <ShieldCheck className="size-3 shrink-0 translate-y-0.5" />
        <span className="truncate">{of.text}</span>
      </div>
    )
  }

  if (of.role === "usage") {
    /*
     * What the turn cost, at the end of it.
     *
     * Outside `showToolCalls` and outside the fold: the cost of a turn is not
     * part of its working — it is the one line that is about the turn rather
     * than in it — and a number somebody has to open a fold to find is a number
     * nobody reads until the bill arrives. One row, muted, with the three prompt
     * figures on the hover line.
     */
    return (
      <div
        title={usageDetail(of.usage)}
        className="flex items-baseline gap-1.5 px-1 text-[0.7rem] text-muted-foreground/80"
      >
        <Coins className="size-3 shrink-0 translate-y-0.5" />
        <span className="truncate">{usageLine(of.usage)}</span>
      </div>
    )
  }

  if (of.role === "error") {
    return (
      <p
        className={cn(
          "rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-1.5",
          "text-xs break-words whitespace-pre-wrap text-destructive"
        )}
      >
        <TriangleAlert className="mr-1.5 inline size-3 shrink-0 -translate-y-px" />
        {of.text}
      </p>
    )
  }

  // The renderer the Explorer's Markdown preview uses, so a table or a code
  // block in a reply reads the way it does in a file.
  return (
    <div className="relative">
      <MarkdownView source={of.text} className="pr-8 pl-1 text-xs" />
      <CopyMessage text={of.text} />
    </div>
  )
}

/**
 * A message's copy button, always on screen in the message's top-right corner.
 *
 * In the corner rather than under, and always there rather than on hover: the
 * button belongs to the message, so it sits against the message itself, and a
 * button that is only revealed by hovering is one nobody new knows is there.
 * The content clears it by the right padding the message already reserves, so
 * it never covers a word. The check on the button and the tooltip both say
 * "Copied" for a moment, the way the grid's cell dialog does, so a click
 * answers itself.
 */
function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <IconButton
      label={copied ? "Copied" : "Copy message"}
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      className="absolute top-0.5 right-0.5 text-muted-foreground"
    >
      {copied ? <Check /> : <Copy />}
    </IconButton>
  )
}

/**
 * One tool call.
 *
 * The lead is what the model said it was doing when it said anything — a
 * `Bash` and a `Task` carry a `description`, and "Check IPC wiring for
 * attachments" is a better row than "Bash". Everything else falls back to the
 * tool's own name, which is what the CLI called it.
 */
function ToolRow({ of }: { of: Extract<AssistantMessage, { role: "tool" }> }) {
  const agent = of.name === AGENT_TOOL

  /*
   * An edit says how much it moved, not what the CLI said about it.
   *
   * The result of an `Edit` is a sentence — "The file /Users/…/review-panel.tsx
   * has been updated. Here's the result of running `cat -n`…" — and it was the
   * widest thing in the row: forty characters of a path the chip beside it was
   * already showing, then a clause about `cat -n`. `+3 −1` is the same fact in
   * the form a reader wants it, and the lines themselves are one click away.
   *
   * The sentence comes back when the call **failed**, which is the one time it
   * is the thing worth reading — an edit that could not find its `old_string`
   * says so there and nowhere else.
   */
  const stat = of.failed ? undefined : of.stat
  const said = stat ?? of.result

  /* A button when there is something to open and a plain row otherwise: `type`,
   * the focus ring and `aria-expanded` come with the element rather than being
   * attributes remembered by hand, and the hover treatment is what makes the one
   * row in a turn that opens look as though it does. */
  const openable = Boolean(of.change && of.path)
  const Element = openable ? "button" : "div"

  const row = (
    <Element
      {...(openable ? { type: "button" as const } : {})}
      className={cn(
        "flex w-full items-baseline gap-1.5 rounded px-1 text-left",
        "text-[0.7rem] text-muted-foreground",
        openable && "hover:bg-muted/60 hover:text-foreground"
      )}
    >
      {toolMark(of.name, "size-3 shrink-0 translate-y-0.5")}

      <span className="shrink-0 font-medium text-foreground/80">
        {agent ? "Agent" : (of.title ?? toolLabel(of.name))}
      </span>

      {/* What came back, next to what it was — `Read` and `631 lines` are one
          fact, and putting the count at the end of the row would leave it
          against whichever argument happened to be longest. */}
      {said && (
        <span className={cn("shrink-0", of.failed && "text-destructive/80")}>
          {said}
        </span>
      )}

      {/* The subagent's own name reads as a second label rather than an
          argument: which agent ran is the sentence, not a parameter of it. */}
      {agent && of.summary && (
        <span className="shrink-0 text-foreground/60">· {of.summary}</span>
      )}
      {agent && of.title && (
        <span className="min-w-0 truncate font-mono opacity-70">
          {of.title}
        </span>
      )}

      {of.path ? (
        <FileChip path={of.path} />
      ) : (
        !agent &&
        of.summary && (
          <span className="min-w-0 truncate font-mono opacity-70">
            {of.summary}
          </span>
        )
      )}
    </Element>
  )

  if (!of.change || !of.path) return row

  return (
    <Popover>
      <PopoverTrigger render={row} />
      <ChangePopover path={of.path} stat={of.stat} change={of.change} />
    </Popover>
  )
}

/**
 * The file a call was about, as a chip.
 *
 * The name rather than the path, with the path on the hover line, for the
 * reason the diff header does the same: a checkout's own path is forty
 * characters of `~/.tabomni/workspace/worktrees/<uuid>/<branch>/` before it says
 * anything about the file, and in a row that truncates, the forty characters are
 * what survives.
 */
function FileChip({ path }: { path: string }) {
  const url = iconFor(path)
  return (
    <span
      title={path}
      className="inline-flex min-w-0 shrink items-center gap-1 rounded border bg-muted/50 px-1.5 py-0.5"
    >
      {url ? (
        <img src={url} alt="" aria-hidden className="size-3 shrink-0" />
      ) : (
        <FileText className="size-3 shrink-0" />
      )}
      <span className="truncate">{nameOf(path)}</span>
    </span>
  )
}

/**
 * What an edit did: the file, how much moved, and the lines.
 *
 * A **popover** and not a tooltip, which is what this was first and what the
 * shape of the content rules out: a tooltip in this app is the inverted
 * `bg-primary` chip meant for a few words — a `-`/`+` block in one came out as a
 * pale box with code in it — and it is also unscrollable, unselectable, and gone
 * the moment the pointer leaves the row. This is code: it has to stay up, take a
 * selection, and scroll.
 *
 * **It is the change the call made, not the file's diff**, and the header says
 * which — those two answers drift apart the moment anything else touches the
 * file, and a popover captioned "diff" that showed the first while somebody read
 * it as the second would be worse than no popover. The file's diff against
 * `HEAD` is a click away in `Changes`, and it is the one that knows what has
 * happened since.
 */
function ChangePopover({
  path,
  stat,
  change,
}: {
  path: string
  stat?: string
  change: string
}) {
  return (
    /* Its own box, and every one of these overrides earns its place: the popover
       is a column with `gap-2.5` and `p-2.5` around a `w-72`, which for three
       stacked full-bleed rows is a gap where each border should be and a width
       for a menu rather than for code. */
    <PopoverContent
      align="start"
      className="w-[min(40rem,80vw)] gap-0 p-0 text-left"
    >
      <div className="flex items-baseline gap-2 border-b px-2 py-1">
        <span className="min-w-0 flex-1 truncate font-mono text-[0.65rem] opacity-70">
          {path}
        </span>
        {stat && <span className="shrink-0 text-[0.65rem]">{stat}</span>}
      </div>

      {/* The editors' own git colours and the same two glyphs, so somebody with
          the `Changes` pane in their eye reads this without learning anything
          new. `pre` rather than a list of rows: the indentation is the code's,
          and it is half of what a change looks like. */}
      <pre className="max-h-72 overflow-auto px-2 py-1.5 font-mono text-[0.65rem] leading-relaxed">
        {change.split("\n").map((line, at) => (
          <div
            key={at}
            className={cn(
              line.startsWith("+") && "text-[#007100] dark:text-[#73c991]",
              line.startsWith("-") && "text-[#ad0707] dark:text-[#c74e39]"
            )}
          >
            {line}
          </div>
        ))}
      </pre>

      <p className="border-t px-2 py-1 text-[0.65rem] opacity-60">
        What this call changed. The file&apos;s own diff is in Changes.
      </p>
    </PopoverContent>
  )
}
