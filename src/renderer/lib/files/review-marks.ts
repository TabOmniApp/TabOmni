import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state"
import { Decoration, EditorView, gutter, GutterMarker } from "@codemirror/view"

import type { ReviewThread } from "./review"

/**
 * The review, as the diff draws it: the column a line is picked from, and the
 * tint on the lines a thread is about.
 *
 * **What it does not draw is the thread.** It did, as a block widget under the
 * range — which is where a forge puts one — and the boxes were taken out again:
 * a diff with three comments in it is a diff pushed apart in three places, and
 * the code around a remark is the thing somebody is reading. So the diff says
 * *which* lines have been commented on, in one bubble and a tint, and the
 * remarks themselves are the list in the pane's own bar (`review-panel.tsx`).
 * What went with the widgets: their DOM, the `drafts` they needed because a
 * rebuild would have taken a half-typed sentence with it, and `replyTo` ever
 * reaching this file.
 *
 * The column is a gutter rather than a click on the line itself for a reason
 * that is not cosmetic: the diff is genuinely read-only, so nothing in the
 * content area holds focus or reports a selection, and the browser's own text
 * selection there is what somebody uses to *copy* a line. A mousedown handler
 * over the code would have to guess which of the two a drag was, every time. A
 * click in a gutter is never anything else.
 *
 * **What is drawn is the state, and the state comes from outside.** The threads
 * live in a zustand store (`lib/files/review.ts`) that knows nothing about
 * editors, so the pane pushes them in as a `setReviewMarks` effect and this
 * field holds whatever it was last told. A widget reading the store directly
 * would work until the store changed without a transaction to redraw on, which
 * is every change.
 *
 * Lines here are **document line numbers**, which in a diff's right-hand side
 * are the working file's own. A removed line is a block widget rather than a
 * line of this document and gets no cell: it has no line in the file for a
 * comment to point at.
 */

/** What the review looks like in one file, as the editor needs it. */
export type ReviewMarks = {
  /** This file's threads. Drawn under the last line of each one's range. */
  threads: ReviewThread[]
  /** The range being written about right now, or null. */
  pending: { fromLine: number; toLine: number } | null
}

/**
 * What the widgets call. Wired to the store by `codemirror-diff.tsx`, which is
 * the only place that knows which checkout and which file this diff is of.
 *
 * Handed in rather than reached for, so this file stays a drawing of a review
 * and not a second copy of what a review *is*.
 */
export type ReviewActions = {
  /** A click in the column: the line, and whether it was a shift-click. */
  pick: (line: number, extend: boolean) => void
  /** A drag: the line it started on, and the line it is over now. */
  drag: (anchor: number, line: number) => void
  /** The button let go, wherever that happened — what opens the box. */
  settle: () => void
}

const EMPTY: ReviewMarks = { threads: [], pending: null }

export const setReviewMarks = StateEffect.define<ReviewMarks>()

const reviewMarks = StateField.define<ReviewMarks>({
  create: () => EMPTY,
  update(marks, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setReviewMarks)) return effect.value
    }
    return marks
  },
})

/**
 * Which lines carry a thread, for the column's cells.
 *
 * Memoised on the list it was computed from, because the caller is a gutter
 * marker: it is asked once per row on screen, and the answer is the same fifty
 * times. The entry dies with the array, which is replaced whenever the review
 * changes — the same bargain `modelOf` in `diff-chrome.ts` makes with a state.
 */
const commented = new WeakMap<ReviewThread[], Set<number>>()

function commentedIn(threads: ReviewThread[]): Set<number> {
  const held = commented.get(threads)
  if (held) return held

  const lines = new Set<number>()
  for (const thread of threads) {
    for (let line = thread.fromLine; line <= thread.toLine; line += 1) {
      lines.add(line)
    }
  }
  commented.set(threads, lines)
  return lines
}

/** GitHub's own affordance: a `+` in a rounded square, one per row, drawn only
 * under the pointer. Written as DOM because a `GutterMarker` returns a node —
 * see the same note on `unfoldIcon` in `diff-chrome.ts`. */
