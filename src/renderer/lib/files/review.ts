import { create } from "zustand"

/**
 * Comments left on the lines of a diff, and the prompt they are handed to an
 * agent as.
 *
 * The `Changes` pane is where a turn's work is read, and reading it is where the
 * remarks happen — "this leaks", "wrong error path", "rename this". Before this
 * they had to be retyped into a chat with the file and line named by hand, which
 * is both the tedious part and the part that goes wrong. So a review is left
 * where it is read: pick the lines, write the remark **in the diff, under the
 * lines it is about**, and one button opens a chat in that checkout with the lot
 * already written into its composer. `lib/files/review-marks.ts` is the drawing
 * half — the column, the tints and the threads as block widgets.
 *
 * **A comment is a thread, not a line of text**, and that is the shape rather
 * than a feature: a remark on a range is answered, argued with and added to, the
 * way one on a pull request is. So a range holds *notes*, each with an author,
 * and `reply` adds one. Which also means the future in mind here is already
 * expressible — an **agent** reviewing the diff leaves threads of its own
 * (`author: "agent"`, through `comment` rather than through the composer), and a
 * reply to one is the same reply. Nothing about this file would change for it,
 * which is the reason it is built this way now: retrofitting an author onto a
 * flat string is a migration, and there is nothing yet to migrate.
 *
 * **A review is a sitting, not a record.** Nothing here is written to disk: a
 * draft outlives switching files and switching tabs, and does not outlive the
 * app. What a review is *for* is the chat at the end of it, and a comment that
 * came back a week later would be pointing at line numbers that have since
 * moved. Anything worth keeping is in the chat, which is a record.
 *
 * Keyed by **root** — a project or one of its `git worktree` checkouts, the same
 * id `FileRoot.id` and the dock's shells use — because that is what is being
 * reviewed and what the chat is started in. Comments on several files are one
 * review, which is the whole point of the button.
 *
 * **A comment has a side**, the way one on a pull request does. Most are on the
 * *new* side, and their line numbers are the working file's — what an agent can
 * open the file at. A comment on a line that was **deleted** has nowhere in the
 * working file to point at, so it is numbered in the commit instead
 * (`side: "old"`), and the prompt says so where it quotes it: the lines
 * themselves are what the remark is about, and they are captured when it is
 * written. Deleted code is half of what a review is about — "this was load
 * bearing", "why did this go" — and before this it had to be retyped into the
 * chat by hand, which is the thing this feature exists to stop.
 *
 * A range is on one side or the other and never both: the two are numbered in
 * different files, so a range spanning them is not something either could be
 * opened at.
 */

/**
 * Who wrote one note.
 *
 * Two, and the second one has no writer yet: an agent asked to review the diff
 * will leave threads on what it finds, and a thread whose author is not said is
 * a thread that reads as the reviewer's own once there are two of them in a pane.
 */
export type ReviewAuthor = "you" | "agent"

/**
 * Which file a thread's line numbers are in.
 *
 * `new` is the working file — the diff's right-hand side, and every kept or
 * added line. `old` is the commit, which is where a deleted line still exists:
 * in the unified diff those rows are the merge extension's block widgets, and in
 * the split one they are the left-hand editor.
 */
export type ReviewSide = "new" | "old"

/** Where a comment is being left: the checkout, the file, and which side of the
 * diff the line numbers belong to. */
export type ReviewPlace = {
  rootId: string
  path: string
  side: ReviewSide
}

/** One thing said in a thread. */
export type ReviewNote = {
  id: string
  author: ReviewAuthor
  body: string
}

/** A range of one file's lines, and the conversation about it. */
export type ReviewThread = {
  id: string
  /** `FileRoot.id`: the checkout this review is of. */
  rootId: string
  /** Absolute, as every path in the Explorer is. */
  path: string
  /** Which file the two numbers below are in — see `ReviewSide`. */
  side: ReviewSide
  /** Inclusive, in the file `side` names. A single line is `from === to`. */
  fromLine: number
  toLine: number
  /**
   * The lines as they read when the thread was opened.
   *
   * Kept rather than resolved at send time, and that is deliberate: the agent is
   * told what the reviewer was looking at. Lines move — a fix to the file above
   * this one is enough — and a snippet read later would quote something the
   * remark was never about. Capped, so a comment on a 400-line block is still a
   * prompt.
   */
  snippet: string
  /** At least one, oldest first: a thread is opened by something being said. */
  notes: ReviewNote[]
}

