import {
  Bot,
  Database,
  FilePen,
  FileText,
  Globe,
  ListTodo,
  Search,
  Send,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import type { ReactNode } from "react"

import type { AssistantMessage } from "@shared/api"
import { AGENT_TOOL } from "@/lib/worktree-chat/activity"

/**
 * What a tool looks and reads like in a chat row.
 *
 * Its own file for the reason `section-marks.tsx` is: the same mark is drawn in
 * two places — on the row itself and on the closed fold above it — and a glyph
 * that means "the shell ran" has to mean it in both. Splitting it also keeps
 * `chat-message.tsx` about the rows rather than about a lookup table.
 */

/**
 * A tool's mark, drawn.
 *
 * A function returning a node rather than a component taking a name, which is
 * the same shape `tab-items.tsx` draws a file's icon with — a looked-up
 * `LucideIcon` rendered inside a component is a component created during
 * render, and React cannot keep the node it drew last time when the type is
 * fresh on every pass.
 */
export function toolMark(name: string, className?: string): ReactNode {
  const Icon = iconOf(name)
  return <Icon className={className} />
}

/**
 * Which glyph a tool gets.
 *
 * By kind rather than one per tool: what a row is scanned for is "did it read,
 * did it run something, did it write" — so `Edit`, `Write` and `NotebookEdit`
 * share a mark, and the three `tabomni-*` servers get the mark of the panel
 * they came from. A tool with no entry falls back to the wrench every one of
 * them used to have.
 */
function iconOf(name: string): LucideIcon {
  if (name.startsWith("mcp__tabomni-database")) return Database
  if (name.startsWith("mcp__tabomni-api")) return Send
  if (name.startsWith("mcp__tabomni-notes")) return FileText
  // A server the user configured. Not the wrench: what makes it worth its own
  // mark is that it reaches outside this machine, which is the thing worth
  // noticing while scanning.
  if (name.startsWith("mcp__")) return Globe
  return TOOL_ICONS[name] ?? Wrench
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  Read: FileText,
  Write: FilePen,
  Edit: FilePen,
  MultiEdit: FilePen,
  NotebookEdit: FilePen,
  Bash: Terminal,
  Glob: Search,
  Grep: Search,
  WebFetch: Globe,
  WebSearch: Globe,
  TodoWrite: ListTodo,
  [AGENT_TOOL]: Bot,
}

/**
 * One tool name per distinct mark, in the order they first appeared.
 *
 * Deduplicated by *glyph* rather than by name, because a closed fold is
 * answering "what kind of thing happened here" — a `Read` and a `Grep` are two
 * marks and a `Write` and an `Edit` are one, and twelve identical glyphs answer
 * the question no better than one. The count is already in the sentence beside
 * them.
 */
export function marksOf(lines: AssistantMessage[]): string[] {
  const seen: LucideIcon[] = []
  const names: string[] = []
  for (const line of lines) {
    if (line.role !== "tool") continue
    const mark = iconOf(line.name)
    if (seen.includes(mark)) continue
    seen.push(mark)
    names.push(line.name)
  }
  return names
}

/**
 * A tool's name as a row says it.
 *
 * The CLI names an MCP tool `mcp__tabomni-database__query`, which is precise
 * and unreadable; what a row wants is the panel it came from and what it did.
 * A server the user configured gets the same treatment for the same reason,
 * with its own name where the panel would be.
 */
export function toolLabel(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
  if (!mcp) return name
  const server = mcp[1]!.replace(/^tabomni-/, "")
  return `${server} · ${mcp[2]!.replaceAll("_", " ")}`
}
