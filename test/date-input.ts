import {
  dateInputKind,
  fromDateInput,
  toDateInput,
} from "../src/renderer/lib/db/date-input"
import { check, finish, section } from "./harness"

/**
 * The date pickers in the Data tab: which columns get one, and the text that
 * crosses between a stored value and a native input.
 *
 * The reason this is worth a test is the timezone rule. A `timestamptz` comes
 * back as an instant and is shown in whatever zone the reader is in, so it has
 * to go back with an offset or the row moves by that offset every time anyone
 * opens the cell. A `timestamp` carries no zone at all, and attaching one to
 * it would move it just as far in the other direction.
 */

section("which input a type calls for")

check(
  "postgres timestamps",
  dateInputKind("timestamp with time zone") === "datetime-local"
)
check("mysql datetime", dateInputKind("datetime") === "datetime-local")
check("a plain date", dateInputKind("date") === "date")
check("postgres time", dateInputKind("time without time zone") === "time")
check("mysql time", dateInputKind("time") === "time")
check(
  "an interval is a duration, not an instant",
  dateInputKind("interval") === null
)
check("mysql year is a number", dateInputKind("year") === null)
check("text is text", dateInputKind("character varying") === null)

section("a stored value in the input")

check(
  "a zone-naive timestamp is passed through as typed",
  toDateInput("2026-08-01 09:30:00", "datetime-local").text ===
    "2026-08-01T09:30:00"
)
check(
  "and is not treated as an instant",
  toDateInput("2026-08-01 09:30:00", "datetime-local").zoned === false
)
check(
  "a date-only value gets midnight, so the input has something to show",
  toDateInput("2026-08-01", "datetime-local").text === "2026-08-01T00:00:00"
)
check(
  "a date column takes the day alone",
  toDateInput("2026-08-01 09:30:00", "date").text === "2026-08-01"
)
check(
  "a time column takes the clock alone",
  toDateInput("2026-08-01 09:30:00", "time").text === "09:30:00"
)
check(
  "seconds are filled in when the value has none",
  toDateInput("2026-08-01 09:30", "datetime-local").text ===
    "2026-08-01T09:30:00"
)
check(
  "sub-second precision is dropped — the inputs step in seconds",
  toDateInput("2026-08-01 09:30:00.123456", "datetime-local").text ===
    "2026-08-01T09:30:00"
)
check("NULL leaves the input empty", toDateInput(null, "date").text === "")
check(
  "and so does something that isn't a date at all",
  toDateInput("not a date", "date").text === ""
)

// A Date is what both drivers hand back for a timestamp column, and what an
// instant has to be shown in the reader's own zone from.
const instant = new Date("2026-08-01T09:30:00Z")
const shown = toDateInput(instant, "datetime-local")
const local = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, "0")}-${String(instant.getDate()).padStart(2, "0")}T${String(instant.getHours()).padStart(2, "0")}:${String(instant.getMinutes()).padStart(2, "0")}:00`

check(
  "a Date is shown as the reader's own wall clock",
  shown.text === local,
  shown
)
check("and is marked as an instant", shown.zoned === true)
check(
  "so is text carrying a zone",
  toDateInput("2026-08-01T09:30:00Z", "datetime-local").zoned === true
)
check(
  "and text carrying an offset",
  toDateInput("2026-08-01T09:30:00+02:00", "datetime-local").zoned === true
)

section("what is written back")

check(
  "a naive timestamp goes back as the engines' own literal",
  fromDateInput("2026-08-01T16:30:00", "datetime-local", false) ===
    "2026-08-01 16:30:00"
)
check(
  "a minute-precision pick gets its seconds",
  fromDateInput("2026-08-01T16:30", "datetime-local", false) ===
    "2026-08-01 16:30:00"
)
check(
  "a date goes back as it is",
  fromDateInput("2026-08-01", "date", false) === "2026-08-01"
)
check(
  "a time gets its seconds too",
  fromDateInput("16:30", "time", false) === "16:30:00"
)
check(
  "an empty input writes nothing — NULL, or the column's default",
  fromDateInput("", "datetime-local", true) === ""
)

// The round trip is the whole point: an instant opened and put back unchanged
// has to name the same instant, whatever zone the machine running this is in.
const back = fromDateInput(shown.text, "datetime-local", shown.zoned)
check(
  "an instant put back unchanged is the same instant",
  new Date(back.replace(" ", "T")).getTime() === instant.getTime(),
  back
)
check(
  "a naive value put back has no zone attached to it",
  !/[+-]\d{2}:\d{2}$/.test(
    fromDateInput("2026-08-01T16:30:00", "datetime-local", false)
  )
)

finish()
