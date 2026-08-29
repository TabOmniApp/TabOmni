import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type SVGProps,
} from "react"
import { createPortal } from "react-dom"
import { Loader2, MessageSquare, Trash2, User, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Claude } from "@/components/ui/svgs/claude"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownView } from "../markdown-view"
import { relativeTo } from "@/lib/files/paths"
import { dropThreadHost, threadHost } from "@/lib/files/review-hosts"
import {
  AGENT_MENTION,
  anchorLabel,
  isDeletedOnly,
  markMention,
  snippetOf,
  threadsOf,
  useReview,
  type PendingRange,
  type ReviewAuthor,
  type ReviewSpot,
  type ReviewThread,
} from "@/lib/files/review"
import { useFiles } from "@/lib/files/store"
/* The `@`-in-a-textarea half of the chat composer's own mention menu, which is
 * pure text work with no chat in it and is checked in `test/chat-mentions.ts`.
 * Reused rather than written again: two answers to "is the caret in a mention?"
 * is two behaviours to keep agreeing. */
import {
  insertMention,
  mentionQuery,
  type MentionQuery,
} from "@/lib/worktree-chat/mention-text"

/** Which threads have had a node made for them, so the ones that go can have it
 * taken back — see the effect in `ReviewPanel`. */
const drawn = new Set<string>()

