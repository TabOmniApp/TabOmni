import { create } from "zustand"

import { useSettings } from "@/lib/settings"

/* The one runtime value these types come with: the severities in the order they
 * are worth reading, which `severitySummary` walks. */
import { REVIEW_SEVERITY_IDS } from "@shared/api"

/* The pane the walk moves through — `step` opens the next thread's file the way
 * clicking its row in the Changes list would. One direction only: that store
 * knows nothing about a review. */
import { useChanges } from "./changes"
/* The one place a path is split — `reviewFile` names a file the way a finding
 * does, which is relative to the checkout. */
import { relativeTo } from "./paths"

/*
 * The record's own types live in the contract rather than here, because a review
 * is written to disk now and main is the one writing it — see `REVIEW_FILE` in
 * `main/store.ts`. Re-exported so every reader of a review still reaches them
 * through this file, which is the same bargain `lib/tree.ts` makes with
 * `@shared/tree`.
 */
export type {
  LineRange,
  ReviewAnchor,
  ReviewAuthor,
  ReviewNote,
  ReviewSide,
  ReviewSeverity,
  ReviewSnippet,
  ReviewThread,
} from "@shared/api"
import type {
  LineRange,
  ReviewChangesAnswer,
  ReviewAnchor,
  ReviewAuthor,
  ReviewNote,
  ReviewSide,
  ReviewSeverity,
  ReviewSnippet,
  ReviewThread,
} from "@shared/api"

/**
 * Comments left on the lines of a diff, and the prompt they are handed to an
 * agent as.
 *
 * The `Changes` pane is where a turn's work is read, and reading it is where the
 * remarks happen — "this leaks", "wrong error path", "rename this". Before this
 * they had to be retyped into a chat with the file and line named by hand, which
 * is both the tedious part and the part that goes wrong. So a review is left
 * where it is read: pick the lines, write the remark **in the diff, under the
 * lines it is about**, and write `@claude-review` in it to have Claude answer in
 * the same thread. `lib/files/review-marks.ts` is the drawing half — the column,
 * the band and the threads as block widgets.
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
 * **A review used to be a sitting, and is a record now.** Nothing was written to
 * disk, on three legs: a review was *for* the chat at the end of it, anything
 * worth keeping was in that chat, and a comment read back a week later would
 * point at line numbers that had since moved. The first two went with the
 * `Ask AI to fix…` button — there is no chat at the end any more, so there was
 * nothing keeping it, and a reviewer who closed the window lost the afternoon.
 *
 * The third leg was the real one, and it is answered rather than ignored: a
 * thread is addressed by the **lines it quoted**, not by its numbers. `settle`
 * finds them again when the file is next shown, moves the comment to where they
 * are, and marks it `stale` when they are nowhere — see it, and `REVIEW_FILE` in
 * `main/store.ts` for where the lot is kept.
 *
 * Keyed by **root** — a project or one of its `git worktree` checkouts, the same
 * id `FileRoot.id` and the dock's shells use — because that is what is being
 * reviewed and what a turn answering a comment runs in. Comments on several
 * files are one review.
 *
 * **A comment has a side**, the way one on a pull request does. Most are on the
 * *new* side, and their line numbers are the working file's — what an agent can
 * open the file at. A comment on a line that was **deleted** has nowhere in the
 * working file to point at, so it is numbered in the commit instead
 * (`anchor.old`), and the prompt says so where it quotes it: the lines
 * themselves are what the remark is about, and they are captured when it is
 * written. Deleted code is half of what a review is about — "this was load
 * bearing", "why did this go" — and before this it had to be retyped into the
 * chat by hand, which is the thing this feature exists to stop.
 *
 * **A range may cover both sides at once**, and that reverses the rule this
 * started with. It said a range was on one side or the other and never both,
 * because the two are numbered in different files and a pair of numbers cannot
 * be in two. That is still true of the *numbers* — and it turned out to be the
 * wrong thing to build the shape around. What a person selects in a unified diff
 * is a **hunk**: the `-` lines and the `+` lines that replaced them, which is one
 * thought and the most common thing there is to have an opinion about. Refusing
 * it meant two comments saying half a remark each, and — worse — a drag that
 * crossed from one to the other silently stopped moving, which read as the
 * selection being broken rather than as a rule being enforced.
 *
 * So a comment's address is a `ReviewAnchor`: a run of the commit's lines, a run
 * of the working file's, or one of each. Nothing is lost — a thread that is only
 * about deleted lines still says so, and one that is only about the working file
 * still carries numbers an agent can open the file at.
 */

/** Where a comment is being left: the checkout and the file. The side is no
 * longer part of it — see `ReviewAnchor`, which carries both. */
export type ReviewPlace = {
  rootId: string
  path: string
}

/** One row of one of the two files: which file, and its line number there. */
export type ReviewRow = { side: ReviewSide; line: number }

/**
 * A range as the editor hands it over: what it names, and where its two ends are
 * **on screen**.
 *
 * The ends are here because they cannot be worked out from the anchor, and
 * getting that wrong is visible. A range covering a hunk holds lines of two
 * files, and which of the two is drawn *above* the other is a fact about the
 * layout rather than about the sides: a deleted chunk sits between the context
 * line before the change and the lines that replaced it, so a range taking in a
 * kept line and then a deleted one has its `new` row on top — and one taking in a
 * deleted line and then its replacement has its `old` row on top. Deriving it
 * from the side drew the band's top rule on its bottom row.
 *
 * So the walk that builds the anchor records what it saw first and last, since it
 * goes down the screen and therefore already knows.
 */
export type ReviewSelection = {
  anchor: ReviewAnchor
  /** The topmost row of the range on screen. */
  first: ReviewRow
  /** The bottommost. The same row as `first` for a range of one. */
  last: ReviewRow
}

/**
 * What a comment writes to reach Claude.
 *
 * **A mention rather than a button**, which is the shape a forge's review already
 * has: a bot is addressed by name, in the sentence that addresses it, and the
 * question and the summons are one thing. The button beside the reply field was
 * the other shape — press it and the *whole thread* went over, so "what about
 * the null case?" and "…but only the second half" could not be said at all
 * without writing a second comment first.
 *
 * Exported because three places have to agree on it: the test for it, the
 * placeholder that teaches it, and the menu that offers it.
 */
