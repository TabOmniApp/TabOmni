import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state"
import {
  BlockType,
  Decoration,
  EditorView,
  gutter,
  GutterMarker,
  ViewPlugin,
  type BlockInfo,
  type ViewUpdate,
} from "@codemirror/view"

import { DIFF_ROW_HEIGHT, removedChunkAt } from "./diff-chrome"
import type { ReviewSide, ReviewThread } from "./review"

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
 * **A line here is a line of one of two files**, and which one is `side`. A
 * document line of the working side is the file's own; a document line of the
 * commit's editor — the left half of the split view — is the commit's. Neither
 * of those is where a **deleted** line lives in the unified diff: there it is a
 * row inside one of the merge extension's block widgets, drawn by
 * `widgetMarker` a whole chunk at a time and resolved back to a row by its
 * height, since a widget is one gutter slot however many lines it draws. That is
 * also the only way a pointer inside one can be turned into a line number, and
 * why `DIFF_ROW_HEIGHT` is a constant both files read rather than a number in a
 * theme.
 *
 * The one thing the removed rows cannot have is the diff's own row tint from a
 * decoration: those rows are inside a widget whose DOM `@codemirror/merge`
 * builds once and caches, so nothing in the document reaches them. They are
 * painted by `removedRowTints` below, which is the one piece of this file that
 * reaches into another extension's DOM.
 */

/** What the review looks like in one file, as the editor needs it. */
export type ReviewMarks = {
  /** This file's threads, **both sides**: one editor draws the working file's
   * and the removed rows in the same pass. */
  threads: ReviewThread[]
  /** The range being written about right now, or null. */
  pending: { fromLine: number; toLine: number; side: ReviewSide } | null
}

/**
 * What the widgets call. Wired to the store by `codemirror-diff.tsx`, which is
 * the only place that knows which checkout and which file this diff is of.
 *
 * Handed in rather than reached for, so this file stays a drawing of a review
 * and not a second copy of what a review *is*.
 */
export type ReviewActions = {
  /** A click in the column: the line, whether it was a shift-click, and which
   * file that line is numbered in — a removed row is the commit's. */
  pick: (line: number, extend: boolean, side: ReviewSide) => void
  /** A drag: the line it started on, and the line it is over now. Both are on
   * `side`, since a drag that leaves the side it started on is ignored. */
  drag: (anchor: number, line: number, side: ReviewSide) => void
  /** The button let go, wherever that happened — what opens the box. */
  settle: () => void
}

/** What one editor's review column is: what to call, what a document line of it
 * is a line of, and whether removed chunks are drawn in it at all. */
