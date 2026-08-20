const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600_000],
  ["month", 30 * 24 * 3600_000],
  ["day", 24 * 3600_000],
  ["hour", 3600_000],
  ["minute", 60_000],
]

/**
 * How long ago something was last written to, coarsened to whichever unit reads
 * naturally — a list of conversations has no use for "3600 seconds ago".
 *
 * In `lib/` rather than beside either caller because both the chat view's Past
 * sessions drawer and the assistant's list of chats draw the same figure from
 * the same kind of timestamp.
 */
export function relativeTime(updatedAt: number): string {
  const delta = updatedAt - Date.now()
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(delta) >= size)
      return RELATIVE.format(Math.round(delta / size), unit)
  }
  return "just now"
}
