import {
  columnSlots,
  type ColumnWindow,
} from "../src/renderer/lib/db/grid-columns"
import { check, finish, section } from "./harness"

/**
 * The result grid's horizontal virtualization.
 *
 * The geometry is what breaks silently: if the spacers don't account for
 * exactly the columns left out, the header stops lining up with the body and
 * every cell is under the wrong column — a grid that looks fine until you read
 * a value off it. So the invariant under test is arithmetic, not appearance.
 */

/** 20 columns, 100px each — so a column's offset is its index × 100. */
const columns = Array.from({ length: 20 }, (_, index) => `c${index}`)
const WIDTH = 100
const TOTAL = columns.length * WIDTH
const widthOf = () => WIDTH

/** What a virtualizer reports for the columns from `from` to `to` inclusive. */
const windowOf = (from: number, to: number): ColumnWindow[] =>
  Array.from({ length: to - from + 1 }, (_, offset) => {
    const index = from + offset
    return { index, start: index * WIDTH, end: (index + 1) * WIDTH }
  })

const totalOf = (slots: { width: number }[]) =>
  slots.reduce((sum, slot) => sum + slot.width, 0)
const indexesOf = (slots: ReturnType<typeof columnSlots<string>>) =>
  slots.flatMap((slot) => (slot.kind === "column" ? [slot.index] : []))

section("scrolled to the start")

const atStart = columnSlots(columns, windowOf(0, 4), widthOf, TOTAL)
check("no leading spacer", atStart[0]?.kind === "column")
check("the columns in view, in order", `${indexesOf(atStart)}` === "0,1,2,3,4")
check("one trailing spacer", atStart[atStart.length - 1]?.kind === "spacer")
check("widths sum to the table's own", totalOf(atStart) === TOTAL, atStart)

section("scrolled into the middle")

const middle = columnSlots(columns, windowOf(8, 12), widthOf, TOTAL)
check(
  "the sticky first column is rendered even though it is out of view",
  `${indexesOf(middle)}` === "0,8,9,10,11,12"
)
check(
  "a spacer stands in for the columns skipped",
  middle[1]?.kind === "spacer"
)
check(
  "that spacer covers the skipped columns minus the one now rendered",
  middle[1]?.width === 8 * WIDTH - WIDTH
)
check("widths still sum to the table's own", totalOf(middle) === TOTAL, middle)

section("scrolled to the end")

const atEnd = columnSlots(columns, windowOf(15, 19), widthOf, TOTAL)
check("no trailing spacer", atEnd[atEnd.length - 1]?.kind === "column")
check("widths still sum to the table's own", totalOf(atEnd) === TOTAL, atEnd)

section("the awkward edges")

check("no columns at all", columnSlots([], [], widthOf, 0).length === 0)
check(
  "a window before the virtualizer has measured anything",
  columnSlots(columns, [], widthOf, TOTAL).length === 0
)

// The second column being in view means the lead is adjacent to it: rendering
// the lead leaves nothing for a spacer to hold, and a zero-width one would be
// a cell the colgroup has to account for for no reason.
const fromSecond = columnSlots(columns, windowOf(1, 3), widthOf, TOTAL)
check(
  "no empty spacer when the lead is adjacent",
  fromSecond[1]?.kind === "column"
)
check(
  "widths sum with no spacer to help",
  totalOf(fromSecond) === TOTAL,
  fromSecond
)

// A window naming columns that have since been hidden must not produce
// undefined cells — the row would come out one cell short of its header.
const stale = columnSlots(
  columns.slice(0, 3),
  windowOf(0, 9),
  widthOf,
  3 * WIDTH
)
check(
  "a stale window is clipped to the columns that exist",
  `${indexesOf(stale)}` === "0,1,2"
)

finish()