function plusIcon(): SVGElement {
  const ns = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(ns, "svg")
  svg.setAttribute("viewBox", "0 0 16 16")
  svg.setAttribute("width", "11")
  svg.setAttribute("height", "11")
  svg.setAttribute("aria-hidden", "true")

  const plus = document.createElementNS(ns, "path")
  plus.setAttribute(
    "d",
    "M7.25 3.5h1.5v3.75h3.75v1.5H8.75v3.75h-1.5V8.75H3.5v-1.5h3.75Z"
  )
  plus.setAttribute("fill", "currentColor")

  svg.append(plus)
  return svg
}

/** A filled speech bubble, for a line that has already been commented on. */
function commentIcon(): SVGElement {
  const ns = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(ns, "svg")
  svg.setAttribute("viewBox", "0 0 16 16")
  svg.setAttribute("width", "11")
  svg.setAttribute("height", "11")
  svg.setAttribute("aria-hidden", "true")

  const bubble = document.createElementNS(ns, "path")
  bubble.setAttribute(
    "d",
    "M2 3.25C2 2.56 2.56 2 3.25 2h9.5c.69 0 1.25.56 1.25 1.25v6.5c0 .69-.56 1.25-1.25 1.25H8.06l-2.7 2.35A.75.75 0 0 1 4.1 12.8v-1.8H3.25C2.56 11 2 10.44 2 9.75Z"
  )
  bubble.setAttribute("fill", "currentColor")

  svg.append(bubble)
  return svg
}

class ReviewCell extends GutterMarker {
  constructor(
    readonly kind: "empty" | "pending" | "commented",
    override readonly elementClass: string
  ) {
    super()
  }

  override eq(other: ReviewCell) {
    return other.kind === this.kind && other.elementClass === this.elementClass
  }

  override toDOM() {
    const span = document.createElement("span")
    span.setAttribute("role", "button")
    span.title =
      this.kind === "commented"
        ? "Commented — click to comment on this line too"
        : "Comment on this line (shift-click for a range)"

    if (this.kind === "commented") {
      span.className = "cm-reviewMark cm-reviewMark-has"
      span.append(commentIcon())
      return span
    }

    // The `+` is in the DOM for every row and shown by the theme below only
    // under the pointer, or on a row already in the range. Drawing it per hover
    // instead would mean a marker that changes identity as the mouse moves, and
    // a gutter redraw per row crossed.
    span.className = "cm-reviewMark cm-reviewMark-add"
    span.append(plusIcon())
    return span
  }
}

const emptyCell = new ReviewCell("empty", "cm-reviewCell")
const pendingCell = new ReviewCell("pending", "cm-reviewCell cm-reviewCell-pending") // prettier-ignore
const commentedCell = new ReviewCell("commented", "cm-reviewCell cm-reviewCell-has") // prettier-ignore

/**
 * The rows themselves, tinted with their cell.
 *
 * The gutter's `elementClass` reaches the cell and nothing else, and a range
 * marked only in a 14px column is a range nobody can see the extent of — which
 * is the whole question a reader has while picking one.
 *
 * A line is drawn as pending *or* commented, not both. Pending wins: it is the
 * thing being done right now, and a line already commented on can be in a new
 * range.
 */
const pendingLine = Decoration.line({ class: "cm-reviewLine-pending" })
const commentedLine = Decoration.line({ class: "cm-reviewLine-has" })

/**
 * The tints: the lines a thread is about, and the range being picked.
 *
 * The gutter's `elementClass` reaches its own cell and nothing else, and a range
 * marked only in a 14px column is a range nobody can see the extent of — which
 * is the whole question a reader has while picking one.
 *
 * A line is drawn as pending *or* commented, not both. Pending wins: it is the
 * thing being done right now, and a line already commented on can be in a new
 * range.
 *
 * In line order, which `RangeSetBuilder` requires: the two sets interleave, so
 * they cannot be two lists appended.
 */
