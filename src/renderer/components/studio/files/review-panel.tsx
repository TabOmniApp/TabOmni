import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { createPortal } from "react-dom"
import { Check, CheckCircle2, MessageSquare, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownView } from "../markdown-view"
import { relativeTo } from "@/lib/files/paths"
import { dropThreadHost, threadHost } from "@/lib/files/review-hosts"
import {
  anchorLabel,
  isDeletedOnly,
  snippetOf,
  threadsOf,
  useReview,
  type PendingRange,
  type ReviewSpot,
  type ReviewThread,
} from "@/lib/files/review"
import { useFiles } from "@/lib/files/store"

/** Which threads have had a node made for them, so the ones that go can have it
 * taken back — see the effect in `ReviewPanel`. */
const drawn = new Set<string>()

/** How long the walk waits for a thread's widget to appear before giving up —
 * see the effect in `ReviewPanel`. Roughly two seconds at 60Hz. */
const MAX_FIND_FRAMES = 120

/**
 * What the thread that was landed on wears.
 *
 * A ring rather than a tint, because the box already has a background and a
 * border doing work; a ring is the one layer nothing else in a thread uses. It
 * stays until another thread is landed on rather than fading after a second: it
 * marks a *place*, and a highlight that disappeared would leave somebody who
 * looked away mid-file with no way back to it but going through the `Comments`
 * tab again.
 */
const FOCUS_RING = (focused: boolean) =>
  focused ? "ring-2 ring-ring/70 ring-offset-1 ring-offset-background" : ""

/**
 * The review of one checkout: the threads, wherever they are drawn.
 *
 * **The remarks are in the diff, under the lines they are about**, and this
 * component's own output is mostly *portals* rather than anything laid out here.
 * It went the other way once — the threads were block widgets, were moved to a
 * list at the foot of the pane because a diff with three comments in it is a diff
 * pushed apart in three places, and have gone back. The objection was real and
 * the thing it bought was worse: a remark four hundred pixels below the code it
 * is about is a remark read with a finger on the screen, and the strip's own
 * scroll meant coming back to what you had already said was a hunt. A diff pushed
 * apart *at* a comment is pushed apart where somebody is already looking.
 *
 * The node each thread is drawn in belongs to `lib/files/review-hosts.ts`, and
 * the editor decides which of them are in the document — so a thread in a file
 * this pane is not showing portals into a detached node and draws nothing,
 * without this component having to work out which those are.
 *
 * **Nothing is left in flow but the stranded composer.** There was a bar under
 * the diff — the comment count, `Discard`, `Review`, and whatever the last run
 * had to say for itself — and every one of those found a better home, which is
 * what made it 32 pixels of diff spent on a row that repeated things said
 * elsewhere. `Review` is in the Explorer's `Changes` header, where the changed
 * files are listed and where somebody wants it *before* picking one; `Discard`
 * is beside it, for the same reason; how a run went is the progress dialog's,
 * which is on screen while it runs and says the count when it stops; and the
 * comment count is the badge on each row of that same list, which says *which*
 * files rather than only how many. The bar's one irreplaceable job — saying a
 * review exists in a file nobody has opened — was already the badge's.
 */