export type ReviewColumn = ReviewActions & {
  /** `new` for the working side, `old` for the commit's own editor in the split
   * view. */
  side: ReviewSide
  /**
   * Whether this editor draws removed chunks as block widgets.
   *
   * The unified diff does; the split view puts them on its other editor, where
   * they are ordinary lines. Said rather than discovered, because a block
   * widget's position is also the start of the line after it — so an editor
   * with no removed rows in it could still find a chunk at a collapsed bar's
   * position and draw a column of marks against nothing.
   */
  removals: boolean
  /**
   * Whether to lay the column *over* the gutter beside it rather than take a
   * column of its own.
   *
   * True in the unified diff, whose `+`/`-` column it lands on: in flow it is
   * 16px of empty space between the signs and the code on every diff in the app,
   * since the mark itself is hidden until the row is hovered. False in the split
   * view, where the gutter beside it is CodeMirror's fold arrows — laying the
   * column over those would take a working control away rather than cover a
   * glyph that says the same thing as the row's own tint.
   */
  overlay: boolean
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
const commented = new WeakMap<ReviewThread[], Record<ReviewSide, Set<number>>>()

function commentedIn(threads: ReviewThread[]): Record<ReviewSide, Set<number>> {
  const held = commented.get(threads)
  if (held) return held

  const lines: Record<ReviewSide, Set<number>> = {
    new: new Set<number>(),
    old: new Set<number>(),
  }
  for (const thread of threads) {
    for (let line = thread.fromLine; line <= thread.toLine; line += 1) {
      lines[thread.side].add(line)
    }
  }
  commented.set(threads, lines)
  return lines
}

/**
 * What one row of one side is: nothing, somewhere in the range being written
 * about, one of that range's two ends, or already commented on.
 *
 * Pending before commented, the same way round as the line decorations — a line
 * already commented on can be in the range being picked now, and that is the
 * state worth drawing.
 *
 * The **ends** are their own states because they are the only rows that carry a
 * handle, and because the band drawn round the range is closed at the top on one
 * and at the bottom on the other. A range of one line is both at once, which is
 * what `pendingSolo` is: two rules on one row rather than a row that is only
 * half a box.
 */
function stateOf(marks: ReviewMarks, side: ReviewSide, line: number): CellKind {
  const { pending } = marks
  if (
    pending &&
    pending.side === side &&
    line >= pending.fromLine &&
    line <= pending.toLine
  ) {
    const first = line === pending.fromLine
    const last = line === pending.toLine
    if (first && last) return "pendingSolo"
    if (first) return "pendingFirst"
    if (last) return "pendingLast"
    return "pending"
  }
  if (commentedIn(marks.threads)[side].has(line)) return "commented"
  return "empty"
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

/** What one row's state looks like. Shared by the gutter cell and the rows of a
 * removed chunk, which are the same control drawn in two places. */
type CellKind =
  | "empty"
  | "pending"
  | "pendingFirst"
  | "pendingLast"
  | "pendingSolo"
  | "commented"

/** The two ends of the range being picked, which are the rows that carry a
 * handle. */
const HANDLES = new Set<CellKind>(["pendingFirst", "pendingLast", "pendingSolo"]) // prettier-ignore

function markDOM(kind: CellKind): HTMLElement {
  const span = document.createElement("span")
  span.setAttribute("role", "button")
  span.title =
    kind === "commented"
      ? "Commented — click to comment on this line too"
      : "Comment on this line (shift-click for a range)"

  if (kind === "commented") {
    span.className = "cm-reviewMark cm-reviewMark-has"
    span.append(commentIcon())
    return span
  }

  // The `+` is in the DOM for every row and shown by the theme below only
  // under the pointer, or on the two ends of the range being picked. Drawing it
  // per hover instead would mean a marker that changes identity as the mouse
  // moves, and a gutter redraw per row crossed.
  span.className = `cm-reviewMark cm-reviewMark-add${
    HANDLES.has(kind) ? " cm-reviewMark-handle" : ""
  }`
  span.append(plusIcon())
  return span
}

/** The class a row of either kind carries for its state, so the tint is one
 * rule wherever the row is drawn. */
const CELL_CLASS: Record<CellKind, string> = {
  empty: "",
  pending: "cm-reviewCell-pending",
  pendingFirst: "cm-reviewCell-pending",
  pendingLast: "cm-reviewCell-pending",
  pendingSolo: "cm-reviewCell-pending",
  commented: "cm-reviewCell-has",
}

/**
 * The class the *line* carries for its state — the band round the range.
 *
 * One class per row rather than a shared one plus modifiers, because what draws
 * the band is a `box-shadow`: three insets on the row that closes the top, three
 * on the one that closes the bottom, and a class that only added a rule would
 * replace the others rather than join them.
 */
const LINE_CLASS: Record<CellKind, string> = {
  empty: "",
  pending: "cm-reviewLine-pending",
  pendingFirst: "cm-reviewLine-pendingFirst",
  pendingLast: "cm-reviewLine-pendingLast",
  pendingSolo: "cm-reviewLine-pendingSolo",
  commented: "cm-reviewLine-has",
}

class ReviewCell extends GutterMarker {
  constructor(
    readonly kind: CellKind,
    override readonly elementClass: string
  ) {
    super()
  }

  override eq(other: ReviewCell) {
    return other.kind === this.kind && other.elementClass === this.elementClass
  }

  override toDOM() {
    return markDOM(this.kind)
  }
}

const emptyCell = new ReviewCell("empty", "cm-reviewCell")

/** One cell per state, built once: a marker is compared by `eq` and rebuilt
 * whenever it differs, so a fresh object per row would redraw the column on
 * every pointer move. */
const CELLS: Record<CellKind, ReviewCell> = {
  empty: emptyCell,
  pending: new ReviewCell("pending", "cm-reviewCell cm-reviewCell-pending"),
  pendingFirst: new ReviewCell("pendingFirst", "cm-reviewCell cm-reviewCell-pending"), // prettier-ignore
  pendingLast: new ReviewCell("pendingLast", "cm-reviewCell cm-reviewCell-pending"), // prettier-ignore
  pendingSolo: new ReviewCell("pendingSolo", "cm-reviewCell cm-reviewCell-pending"), // prettier-ignore
  commented: new ReviewCell("commented", "cm-reviewCell cm-reviewCell-has"),
}

/**
 * The column beside a removed chunk: one mark per removed line.
 *
 * The shape `RemovedColumn` in `diff-chrome.ts` has, for the reason stated
 * there — a widget is one gutter slot however many rows it draws, so the slot is
 * filled with that many rows at the pinned line height. What is different here
 * is that each row is a control: the hover that reveals a `+` is per row rather
 * than per slot, which is a `:hover` on the row in the theme below.
 */
class RemovedReviewColumn extends GutterMarker {
  constructor(
    /** The first row's line number in the commit — what a click on it means. */
    readonly firstOld: number,
    readonly kinds: CellKind[]
  ) {
    super()
  }

  override eq(other: RemovedReviewColumn) {
    return (
      other.firstOld === this.firstOld &&
      other.kinds.length === this.kinds.length &&
      other.kinds.every((kind, at) => kind === this.kinds[at])
    )
  }

  override toDOM() {
    const wrap = document.createElement("span")
    wrap.className = "cm-reviewRemovedCol"
    for (const kind of this.kinds) {
      const row = wrap.appendChild(document.createElement("span"))
      row.className = `cm-reviewRemovedRow ${CELL_CLASS[kind]}`.trimEnd()
      row.append(markDOM(kind))
    }
    return wrap
  }
}

/** One line decoration per state, built once for the same reason `CELLS` is. */
const LINES: Record<CellKind, Decoration | null> = {
  empty: null,
  pending: Decoration.line({ class: LINE_CLASS.pending }),
  pendingFirst: Decoration.line({ class: LINE_CLASS.pendingFirst }),
  pendingLast: Decoration.line({ class: LINE_CLASS.pendingLast }),
  pendingSolo: Decoration.line({ class: LINE_CLASS.pendingSolo }),
  commented: Decoration.line({ class: LINE_CLASS.commented }),
}

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
  doc: { lines: number; line: (n: number) => { from: number } },
  side: ReviewSide
) {
  const builder = new RangeSetBuilder<Decoration>()
  const lines = new Set<number>(commentedIn(marks.threads)[side])
  if (marks.pending?.side === side) {
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
    const decoration = LINES[stateOf(marks, side, line)]
    if (decoration) builder.add(from, from, decoration)
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
export function reviewGutter(column: ReviewColumn): Extension {
  const { side, removals, overlay } = column

  /** One row of one file: which of the two, and its line number there. */
  type Row = { side: ReviewSide; line: number }

  /**
   * The row the pointer went down on, or null when it is up.
   *
   * Closed over rather than kept in the editor's state: a drag is a gesture over
   * the DOM and is finished by a `mouseup` that can land anywhere — outside the
   * gutter, outside the editor, outside the window — so it is followed on
   * `window` and cannot be a transaction on a view that may be gone by then.
   * Nothing draws from it either; what is on screen is the pending range the
   * store already holds.
   */
  let anchor: Row | null = null
  /** The view the press landed in, so the pointer can be resolved to a row of
   * *that* editor after it has left the column — and, in a split diff, not the
   * commit's side. */
  let dragging: EditorView | null = null
  /** The row the range was last taken to, so a `mousemove` that has not crossed
   * into another one does nothing: the range changes per row, not per pixel, and
   * each change is a store write, a render of the strip and a transaction on the
   * view. */
  let over: Row | null = null

  /**
   * Which row of which file a block is, at this Y.
   *
   * A removed chunk is one block however many lines it draws, so the row inside
   * it is the offset from its top over the pinned row height — the same fact
   * `RemovedColumn` relies on to line its numbers up, read the other way round.
   * Null for a collapsed bar: it is not a line of either file, so it is not
   * something a comment can name.
   */
  const rowOf = (
    view: EditorView,
    block: BlockInfo,
    clientY: number
  ): Row | null => {
    if (block.type !== BlockType.Text) {
      const removed = removals ? removedChunkAt(view.state, block.from) : null
      if (!removed) return null

      const at = Math.floor(
        (clientY - view.documentTop - block.top) / DIFF_ROW_HEIGHT
      )
      const row = Math.min(Math.max(at, 0), removed.lines - 1)
      return { side: "old", line: removed.firstOld + row }
    }

    return { side, line: view.state.doc.lineAt(block.from).number }
  }

  const track = (event: MouseEvent) => {
    if (anchor === null || dragging === null) return

    const row = rowAtY(dragging, event.clientY, rowOf)
    // A drag that has left the side it started on does nothing rather than
    // jumping: the two sides are numbered in different files, so there is no
    // range that spans them. Dragging back returns to the rows it left.
    if (row === null || row.side !== anchor.side) return
    if (row.line === over?.line) return

    over = row
    column.drag(anchor.line, row.line, anchor.side)
  }

  const release = () => {
    window.removeEventListener("mousemove", track)
    if (anchor === null) return
    anchor = null
    dragging = null
    over = null
    column.settle()
  }

  return [
    reviewMarks,
    gutter({
      class: `cm-diffGutter cm-reviewGutter${overlay ? " cm-reviewGutter-over" : ""}`,
      lineMarker: (view, line) => {
        const marks = view.state.field(reviewMarks)
        const number = view.state.doc.lineAt(line.from).number
        return CELLS[stateOf(marks, side, number)]
      },
      /**
       * Beside a removed chunk: a mark per line it draws, numbered in the
       * commit. Nothing beside a collapsed bar, which is not a line of either
       * file — `removedChunkAt` answering null is what tells the two apart.
       */
      widgetMarker: (view, _widget, block) => {
        const removed = removals ? removedChunkAt(view.state, block.from) : null
        if (!removed) return null

        const marks = view.state.field(reviewMarks)
        return new RemovedReviewColumn(
          removed.firstOld,
          Array.from({ length: removed.lines }, (_, at) =>
            stateOf(marks, "old", removed.firstOld + at)
          )
        )
      },
      lineMarkerChange: (update) =>
        update.docChanged ||
        update.viewportChanged ||
        update.startState.field(reviewMarks) !==
          update.state.field(reviewMarks),
      domEventHandlers: {
        mousedown(view, block, event) {
          const mouse = event as MouseEvent
          // The left button only: the right one is a context menu, and the
          // middle one is a paste on some platforms.
          if (mouse.button !== 0) return false

          const row = rowOf(view, block, mouse.clientY)
          // The collapsed bar's own cell. Left alone rather than swallowed:
          // there is nothing to pick there.
          if (row === null) return false

          anchor = row
          over = row
          dragging = view
          // Both on `window`, since the pointer spends the rest of the gesture
          // outside the column it was pressed in — and `once` on the mouseup, so
          // a gesture leaves nothing behind.
          window.addEventListener("mousemove", track)
          window.addEventListener("mouseup", release, { once: true })

          column.pick(row.line, mouse.shiftKey, row.side)
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
      reviewDecorations(state.field(reviewMarks), state.doc, side)
    ),
    // Only where there are removed rows to paint: the split view's deletions are
    // ordinary lines on its other editor and are tinted by the decorations above.
    ...(removals ? [removedRowTints] : []),
    reviewTheme,
  ]
}

/**
 * The tint on the rows of a removed chunk, painted onto the merge extension's
 * own DOM.
 *
 * The one place in this file that reaches into another extension's elements, and
 * the reason is that there is no other way in: a removed chunk is a block widget
 * whose DOM `@codemirror/merge` builds once and caches on the chunk, so no
 * decoration of ours addresses those rows and re-rendering them is not something
 * the widget offers. What a comment needs is the same thing the kept lines get —
 * the extent of the range visible in the code rather than only in a 16px column.
 *
 * `posAtDOM` is how the merge extension itself finds a chunk from its element
 * (its accept/reject buttons do exactly this), so it is the supported way back
 * from a node to a position. A chunk that cannot be resolved is skipped, which
 * costs the tint and nothing else.
 */
const removedRowTints = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.paint(view)
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.geometryChanged ||
        update.startState.field(reviewMarks) !== update.state.field(reviewMarks)
      ) {
        this.paint(update.view)
      }
    }

    paint(view: EditorView) {
      const marks = view.state.field(reviewMarks)

      for (const chunk of view.contentDOM.querySelectorAll(
        ".cm-deletedChunk"
      )) {
        let removed: { firstOld: number; lines: number } | null = null
        try {
          removed = removedChunkAt(view.state, view.posAtDOM(chunk))
        } catch {
          // A node the view no longer has a position for — mid-update, or a
          // chunk on its way out. There is nothing to tint in it.
        }
        if (!removed) continue

        const rows = chunk.querySelectorAll(".cm-deletedLine")
        rows.forEach((row, at) => {
          const wanted =
            LINE_CLASS[stateOf(marks, "old", removed.firstOld + at)]
          for (const name of Object.values(LINE_CLASS)) {
            if (name) row.classList.toggle(name, name === wanted)
          }
        })
      }
    }
  }
)

/**
 * The row under a pointer, by its Y alone.
 *
 * `y - documentTop` is how the gutter's own event handlers resolve a block, so
 * this agrees with the cell the press landed on rather than being a second
 * opinion about it. What that block *means* is `rowOf`'s, which is the column's
 * own: only it knows which side this editor's lines are, and whether a widget in
 * it is a removed chunk.
 *
 * Clamped to the scroller, which is what a drag past either end means: dragging
 * below the pane takes the range to the last row on screen and stops there. It
 * does **not** scroll the diff — a review of a range longer than the pane is a
 * range picked by shift-clicking its two ends, and an editor that scrolls itself
 * under a held pointer is a range nobody can aim.
 */
function rowAtY<Row>(
  view: EditorView,
  clientY: number,
  rowOf: (view: EditorView, block: BlockInfo, clientY: number) => Row | null
): Row | null {
  const box = view.scrollDOM.getBoundingClientRect()
  const y = Math.min(Math.max(clientY, box.top + 1), box.bottom - 1)
  return rowOf(view, view.lineBlockAtHeight(y - view.documentTop), y)
}

/**
 * The column's own metrics and the two colours in it.
 *
 * Primer's blue, as the rest of the diff is Primer's — a review mark is a
 * control rather than a state of the code, so it is the one thing in this pane
 * drawn in the accent rather than in a diff tint.
 */
const PENDING_TINT = "color-mix(in oklab, var(--primary) 14%, transparent)"
const PENDING_EDGE = "inset 2px 0 0 var(--primary)"

const reviewTheme = EditorView.theme({
  ".cm-reviewGutter": { cursor: "pointer", overflow: "visible" },
  /*
   * Out of the row of gutters and over the `+`/`-` column, rather than a fifth
   * column of its own — see `overlay`, which is what says where this is safe.
   *
   * A gutter in flow is 16px of empty space between the signs and the code on
   * every diff in the app, since the mark itself is hidden until the row is
   * hovered: a permanent gap paid for a control that is usually not drawn.
   * Absolute takes it out of `.cm-gutters`' flex row — which is `position:
   * sticky`, and therefore the containing block — and lays it over the sign
   * column, where a forge puts the button anyway: the cell is transparent, so
   * the row's own tint still reads through, and the sign is covered only while
   * the mark is up. `right: 0` rather than `left: 100%` for the same reason —
   * over the code would hide its first character.
   */
  ".cm-reviewGutter-over": {
    position: "absolute",
    top: "0",
    bottom: "0",
    right: "0",
  },
  ".cm-reviewGutter .cm-gutterElement": {
    // Narrow enough to stay inside the sign column it is laid over rather than
    // spilling onto the numbers beside it.
    padding: "0 1px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    // The handle at either end of a range deliberately hangs out of this column
    // and over the code, and `.cm-gutter` is `overflow: hidden` in CodeMirror's
    // own base theme — which clipped it to a half-round stub. Nothing else in
    // here overflows, and `.cm-gutters` sits at `z-index: 200`, so what hangs
    // out paints over the code rather than under it.
    overflow: "visible",
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
  // Hidden until the row is under the pointer, or the row is one of the two ends
  // of the range being written about — a column of plus signs down every diff in
  // the app would be the loudest thing in it.
  ".cm-reviewMark-add": { opacity: "0", transition: "opacity 80ms" },
  /* The row under the pointer, and **only** that row: `>` rather than a
     descendant, because a removed chunk is one gutter element holding every one
     of its rows — hovering anywhere in a twenty-line deletion lit all twenty of
     them. The rows of that column carry their own `:hover` below. */
  ".cm-reviewGutter .cm-gutterElement:hover > .cm-reviewMark-add": {
    opacity: "1",
  },
  /* The rows of a removed chunk. One slot, one row per removed line at the
     pinned height, so the marks line up with the code the widget drew — and the
     hover is per row rather than per slot, since each row is its own control. */
  ".cm-reviewRemovedCol": {
    display: "block",
    // The whole slot, so the rows start where the widget's own do: the cell
    // centres a single mark, and a column of them centred would drift by half
    // whatever rounding the slot has.
    alignSelf: "stretch",
    width: "100%",
  },
  ".cm-reviewRemovedRow": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: `${DIFF_ROW_HEIGHT}px`,
  },
  ".cm-reviewRemovedRow:hover .cm-reviewMark-add": { opacity: "1" },
  /*
   * The two ends of the range being picked, as handles.
   *
   * Bigger than the mark that opened the range, always drawn, and hanging over
   * the code: what they say is *this is the range and these are its ends*, which
   * is a different job from the `+` that appears under the pointer — and a
   * reader mid-gesture is looking at the code rather than at a 16px column. The
   * rows between them draw no mark at all, so the pair reads as two ends of one
   * thing rather than as a column of buttons.
   *
   * The ring is the pane's own background, which is what keeps a handle legible
   * where it overlaps a line of code.
   */
  ".cm-reviewMark-handle": {
    opacity: "1",
    width: "20px",
    height: "20px",
    borderRadius: "6px",
    transform: "translateX(7px)",
    boxShadow: "0 0 0 2px var(--background)",
    position: "relative",
    zIndex: "1",
  },
  ".cm-reviewCell-pending": { backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)" }, // prettier-ignore
  ".cm-reviewCell-has": { backgroundColor: "color-mix(in oklab, var(--primary) 12%, transparent)" }, // prettier-ignore
  /* Over the diff's own tint rather than instead of it: a commented line is
     still an added or a removed one, and losing that would take away the thing
     the comment is about. Hence a left edge and a wash rather than a fill. */
  ".cm-reviewLine-pending": {
    backgroundColor: PENDING_TINT,
    boxShadow: PENDING_EDGE,
  },
  /* The range as a closed band: the same left edge on every row of it, plus a
     rule across the top of the first and the bottom of the last. Insets rather
     than borders, because a border is a pixel of height and would move the rows
     under the pointer that is still choosing them. */
  ".cm-reviewLine-pendingFirst": {
    backgroundColor: PENDING_TINT,
    boxShadow: `${PENDING_EDGE}, inset 0 1px 0 var(--primary)`,
  },
  ".cm-reviewLine-pendingLast": {
    backgroundColor: PENDING_TINT,
    boxShadow: `${PENDING_EDGE}, inset 0 -1px 0 var(--primary)`,
  },
  ".cm-reviewLine-pendingSolo": {
    backgroundColor: PENDING_TINT,
    boxShadow: `${PENDING_EDGE}, inset 0 1px 0 var(--primary), inset 0 -1px 0 var(--primary)`, // prettier-ignore
  },
  ".cm-reviewLine-has": {
    boxShadow:
      "inset 2px 0 0 color-mix(in oklab, var(--primary) 55%, transparent)",
  },
})