function reviewDecorations(
  marks: ReviewMarks,
  doc: { lines: number; line: (n: number) => { from: number } }
) {
  const builder = new RangeSetBuilder<Decoration>()
  const hasThread = commentedIn(marks.threads)
  const inRange = (line: number) =>
    marks.pending !== null &&
    line >= marks.pending.fromLine &&
    line <= marks.pending.toLine

  const lines = new Set<number>(hasThread)
  if (marks.pending) {
    for (
      let line = marks.pending.fromLine;
      line <= marks.pending.toLine;
      line += 1
    ) {
      lines.add(line)
    }
  }

  for (const line of [...lines].sort((a, b) => a - b)) {
    if (line < 1 || line > doc.lines) continue
    const from = doc.line(line).from
    builder.add(from, from, inRange(line) ? pendingLine : commentedLine)
  }

  return builder.finish()
}

/**
 * The column, and the line decorations that go with it.
 *
 * Two ways to name more than one line, which are the two a reader already knows
 * from a forge: **drag** down or up, and **shift-click** a second line. `onDrag`
 * is handed the line the pointer went down on as well as the one it is over,
 * because a drag that turns back has to shrink the range and one that only ever
 * grows is a range with no anchor; `onPick` grows what is there, which is what a
 * shift-click means. Everything either of them *means* is the store's.
 *
 * **The drag is followed on `window`, not on this column.** It was the gutter's
 * own `mouseover`, which is a 22px-wide target: pressing in it and pulling down
 * *through the code* — which is what the hand does, since the range being chosen
 * is the code — left the column and the range stopped following. So the row is
 * read off the pointer's Y through `lineBlockAtHeight`, the same way the gutter's
 * own handlers resolve a line, and the X is ignored entirely. Which also means a
 * drag that leaves the editor keeps working, and one that leaves the window ends
 * where the button was let go.
 *
 * The gutter swallows the press either way, so it never reaches whatever else
 * the pane binds — and `preventDefault` on it is also what stops the drag from
 * selecting the text it is dragged across.
 */
export function reviewGutter(actions: ReviewActions): Extension {
  /*
   * The line the pointer went down on, or null when it is up.
   *
   * Closed over rather than kept in the editor's state: a drag is a gesture over
   * the DOM and is finished by a `mouseup` that can land anywhere — outside the
   * gutter, outside the editor, outside the window — so it is followed on
   * `window` and cannot be a transaction on a view that may be gone by then.
   * Nothing draws from it either; what is on screen is the pending range the
   * store already holds.
   */
  let anchor: number | null = null
  /** The view the press landed in, so the pointer can be resolved to a row of
   * *that* editor after it has left the column — and, in a split diff, not the
   * commit's side. */
  let dragging: EditorView | null = null
  /** The row the range was last taken to, so a `mousemove` that has not crossed
   * into another one does nothing: the range changes per row, not per pixel, and
   * each change is a store write, a render of the strip and a transaction on the
   * view. */
  let over: number | null = null

  const track = (event: MouseEvent) => {
    if (anchor === null || dragging === null) return

    const line = lineAtY(dragging, event.clientY)
    if (line === over) return
    over = line
    actions.drag(anchor, line)
  }

  const release = () => {
    window.removeEventListener("mousemove", track)
    if (anchor === null) return
    anchor = null
    dragging = null
    over = null
    actions.settle()
  }

  return [
    reviewMarks,
    gutter({
      class: "cm-diffGutter cm-reviewGutter",
      lineMarker: (view, line) => {
        const marks = view.state.field(reviewMarks)
        const number = view.state.doc.lineAt(line.from).number

        // Pending before commented, the same way round as the line
        // decorations: a line already commented on can be in the range being
        // written about now, and that is the state worth drawing.
        if (
          marks.pending &&
          number >= marks.pending.fromLine &&
          number <= marks.pending.toLine
        ) {
          return pendingCell
        }
        if (commentedIn(marks.threads).has(number)) return commentedCell
        return emptyCell
      },
      // Nothing beside a removed chunk or a collapsed bar: neither is a line of
      // this file, so neither is something a comment can name.
      widgetMarker: () => null,
      lineMarkerChange: (update) =>
        update.docChanged ||
        update.viewportChanged ||
        update.startState.field(reviewMarks) !==
          update.state.field(reviewMarks),
      domEventHandlers: {
        mousedown(view, line, event) {
          const mouse = event as MouseEvent
          // The left button only: the right one is a context menu, and the
          // middle one is a paste on some platforms.
          if (mouse.button !== 0) return false

          const number = view.state.doc.lineAt(line.from).number
          anchor = number
          over = number
          dragging = view
          // Both on `window`, since the pointer spends the rest of the gesture
          // outside the column it was pressed in — and `once` on the mouseup, so
          // a gesture leaves nothing behind.
          window.addEventListener("mousemove", track)
          window.addEventListener("mouseup", release, { once: true })

          actions.pick(number, mouse.shiftKey)
          // Both, and both matter: the default would start a text selection
          // that a shift-click then extends across the diff, and the bubble
          // would reach the pane's own handlers.
          event.preventDefault()
          return true
        },
      },
      initialSpacer: () => emptyCell,
    }),
    EditorView.decorations.compute([reviewMarks], (state) =>
      reviewDecorations(state.field(reviewMarks), state.doc)
    ),
    reviewTheme,
  ]
}