export const AGENT_MENTION = "@claude-review"

/**
 * The mention, as a token rather than a substring.
 *
 * The boundaries are the whole of the care here. Trailing `[\w-]` is refused so
 * `@claude-reviewer` is somebody else and `@claude-review-later` is a note to
 * self; leading `[\w@/-]` is refused so an email or a path ending in it is not a
 * summons. Everything else — a full stop, a comma, a bracket, the end of the
 * line — is somebody having addressed it and then carried on.
 */
const MENTION = /(?<![\w@/-])@claude-review(?![\w-])/i

/** Whether a comment is addressed to Claude. Pure, and checked in
 * `test/review.ts`, because the cost of getting it wrong is a turn nobody asked
 * for — or a question that silently went nowhere. */
export function mentionsAgent(body: string): boolean {
  return MENTION.test(body)
}

/**
 * A body with the mention wrapped in backticks, ready for the markdown renderer.
 *
 * A note is drawn as **markdown** — Claude answers in it, and a reviewer writing
 * `` `fd` `` means the identifier — which left the mention with nowhere to be a
 * chip: the renderer builds its own DOM, so there is no React tree to slip a
 * `<span>` into. Making it inline code is the one thing that survives the round
 * trip, and it says the right thing anyway: this word is a handle rather than
 * prose.
 *
 * The stored note is untouched. This is presentation, applied on the way to the
 * renderer, so what is quoted back to Claude in `threadBlock` is still what was
 * typed.
 *
 * A mention inside a fenced code block would come out with stray backticks. It
 * would also have summoned Claude, which is the older and stranger half of that
 * problem, and neither is worth a markdown parse to avoid.
 */
export function markMention(body: string): string {
  return body.replace(/(?<![\w@/-])@claude-review(?![\w-])/gi, "`$&`")
}

/**
 * Where on screen the range being commented on is, in client coordinates.
 *
 * Here so the composer can be drawn **against the lines it is about** rather
 * than in a strip at the foot of the pane: picking a range at the top of a diff
 * and then typing about it four hundred pixels below is the single thing that
 * made this feature tiring to use. The box is positioned, not laid out — nothing
 * in the diff moves for it, which is the objection that took the old block
 * widgets out (see `review-marks.ts`).
 *
 * Client coordinates and not the pane's, so the box is `position: fixed` and
 * needs no positioned ancestor and no knowledge of which pane it is in. Pushed
 * by `codemirror-diff.tsx`, which is the only place that can turn a line number
 * into a pixel — and re-pushed while the diff scrolls, since a range scrolled
 * out from under its box is a box pointing at nothing.
 */
export type ReviewSpot = {
  /** The top of the range's first line. */
  top: number
  /** The bottom of the range's last line — where the box hangs from when there
   * is room below. */
  bottom: number
  /** The left edge of the code, so the box lines up with the lines rather than
   * with the gutter. */
  left: number
  /** The right edge of the editor, which is what the box's width is measured
   * against. */
  right: number
}