export function ReviewPanel({
  rootId,
  rootPath,
}: {
  rootId: string
  /** The checkout's own directory: the paths are shown relative to it, and it is
   * where `Ask Claude` runs its turn. */
  rootPath: string
}) {
  /* The whole list, filtered during render rather than in the selector: this
   * store is read through zustand v5's `useSyncExternalStore`, which requires a
   * snapshot that is stable between calls — a selector returning a fresh array
   * each time is the "getSnapshot should be cached" loop. */
  const all = useReview((state) => state.threads)
  const threads = threadsOf({ threads: all }, rootId)
  const pending = useReview((state) => state.pending)
  /* Only once the pointer is up: while a range is being dragged this strip must
   * not appear and take height off the diff, or the rows move out from under the
   * pointer choosing them. See `PendingRange.settled`. */
  const mine = pending?.rootId === rootId && pending.settled ? pending : null
  const replyTo = useReview((state) => state.replyTo)
  /* Where those lines are on screen, when any of them is — see `ReviewSpot`.
   * The composer goes there rather than in this strip, which is the whole of
   * the "the box is nowhere near the code" complaint. */
  const spot = useReview((state) => state.spot)

  /* The strip's own copy of the box, for a range that is on screen nowhere:
   * picked and then scrolled past, or in a file the pane has since switched
   * away from. Rare, and the reason this path is kept rather than deleted. */
  const stranded = mine && !spot ? mine : null

  /* A node per thread stops being anybody's the moment the thread does. Not on
   * `remove` in the store, which knows nothing about the DOM, and not in the
   * widget, which is rebuilt for reasons that have nothing to do with a thread
   * ending — see `review-hosts.ts`.
   *
   * Against **every** thread rather than this root's, because the map is one for
   * the app: a second pane, on another project, would otherwise read its own
   * list as the whole world and drop the nodes of every thread it cannot see. */
  const ids = all.map((thread) => thread.id).join(" ")
  useEffect(() => {
    const alive = new Set(ids ? ids.split(" ") : [])
    for (const id of drawn) {
      if (!alive.has(id)) {
        dropThreadHost(id)
        drawn.delete(id)
      }
    }
    for (const id of alive) drawn.add(id)
  }, [ids])

  const label = (path: string) => relativeTo(rootPath, path) || path

  /*
   * The thread that was landed on, brought into view.
   *
   * **Retried across frames rather than done once**, which is the whole of the
   * difficulty: `reveal` may have opened another file, and the widget the thread
   * is drawn in does not exist until that file's diff has been read, parsed and
   * laid out. So the node is asked for every frame until it is in the document —
   * `threadHost` hands back the same node whether or not the editor has attached
   * it yet, so there is nothing to subscribe to, only something to wait for.
   *
   * Bounded, because a thread in a file that turns out not to be readable would
   * otherwise be a rAF loop for the rest of the session. Two seconds is far more
   * than a diff takes and short enough that nothing accumulates.
   */
  const focused = useReview((state) => state.focused)
  useEffect(() => {
    if (!focused) return
    let frames = 0
    let raf = 0

    const find = () => {
      const node = threadHost(focused)
      if (node.isConnected) {
        node.scrollIntoView({ block: "center", behavior: "smooth" })
        return
      }
      if (frames++ < MAX_FIND_FRAMES) raf = requestAnimationFrame(find)
    }

    find()
    return () => cancelAnimationFrame(raf)
  }, [focused])

  return (
    <>
      {/*
        Each thread, drawn into the node the editor put under its lines. A
        thread whose file is not the one on screen portals into a node that is
        not in the document, and nothing is drawn — which is how "only the
        threads you can see" is decided without deciding it here.
      */}
      {threads.map((thread) => (
        <Fragment key={thread.id}>
          {createPortal(
            <Thread
              thread={thread}
              label={label(thread.path)}
              replying={replyTo === thread.id}
              focused={focused === thread.id}
            />,
            threadHost(thread.id)
          )}
        </Fragment>
      ))}

      {mine && spot && (
        <FloatingComposer place={mine} spot={spot} label={label(mine.path)} />
      )}

      {/*
        The box for a range that is on screen nowhere — see `stranded`.

        The one thing the bar used to hold that had no other home, so it is what
        is left of it: a strip at the foot of the pane, drawn **only** when there
        is a comment being written with nothing on screen to hang it from. Every
        other state draws no row at all, which is the point of taking the bar
        out.
      */}
      {stranded && (
        <div className="shrink-0 border-t bg-muted/20 px-3 py-2">
          <RangeLine label={label(stranded.path)} place={stranded} />
          <Composer place={stranded} />
        </div>
      )}
    </>
  )
}

/**
 * The one word that says a range is not in the file any more.
 *
 * Said in the list rather than left to the reader's memory of which row they
 * clicked: `a.ts:772` means two different lines depending on the side, and the
 * one thing that separates them is this.
 */
function DeletedMark() {
  return (
    <span
      className="ml-1.5 rounded-sm bg-destructive/15 px-1 py-px font-sans text-[0.6rem] text-destructive"
      title="These lines were deleted — the numbers are the committed file's"
    >
      deleted
    </span>
  )
}

/** Which lines are being commented on, and how to change one's mind about that
 * — said out loud, because neither way of growing a range is guessable from a
 * column of plus signs. */
function RangeLine({ label, place }: { label: string; place: PendingRange }) {
  return (
    <p className="mb-1.5 font-mono text-[0.7rem] text-muted-foreground">
      {label}:{anchorLabel(place.anchor)}
      {isDeletedOnly(place.anchor) && <DeletedMark />}
      <span className="ml-2 font-sans">
        drag the column, or shift-click a line, to change the range
      </span>
    </p>
  )
}

/**
 * The box a new thread is written in, wherever it is being drawn.
 *
 * One component for both placements — floating beside the lines, and in the
 * strip for a range that is on screen nowhere — because what it does when it is
 * submitted is the fiddly half and must not exist twice.
 */
