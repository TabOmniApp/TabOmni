import {
  Brain,
  Coins,
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
import { MarkdownView } from "../markdown-view"
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
      <div className="ml-4 rounded-lg rounded-br-sm bg-accent/60 px-2.5 py-1.5 text-xs">
        <MentionText text={of.text} />
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
          "text-xs whitespace-pre-wrap text-destructive"
        )}
      >
        <TriangleAlert className="mr-1.5 inline size-3 shrink-0 -translate-y-px" />
        {of.text}
      </p>
    )
  }

  // The renderer the Explorer's Markdown preview uses, so a table or a code
  // block in a reply reads the way it does in a file.
  return <MarkdownView source={of.text} className="px-1 text-xs" />
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

  return (
    <div className="flex items-baseline gap-1.5 px-1 text-[0.7rem] text-muted-foreground">
      {toolMark(of.name, "size-3 shrink-0 translate-y-0.5")}

      <span className="shrink-0 font-medium text-foreground/80">
        {agent ? "Agent" : (of.title ?? toolLabel(of.name))}
      </span>

      {/* What came back, next to what it was — `Read` and `631 lines` are one
          fact, and putting the count at the end of the row would leave it
          against whichever argument happened to be longest. */}
      {of.result && (
        <span className={cn("shrink-0", of.failed && "text-destructive/80")}>
          {of.result}
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
    </div>
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
