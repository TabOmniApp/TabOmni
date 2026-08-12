/**
 * What one row of a horizontally virtualized grid actually renders.
 *
 * A `column` slot carries its own place in the full column list — the grid's
 * selection model counts in columns, never in whatever is mounted — and a
 * `spacer` stands in for a run of columns that are out of view, holding their
 * combined width so the table stays as wide as it claims to be.
 */
export type ColumnSlot<T> =
  | { kind: "column"; info: T; index: number; width: number }
  | { kind: "spacer"; width: number }

/** One column's place in the scroll area, as the virtualizer reports it. */
export type ColumnWindow = { index: number; start: number; end: number }

/**
 * Turns the columns in view into the cells a row renders.
 *
 * The first column is always rendered, in view or not: it is the sticky one,
 * and a sticky cell that isn't in the DOM stops holding the left edge — the
 * grid would scroll its identifying column away. Its width comes out of the
 * leading spacer so the total is unchanged.
 *
 * The invariant every caller depends on: the slot widths sum to `totalWidth`.
 * Header, body and `colgroup` are all built from one call's result, so they
 * agree with each other by construction; they agree with the table's own width
 * only because of this.
 */
export function columnSlots<T>(
  columns: T[],
  window: ColumnWindow[],
  widthOf: (column: T) => number,
  totalWidth: number
): ColumnSlot<T>[] {
  const slots: ColumnSlot<T>[] = []
  const lead = columns[0]
  if (window.length === 0 || !lead) return slots

  const first = window[0]!
  if (first.index > 0) {
    const leadWidth = widthOf(lead)
    slots.push({ kind: "column", info: lead, index: 0, width: leadWidth })
    // `start` already counts the lead column, which is now rendered in full.
    if (first.start > leadWidth) {
      slots.push({ kind: "spacer", width: first.start - leadWidth })
    }
  }

  for (const item of window) {
    const column = columns[item.index]
    if (!column) continue
    slots.push({
      kind: "column",
      info: column,
      index: item.index,
      width: widthOf(column),
    })
  }

  const tail = totalWidth - window[window.length - 1]!.end
  if (tail > 0) slots.push({ kind: "spacer", width: tail })

  return slots
}
