import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Bot, MessageSquare, Sparkles, Trash2, User, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useChanges } from "@/lib/files/changes"
import { relativeTo } from "@/lib/files/paths"
import {
  noteCount,
  rangeLabel,
  reviewPrompt,
  snippetOf,
  threadsOf,
  useReview,
  type ReviewAuthor,
  type ReviewThread,
} from "@/lib/files/review"
import { useFiles } from "@/lib/files/store"
import { useStudio } from "@/lib/store"
import { placeOfRoot, useWorktreeChats } from "@/lib/worktree-chat/store"

/**
 * The review at the foot of the `Changes` pane: the threads left on this
 * checkout, the box to write the next one in, and the button that hands the lot
 * to an agent.
 *
 * **The remarks are here and not in the diff**, and it went the other way once:
 * the threads were CodeMirror block widgets under the lines they were about,
 * which is where a forge draws them. It came back, because a diff with three
 * comments in it is a diff pushed apart in three places — and the code around a
 * remark is the thing somebody is reading. What the diff keeps is what it can say
 * without moving a line: a bubble in the review column and a tint on the range
 * (`lib/files/review-marks.ts`). What the remark says is here, where a review of
 * four files is one list rather than four files to open.
 *
 * The other thing a list buys, which the widgets could not: a thread in a file
 * that is not on screen is still readable. Half of reviewing is coming back to
 * what you have already said.
 *
 * Nothing is drawn at all until there is a thread or a range picked, so a
 * checkout being read rather than reviewed loses no height to this.
 */
