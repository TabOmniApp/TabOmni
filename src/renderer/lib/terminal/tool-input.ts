/**
 * How a tool call's arguments are shown to the user.
 *
 * Its own module because two places show them and neither should own the
 * other: the transcript's tool card, and the dialog that asks whether the call
 * may happen at all — which has to show exactly what the card will, or the
 * user is approving something other than what they read.
 */

/** How much of a tool's arguments or output is shown before being cut off. */
const PREVIEW_LIMIT = 2000

/**
 * A tool's arguments as one readable block.
 *
 * `Bash` and the tools that wrap a single command carry one field worth
 * reading on its own; for everything else the JSON is the honest answer, since
 * this app cannot know what an MCP server's tool takes.
 */
export function describeInput(input: unknown): string {
  if (typeof input !== "object" || input === null) return clamp(String(input))

  const record = input as Record<string, unknown>
  if (typeof record.command === "string") return clamp(record.command)

  return clamp(JSON.stringify(input, null, 2))
}

export function clamp(text: string): string {
  return text.length > PREVIEW_LIMIT
    ? `${text.slice(0, PREVIEW_LIMIT)}\n… ${text.length - PREVIEW_LIMIT} more characters`
    : text
}
