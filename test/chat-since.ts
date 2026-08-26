import { since } from "../src/renderer/lib/worktree-chat/since"
import { check, finish, section } from "./harness"

/**
 * The `9h` in the corner of a chat's row.
 *
 * Worth a test for the boundaries rather than the arithmetic: every one of them
 * is a `<` against a constant, and the failure they guard against is the label
 * that reads as missing data — a `0m` on a chat answered a second ago, an empty
 * corner where a record's field was written by an older build, a `-1m` on a
 * machine whose clock has just been corrected backwards.
 *
 * `now` is passed in rather than mocked, which is the reason this is a function
 * of two arguments at all: a helper that read the clock itself could only be
 * tested by waiting.
 */

const NOW = Date.parse("2026-08-26T12:00:00.000Z")

/** `ms` before `NOW`, as the ISO string a record holds. */
function ago(ms: number): string {
  return new Date(NOW - ms).toISOString()
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const YEAR = 365 * DAY

section("since: the width a row can spare")

check("under a minute is a word, not a zero", since(ago(30_000), NOW) === "now")
check("a minute is a minute", since(ago(MINUTE), NOW) === "1m")
check("and it counts down to the hour", since(ago(59 * MINUTE), NOW) === "59m")
check("an hour turns over", since(ago(HOUR), NOW) === "1h")
check("the screenshot's 9h", since(ago(9 * HOUR), NOW) === "9h")
check("and its 23h, one short of a day", since(ago(23 * HOUR), NOW) === "23h")
check("a day turns over", since(ago(DAY), NOW) === "1d")
check("days run to the week", since(ago(6 * DAY), NOW) === "6d")
check("then weeks", since(ago(WEEK), NOW) === "1w")
check("weeks run to the year", since(ago(51 * WEEK), NOW) === "51w")

section("the ends")

check("a year is not a count", since(ago(YEAR), NOW) === "1y+")
check("nor is a decade", since(ago(12 * YEAR), NOW) === "1y+")
check(
  "a clock that went backwards is still now",
  since(new Date(NOW + HOUR).toISOString(), NOW) === "now"
)
check("a field that never arrived draws nothing", since("", NOW) === "")
check("and neither does one holding something else", since("soon", NOW) === "")

section("truncation, not rounding")

check(
  "90 minutes is 1h rather than 2h",
  since(ago(HOUR + 30 * MINUTE), NOW) === "1h"
)
check(
  "and 47 hours is 1d rather than 2d",
  since(ago(2 * DAY - HOUR), NOW) === "1d"
)

finish()