/** The range being commented on, before there is a thread. */
export type PendingRange = ReviewSelection & {
  rootId: string
  path: string
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
  anchor: ReviewAnchor
  snippet: ReviewSnippet
  body: string
  author?: ReviewAuthor
  /** How bad the finding is, when it came from one — see `ReviewSeverity`. The
   * composer never sets it: a person writing a remark is not filling in a
   * form. */
  severity?: ReviewSeverity
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
   * Where the pending range is on screen, or null when it is nowhere the reader
   * can see — see `ReviewSpot`.
   *
   * Null is a real state and not just "not measured yet": a range picked in a
   * file, then scrolled off the top of the pane, has no rows on screen to hang a
   * box from. The strip at the foot of the pane is what draws the composer then,
   * which is why that path is kept rather than deleted.
   */
  spot: ReviewSpot | null
  /**
   * Threads waiting on an answer from Claude, by id.
   *
   * On the store rather than in the row, because the pane is closable: switching
   * to `All files` and back unmounts every row, and an answer that arrived in
   * between has to land in the thread rather than in a component that has gone.
   * A set of ids rather than a flag, since several threads can be asked at once
   * — they are separate turns in separate processes and nothing serialises them.
   */
  asking: string[]
  /** The last failure per thread, drawn under it until the next attempt. Not a
   * note: a reply that did not happen is not something anybody said. */
  askErrors: Record<string, string>
  /** The checkout Claude is reviewing right now, or null. One at a time, and by
   * root rather than a flag, so a second project's pane does not spin for a turn
   * that is not its own. */
  reviewing: string | null
  /** What the last whole-diff review came back with when it came back with
   * nothing usable — drawn in the bar until the next attempt. */
  reviewError: string | null
  /**
   * The running review's own activity, one line per tool call — `Read
   * src/main/ipc.ts`, `Grep TODO` — pushed from main as `reviewAll`'s turn
   * calls them. Not a transcript kept between runs: cleared the moment the
   * next review starts, and there is nothing to save it for once the turn has
   * ended, so it is left as it stood — the bar hides it again once
   * `reviewing` goes back to null.
   */
  progress: string[]
  /**
   * The checkout whose progress dialog is open, or null.
   *
   * Its own field rather than `reviewing`, because the two do not end
   * together: the turn finishes and what it found still has to be read, so
   * the dialog stays until it is closed. Opened by `reviewAll` rather than by
   * the button, so every way of starting a review shows the same thing.
   */
  progressOpen: string | null
  /** How many comments the last finished review left, or null while one is
   * running or before any has run — what the dialog says when it is done. */
  reviewFound: number | null
  /**
   * How those comments broke down by severity — `{ critical: 1, high: 3 }`.
   *
   * Counted as the comments are **left** rather than off the findings, so it
   * agrees with `reviewFound`: a finding on a file that could not be read is
   * dropped without a comment, and a summary claiming it would be a number
   * nobody could find in the diff.
   *
   * A partial record: a severity nothing was rated is **absent** rather than
   * zero, because the dialog reads it as a list of what there is and `0 low` is
   * a phrase nobody wants. Findings with no severity at all are in
   * `reviewFound` and in none of these, which is why the two are not expected
   * to add up.
   */
  reviewFoundBy: Partial<Record<ReviewSeverity, number>>
  closeProgress: () => void
  /** Subscribes to `onReviewProgress`, once — called from `studio.tsx` the
   * way every other main-pushed stream is. Returns the unsubscribe. */
  listen: () => () => void

  /**
   * A range picked in the review column — a press, or the whole span a
   * shift-click reaches.
   *
   * The anchor arrives **already worked out**, both sides of it, because only the
   * editor can say which rows lie between two points on screen: a run of the
   * unified diff crosses from a chunk's deleted rows into the lines that replaced
   * them, and those are two files. `review-marks.ts` walks it; this only records
   * it.
   *
   * A pick in another file replaces whatever was pending: a comment cannot be
   * about a range that spans two files, which is the one part of the old
   * one-side-only rule that survives.
   */
  pick: (place: ReviewPlace, selection: ReviewSelection) => void
  /**
   * The same, while the pointer is still down.
   *
   * Apart from `pick` only in what it means to the reader — this replaces rather
   * than settles, and a drag that turns back shrinks because the caller
   * recomputes the whole span from its own anchor every time rather than growing
   * what is here.
   */
  stretch: (place: ReviewPlace, selection: ReviewSelection) => void
  /** The pointer let go: the range stops being dragged and the box opens. */
  settle: () => void
  cancel: () => void

  /**
   * Opens the pending range as a thread of the reader's own. Empty text is a
   * cancel.
   *
   * `rootPath` is the checkout, and it is here for one reason: a comment that
   * says `@claude-review` asks a question the moment it is written, and the turn
   * that answers it runs there. Without one the mention is left as text.
   */
  add: (body: string, snippet: ReviewSnippet, rootPath?: string) => void
  /**
   * Opens a thread anywhere, said by anybody — the door an agent's review comes
   * through, and what `add` is written over.
   *
   * Hands back the thread's id, so a caller with several things to say about one
   * range can `reply` into it rather than opening a thread per sentence.
   */
  comment: (input: ThreadInput) => string
  /**
   * Another note on an existing thread.
   *
   * `rootPath` does the same job it does on `add` — a reply saying
   * `@claude-review` asks its question — and the guard that keeps it from looping
   * is that **only a note by `you` summons anything**. Claude's own answers come
   * back through here with `author: "agent"`, and one that quoted the mention
   * while explaining it would otherwise ask itself again, for ever.
   */
  reply: (
    threadId: string,
    body: string,
    options?: { author?: ReviewAuthor; rootPath?: string }
  ) => void
  /** Opens one thread's reply box, or closes whichever is open. */
  openReply: (threadId: string | null) => void
  /**
   * The thread `⌥↓` last landed on, or null.
   *
   * What it buys is two things at once: the pane scrolls to it, and it is drawn
   * with a ring so the eye finds it in a file that may have three others. Not
   * persisted and not per root — it is where somebody is *now*, and a place in a
   * review is not a thing to come back to a week later.
   */
  focused: string | null
  /**
   * The next unanswered comment, or the previous one — `⌥↓` / `⌥↑`.
   *
   * **Across files**, which is the whole point of it: it opens the file the next
   * thread is in before focusing it, so a review of twelve files is walked with
   * one key instead of twelve trips through the Changes tree. `openPath` rather
   * than `selectPath`, so a pane that is not on screen comes to the front the
   * same way clicking the row would.
   *
   * Only the **open** threads, through `orderedThreads`: a walk that stopped at
   * conversations somebody has already settled is a walk that gets longer the
   * more work you do.
   */
  step: (rootId: string, delta: 1 | -1) => void
  /**
   * Settles a conversation, or reopens it — see `ReviewThread.resolved`.
   *
   * A **set** rather than a toggle, because the two ends are two different
   * buttons and a toggle would let a stale render resolve what somebody had
   * just reopened. Resolving closes the reply box if it is this thread's: the
   * box is the "there is more to say here" affordance, and leaving it open
   * beside a collapsed thread says both things at once.
   */
  resolve: (threadId: string, resolved: boolean) => void
  /** The whole thread, notes and all: there is no deleting half a
   * conversation. */
  remove: (threadId: string) => void
  /** Everything for one root — `Discard`, and what sending the review does. */
  clear: (rootId: string) => void
  /**
   * What the diff on screen is comparing against — see `committed`.
   *
   * Also where a **kept** review is put back on its lines: this fires when a file
   * is shown, which is the one moment both halves of it are to hand, so every
   * thread in that file is `settle`d against them. See `settle`.
   */
  showing: (path: string, text: string, working?: string) => void
  /**
   * Reads the review back off disk. Once, at boot.
   *
   * The threads arrive addressed by line numbers that were true when the app was
   * last closed. Nothing is re-anchored here — the files are not read at boot and
   * would not be worth reading — so a thread is put back where it was and checked
   * the first time its file is shown.
   */
  load: () => Promise<void>
  /** Where the pending range is on screen — see `spot`. */
  locate: (spot: ReviewSpot | null) => void
  /**
   * Hands the whole diff to Claude and turns what it finds into threads.
   *
   * The **findings** come back rather than the threads, and this side builds
   * them: an agent returns a place and a sentence, and everything else a thread
   * carries — its id, the lines it quotes, who said it — is known here. Quoting
   * is the reason it has to be here at all, since the file's text is what a
   * thread is anchored by (`settle`) and reading it is a call this side already
   * has.
   *
   * Threads are **added**, never replaced: a review Claude ran on top of remarks
   * somebody had already written is two reviews of the same diff, and throwing
   * one away is not this button's business. `Discard` is.
   *
   * `only` is the files to read, relative to the root, or absent for the whole
   * diff. It is not a second implementation because the only thing it changes is
   * which files get a turn — the guard, the dialog, the threads and the summary
   * are the run, whether it is one file or four hundred.
   */
  reviewAll: (
    rootId: string,
    rootPath: string,
    only?: string[]
  ) => Promise<void>
  /**
   * One changed file, read again — the row's own button.
   *
   * The case the whole-diff review does not cover, and the one that happens
   * every day: a comment is acted on, the file is fixed, and the question is
   * whether *this* file is right now. Re-reviewing the checkout for it is N
   * turns to answer one file's question, and the answers to the other N−1 are
   * already on screen.
   *
   * Unlike `reviewAll` this **does** take something away first, and exactly one
   * thing: Claude's own comments on that file that nobody has answered. See the
   * body for where that rule stops.
   */
  reviewFile: (
    rootId: string,
    rootPath: string,
    /** Absolute, as the Changes list and the diff hold it. */
    path: string
  ) => Promise<void>
  /**
   * Asks Claude about one thread and puts its answer in as a reply.
   *
   * An action rather than a call in the row for the reason `asking` is on the
   * store: the answer has to land whether or not anybody is still looking at the
   * pane. `rootPath` is the checkout — the directory the turn reads in, and what
   * the thread's path is made relative to.
   *
   * Reached by writing `@claude-review` in a comment rather than by a button —
   * see `AGENT_MENTION`. Still its own action because the *whole thread* is what
   * goes over, and because a caller has to be able to say "ask about this one"
   * without also saying what to ask.
   *
   * Never throws, and never asks twice at once for the same thread.
   */
  askAgent: (threadId: string, rootPath: string) => Promise<void>
}