function Composer({ place }: { place: PendingRange }) {
  /* What the diff on screen is comparing against, for a comment on a deleted
   * line: those lines are in the commit and nowhere else. */
  const committed = useReview((state) => state.committed)

  return (
    <Box
      placeholder="What should change here?"
      onCancel={() => useReview.getState().cancel()}
      onSubmit={(body) => {
        // The quoted lines come from the buffer the diff is showing, which is
        // the file including whatever the `Edit` view has typed into it and not
        // yet saved — the text the reader was looking at. A deleted line is not
        // in that buffer at all: it is quoted from the commit, which is the
        // other half of what is on screen. A range covering a hunk needs both,
        // which is the whole reason a snippet has two halves.
        const doc = useFiles.getState().docs[place.path]
        const working = doc?.kind === "text" ? doc.text : ""
        const commit = committed?.path === place.path ? committed.text : ""
        const { old: before, new: after } = place.anchor

        useReview.getState().add(body, {
          old: before
            ? snippetOf(commit, before.fromLine, before.toLine)
            : null,
          new: after ? snippetOf(working, after.fromLine, after.toLine) : null,
        })
      }}
    />
  )
}

/** How wide the floating box is allowed to get, and how narrow it may be
 * squeezed before it stops following the code's left edge. A comment is a
 * sentence or two; a box the width of a wide diff is a line of text nobody can
 * scan back across. */
const COMPOSER_MAX_WIDTH = 560
const COMPOSER_MIN_WIDTH = 320
/** Between the box and the range it belongs to. Small on purpose — the gap is
 * what says the two are one thing. */
const COMPOSER_GAP = 6
/** Off the window's own edges, so a box against the bottom of the screen still
 * reads as a box. */
const COMPOSER_MARGIN = 8

/**
 * The composer, floating against the lines it is about.
 *
 * **Positioned, not laid out**, and that is what makes this affordable where the
 * block widgets it replaces were not (`review-marks.ts` has that argument): the
 * box is `position: fixed` over the diff, so no row moves for it and the code
 * around the range — the thing being read — stays where it was. What the widgets
 * cost was a diff pushed apart in as many places as it had comments; there is
 * only ever one of these, and only while somebody is typing into it.
 *
 * Below the range where there is room and above it where there is not, which is
 * the ordinary rule for anything that hangs off something. Measured before paint
 * rather than estimated, so a box that has to flip does not do it visibly.
 */
function FloatingComposer({
  place,
  spot,
  label,
}: {
  place: PendingRange
  spot: ReviewSpot
  label: string
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const card = cardRef.current
    if (!card) return

    // Observed rather than measured once: the textarea grows as it is typed
    // into, and a box below the range that has flipped above it has to keep
    // hanging from the same edge as it does.
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height)
    })
    observer.observe(card)
    return () => observer.disconnect()
  }, [])

  const width = Math.min(
    COMPOSER_MAX_WIDTH,
    Math.max(COMPOSER_MIN_WIDTH, spot.right - spot.left)
  )
  // Right-aligned to the editor when the code's left edge would push the box off
  // it, which is what a deeply indented range does.
  const left = Math.max(
    COMPOSER_MARGIN,
    Math.min(spot.left, spot.right - width, window.innerWidth - width - COMPOSER_MARGIN) // prettier-ignore
  )

  const below = spot.bottom + COMPOSER_GAP
  const fits = below + height <= window.innerHeight - COMPOSER_MARGIN
  const top = fits
    ? below
    : Math.max(COMPOSER_MARGIN, spot.top - COMPOSER_GAP - height)

  return (
    <div
      ref={cardRef}
      /* Above the editor and its gutters, which sit at `z-index: 200` in
         CodeMirror's own base theme — a composer behind the code it is about
         would be worse than one at the foot of the pane. */
      className="fixed z-[300] rounded-md border bg-popover px-3 py-2 shadow-lg"
      style={{ left, top, width }}
      /* The box is not in the editor's DOM, so nothing here reaches the review
         column — but it is drawn *over* the pane, and a press in it must not
         reach whatever else the pane binds to a click on itself. */
      onMouseDown={(event) => event.stopPropagation()}
    >
      <RangeLine label={label} place={place} />
      <Composer place={place} />
    </div>
  )
}

/**
 * The word that says the code this was written about is not in the file any
 * more.
 *
 * A review outlives the app now, so a thread can be read back against a file that
 * has moved on: `settle` looks for the lines it quoted, and says so when it
 * cannot find them. The thread is **kept** — a remark whose code has gone is
 * still something somebody said, and often the most interesting thing in the
 * review — but nothing in the diff is tinted for it, since the numbers it holds
 * are the ones it was written with and marking whatever sits at them now would be
 * pointing at the wrong code.
 */