/**
 * The row under a pointer, by its Y alone.
 *
 * `y - documentTop` is how the gutter's own event handlers resolve a line, so
 * this agrees with the cell the press landed on rather than being a second
 * opinion about it.
 *
 * Clamped to the scroller, which is what a drag past either end means: dragging
 * below the pane takes the range to the last row on screen and stops there. It
 * does **not** scroll the diff — a review of a range longer than the pane is a
 * range picked by shift-clicking its two ends, and an editor that scrolls itself
 * under a held pointer is a range nobody can aim.
 */
function lineAtY(view: EditorView, clientY: number): number {
  const box = view.scrollDOM.getBoundingClientRect()
  const y = Math.min(Math.max(clientY, box.top + 1), box.bottom - 1)
  const block = view.lineBlockAtHeight(y - view.documentTop)
  return view.state.doc.lineAt(block.from).number
}

/**
 * The column's own metrics and the two colours in it.
 *
 * Primer's blue, as the rest of the diff is Primer's — a review mark is a
 * control rather than a state of the code, so it is the one thing in this pane
 * drawn in the accent rather than in a diff tint.
 */
const reviewTheme = EditorView.theme({
  ".cm-reviewGutter": { cursor: "pointer" },
  ".cm-reviewGutter .cm-gutterElement": {
    padding: "0 3px 0 5px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  ".cm-reviewMark": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "14px",
    height: "14px",
    borderRadius: "3px",
    color: "#ffffff",
    backgroundColor: "var(--primary)",
  },
  // Hidden until the row is under the pointer, or the row is in the range being
  // written about — a column of plus signs down every diff in the app would be
  // the loudest thing in it.
  ".cm-reviewMark-add": { opacity: "0", transition: "opacity 80ms" },
  ".cm-reviewGutter .cm-gutterElement:hover .cm-reviewMark-add": {
    opacity: "1",
  },
  ".cm-reviewCell-pending .cm-reviewMark-add": { opacity: "1" },
  ".cm-reviewCell-pending": { backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)" }, // prettier-ignore
  ".cm-reviewCell-has": { backgroundColor: "color-mix(in oklab, var(--primary) 12%, transparent)" }, // prettier-ignore
  /* Over the diff's own tint rather than instead of it: a commented line is
     still an added or a removed one, and losing that would take away the thing
     the comment is about. Hence a left edge and a wash rather than a fill. */
  ".cm-reviewLine-pending": {
    backgroundColor: "color-mix(in oklab, var(--primary) 14%, transparent)",
    boxShadow: "inset 2px 0 0 var(--primary)",
  },
  ".cm-reviewLine-has": {
    boxShadow:
      "inset 2px 0 0 color-mix(in oklab, var(--primary) 55%, transparent)",
  },
})