/**
 * The review of one checkout: the threads, wherever they are drawn, and the
 * one-line bar that says how many there are.
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
 * What is left in flow is a bar: how many comments there are across the whole
 * checkout, and `Discard`. It is the only thing that can say a review exists in a
 * file that is not open, and the only place a review can be thrown away.
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

  /* Threads, not notes: this counts the **places** a remark has been left, so a
   * thread somebody has argued with three times is still one place to go and
   * look. See the note where `noteCount` used to be. */
  const count = threads.length
  const label = (path: string) => relativeTo(rootPath, path) || path

  /* By root rather than a flag: a second project's pane must not spin for a turn
   * that is not its own. */
  const reviewing = useReview((state) => state.reviewing) === rootId
  const reviewError = useReview((state) => state.reviewError)
  const progress = useReview((state) => state.progress)

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
              rootPath={rootPath}
              label={label(thread.path)}
              replying={replyTo === thread.id}
            />,
            threadHost(thread.id)
          )}
        </Fragment>
      ))}

      {mine && spot && (
        <FloatingComposer
          place={mine}
          spot={spot}
          rootPath={rootPath}
          label={label(mine.path)}
        />
      )}

      {/*
        The bar.

        **Always drawn**, where it used to appear only once there was something
        to count. `Review` is why: a button that hands the whole diff to Claude
        has to be reachable on a diff nobody has commented on yet, which is
        exactly the state the bar used to hide in. Thirty-two pixels is what that
        costs, and it buys the one line that can say a review exists in a file
        nobody has opened.
      */}
      <div className="shrink-0 border-t bg-muted/20">
        <div className="flex h-8 items-center gap-2 px-3">
          <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs font-medium">
            Review
            {count > 0 && (
              <span className="ml-1.5 font-normal text-muted-foreground">
                {count === 1 ? "1 comment" : `${count} comments`}
              </span>
            )}
          </span>

          {/* Whatever the last whole-diff review had to say for itself: that it
              found nothing, or that it could not be run. Beside the button that
              started it rather than in a thread — it is about the run, not about
              any line. */}
          {reviewError && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {reviewError}
            </span>
          )}

          {/* While it runs, the same slot says what it is doing instead — the
              turn's own last tool call (`Read src/main/ipc.ts`), so a review
              of a dozen files reads as progress rather than as a spinner with
              nothing behind it. See `progress` and `listen` on the store. */}
          {reviewing && progress.length > 0 && (
            <span
              className="min-w-0 truncate font-mono text-xs text-muted-foreground"
              title={progress.join("\n")}
            >
              {progress[progress.length - 1]}
            </span>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {count > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1.5 px-2 text-xs"
                onClick={() => useReview.getState().clear(rootId)}
              >
                <Trash2 className="size-3" />
                Discard
              </Button>
            )}
            {/*
              One turn over every changed file, leaving what it finds as threads
              on the lines it names — the same author a reviewer's own remarks
              have, in the same pane, answerable in the same way.

              Not a chat: the point is that the findings arrive **as comments**,
              beside the code, rather than as a report somebody has to read and
              then re-enter. `review-agent.ts` has the shape of the turn.
            */}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1.5 px-2 text-xs"
              disabled={reviewing}
              title="Hands every changed file to Claude and leaves what it finds as comments"
              onClick={() =>
                void useReview.getState().reviewAll(rootId, rootPath)
              }
            >
              {reviewing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Claude className="size-3" />
              )}
              {reviewing ? "Reviewing…" : "Review"}
            </Button>
          </div>
        </div>

        {stranded && (
          <div className="border-t bg-background px-3 py-2">
            <RangeLine label={label(stranded.path)} place={stranded} />
            <Composer place={stranded} rootPath={rootPath} />
          </div>
        )}
      </div>
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
function Composer({
  place,
  rootPath,
}: {
  place: PendingRange
  /** The checkout, for a first comment that already says `@claude-review` — see
   * `add`. Asking on the way in is the point: the question and the summons are
   * one sentence. */
  rootPath: string
}) {
  /* What the diff on screen is comparing against, for a comment on a deleted
   * line: those lines are in the commit and nowhere else. */
  const committed = useReview((state) => state.committed)

  return (
    <Box
      placeholder="What should change here?  @ to ask Claude"
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

        useReview.getState().add(
          body,
          {
            old: before
              ? snippetOf(commit, before.fromLine, before.toLine)
              : null,
            new: after
              ? snippetOf(working, after.fromLine, after.toLine)
              : null,
          },
          rootPath
        )
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
  rootPath,
  label,
}: {
  place: PendingRange
  spot: ReviewSpot
  rootPath: string
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
      <Composer place={place} rootPath={rootPath} />
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
 * Who said it, as a glyph.
 *
 * Claude's own mark rather than a generic robot — the app already ships svgl's
 * (`components/ui/svgs/claude.tsx`, the same one the chat composer uses), and a
 * thread where one voice is the product is a thread that should say which
 * product. It carries its own colour, which is also what tells the two apart at
 * this size without reading the name beside it.
 */
const AUTHOR_MARK: Record<
  ReviewAuthor,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  you: User,
  agent: Claude,
}

const AUTHOR_TITLE: Record<ReviewAuthor, string> = {
  you: "You",
  agent: "Claude",
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
  rootPath,
  label,
  replying,
}: {
  thread: ReviewThread
  /** The checkout, for the turn `Ask Claude` runs — see `askAgent`. */
  rootPath: string
  label: string
  replying: boolean
}) {
  const asking = useReview((state) => state.asking).includes(thread.id)
  const failed = useReview((state) => state.askErrors)[thread.id]

  return (
    /* `overflow-hidden` so the separators and the footer's own tint stop at the
       rounded corners rather than squaring them off. */
    <div className="group overflow-hidden rounded-md border bg-popover shadow-md">
      <ul>
        {thread.notes.map((note, at) => {
          const Mark = AUTHOR_MARK[note.author]
          const first = at === 0
          return (
            <li key={note.id} className="border-t px-3 py-2 first:border-t-0">
              <div className="flex items-center gap-1.5">
                <Mark className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs font-medium">
                  {AUTHOR_TITLE[note.author]}
                </span>
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
                source={markMention(note.body)}
                className="mt-1 pl-[1.25rem] text-[0.8125rem] leading-snug"
              />
            </li>
          )
        })}

        {/*
          The turn, while it is running, drawn as the note it is about to become.
          It was a spinner on a button; the button is gone, and a thread that has
          summoned Claude has to say so somewhere — this is where the answer will
          appear, so it is where the waiting belongs.
        */}
        {asking && (
          <li className="border-t px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Claude className="size-3.5 shrink-0" />
              <span className="text-xs font-medium">{AUTHOR_TITLE.agent}</span>
            </div>
            <p className="mt-1 flex items-center gap-1.5 pl-[1.25rem] text-[0.8125rem] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Reading the code…
            </p>
          </li>
        )}
      </ul>

      {/* Drawn, not written in as a note: a reply that did not happen is not
          something anybody said. Cleared by the next attempt. */}
      {failed && (
        <p className="border-t px-3 py-1.5 text-[0.7rem] text-destructive">
          Claude could not answer: {failed}
        </p>
      )}

      <div className="border-t bg-muted/40 px-3 py-2">
        {replying ? (
          <Box
            placeholder="Reply…  @ to ask Claude"
            submitLabel="Reply"
            onCancel={() => useReview.getState().openReply(null)}
            onSubmit={(body) =>
              useReview.getState().reply(thread.id, body, { rootPath })
            }
          />
        ) : (
          /*
            A field until it is clicked, then the box. One line of height for the
            most common thing to do with a thread, which is what a forge spends
            on it — and `openReply` is what it already meant, so the store did not
            grow a state for this.

            The whole width now: the `Ask Claude` button that sat beside it is
            gone, and what replaced it is a word you write *into* this field. A
            button and a mention doing the same job would be two ways to ask, one
            of which cannot say what it is asking about.
          */
          <button
            type="button"
            className="w-full truncate rounded-md border bg-background px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
            onClick={() => useReview.getState().openReply(thread.id)}
          >
            Reply… <span className="opacity-70">@ to ask Claude</span>
          </button>
        )}
      </div>
    </div>
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
  /**
   * The `@…` the caret is inside, when what has been typed could still become
   * the mention. Null is "no menu".
   *
   * There is exactly **one** name to offer, so this is a boolean with a position
   * attached rather than a list and a selection: no arrow keys, no highlight, no
   * ranking. The day there is a second mentionable thing this grows a selected
   * index and the chat composer's menu is the thing to copy — it already has all
   * of that, and this deliberately does not.
   */
  const [query, setQuery] = useState<MentionQuery | null>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  /** Where the caret goes once picking a mention has re-rendered the value —
   * the same bargain the chat composer's field makes with React. */
  const picked = useRef<number | null>(null)
  /** Set by Escape and cleared once the caret leaves the query, so a dismissed
   * menu stays dismissed for this word rather than for ever. */
  const dismissed = useRef(false)

  useEffect(() => {
    fieldRef.current?.focus()
  }, [])

  useEffect(() => {
    const caret = picked.current
    if (caret === null) return
    picked.current = null
    fieldRef.current?.focus()
    fieldRef.current?.setSelectionRange(caret, caret)
  })

  /** Whether the menu should be up for what has been typed after the `@`. A
   * prefix of the name, which an empty filter is — a bare `@` offers it. */
  function refresh(text: string, caret: number) {
    const found = mentionQuery(text, caret)
    if (!found) {
      dismissed.current = false
      setQuery(null)
      return
    }
    const offers = AGENT_MENTION.slice(1).startsWith(found.filter.toLowerCase())
    setQuery(!dismissed.current && offers ? found : null)
  }

  function pick() {
    const field = fieldRef.current
    if (!query || !field) return

    const next = insertMention(
      draft,
      query,
      field.selectionStart,
      AGENT_MENTION
    )
    setDraft(next.text)
    picked.current = next.caret
    setQuery(null)
  }

  function submit() {
    if (!draft.trim()) return
    onSubmit(draft)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // An IME's Enter belongs to the candidate window — the same guard the chat
    // composer keeps, and for the same keyboards.
    if (event.nativeEvent.isComposing) return

    /*
     * The menu gets the keys first, and takes only three.
     *
     * `⌘⏎` is deliberately not one of them: a comment that is finished while the
     * menu happens to be up should send, not complete a word nobody was
     * choosing. Escape closes the menu rather than the box, which is what a
     * reader means by it while a list is open — and what stops a dismissed menu
     * throwing away a half-written remark.
     */
    if (query) {
      if (
        event.key === "Tab" ||
        (event.key === "Enter" && !event.metaKey && !event.ctrlKey)
      ) {
        // prettier-ignore
        event.preventDefault()
        pick()
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        dismissed.current = true
        setQuery(null)
        return
      }
    }

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
          onChange={(event) => {
            setDraft(event.target.value)
            refresh(event.target.value, event.target.selectionStart)
          }}
          /* Caret moves that are not edits — an arrow key, a click into the
             middle of the draft — are what close a menu the caret has left. */
          onSelect={(event) =>
            refresh(draft, event.currentTarget.selectionStart)
          }
          onKeyDown={onKeyDown}
          className="min-h-16 resize-none text-xs md:text-xs"
        />
        {query && (
          <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border bg-popover shadow-lg">
            <li>
              {/* `onMouseDown` with the default prevented rather than `onClick`:
                  a click takes the focus off the field first, and a mention
                  inserted into a box nobody is in is a caret nobody can see. */}
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                onMouseDown={(event) => {
                  event.preventDefault()
                  pick()
                }}
              >
                <Claude className="size-3.5 shrink-0" />
                <span className="font-medium">{AGENT_MENTION}</span>
                <span className="ml-auto truncate text-muted-foreground">
                  answers in this thread
                </span>
              </button>
            </li>
          </ul>
        )}
      </div>
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