/** The range being commented on, before there is a thread. */
export type PendingRange = {
  rootId: string
  path: string
  side: ReviewSide
  fromLine: number
  toLine: number
  /**
   * Whether the pointer has been let go — which is what opens the box.
   *
   * The range is painted from the moment it is picked and the box is not, and
   * that gap is load-bearing: the box is drawn *in* the diff, under the range, so
   * opening it mid-drag inserts height between the rows and moves them out from
   * under the pointer that is still choosing them. So a drag paints, and the
   * release opens.
   */
  settled: boolean
}

/** How many lines of the file a thread quotes, at most. Enough for a function,
 * short enough that eight comments are still one prompt. */
export const SNIPPET_LIMIT = 24

/** What opening a thread needs: where, what was said, and by whom. */
export type ThreadInput = {
  rootId: string
  path: string
  fromLine: number
  toLine: number
  snippet: string
  body: string
  author?: ReviewAuthor
  /** The working file unless said otherwise: a caller with a line number in
   * hand — an agent leaving its own review — means the file as it is now. */
  side?: ReviewSide
}

type ReviewState = {
  /** Every thread, across every root, in the order they were opened — which is
   * the order the prompt lists them in. */
  threads: ReviewThread[]
  /** The one range being written about, or null. One at a time: a second box
   * open in another file is a comment nobody is looking at. */
  pending: PendingRange | null
  /**
   * The thread whose reply box is open, or null.
   *
   * On the store rather than inside the box, because the box is a CodeMirror
   * widget: a widget is rebuilt whenever the threads change, so a reply box that
   * remembered itself in its own DOM would close every time anything else in the
   * review moved. What it must *not* hold is the half-typed text — see the
   * `drafts` note in `review-marks.ts`.
   */
  replyTo: string | null
  /**
   * The committed text of the file the diff is showing, or null.
   *
   * Here because of one thing only: a comment on a **deleted** line quotes lines
   * that are not in the working file, so `snippetOf` has to read them out of the
   * commit — and the panel that writes the thread has the working buffer to hand
   * and not this. It is pushed in by the diff (`codemirror-diff.tsx`), which is
   * the one place that holds both halves of what is on screen.
   *
   * One file rather than a cache: the pane draws one diff, and a committed text
   * kept for a file nobody is looking at is a copy of a file going stale.
   */
  committed: { path: string; text: string } | null

  /**
   * A click in the review gutter.
   *
   * `extend` is a shift-click, which grows the range the way a diff is selected
   * everywhere else. It only extends a range **in the same file and on the same
   * side**: a shift-click after switching files is a new range rather than one
   * spanning two files, and one that lands on a deleted line after a kept one is
   * a new range because the two are numbered in different files.
   */
  pick: (place: ReviewPlace, line: number, extend: boolean) => void
  /**
   * A range dragged from one line to another — the pointer held down in the
   * review column and moved.
   *
   * Takes the **anchor** rather than growing what is there, which is the whole
   * difference from `pick(…, extend)`: a drag that turns back has to shrink, and
   * a range with no anchor can only ever get bigger. Which end is which does not
   * matter — dragging upwards is the same range as dragging down to the same
   * pair.
   */
  stretch: (place: ReviewPlace, anchor: number, line: number) => void
  /** The pointer let go: the range stops being dragged and the box opens. */
  settle: () => void
  cancel: () => void

  /** Opens the pending range as a thread of the reader's own. Empty text is a
   * cancel. */
  add: (body: string, snippet: string) => void
  /**
   * Opens a thread anywhere, said by anybody — the door an agent's review comes
   * through, and what `add` is written over.
   *
   * Hands back the thread's id, so a caller with several things to say about one
   * range can `reply` into it rather than opening a thread per sentence.
   */
  comment: (input: ThreadInput) => string
  /** Another note on an existing thread. */
  reply: (threadId: string, body: string, author?: ReviewAuthor) => void
  /** Opens one thread's reply box, or closes whichever is open. */
  openReply: (threadId: string | null) => void
  /** The whole thread, notes and all: there is no deleting half a
   * conversation. */
  remove: (threadId: string) => void
  /** Everything for one root — `Discard`, and what sending the review does. */
  clear: (rootId: string) => void
  /** What the diff on screen is comparing against — see `committed`. */
  showing: (path: string, text: string) => void
}

/** Ids are unique within a run and mean nothing outside it, which is all a
 * draft needs — see the note above about a review being a sitting. */
let counter = 0
const nextId = (kind: string) => `${kind}-${Date.now()}-${(counter += 1)}`

