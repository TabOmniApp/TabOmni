/**
 * How long ago a chat was last touched, in the width a sidebar row can spare.
 *
 * `9h`, `23h`, `1d` — the form the column needs, which is not the form
 * `Intl.RelativeTimeFormat` gives: "9 hours ago" is the whole row, and the row
 * is already carrying a title that wants every pixel of it. The one in
 * `lib/db/display.ts` is the long form and stays there, since a cell in the data
 * browser has the width and a reader of it wants the sentence.
 *
 * Deliberately coarse, one unit and no decimal. What the label answers is "is
 * this the conversation I was in, or one from last week" — a question a single
 * character of precision settles and a second one only clutters. So 90 minutes
 * is `1h` rather than `1.5h`, and everything past a year is `1y+` rather than a
 * count nobody is comparing.
 *
 * `now` under a minute rather than `0m`: a chat answered while the column is on
 * screen would otherwise draw a zero, which reads as missing data.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const YEAR = 365 * DAY

export function since(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso)
  // A record written by a build that stored something else here, or a field
  // that never arrived: no label is better than `NaNd` in the corner of a row.
  if (Number.isNaN(at)) return ""

  // Clocks go backwards — a machine correcting its time, a record copied from
  // one that was ahead — and a future timestamp is still "just now" rather than
  // a negative count.
  const ms = Math.max(0, now - at)

  if (ms < MINUTE) return "now"
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`
  if (ms < WEEK) return `${Math.floor(ms / DAY)}d`
  if (ms < YEAR) return `${Math.floor(ms / WEEK)}w`
  return "1y+"
}

const SECOND = 1000

/**
 * How long the turn under the spinner has been going: `1s`, `45s`, `1m5s`,
 * `1h1m6s`.
 *
 * Every unit down to the second rather than `since`'s single coarse one, and
 * for the opposite reason: this label is watched while it moves, so what it has
 * to show is that something is still happening — a `1m` sitting still for the
 * next fifty-nine seconds is exactly the "is this stuck" it exists to answer.
 * Which is also why the seconds stay once the minutes appear: they are the part
 * that is moving.
 *
 * Units are dropped from the left only, never the middle — an hour in, `1h0m5s`
 * rather than `1h5s`, which reads as five seconds at a glance.
 *
 * Clocks going backwards are floored at zero, as in `since`.
 */
export function elapsed(startedAt: number, now: number = Date.now()): string {
  return duration(now - startedAt)
}

/**
 * The same label for a stretch that has already finished: a turn's own wall
 * time, off its usage line.
 *
 * Shared with the spinner's clock rather than written again, because it is the
 * same number twice — what a turn is drawn as having taken has to be what
 * somebody watched it count up to, and two formatters would drift the moment
 * one of them rounded.
 */
export function duration(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / SECOND)
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  if (hours > 0) return `${hours}h${minutes}m${seconds}s`
  if (minutes > 0) return `${minutes}m${seconds}s`
  return `${seconds}s`
}