/** One key dropped from a record, as a new one. */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  return Object.fromEntries(
    Object.entries(record).filter(([held]) => held !== key)
  )
}

/**
 * The review, written down.
 *
 * Fire-and-forget after every change, the way the board saves its cards: the
 * whole collection is a few dozen short records, and a review that is one write
 * behind at the moment the app is killed has lost the last remark rather than
 * the review.
 *
 * Debounced, unlike the board's, because this store is written to by a **drag**:
 * every row a range crosses is a `set`, and a file write per row is a file write
 * per fifty milliseconds. What is saved is read at call time, so the last write
 * in a burst is the one that lands.
 */
let pendingWrite: ReturnType<typeof setTimeout> | null = null

function keep(threads: ReviewThread[]): void {
  if (pendingWrite) clearTimeout(pendingWrite)
  pendingWrite = setTimeout(() => {
    pendingWrite = null
    void window.desktop.saveReviewThreads(threads).catch((error: unknown) => {
      console.error("Could not save the review", error)
    })
  }, WRITE_DELAY_MS)
}

/** Long enough that a drag is one write, short enough that closing the app a
 * second after a comment keeps it. */
const WRITE_DELAY_MS = 300

/** Ids are unique within a run and mean nothing outside it, which is all a
 * draft needs — see the note above about a review being a sitting. */
let counter = 0
const nextId = (kind: string) => `${kind}-${Date.now()}-${(counter += 1)}`

