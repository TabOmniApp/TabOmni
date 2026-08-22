/**
 * Native date inputs for temporal columns, and the text that goes in and out
 * of them.
 *
 * A `timestamp` used to be typed as free text, the way every other column is,
 * which meant remembering the engine's own literal format to change an hour.
 * Chromium already has a picker per temporal shape, so the only real work is
 * at the two edges: what the stored value looks like *in* the input, and what
 * is written back for what was picked.
 *
 * Pure, and tested in `test/date-input.ts` — the timezone rule below is the
 * kind of thing that is wrong by an hour twice a year if nothing asks.
 */

/** The three native inputs, keyed the way `<input type>` spells them. */
export type DateInputKind = "date" | "datetime-local" | "time"

/**
 * Which input a SQL type calls for, or null when the type is not a point in
 * time at all.
 *
 * Covers both engines' spellings: Postgres writes `timestamp with time zone`
 * and `time without time zone`, MySQL writes `datetime` and `time`. `interval`
 * is a duration rather than an instant, and MySQL's `year` is a number — a
 * picker for either would be lying about what the column holds.
 */
export function dateInputKind(type: string): DateInputKind | null {
  const normalized = type.trim().toLowerCase()
  if (normalized.includes("interval")) return null
  if (normalized.includes("timestamp") || normalized.includes("datetime"))
    return "datetime-local"
  if (/\btime\b/.test(normalized)) return "time"
  if (/\bdate\b/.test(normalized)) return "date"
  return null
}

/** A stored value, split into the parts an input needs. */
type Parts = {
  /** `YYYY-MM-DD`, or "" for a time-only value. */
  day: string
  /** `HH:mm:ss`, or "" for a date-only value. */
  time: string
  /**
   * The value names an instant rather than a wall clock — a `Date` from the
   * driver, or text carrying `Z` or an offset. Such a value is shown in the
   * reader's own timezone, so it has to be written back with the offset that
   * turns it into the same instant again; a zone-*naive* value is passed
   * through as typed, and inventing a zone for it would move it.
   */
  zoned: boolean
}

const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2}|[+-]\d{2})?)?$/i
const TIME_ONLY =
  /^(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2}|[+-]\d{2})?$/i

const pad = (value: number) => String(value).padStart(2, "0")

/** A `Date` as the wall clock it reads as in the reader's own timezone. */
function localParts(date: Date): Parts {
  return {
    day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    zoned: true,
  }
}

function parse(value: unknown): Parts | null {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : localParts(value)
  if (typeof value !== "string" || value.trim() === "") return null

  const text = value.trim()
  const stamp = TIMESTAMP.exec(text)
  if (stamp) {
    const [, year, month, day, hour, minute, second, zone] = stamp
    if (zone) return localParts(new Date(text))
    return {
      day: `${year}-${month}-${day}`,
      time: hour ? `${hour}:${minute}:${second ?? "00"}` : "",
      zoned: false,
    }
  }

  const time = TIME_ONLY.exec(text)
  if (time) {
    const [, hour, minute, second] = time
    // A bare time's own zone, if it has one, is left alone: there is no date
    // to resolve an offset against, so `timetz` is shown — and written — as
    // the wall clock it was stored as.
    return {
      day: "",
      time: `${hour}:${minute}:${second ?? "00"}`,
      zoned: false,
    }
  }

  // Something the patterns don't know but `Date` does — a locale-ish string
  // from a driver that formats its own. Better shown in the picker than left
  // blank, and it is only ever written back as what was picked.
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : localParts(parsed)
}

/**
 * A stored value as the text a native input of that kind takes, plus whether
 * writing it back has to carry a zone.
 *
 * Sub-second precision is dropped: the inputs step in seconds, and a value
 * they cannot represent is one Chromium refuses to show at all.
 */
export function toDateInput(
  value: unknown,
  kind: DateInputKind
): { text: string; zoned: boolean } {
  const parts = parse(value)
  if (!parts) return { text: "", zoned: false }
  if (kind === "date") return { text: parts.day, zoned: parts.zoned }
  if (kind === "time") return { text: parts.time, zoned: parts.zoned }
  if (!parts.day) return { text: "", zoned: parts.zoned }
  return {
    text: `${parts.day}T${parts.time || "00:00:00"}`,
    zoned: parts.zoned,
  }
}

/** `+07:00` for the offset a wall clock has at that instant — read off the
 * date itself, so a value either side of a DST change gets its own. */
function offsetAt(local: Date): string {
  const minutes = -local.getTimezoneOffset()
  const sign = minutes < 0 ? "-" : "+"
  const size = Math.abs(minutes)
  return `${sign}${pad(Math.floor(size / 60))}:${pad(size % 60)}`
}

/**
 * What is written for what the input holds — "" when it holds nothing, which
 * the caller reads as NULL (a cell) or as "not set" (a new row).
 *
 * The date and the time are separated by a space rather than by the `T` the
 * input uses: both engines take either in a literal, and the space is what
 * their own output looks like, so a value written here reads like the ones
 * beside it.
 */
export function fromDateInput(
  text: string,
  kind: DateInputKind,
  zoned: boolean
): string {
  if (text === "") return ""
  if (kind === "date") return text
  if (kind === "time") return withSeconds(text)

  const [day, time = "00:00:00"] = text.split("T")
  const stamp = `${day} ${withSeconds(time)}`
  if (!zoned) return stamp
  const local = new Date(`${day}T${withSeconds(time)}`)
  return Number.isNaN(local.getTime()) ? stamp : `${stamp}${offsetAt(local)}`
}

/** `16:30:00` from an input left at minute precision, and no fractional
 * seconds from one that somehow has them. */
function withSeconds(time: string): string {
  const clock = time.split(".")[0]!
  return clock.split(":").length === 2 ? `${clock}:00` : clock
}
