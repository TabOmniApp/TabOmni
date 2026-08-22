import { TriangleAlert, Wrench } from "lucide-react"

import type { AssistantMessage } from "@shared/api"
import { useSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { MarkdownView } from "../markdown-view"
import { MentionText } from "./chat-composer"

/**
 * One line of a `claude -p` conversation.
 *
 * One file for every role rather than a component per role: a print-mode turn
 * arrives as `AssistantMessage`s, and a tool call, an error and a reply have to
 * read as one conversation.
 *
 * A tool call is a row rather than a bubble, and only the user's line gets one:
 * whose turn it is has to be readable without reading it.
 */
export function ChatMessage({ of }: { of: AssistantMessage }) {
  // Settings › Chat, under the key a chat view that no longer exists wrote.
  // Read here rather than by the pane: the switch is about the rows, and the
  // rows are this file.
  const showToolCalls = useSettings((state) => state.showToolCalls)

  if (of.role === "user") {
    return (
      <div className="ml-4 rounded-lg rounded-br-sm bg-accent/60 px-2.5 py-1.5 text-xs">
        <MentionText text={of.text} />
      </div>
    )
  }

  if (of.role === "tool") {
    if (!showToolCalls) return null
    return (
      <div className="flex items-baseline gap-1.5 px-1 font-mono text-[0.7rem] text-muted-foreground">
        <Wrench className="size-3 shrink-0 translate-y-0.5" />
        <span className="shrink-0">{toolLabel(of.name)}</span>
        {of.summary && (
          <span className="truncate opacity-70">{of.summary}</span>
        )}
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
 * A tool's name as a row says it.
 *
 * The CLI names an MCP tool `mcp__tabomni-database__query`, which is precise
 * and unreadable; what a row wants is the panel it came from and what it did.
 */
function toolLabel(name: string): string {
  const mcp = /^mcp__tabomni-([a-z]+)__(.+)$/.exec(name)
  if (!mcp) return name
  return `${mcp[1]} · ${mcp[2]!.replaceAll("_", " ")}`
}