export const useReview = create<ReviewState>((set, get) => ({
  threads: [],
  pending: null,
  replyTo: null,
  committed: null,
  spot: null,
  asking: [],
  askErrors: {},
  reviewing: null,
  reviewError: null,
  progress: [],
  progressOpen: null,
  reviewFound: null,
  reviewFoundBy: {},

  closeProgress() {
    // The lines go with it: they describe a run that has been read and
    // dismissed, and keeping them would mean the next dialog opening on the
    // last review's transcript for the frame before the first line arrives.
    set({ progressOpen: null, progress: [] })
  },

  listen() {
    return window.desktop.onReviewProgress((event) => {
      // Nobody is running a review — a stray line from a turn whose result
      // already landed, since the channel is not torn down between runs.
      if (!get().reviewing) return
      set({ progress: [...get().progress, event.text] })
    })
  },

  pick(place, selection) {
    set({
      pending: { ...selection, ...place, settled: false },
    })
  },

  stretch(place, selection) {
    set({
      pending: { ...selection, ...place, settled: false },
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
    // The spot goes with the range: it describes where that range was, and a
    // stale one is a box hanging beside lines nobody picked.
    set({ pending: null, spot: null })
  },

  add(body, snippet, rootPath) {
    const { pending } = get()
    if (!pending || !body.trim()) {
      set({ pending: null, spot: null })
      return
    }

    const id = get().comment({ ...pending, snippet, body })
    set({ pending: null, spot: null })

    // The summons is the sentence, so it goes the moment the sentence does.
    if (rootPath && mentionsAgent(body)) void get().askAgent(id, rootPath)
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
          anchor: input.anchor,
          snippet: input.snippet,
          notes: [note],
          // Left off entirely when there is none, rather than written as
          // `undefined`: this record goes to disk as JSON, and a key holding
          // nothing is a key every later reader has to think about.
          ...(input.severity ? { severity: input.severity } : {}),
        },
      ],
    })
    keep(get().threads)
    return id
  },

  reply(threadId, body, options) {
    const text = body.trim()
    if (!text) return
    const author = options?.author ?? "you"

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

    keep(get().threads)

    // Only what a person said summons anything — see `reply` on the state. This
    // is the whole of what stops Claude's own answer asking Claude again.
    if (author !== "you") return
    if (options?.rootPath && mentionsAgent(text)) {
      void get().askAgent(threadId, options.rootPath)
    }
  },

  openReply(threadId) {
    if (get().replyTo === threadId) return
    set({ replyTo: threadId })
  },

  focused: null,

  step(rootId, delta) {
    const next = stepThrough(
      orderedThreads(threadsOf(get(), rootId)),
      get().focused,
      delta
    )
    if (!next) return

    set({ focused: next.id })
    // Only when it is somewhere else: `openPath` on the file already showing
    // would be a `set` per keypress, and every subscriber of the changes store
    // re-rendering behind a scroll.
    if (useChanges.getState().selectedPath[rootId] !== next.path) {
      useChanges.getState().openPath(rootId, next.path)
    }
  },

  resolve(threadId, resolved) {
    const threads = get().threads.map((thread) =>
      thread.id === threadId ? { ...thread, resolved } : thread
    )
    set({
      threads,
      replyTo: resolved && get().replyTo === threadId ? null : get().replyTo,
    })
    keep(threads)
  },

  remove(threadId) {
    set({
      threads: get().threads.filter((thread) => thread.id !== threadId),
      replyTo: get().replyTo === threadId ? null : get().replyTo,
      askErrors: without(get().askErrors, threadId),
      // Not taken off `asking`: the turn is still running out there, and `reply`
      // into a thread that has gone is a no-op. Leaving the id would be a
      // spinner on nothing, so it goes — the answer is simply dropped, which is
      // what deleting the thread it was about means.
      asking: get().asking.filter((id) => id !== threadId),
    })
    keep(get().threads)
  },

  showing(path, text, working) {
    /*
     * The threads in this file, put back on their lines.
     *
     * Here rather than at boot because this is the one moment both texts exist:
     * the diff has just been handed the commit, and the working buffer is the one
     * it is drawing. A file nobody opens is never checked, which is right — a
     * comment is only wrong once somebody is looking at it.
     *
     * Identity is what makes this cheap enough to run on every rebuild: `settle`
     * hands back the same object when nothing moved, so the common case leaves
     * the array untouched and nothing re-renders.
     */
    const threads = get().threads
    const checked = threads.map((thread) =>
      thread.path === path
        ? settle(thread, { old: text, new: working ?? null })
        : thread
    )
    const changed = checked.some((thread, at) => thread !== threads[at])
    if (changed) set({ threads: checked })

    // Guarded rather than set blind: this is called from an effect that runs on
    // every rebuild of the diff, and a `set` with the same pair would re-render
    // every subscriber of the review for nothing.
    const held = get().committed
    if (held?.path === path && held.text === text) {
      if (changed) void keep(get().threads)
      return
    }
    set({ committed: { path, text } })
    if (changed) void keep(get().threads)
  },

  async load() {
    try {
      set({ threads: await window.desktop.listReviewThreads() })
    } catch (error) {
      // A review that cannot be read is a review this run does without. Worth
      // saying out loud, and not worth refusing to open the pane over.
      console.error("Could not read the review", error)
    }
  },

  clear(rootId) {
    const kept = get().threads.filter((thread) => thread.rootId !== rootId)
    const alive = new Set(kept.map((thread) => thread.id))
    const cleared = get().pending?.rootId === rootId
    set({
      threads: kept,
      pending: cleared ? null : get().pending,
      spot: cleared ? null : get().spot,
      replyTo: kept.some((thread) => thread.id === get().replyTo)
        ? get().replyTo
        : null,
      asking: get().asking.filter((id) => alive.has(id)),
      askErrors: Object.fromEntries(
        Object.entries(get().askErrors).filter(([id]) => alive.has(id))
      ),
    })
    keep(get().threads)
  },

  locate(spot) {
    // Guarded like `showing`, and for the same reason doubled: this is pushed
    // from a scroll handler, so an unguarded `set` would re-render every
    // subscriber of the review on every frame of a scroll.
    const held = get().spot
    if (
      held === spot ||
      (held !== null &&
        spot !== null &&
        held.top === spot.top &&
        held.bottom === spot.bottom &&
        held.left === spot.left &&
        held.right === spot.right)
    ) {
      return
    }
    set({ spot })
  },

  reviewFile(rootId, rootPath, path) {
    /*
     * The comments this run is about to replace: the ones **Claude left on this
     * file and nobody has answered**.
     *
     * Without this, reading a file again after fixing it is a second opinion
     * stacked on the first, and the pane fills with remarks about code that is
     * no longer there — which is the state this button exists to get out of.
     *
     * The rule stops exactly where somebody has typed. A thread with more than
     * its opening note has been replied to, argued with or answered by
     * `@claude-review`, and that is a conversation rather than a finding; it
     * stays, and `settle` marks it stale if the lines it quoted have gone. The
     * user's own comments are never touched, which is the promise the whole-diff
     * review makes too ("threads are added, never replaced") — this narrows it
     * to Claude's own unanswered word on one file rather than breaking it.
     */
    const kept = get().threads.filter(
      (thread) =>
        !(
          thread.rootId === rootId &&
          thread.path === path &&
          // An author is a *note's*, not a thread's — a thread of one note by
          // the agent is a finding, and anything longer has somebody in it.
          thread.notes.length === 1 &&
          thread.notes[0]?.author === "agent"
        )
    )
    if (kept.length !== get().threads.length) {
      set({ threads: kept })
      keep(kept)
    }

    // Relative, which is how a finding names a file and so how main filters:
    // the store works in absolute paths and the contract does not.
    return get().reviewAll(rootId, rootPath, [relativeTo(rootPath, path)])
  },

  async reviewAll(rootId, rootPath, only) {
    // One at a time across the app: a whole-diff review reads every changed
    // file, and two of them racing would be two `claude`s over the same diff. A
    // single file is no exception — it is the same store, the same progress
    // list and the same dialog, and there is nothing to show two runs in.
    if (get().reviewing) return
    set({
      reviewing: rootId,
      reviewError: null,
      progress: [],
      // Opened here rather than by the button, so every way of starting a
      // review shows the same thing running.
      progressOpen: rootId,
      reviewFound: null,
      reviewFoundBy: {},
    })

    let answer: ReviewChangesAnswer
    try {
      const settings = useSettings.getState()
      answer = await window.desktop.reviewChanges(
        rootPath,
        settings.reviewModel,
        settings.reviewEffort,
        settings.reviewProfileId,
        only
      )
    } catch (error) {
      answer = { error: error instanceof Error ? error.message : String(error) }
    }

    if ("error" in answer) {
      // `reviewFound` is set here too, or the dialog would read a failed run
      // as one still going: null is "no answer yet", and this is an answer.
      set({
        reviewing: null,
        reviewError: answer.error,
        reviewFound: 0,
        reviewFoundBy: {},
      })
      return
    }

    /*
     * Each finding as a thread, quoting the file the way a typed comment does.
     *
     * The reads are what make this a loop rather than a `map`: a finding names a
     * file, and the lines it is about have to come out of that file — which is
     * what a thread is anchored by afterwards (`settle`), so a thread written
     * without them would be one that could never be put back.
     *
     * A file that cannot be read is skipped rather than commented on blindly: a
     * remark with nothing quoted is one `settle` will call stale the first time
     * it looks.
     */
    const texts = new Map<string, string>()
    /** Comments actually left, which is not `findings.length`: a finding on a
     * file that cannot be read is skipped below, and the dialog must not
     * claim a comment that is not there. */
    let left = 0
    /** The same tally by severity — see `reviewFoundBy`. Counted here, beside
     * `left`, so the two cannot disagree about a finding that was dropped. */
    const by: Partial<Record<ReviewSeverity, number>> = {}
    for (const finding of answer.findings) {
      const path = `${rootPath}/${finding.path}`
      if (!texts.has(path)) {
        try {
          const read = await window.desktop.readTextFile(path)
          // A binary the model named anyway. Nothing to quote, so nothing to
          // anchor a comment to.
          if (read.kind !== "text") continue
          texts.set(path, read.text)
        } catch {
          continue
        }
      }
      const text = texts.get(path)
      if (text === undefined) continue

      get().comment({
        rootId,
        path,
        anchor: {
          old: null,
          new: { fromLine: finding.fromLine, toLine: finding.toLine },
        },
        snippet: {
          old: null,
          new: snippetOf(text, finding.fromLine, finding.toLine),
        },
        body: finding.body,
        author: "agent",
        severity: finding.severity,
      })
      left += 1
      if (finding.severity) {
        by[finding.severity] = (by[finding.severity] ?? 0) + 1
      }
    }

    set({
      reviewing: null,
      reviewFound: left,
      reviewFoundBy: by,
      // Said rather than left silent: a review that found nothing and a review
      // that failed look identical from the outside, and only one of them is
      // good news.
      reviewError:
        answer.findings.length === 0
          ? "Claude found nothing to comment on."
          : null,
    })
  },

  async askAgent(threadId, rootPath) {
    const thread = get().threads.find((entry) => entry.id === threadId)
    if (!thread || get().asking.includes(threadId)) return

    // The last failure goes as the next attempt starts: an error still on screen
    // beside a spinner reads as this attempt having already failed.
    set({
      asking: [...get().asking, threadId],
      askErrors: without(get().askErrors, threadId),
    })

    let answer: { text: string } | { error: string }
    try {
      const settings = useSettings.getState()
      answer = await window.desktop.replyToReviewComment(
        rootPath,
        threadPrompt(thread, rootPath),
        settings.reviewModel,
        settings.reviewEffort,
        settings.reviewProfileId
      )
    } catch (error) {
      // The channel itself failed — main gone, or the handler threw. Everything
      // the turn can do wrong comes back as `{ error }` instead.
      answer = { error: error instanceof Error ? error.message : String(error) }
    }

    // Still there? The thread can have been deleted, or the whole review
    // discarded, while the turn was running.
    const still = get().threads.some((entry) => entry.id === threadId)
    set({ asking: get().asking.filter((id) => id !== threadId) })
    if (!still) return

    if ("error" in answer) {
      set({ askErrors: { ...get().askErrors, [threadId]: answer.error } })
      return
    }
    get().reply(threadId, answer.text, { author: "agent" })
  },
}))