export const useReview = create<ReviewState>((set, get) => ({
  threads: [],
  pending: null,
  replyTo: null,
  committed: null,

  pick(place, line, extend) {
    const { pending } = get()
    const grow =
      extend &&
      pending !== null &&
      pending.path === place.path &&
      pending.side === place.side
        ? extendTo(pending, line)
        : null

    set({
      pending: grow ?? {
        rootId: place.rootId,
        path: place.path,
        side: place.side,
        fromLine: line,
        toLine: line,
        settled: false,
      },
    })
  },

  stretch(place, anchor, line) {
    set({
      pending: {
        rootId: place.rootId,
        path: place.path,
        side: place.side,
        fromLine: Math.min(anchor, line),
        toLine: Math.max(anchor, line),
        settled: false,
      },
    })
  },

  settle() {
    const { pending } = get()
    // Nothing to settle is the common case: every mouseup in the app that is
    // not the end of a pick comes through here.
    if (!pending || pending.settled) return
    set({ pending: { ...pending, settled: true } })
  },

  cancel() {
    set({ pending: null })
  },

  add(body, snippet) {
    const { pending } = get()
    if (!pending || !body.trim()) {
      set({ pending: null })
      return
    }

    get().comment({ ...pending, snippet, body })
    set({ pending: null })
  },

  comment(input) {
    const id = nextId("thread")
    const note: ReviewNote = {
      id: nextId("note"),
      author: input.author ?? "you",
      body: input.body.trim(),
    }

    set({
      threads: [
        ...get().threads,
        {
          id,
          rootId: input.rootId,
          path: input.path,
          side: input.side ?? "new",
          fromLine: input.fromLine,
          toLine: input.toLine,
          snippet: input.snippet,
          notes: [note],
        },
      ],
    })
    return id
  },

  reply(threadId, body, author = "you") {
    const text = body.trim()
    if (!text) return

    set({
      // The box closes with the reply in it: leaving it open reads as a second
      // reply being expected.
      replyTo: get().replyTo === threadId ? null : get().replyTo,
      threads: get().threads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              notes: [
                ...thread.notes,
                { id: nextId("note"), author, body: text },
              ],
            }
          : thread
      ),
    })
  },

  openReply(threadId) {
    if (get().replyTo === threadId) return
    set({ replyTo: threadId })
  },

  remove(threadId) {
    set({
      threads: get().threads.filter((thread) => thread.id !== threadId),
      replyTo: get().replyTo === threadId ? null : get().replyTo,
    })
  },

  showing(path, text) {
    // Guarded rather than set blind: this is called from an effect that runs on
    // every rebuild of the diff, and a `set` with the same pair would re-render
    // every subscriber of the review for nothing.
    const held = get().committed
    if (held?.path === path && held.text === text) return
    set({ committed: { path, text } })
  },

  clear(rootId) {
    const kept = get().threads.filter((thread) => thread.rootId !== rootId)
    set({
      threads: kept,
      pending: get().pending?.rootId === rootId ? null : get().pending,
      replyTo: kept.some((thread) => thread.id === get().replyTo)
        ? get().replyTo
        : null,
    })
  },
}))

/** A range grown to include one more line, whichever side of it that line is
 * on. The anchor is not tracked: a shift-click below extends downwards and one
 * above extends upwards, which is what a reader means by either. */
export function extendTo(range: PendingRange, line: number): PendingRange {
  return {
    ...range,
    fromLine: Math.min(range.fromLine, line),
    toLine: Math.max(range.toLine, line),
    // A shift-click is a press like any other: the box opens when it is let go.
    settled: false,
  }
}

/** One root's threads, in the order they were opened. */
export function threadsOf(
  state: { threads: ReviewThread[] },
  rootId: string | null
): ReviewThread[] {
  if (rootId === null) return []
  return state.threads.filter((thread) => thread.rootId === rootId)
}

/** How many notes are in a set of threads — what the strip and the button
 * count, since a thread with three replies is three things said. */
export function noteCount(threads: ReviewThread[]): number {
  return threads.reduce((total, thread) => total + thread.notes.length, 0)
}

/**
 * Which of one file's lines carry a thread, as a flat set.
 *
 * A set rather than the ranges, because the caller is a gutter marker asking
 * about one line at a time and there is one of those per row on screen. One
 * side at a time for the same reason a range cannot span both: line 12 of the
 * commit and line 12 of the working file are two different rows.
 */