export function ReviewPanel({
  rootId,
  rootPath,
}: {
  rootId: string
  /** The checkout's own directory: the paths are shown, and sent, relative to
   * it — that is the cwd the turn will run in. */
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
  /* What the diff on screen is comparing against, for a comment on a deleted
   * line: those lines are in the commit and nowhere else. */
  const committed = useReview((state) => state.committed)

  const folders = useStudio((state) => state.folders)

  /** Set while the chat is being started, so the button cannot be pressed twice
   * into two chats holding the same review. */
  const [starting, setStarting] = useState(false)

  if (threads.length === 0 && !mine) return null

  const label = (path: string) => relativeTo(rootPath, path) || path
  const notes = noteCount(threads)

  /**
   * A new chat in this project with the whole review **written into its
   * composer**, unsent.
   *
   * Not sent, and that is what the ellipsis on the button means: a prompt
   * assembled out of eight remarks is exactly the kind that wants a sentence
   * added to it — "the first three only", "and run the tests" — and a turn that
   * has already started cannot be told that. So the last word stays the
   * reader's, in a field they are already looking at.
   *
   * The threads are **not** cleared. The review is the structured thing — ranges
   * and files and who said what — and the composer holds only its text, so
   * throwing it away on the strength of a message nobody has sent yet would lose
   * the reviewable half of it if the reader decided against sending. `Discard` is
   * the deliberate way, and pressing this twice makes a second chat, which is
   * visible and closable rather than silent.
   */
  async function ask() {
    const place = placeOfRoot(rootId, folders)
    if (!place || threads.length === 0) return

    setStarting(true)
    try {
      await useWorktreeChats
        .getState()
        .create(place, reviewPrompt(threads, rootPath))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="flex max-h-[45%] shrink-0 flex-col border-t bg-muted/20">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3">
        <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">
          Review
          {notes > 0 && (
            <span className="ml-1.5 font-normal text-muted-foreground">
              {notes === 1 ? "1 comment" : `${notes} comments`}
            </span>
          )}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {threads.length > 0 && (
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
          <Button
            size="sm"
            className="h-6 gap-1.5 px-2 text-xs"
            disabled={threads.length === 0 || starting}
            title="Opens a new chat in this checkout with the review in its composer, ready to send"
            onClick={() => void ask()}
          >
            <Sparkles className="size-3" />
            {/* The ellipsis is the ordinary meaning of one on a button: this
                opens something where the action is finished, rather than doing
                it. */}
            {starting ? "Opening a chat…" : "Ask AI to fix…"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {mine && (
          <div className="border-b bg-background px-3 py-2">
            <p className="mb-1.5 font-mono text-[0.7rem] text-muted-foreground">
              {label(mine.path)}:{rangeLabel(mine)}
              {mine.side === "old" && <DeletedMark />}
              {/* Said out loud, because neither way of growing a range is
                  guessable from a column of plus signs. */}
              <span className="ml-2 font-sans">
                drag the column, or shift-click a line, to change the range
              </span>
            </p>
            <Box
              placeholder="What should change here?"
              onCancel={() => useReview.getState().cancel()}
              onSubmit={(body) => {
                // The quoted lines come from the buffer the diff is showing,
                // which is the file including whatever the `Edit` view has typed
                // into it and not yet saved — the text the reader was looking at.
                // A deleted line is not in that buffer at all: it is quoted from
                // the commit, which is the other half of what is on screen.
                const doc = useFiles.getState().docs[mine.path]
                const working = doc?.kind === "text" ? doc.text : ""
                const text =
                  mine.side === "old"
                    ? committed?.path === mine.path
                      ? committed.text
                      : ""
                    : working
                useReview
                  .getState()
                  .add(body, snippetOf(text, mine.fromLine, mine.toLine))
              }}
            />
          </div>
        )}

        <ul>
          {threads.map((thread) => (
            <Thread
              key={thread.id}
              thread={thread}
              label={label(thread.path)}
              replying={replyTo === thread.id}
            />
          ))}
        </ul>
      </div>
    </div>
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

/** Who said it, as a glyph rather than a name: there are two authors and one of
 * them is the person reading. A name would be a column of "You" down the
 * strip. */
const AUTHOR_MARK: Record<ReviewAuthor, typeof User> = {
  you: User,
  agent: Bot,
}

const AUTHOR_TITLE: Record<ReviewAuthor, string> = {
  you: "You",
  agent: "Claude",
}

/**
 * One range and everything said about it.
 *
 * The notes are stacked rather than folded: a thread here is two or three lines
 * long, and a fold would be a click to read a sentence. A thread long enough to
 * want folding is the point at which to add one.
 */
function Thread({
  thread,
  label,
  replying,
}: {
  thread: ReviewThread
  label: string
  replying: boolean
}) {
  return (
    <li className="group border-b px-3 py-1.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <button
          type="button"
          // Clicking the heading goes to the file it is about, which is the one
          // thing to do with a thread that is not answering or deleting it. The
          // line is not scrolled to: the diff is collapsed and the pane owns its
          // own scroll, and a jump that landed somewhere near would be worse
          // than none.
          onClick={() =>
            useChanges.getState().openPath(thread.rootId, thread.path)
          }
          className="min-w-0 flex-1 truncate text-left font-mono text-[0.7rem] text-muted-foreground hover:text-foreground"
        >
          {label}:{rangeLabel(thread)}
          {thread.side === "old" && <DeletedMark />}
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[0.7rem] opacity-0 group-hover:opacity-100"
          onClick={() => useReview.getState().openReply(thread.id)}
        >
          Reply
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete this thread"
          className="size-5 shrink-0 opacity-0 group-hover:opacity-100"
          onClick={() => useReview.getState().remove(thread.id)}
        >
          <X className="size-3" />
        </Button>
      </div>

      <ul className="mt-0.5 space-y-1">
        {thread.notes.map((note) => {
          const Mark = AUTHOR_MARK[note.author]
          return (
            <li key={note.id} className="flex items-start gap-1.5">
              <Mark
                aria-label={AUTHOR_TITLE[note.author]}
                className="mt-0.5 size-3 shrink-0 text-muted-foreground"
              />
              <p className="min-w-0 flex-1 text-xs whitespace-pre-wrap">
                {note.body}
              </p>
            </li>
          )
        })}
      </ul>

      {replying && (
        <div className="mt-1.5">
          <Box
            placeholder="Reply…"
            onCancel={() => useReview.getState().openReply(null)}
            onSubmit={(body) => useReview.getState().reply(thread.id, body)}
          />
        </div>
      )}
    </li>
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
  onSubmit,
  onCancel,
}: {
  placeholder: string
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
      <Textarea
        ref={fieldRef}
        value={draft}
        rows={3}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        className="min-h-16 resize-none text-xs md:text-xs"
      />
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
          Comment
          <span className="ml-1 opacity-60">⌘⏎</span>
        </Button>
      </div>
    </div>
  )
}