/** An anchor naming nothing at all, which is not a comment. Every producer of
 * one has a path where the rows it walked turned out to be a folded bar and
 * nothing else. */
export function isEmptyAnchor(anchor: ReviewAnchor): boolean {
  return anchor.old === null && anchor.new === null
}

/** One row added to a range, or a range of one where there was none. */
export function growRange(range: LineRange | null, line: number): LineRange {
  if (!range) return { fromLine: line, toLine: line }
  return {
    fromLine: Math.min(range.fromLine, line),
    toLine: Math.max(range.toLine, line),
  }
}

/**
 * One row folded into an anchor, on the side it belongs to.
 *
 * How every anchor is built: the caller walks the rows between two points on
 * screen and hands each one to this. The result is min/max per side, which is
 * what makes a run crossing from a chunk's deleted rows into the lines that
 * replaced them come out as one comment about both.
 */
export function withRow(
  anchor: ReviewAnchor,
  side: ReviewSide,
  line: number
): ReviewAnchor {
  return { ...anchor, [side]: growRange(anchor[side], line) }
}

/** Nothing named yet — what a walk starts from. */
export const EMPTY_ANCHOR: ReviewAnchor = { old: null, new: null }

/** One root's threads, in the order they were opened. */
export function threadsOf(
  state: { threads: ReviewThread[] },
  rootId: string | null
): ReviewThread[] {
  if (rootId === null) return []
  return state.threads.filter((thread) => thread.rootId === rootId)
}

/**
 * The ones still asking for something.
 *
 * The **count** every part of the UI shows is of these rather than of the lot —
 * the bar under the diff, the badge on a row of the Changes list — because a
 * count is read as "how much is left", and a review whose every remark has been
 * dealt with should say so. The threads themselves are not filtered anywhere: a
 * resolved conversation stays on its lines, collapsed.
 *
 * `resolved` is absent on everything written before the field existed, so this
 * is a truthiness check and not `=== false`.
 */
export function openThreads(threads: ReviewThread[]): ReviewThread[] {
  return threads.filter((thread) => !thread.resolved)
}

/**
 * Every open thread of one checkout, in the order somebody reads them.
 *
 * **By file and then down the page**, which is the order the diff is in and the
 * order the Changes list draws its rows in — not the order the threads were
 * opened, which is what `threadsOf` gives and which for an agent's review is
 * whichever of four concurrent turns answered first. A walk that jumped between
 * files and back would be one nobody could keep their place in.
 *
 * A thread's line is the **working file's** when it has one and the commit's
 * otherwise, because that is the row it is drawn under: a remark about deleted
 * code sits with the deleted chunk, above the lines that replaced it.
 *
 * Pure, and checked in `test/review.ts`.
 */
export function orderedThreads(threads: ReviewThread[]): ReviewThread[] {
  return [...openThreads(threads)].sort(
    (a, b) => a.path.localeCompare(b.path) || lineOf(a) - lineOf(b)
  )
}

/** Which row a thread is drawn on — see `orderedThreads`. */
function lineOf(thread: ReviewThread): number {
  return thread.anchor.new?.fromLine ?? thread.anchor.old?.fromLine ?? 0
}

/**
 * Which thread `⌥↓` / `⌥↑` lands on next, or null when there are none.
 *
 * **Wraps**, deliberately: a review is walked until it is empty rather than
 * until the bottom, and stopping at the last comment would leave somebody
 * pressing a key that does nothing with three files still to read. What makes
 * that safe is that resolving is what takes a thread *out* of this list — so the
 * walk shrinks as it is worked through, and the last one resolved ends it.
 *
 * A `from` that is not in the list — nothing focused yet, or the thread that was
 * focused has just been resolved or deleted — starts at the top going forwards
 * and at the bottom going back, which is what "next" means when there is no
 * current.
 *
 * Pure, and checked in `test/review.ts`.
 */