export function commentedLines(
  threads: ReviewThread[],
  path: string,
  side: ReviewSide = "new"
): Set<number> {
  const lines = new Set<number>()
  for (const thread of threads) {
    if (thread.path !== path || thread.side !== side) continue
    for (let line = thread.fromLine; line <= thread.toLine; line += 1) {
      lines.add(line)
    }
  }
  return lines
}

/** `12` for one line, `12–18` for a range — an en dash, the way a line range is
 * written. */
export function rangeLabel(range: {
  fromLine: number
  toLine: number
}): string {
  return range.fromLine === range.toLine
    ? String(range.fromLine)
    : `${range.fromLine}–${range.toLine}`
}

/**
 * The lines a thread quotes, taken out of the file's text.
 *
 * Truncated with a line saying so rather than silently, since a prompt that
 * stops mid-function reads as the reviewer having meant only that much.
 */
export function snippetOf(
  text: string,
  fromLine: number,
  toLine: number,
  limit = SNIPPET_LIMIT
): string {
  const lines = text.split("\n").slice(fromLine - 1, toLine)
  if (lines.length <= limit) return lines.join("\n")
  return [
    ...lines.slice(0, limit),
    `… ${lines.length - limit} more line${lines.length - limit === 1 ? "" : "s"}`,
  ].join("\n")
}

/** What each author is called in the prompt. The turn reading it is the one
 * whose own past notes are `Assistant`, which is how it tells a remark it has
 * already made from one being made to it. */
const AUTHOR_LABEL: Record<ReviewAuthor, string> = {
  you: "Reviewer",
  agent: "Assistant",
}

/**
 * The whole review as one prompt.
 *
 * **A file-and-line heading, the lines themselves, then what was said**, per
 * thread, in the order they were opened — which is the order a reviewer read the
 * diff in, and therefore the order the remarks make sense in. Markdown because
 * that is what a turn reads best, and fenced code because a snippet with a `#`
 * in it would otherwise be a heading.
 *
 * A **deleted** thread's heading says so, since its numbers are the commit's and
 * an agent that opened the working file at one of them would be looking at
 * whatever moved up into the gap. The quoted lines are the address in that case,
 * which the preamble says out loud.
 *
 * A thread with one note is that note, unattributed: naming an author in a
 * conversation with one voice is noise. A thread with several is the exchange,
 * each line labelled, because who said what is the whole content of a
 * disagreement — and because an agent's own earlier remark has to be
 * distinguishable from the instruction it is being given now.
 *
 * The paths are **relative to the checkout**, which is the cwd the turn runs in:
 * an absolute path under `~/.tabomni/workspace/worktrees/<uuid>/<branch>/` is
 * forty characters of this app's own bookkeeping before it says anything about
 * the file, and the agent has to turn it back into a relative one anyway.
 *
 * Pure, and the reason it is: this is the one thing in the feature worth being
 * sure about — a prompt is what the whole review becomes — and it is checked in
 * `test/review.ts` without a store, a chat or an editor.
 */
export function reviewPrompt(
  threads: ReviewThread[],
  rootPath: string
): string {
  const relative = (path: string) =>
    path.startsWith(rootPath + "/") ? path.slice(rootPath.length + 1) : path

  const blocks = threads.map((thread) => {
    // The side is said on every heading that needs it rather than once at the
    // top, because a turn reads these one at a time and acting on a deleted
    // line's number as if it were the working file's is the mistake this stops.
    const side = thread.side === "old" ? " (deleted — numbers are the commit's)" : "" // prettier-ignore
    const where = `${relative(thread.path)}:${rangeLabel(thread)}${side}`
    const quoted = thread.snippet
      ? ["", "```", thread.snippet, "```"].join("\n")
      : ""
    const said =
      thread.notes.length === 1
        ? (thread.notes[0]?.body ?? "")
        : thread.notes
            .map((note) => `**${AUTHOR_LABEL[note.author]}:** ${note.body}`)
            .join("\n\n")

    return `### ${where}${quoted}\n\n${said}`
  })

  const notes = noteCount(threads)
  const count = notes === 1 ? "1 comment" : `${notes} comments`

  return [
    `Code review of the uncommitted changes in this checkout — ${count} below.`,
    "",
    "Each heading is a file and the lines it is about, followed by those lines as they read when the comment was written, then what was said about them. Line numbers may have moved since; the quoted lines are what was meant.",
    "",
    "A heading marked *deleted* is about lines this change removed: those numbers are the committed file's, and there is nothing at them in the working file. Find the code by what is quoted, not by the number.",
    "",
    "Address every one of them. Where a comment is a question rather than a change, answer it instead of editing.",
    "",
    ...blocks,
  ].join("\n")
}