function StaleMark() {
  return (
    <span
      className="ml-1.5 rounded-sm bg-muted px-1 py-px font-sans text-[0.6rem] text-muted-foreground"
      title="These lines have changed since this comment was written — the code it quotes is no longer in the file"
    >
      outdated
    </span>
  )
}

/**
 * One range and everything said about it, in the shape a forge uses.
 *
 * **A bordered box between two runs of code, with one block per thing said and a
 * `Reply…` field at the foot** — which is what a pull request's inline thread
 * looks like, and the reason to copy it is not fashion: it is the layout anybody
 * who reviews code already reads without being taught. What it gets right, and
 * what the earlier card here did not:
 *
 * - **Every note says who said it, above what they said.** A glyph beside the
 *   text left "who" to be inferred from an icon; a review with a reviewer and an
 *   agent in it is a conversation, and a conversation needs names.
 * - **The notes are separated, not spaced.** A hairline between blocks is what
 *   makes three remarks read as three rather than as one paragraph with gaps.
 * - **The reply field is always there.** It was a `Reply` button revealed on
 *   hover — a control nobody can see, guarding the single most common thing to do
 *   with a thread. Collapsed to one line until it is clicked, which is exactly
 *   the trade a forge makes: present, and not taking the height of a form.
 *
 * The one thing here a forge has no need of is the **file and line**, and it is
 * kept: a hunk's `12–14 (was 8–9)` and the `deleted` mark carry what the box's
 * position on screen cannot say. It goes where a timestamp goes, on the first
 * note, muted.
 */