export function stepThrough(
  ordered: ReviewThread[],
  from: string | null,
  delta: 1 | -1
): ReviewThread | null {
  if (ordered.length === 0) return null
  const at = ordered.findIndex((thread) => thread.id === from)
  if (at === -1) return ordered[delta === 1 ? 0 : ordered.length - 1] ?? null
  return ordered[(at + delta + ordered.length) % ordered.length] ?? null
}

/**
 * A severity as a number, worst highest, and nothing as 0.
 *
 * For the two places that have to **compare** severities rather than draw one:
 * the badge on a Changes row, which shows the worst of a file's, and the walk up
 * a directory that takes the worst of everything under it. A number rather than
 * the id, so `lib/files/change-tree.ts` can take a maximum without learning what
 * a review is — the same line `commentCountsUnder` already holds.
 */
export function severityRank(severity: ReviewSeverity | undefined): number {
  const at = severity ? REVIEW_SEVERITY_IDS.indexOf(severity) : -1
  return at === -1 ? 0 : REVIEW_SEVERITY_IDS.length - at
}

/** And back, for the row that has a maximum and has to draw it. */
export function severityAtRank(rank: number): ReviewSeverity | undefined {
  return REVIEW_SEVERITY_IDS[REVIEW_SEVERITY_IDS.length - rank]
}

/**
 * What a finished review found, by severity: `1 critical, 3 high, 2 low`.
 *
 * **Worst first**, in `REVIEW_SEVERITY_IDS` order rather than in whatever order
 * the tally happened to be built, because the first word is the one that
 * decides whether the diff is read now or after lunch.
 *
 * A level with nothing in it is left out entirely — `0 low` is a phrase nobody
 * wants — and a review whose findings all came back unrated reads as `""`,
 * which the dialog draws as nothing rather than as an empty bracket. The count
 * of comments is said separately and is the number that includes them.
 *
 * Pure, and checked in `test/review.ts`.
 */
export function severitySummary(
  by: Partial<Record<ReviewSeverity, number>>
): string {
  return REVIEW_SEVERITY_IDS.flatMap((id) => {
    const count = by[id] ?? 0
    return count > 0 ? [`${count} ${id}`] : []
  }).join(", ")
}

/*
 * `noteCount` was here, summing every note across a set of threads, and the bar
 * counted with it — "a thread with three replies is three things said".
 *
 * That was right while the bar was the **header of a list of notes**. It is not
 * the bar's job any more: the threads are drawn in the diff, and what is left in
 * flow says only that a review exists and that some of it is in files nobody is
 * looking at. What answers that is **how many places have a remark on them**,
 * which is a count of threads. Counting notes also had a result nobody would
 * defend out loud — asking Claude a question made the review look bigger, since
 * its answer is a note like any other.
 *
 * So it is `threads.length` at the one call site, and nothing here computes it.
 */

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
    if (thread.path !== path) continue
    const range = thread.anchor[side]
    if (!range) continue
    for (let line = range.fromLine; line <= range.toLine; line += 1) {
      lines.add(line)
    }
  }
  return lines
}

/** `12` for one line, `12–18` for a range — an en dash, the way a line range is
 * written. */
export function rangeLabel(range: LineRange): string {
  return range.fromLine === range.toLine
    ? String(range.fromLine)
    : `${range.fromLine}–${range.toLine}`
}

/**
 * An anchor as the one string a heading and a row both show.
 *
 * The working file's numbers lead where there are any, because those are the
 * ones somebody can open the file at; the commit's follow in brackets, said to
 * be the commit's, because `12` means two different lines depending on which
 * file it is a line of and that is the whole ambiguity to kill. A thread with
 * only deleted lines is the one case where the commit's numbers lead, and it is
 * marked as such wherever it is drawn.
 */
export function anchorLabel(anchor: ReviewAnchor): string {
  if (anchor.new && anchor.old) {
    return `${rangeLabel(anchor.new)} (was ${rangeLabel(anchor.old)})`
  }
  const only = anchor.new ?? anchor.old
  return only ? rangeLabel(only) : "?"
}

/** Whether a thread is about deleted lines and nothing else — the one shape
 * whose numbers are not the working file's, and so the one that has to say so. */
export function isDeletedOnly(anchor: ReviewAnchor): boolean {
  return anchor.new === null && anchor.old !== null
}

/**
 * One thread put back on the lines it was written about, in a file that has
 * moved on.
 *
 * **This is the price of keeping a review**, and it is the whole of the argument
 * that used to say not to: a comment read back tomorrow points at line 12, and
 * line 12 is whatever moved into it. So the numbers are not what a thread is
 * addressed by — the **snippet** is. It was already captured, for the prompt, and
 * it turns out to be the durable address.
 *
 * Three answers, in order, and the order is the point:
 *
 * 1. **The lines are still there.** Nothing moved under this comment; leave it
 *    exactly as it is, which is the common case and costs one comparison.
 * 2. **They are somewhere else in the file.** Something was inserted or removed
 *    above; move the anchor to where they are now. Only when the snippet appears
 *    **once** — a comment on `}` would otherwise land on whichever `}` came
 *    first, which is worse than saying nothing.
 * 3. **They are gone**, or they are ambiguous. Mark it `stale`. Not delete it: a
 *    remark whose code has gone is still something somebody said, and often the
 *    most interesting thing in the review.
 *
 * A **truncated** snippet (`SNIPPET_LIMIT`) is handled by the same three, and
 * needs no case of its own: its `…` line is not part of the file, but everything
 * above it is, and that prefix identifies the start of the run exactly as well.
 * So the marker is dropped and the rest is looked for. What is lost is only that
 * a comment on a 400-line block is recognised by its first 24 lines — which is
 * what it was already quoted by.
 *
 * Pure, and checked in `test/review.ts`.
 */
export function settle(
  thread: ReviewThread,
  text: { old: string | null; new: string | null }
): ReviewThread {
  let moved = thread.anchor
  let lost = false

  for (const side of ["old", "new"] as const) {
    const range = thread.anchor[side]
    const quoted = thread.snippet[side]
    const file = text[side]
    // Nothing to check: this side is not part of the anchor, or the file it
    // would be checked against is not to hand. Left where it is rather than
    // called stale — an unread file is not a missing line.
    if (!range || !quoted || file === null) continue

    const found = placeOf(file, quoted, range)
    if (found === "gone") lost = true
    else if (found !== range.fromLine) {
      moved = { ...moved, [side]: shifted(range, found) }
    }
  }

  const stale = lost || undefined
  if (moved === thread.anchor && stale === thread.stale) return thread
  return { ...thread, anchor: moved, stale }
}

