import type { Column } from "./engines"

/**
 * How one column is *displayed* in the Data tab.
 *
 * Presentation only. There is no metadata layer in a plain SQL database to
 * store any of this in, so it lives in the explorer store for the session and
 * never reaches the server — nothing here changes a value, only how it reads.
 */
export type ColumnPref = {
  hidden?: boolean
  /** Show the whole value across several lines instead of truncating it. */
  wrap?: boolean
  /** A `FormatOption.id`, or undefined for the column's plain rendering. */
  format?: string
}

export type FormatOption = {
  id: string
  label: string
  /** The same sample value under this format, as a menu preview. */
  example: string
}

const NUMBER_FORMATS: FormatOption[] = [
  { id: "number:plain", label: "Plain", example: "1234.5" },
  { id: "number:grouped", label: "Thousands", example: "1,234.5" },
  { id: "number:integer", label: "Rounded", example: "1,235" },
  { id: "number:decimal2", label: "2 decimals", example: "1,234.50" },
  { id: "number:percent", label: "Percent", example: "123,450%" },
]

const DATE_FORMATS: FormatOption[] = [
  { id: "date:iso", label: "ISO", example: "2026-08-01T09:30:00Z" },
  { id: "date:local", label: "Local", example: "Aug 1, 2026, 4:30 PM" },
  { id: "date:day", label: "Date only", example: "2026-08-01" },
  { id: "date:time", label: "Time only", example: "16:30:00" },
  { id: "date:relative", label: "Relative", example: "3 days ago" },
]

/** Whether a SQL type name reads as a number. */
function isNumericType(type: string): boolean {
  return /int|numeric|decimal|float|double|real|serial|money|year/i.test(type)
}

/** Whether a SQL type name reads as a point in time. */
function isTemporalType(type: string): boolean {
  return /date|time(stamp)?/i.test(type) && !/interval/i.test(type)
}

/**
 * Which formats a column's header menu should offer.
 *
 * Driven by the introspected type where there is one, and otherwise by a
 * sample value — the SQL console has no column metadata at all, but its
 * results are just as worth formatting.
 */
export function formatOptionsFor(
  column: Column | undefined,
  sample: unknown
): FormatOption[] {
  if (column) {
    if (isNumericType(column.type)) return NUMBER_FORMATS
    if (isTemporalType(column.type)) return DATE_FORMATS
    return []
  }
  if (typeof sample === "number") return NUMBER_FORMATS
  if (sample instanceof Date) return DATE_FORMATS
  return []
}

/** The value as a number, or null when this format cannot apply to it. */
function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  // Postgres hands back `numeric`/`bigint` as strings to keep their precision.
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** The value as a date, or null when this format cannot apply to it. */
function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600_000],
  ["month", 30 * 24 * 3600_000],
  ["day", 24 * 3600_000],
  ["hour", 3600_000],
  ["minute", 60_000],
  ["second", 1000],
]

function relative(date: Date): string {
  const delta = date.getTime() - Date.now()
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(delta) >= size)
      return RELATIVE.format(Math.round(delta / size), unit)
  }
  return RELATIVE.format(0, "second")
}

function applyFormat(value: unknown, format: string): string | null {
  if (format.startsWith("number:")) {
    const number = asNumber(value)
    if (number === null) return null
    switch (format) {
      case "number:grouped":
        return number.toLocaleString(undefined, { maximumFractionDigits: 6 })
      case "number:integer":
        return number.toLocaleString(undefined, { maximumFractionDigits: 0 })
      case "number:decimal2":
        return number.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      case "number:percent":
        return number.toLocaleString(undefined, {
          style: "percent",
          maximumFractionDigits: 2,
        })
      default:
        return String(number)
    }
  }

  if (format.startsWith("date:")) {
    const date = asDate(value)
    if (date === null) return null
    switch (format) {
      case "date:local":
        return date.toLocaleString()
      case "date:day":
        return date.toLocaleDateString(undefined, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
      case "date:time":
        return date.toLocaleTimeString()
      case "date:relative":
        return relative(date)
      default:
        return date.toISOString()
    }
  }

  return null
}

/**
 * One cell's text.
 *
 * `muted` marks values that are not data the user typed: NULL, empty, binary.
 * A `pref.format` that cannot apply to the value in hand — a date format on a
 * column that turned out to hold text — falls back to the plain rendering
 * rather than showing "Invalid Date".
 */
export function formatCell(
  value: unknown,
  pref?: ColumnPref
): { text: string; muted: boolean } {
  if (value === null || value === undefined)
    return { text: "NULL", muted: true }
  if (value === "") return { text: "empty", muted: true }

  if (pref?.format) {
    const formatted = applyFormat(value, pref.format)
    if (formatted !== null) return { text: formatted, muted: false }
  }

  if (value instanceof Date) return { text: value.toISOString(), muted: false }
  if (value instanceof Uint8Array) {
    return { text: `${value.byteLength} bytes`, muted: true }
  }

  if (typeof value === "object") {
    try {
      return { text: JSON.stringify(value), muted: false }
    } catch {
      return { text: String(value), muted: true }
    }
  }

  return { text: String(value), muted: false }
}