function Thread({
  thread,
  label,
  replying,
  focused,
}: {
  thread: ReviewThread
  label: string
  replying: boolean
  /** Whether the walk is standing on this one — see `step`. Drawn as a ring:
   * the pane has scrolled here, and a comment landed on among three others is
   * one the eye still has to find. */
  focused: boolean
}) {
  /* Whether a *resolved* thread has been opened again to be read. Local, and
     deliberately not on the store: it says nothing about the review, it is not
     worth writing down, and a resolved thread the reader unfolded should fold
     itself back the next time the pane is built. Resolving again re-folds it,
     which is why this is reset there rather than left as it stood. */
  const [showing, setShowing] = useState(false)

  if (thread.resolved && !showing) {
    return (
      <ResolvedMark
        thread={thread}
        label={label}
        focused={focused}
        onShow={() => setShowing(true)}
      />
    )
  }

  return (
    /* `overflow-hidden` so the separators and the footer's own tint stop at the
       rounded corners rather than squaring them off. */
    <div
      className={`group overflow-hidden rounded-md border bg-popover shadow-md ${FOCUS_RING(focused)}`}
    >
      <ul>
        {thread.notes.map((note, at) => {
          const first = at === 0
          return (
            <li key={note.id} className="border-t px-3 py-2 first:border-t-0">
              <div className="flex items-center gap-1.5">
                {first && (
                  <span className="ml-auto min-w-0 truncate font-mono text-[0.7rem] text-muted-foreground">
                    {label}:{anchorLabel(thread.anchor)}
                    {isDeletedOnly(thread.anchor) && <DeletedMark />}
                    {thread.stale && <StaleMark />}
                  </span>
                )}
                {first && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete this thread"
                    /* The whole thread, notes and all — there is no deleting half
                       a conversation. On hover, because it is the one thing here
                       that cannot be undone. */
                    className="-mr-1 size-5 shrink-0 opacity-0 group-hover:opacity-100"
                    onClick={() => useReview.getState().remove(thread.id)}
                  >
                    <X className="size-3" />
                  </Button>
                )}
              </div>
              {/*
                Markdown, by the renderer the chat pane and the Explorer's `.md`
                preview both use. Claude answers in it — backticked identifiers,
                a `**bold**` qualifier, the occasional short list — and a thread
                showing the source characters is a thread quoting the punctuation
                instead of reading it. A reviewer typing `fd` gets the same.

                Indented under the name rather than under the glyph, which is
                what makes a block of prose read as that person's. At the code's
                own size: it is the content of this box.
              */}
              <MarkdownView
                source={note.body}
                className="mt-1 pl-[1.25rem] text-[0.8125rem] leading-snug"
              />
            </li>
          )
        })}
      </ul>

      <div className="space-y-1.5 border-t bg-muted/40 px-3 py-2">
        {replying ? (
          <Box
            placeholder="Reply…"
            submitLabel="Reply"
            onCancel={() => useReview.getState().openReply(null)}
            onSubmit={(body) => useReview.getState().reply(thread.id, body)}
          />
        ) : (
          /*
            A field until it is clicked, then the box. One line of height for the
            most common thing to do with a thread, which is what a forge spends
            on it — and `openReply` is what it already meant, so the store did not
            grow a state for this.
          */
          <button
            type="button"
            className="w-full truncate rounded-md border bg-background px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
            onClick={() => useReview.getState().openReply(thread.id)}
          >
            Reply…
          </button>
        )}

        {/*
          The forge's *Resolve conversation*, and under the reply field for the
          same reason it sits under one there: the two are the ends of the same
          decision — say something more, or say this is dealt with — and a
          button that settles a thread belongs after the one that continues it.

          Full width and quiet: it is pressed once per thread, so it does not
          need to be loud, but it must be visible without hovering. The `Delete`
          beside the first note is the destructive one and stays on hover; this
          one is undone by pressing it again.
        */}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-full gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={() =>
            useReview.getState().resolve(thread.id, !thread.resolved)
          }
        >
          {thread.resolved ? (
            <>
              <MessageSquare className="size-3" />
              Reopen conversation
            </>
          ) : (
            <>
              <Check className="size-3" />
              Resolve conversation
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

/**
 * A settled conversation, folded to one line.
 *
 * **Folded rather than hidden**, which is the whole of the argument: a review
 * that quietly removed what had been dealt with would be this app deciding a
 * discussion was over, and the record of *how* a remark was answered is the
 * reason a forge keeps the thread at all. What resolving buys is the height —
 * a diff worked through is a diff you can read again — and the counts, which
 * `openThreads` takes care of.
 *
 * The whole row is the button: a thread this small has one thing to do with it,
 * and a chevron beside a line of text is a target nobody can hit. `Reopen` is
 * inside the thread it opens rather than out here, because reopening is a
 * decision about the conversation and this row is a door.
 */
function ResolvedMark({
  thread,
  label,
  focused,
  onShow,
}: {
  thread: ReviewThread
  label: string
  focused: boolean
  onShow: () => void
}) {
  const notes = thread.notes.length
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-1.5 rounded-md border bg-popover/60 px-3 py-1.5 text-left shadow-sm hover:bg-accent ${FOCUS_RING(focused)}`}
      onClick={onShow}
      title="Show this resolved conversation"
    >
      <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-xs font-medium">Resolved</span>
      <span className="text-[0.7rem] text-muted-foreground">
        {notes === 1 ? "1 comment" : `${notes} comments`}
      </span>
      <span className="ml-auto min-w-0 truncate font-mono text-[0.7rem] text-muted-foreground">
        {label}:{anchorLabel(thread.anchor)}
      </span>
    </button>
  )
}

/**
 * The box for one thing said — a new thread, or a reply to one.
 *
 * One component for both because they are one control, and two copies of a
 * textarea with a ⌘⏎ and a Cancel would drift.
 *
 * The draft is `useState` here rather than a field on the store: it lives exactly
 * as long as the box does, and a store holding half-typed text would be one more
 * thing for every other panel's render to subscribe to. Focused on mount, since
 * whatever opened it was a click somewhere else.
 *
 * **The draft survives the range changing**, deliberately and by doing nothing:
 * the box is mounted while *some* range is picked, so extending one with a
 * shift-click — or re-picking after a mis-click — keeps what has been typed. It
 * is unmounted by the comment being added or cancelled, which is what empties
 * it. Resetting on the range instead loses a sentence to the second half of the
 * gesture that was meant to widen it.
 */
function Box({
  placeholder,
  submitLabel = "Comment",
  onSubmit,
  onCancel,
}: {
  placeholder: string
  /** What the button says. `Reply` where the box is answering a thread — the
   * word is the difference between opening a conversation and joining one, and
   * a forge says both. */
  submitLabel?: string
  onSubmit: (body: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState("")
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    fieldRef.current?.focus()
  }, [])

  function submit() {
    if (!draft.trim()) return
    onSubmit(draft)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // An IME's Enter belongs to the candidate window — the same guard the chat
    // composer keeps, and for the same keyboards.
    if (event.nativeEvent.isComposing) return

    if (event.key === "Escape") {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div>
      <div className="relative">
        <Textarea
          ref={fieldRef}
          value={draft}
          rows={3}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          className="min-h-16 resize-none text-xs md:text-xs"
        />
      </div>
      <div className="mt-1.5 flex items-center justify-end gap-1.5"> </div>
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={draft.trim().length === 0}
          onClick={submit}
        >
          {submitLabel}
          <span className="ml-1 opacity-60">⌘⏎</span>
        </Button>
      </div>
    </div>
  )
}