/**
 * Which line a quoted run starts at now, or `"gone"`.
 *
 * Checked where it was first, so a file nothing has happened to costs one string
 * comparison per thread rather than a search.
 */
function placeOf(
  text: string,
  quoted: string,
  range: LineRange
): number | "gone" {
  const lines = text.split("\n")
  const all = quoted.split("\n")
  // `snippetOf` ends a run it had to cut with a line saying how much it left
  // out. That line is not in the file; everything above it is, and identifies
  // the start just as well.
  const wanted = all.at(-1)?.startsWith("… ") ? all.slice(0, -1) : all
  if (wanted.length === 0) return "gone"

  if (sameAt(lines, wanted, range.fromLine)) return range.fromLine

  let at: number | null = null
  for (let line = 1; line + wanted.length - 1 <= lines.length; line += 1) {
    if (!sameAt(lines, wanted, line)) continue
    // Twice is as bad as never: moving to the first of two identical runs is a
    // comment quietly reattached to the wrong code.
    if (at !== null) return "gone"
    at = line
  }
  return at ?? "gone"
}

/** Whether the file holds this run starting at `line`, counting from 1. */
function sameAt(lines: string[], wanted: string[], line: number): boolean {
  if (line < 1 || line + wanted.length - 1 > lines.length) return false
  return wanted.every((text, at) => lines[line - 1 + at] === text)
}

/** The same run, starting somewhere else. */
function shifted(range: LineRange, fromLine: number): LineRange {
  return { fromLine, toLine: fromLine + (range.toLine - range.fromLine) }
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
 * One thread as the prompt writes it: a file-and-line heading, the lines
 * themselves, then what was said.
 *
 * Apart from `threadPrompt` rather than inlined into it, because this is the part
 * worth getting exactly right — the relative path, the deleted side, and which
 * notes get an author — and it is what the tests point at. It had a second caller
 * once, `reviewPrompt`, which handed a whole review to a chat; that went with the
 * `Ask AI to fix…` button. See `docs/design.md`.
 *
 * A thread with one note is that note, unattributed: naming an author in a
 * conversation with one voice is noise. A thread with several is the exchange,
 * each line labelled, because who said what is the whole content of a
 * disagreement — and because an agent's own earlier remark has to be
 * distinguishable from the instruction it is being given now.
 *
 * **A thread about both sides is quoted twice, labelled.** One fence with the
 * two runs concatenated would be a turn reading the commit's lines as if they
 * were in the file, which is the exact mistake the deleted-side heading has
 * always existed to stop — and it is worse here, because half of what is quoted
 * *is* in the file. So the removed lines are said to be removed, above the ones
 * that replaced them, which is also the order the reader saw them in.
 */
function threadBlock(thread: ReviewThread, rootPath: string): string {
  const path = thread.path.startsWith(rootPath + "/")
    ? thread.path.slice(rootPath.length + 1)
    : thread.path
  // The side is said on every heading that needs it rather than once at the
  // top, because a turn reads these one at a time and acting on a deleted
  // line's number as if it were the working file's is the mistake this stops.
  const marked = isDeletedOnly(thread.anchor) ? " (deleted — numbers are the commit's)" : "" // prettier-ignore

  const fence = (text: string) => ["```", text, "```"].join("\n")
  const parts: string[] = []
  if (thread.anchor.old && thread.snippet.old) {
    // Labelled only when there is something beside it to tell it from. On its
    // own the heading has already said these lines are gone.
    const said = thread.anchor.new
      ? `Removed (lines ${rangeLabel(thread.anchor.old)} of the committed file):\n`
      : ""
    parts.push(said + fence(thread.snippet.old))
  }
  if (thread.anchor.new && thread.snippet.new) {
    const said = thread.anchor.old
      ? `Now (lines ${rangeLabel(thread.anchor.new)} of the working file):\n`
      : ""
    parts.push(said + fence(thread.snippet.new))
  }

  const quoted = parts.length > 0 ? `\n\n${parts.join("\n\n")}` : ""
  const said =
    thread.notes.length === 1
      ? (thread.notes[0]?.body ?? "")
      : thread.notes
          .map((note) => `**${AUTHOR_LABEL[note.author]}:** ${note.body}`)
          .join("\n\n")

  return `### ${path}:${anchorLabel(thread.anchor)}${marked}${quoted}\n\n${said}`
}

/**
 * One thread as a question, for the reply that lands back in it.
 *
 * The only prompt a review produces now, and it hands over **one remark to be
 * answered** — in a paragraph, by a turn that cannot edit anything
 * (`src/main/review-agent.ts`). There was a second one that handed the whole
 * review to a chat to be *carried out*; it went with its button.
 *
 * The exchange so far goes over with it, replies included, so asking a second
 * time after arguing with the first answer is a follow-up rather than the same
 * question again — `threadBlock` labelling the authors is what makes that
 * readable, and `Assistant` is what the model recognises as its own.
 *
 * Pure, and the reason it is: this is the one thing in the feature worth being
 * sure about — a prompt is what a remark becomes — and it is checked in
 * `test/review.ts` without a store, a chat or an editor.
 */
export function threadPrompt(thread: ReviewThread, rootPath: string): string {
  return [
    "A comment left on this checkout's uncommitted changes. Answer it.",
    "",
    "The heading is a file and the lines it is about, followed by those lines as they read when the comment was written, then what was said. Line numbers may have moved since; the quoted lines are what was meant. A heading marked *deleted* is about lines this change removed — those numbers are the committed file's, and there is nothing at them in the working file. A heading reading `12–14 (was 8–9)` is about a hunk: what is quoted under *Removed* is gone from the file, and what is under *Now* replaced it.",
    "",
    "`@claude-review` in a comment is how you were called into this thread. It is addressed to you and is not part of the question — read the rest of the sentence.",
    "",
    threadBlock(thread, rootPath),
  ].join("\n")
}
