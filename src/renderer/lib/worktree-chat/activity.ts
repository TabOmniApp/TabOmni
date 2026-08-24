import type { AssistantMessage } from "@shared/api"

/**
 * A turn's working, folded away from its answer.
 *
 * **Why a fold rather than a switch.** `showToolCalls` hid the tool rows
 * outright, which answers the wrong question: the rows are noise while reading
 * the answer and are the entire point five minutes later, when what is being
 * asked is "what did it actually do to my branch". A fold is both — one line
 * saying how much happened, and the whole of it a click away — and it is what
 * the setting now means.
 *
 * **What counts as working.** Everything a turn produced except its last word:
 * the tool calls, the thinking, and the narration between them ("let me check
 * the composer first"), which reads as working precisely because the answer
 * came after it. Two things are never folded — an error, and a refusal — for
 * the reason the old switch made an exception for refusals too: both are the
 * turn telling you it did *less* than you asked, and that cannot be behind a
 * fold somebody has to know to open.
 *
 * The whole of this is pure and tested in `test/chat-activity.ts`, because the
 * cases that matter are the shapes of a transcript rather than anything on
 * screen: a turn still running has no last word yet, a turn that only talked has
 * no working at all, and a chat read back from disk is several turns in a row.
 */

/** One thing the pane draws: a line on its own, or a run of them folded. */
export type ChatBlock =
  | { kind: "line"; id: string; line: AssistantMessage }
  | {
      kind: "activity"
      id: string
      lines: AssistantMessage[]
      counts: ActivityCounts
    }

/** What the folded line says there is. */
export type ActivityCounts = {
  /** Tool calls, not counting the subagents — those are counted as agents. */
  tools: number
  /** What the turn said on the way: its narration and its thinking. */
  messages: number
  subagents: number
}

/** The tool a subagent runs under, which is counted and drawn as an agent
 * rather than as one more tool call. */
export const AGENT_TOOL = "Task"

export function blocksOf(messages: AssistantMessage[]): ChatBlock[] {
  const blocks: ChatBlock[] = []

  for (const turn of turnsOf(messages)) {
    // The user's own line is never part of a turn's working: it is what the
    // working was for.
    if (turn.prompt)
      blocks.push({ kind: "line", id: turn.prompt.id, line: turn.prompt })

    /*
     * The turn's last word, which is the answer and stays out of the fold.
     *
     * A turn still being answered has none — everything so far is working, and
     * a fold that closed over the answer the moment it arrived would be the
     * pane hiding what it just finished writing. So this is the index to fold
     * *up to*, and while a turn is running that is all of it.
     */
    const answer = lastIndexOf(turn.lines, (line) => line.role === "assistant")

    let run: AssistantMessage[] = []
    const flush = () => {
      if (run.length === 0) return
      blocks.push({
        kind: "activity",
        // The first line's id: stable across a re-render, and unique because a
        // line id is.
        id: `activity-${run[0]!.id}`,
        lines: run,
        counts: countsOf(run),
      })
      run = []
    }

    turn.lines.forEach((line, index) => {
      if (answer !== -1 && index >= answer) {
        flush()
        blocks.push({ kind: "line", id: line.id, line })
        return
      }
      if (alwaysShown(line)) {
        flush()
        blocks.push({ kind: "line", id: line.id, line })
        return
      }
      run.push(line)
    })
    flush()
  }

  return blocks
}

/** A line that is never folded: the turn saying it did less than was asked. */
function alwaysShown(line: AssistantMessage): boolean {
  return line.role === "error" || (line.role === "ask" && refused(line))
}

/** The wording `main/worktree-chat.ts` composes a refusal with. Matched rather
 * than flagged because the line is a sentence somebody reads, and it is the
 * same test the row's own colour uses. */
export function refused(line: AssistantMessage): boolean {
  return line.role === "ask" && line.text.startsWith("Refused")
}

export function countsOf(lines: AssistantMessage[]): ActivityCounts {
  let tools = 0
  let messages = 0
  let subagents = 0

  for (const line of lines) {
    if (line.role === "tool") {
      if (line.name === AGENT_TOOL) subagents += 1
      else tools += 1
      continue
    }
    if (line.role === "assistant" || line.role === "thinking") messages += 1
  }

  return { tools, messages, subagents }
}

/** The folded line's own words. Left out of the component so the phrasing is
 * testable and so a count of zero is dropped rather than drawn as `0 tools`. */
export function summaryOf(counts: ActivityCounts): string {
  const parts: string[] = []
  if (counts.tools > 0) parts.push(plural(counts.tools, "tool call"))
  if (counts.messages > 0) parts.push(plural(counts.messages, "message"))
  if (counts.subagents > 0) parts.push(plural(counts.subagents, "subagent"))
  // Nothing but the lines that are never folded can produce this, and a run of
  // those is never made — so it is a fallback rather than a case.
  return parts.join(", ") || "working"
}

function plural(count: number, what: string): string {
  return `${count} ${what}${count === 1 ? "" : "s"}`
}

/** The conversation split at the user's lines: a prompt and what followed it. */
function turnsOf(messages: AssistantMessage[]): {
  prompt: AssistantMessage | null
  lines: AssistantMessage[]
}[] {
  const turns: {
    prompt: AssistantMessage | null
    lines: AssistantMessage[]
  }[] = []
  // A chat can open with lines that follow no prompt — a turn retried as a
  // resume writes its own — so the first turn may have none.
  let current: { prompt: AssistantMessage | null; lines: AssistantMessage[] } =
    {
      prompt: null,
      lines: [],
    }

  for (const line of messages) {
    if (line.role === "user") {
      if (current.prompt || current.lines.length > 0) turns.push(current)
      current = { prompt: line, lines: [] }
      continue
    }
    current.lines.push(line)
  }
  if (current.prompt || current.lines.length > 0) turns.push(current)

  return turns
}

function lastIndexOf(
  lines: AssistantMessage[],
  matches: (line: AssistantMessage) => boolean
): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (matches(lines[index]!)) return index
  }
  return -1
}
