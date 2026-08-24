import { check, finish, section } from "./harness"

/**
 * A review left on a diff, and the prompt it becomes.
 *
 * The prompt is the only part worth being sure about: everything else in the
 * feature is a gutter cell or a strip, and this is the thing a turn actually
 * reads. So the pure halves are checked here — the range arithmetic, the
 * snippet, and the whole review as one message — with no store, no editor and no
 * chat in the way.
 */
const {
  commentedLines,
  extendTo,
  noteCount,
  rangeLabel,
  reviewPrompt,
  snippetOf,
  threadsOf,
  useReview,
} = await import("../src/renderer/lib/files/review")

type Author = "you" | "agent"

/** A thread, written out at the call site the way the store would hold it. The
 * notes are `[author, body]` pairs so a two-voice thread is one line here. */
const thread = (
  path: string,
  fromLine: number,
  toLine: number,
  said: [Author, string][],
  snippet = ""
) => ({
  id: `${path}:${fromLine}`,
  rootId: "root",
  path,
  fromLine,
  toLine,
  snippet,
  notes: said.map(([author, body], at) => ({
    id: `${path}:${fromLine}:${at}`,
    author,
    body,
  })),
})

async function main() {
  section("picking a range")

  const range = {
    rootId: "r",
    path: "/w/a.ts",
    fromLine: 10,
    toLine: 10,
    settled: true,
  }

  check(
    "a shift-click below extends downwards",
    extendTo(range, 14).fromLine === 10 && extendTo(range, 14).toLine === 14
  )

  check(
    "and one above extends upwards",
    extendTo(range, 4).fromLine === 4 && extendTo(range, 4).toLine === 10,
    "a shift-click grows the range: which end it lands on is the reader's"
  )

  check(
    "and it is a press like any other, so the box waits for the release",
    extendTo(range, 14).settled === false
  )

  section("the store's own picking")

  const review = useReview.getState()
  const place = { rootId: "root", path: "/w/a.ts" }

  review.pick(place, 10, false)
  check(
    "a press paints one line and does not open the box yet",
    useReview.getState().pending?.fromLine === 10 &&
      useReview.getState().pending?.toLine === 10 &&
      useReview.getState().pending?.settled === false,
    "a box drawn mid-drag takes height off the diff and moves the rows"
  )

  review.pick(place, 14, true)
  check(
    "a shift-click in the same file grows the range",
    useReview.getState().pending?.fromLine === 10 &&
      useReview.getState().pending?.toLine === 14,
    useReview.getState().pending
  )

  section("dragging the column")

  review.pick(place, 10, false)
  review.stretch(place, 10, 16)
  check(
    "a drag downwards takes everything between",
    useReview.getState().pending?.fromLine === 10 &&
      useReview.getState().pending?.toLine === 16
  )

  review.stretch(place, 10, 12)
  check(
    "and turning back shrinks it, which is what the anchor is for",
    useReview.getState().pending?.fromLine === 10 &&
      useReview.getState().pending?.toLine === 12,
    "a range grown from itself could only ever get bigger"
  )

  review.stretch(place, 10, 6)
  check(
    "dragging past the anchor turns the range around",
    useReview.getState().pending?.fromLine === 6 &&
      useReview.getState().pending?.toLine === 10
  )

  review.settle()
  check(
    "letting go is what opens the box",
    useReview.getState().pending?.settled === true
  )

  review.settle()
  check(
    "and a second mouseup changes nothing",
    useReview.getState().pending?.settled === true,
    "every release in the app comes through here, not only the ones that mean it"
  )

  section("writing one")

  review.pick(place, 10, false)
  review.settle()

  review.pick({ rootId: "root", path: "/w/b.ts" }, 3, true)
  check(
    "a shift-click in another file starts again",
    useReview.getState().pending?.path === "/w/b.ts" &&
      useReview.getState().pending?.fromLine === 3 &&
      useReview.getState().pending?.toLine === 3,
    "a comment cannot be about a range that spans two files"
  )

  review.add("  rename this  ", "const x = 1")
  const saved = useReview.getState()
  check(
    "adding opens a thread, trims the body and clears the range",
    saved.threads.length === 1 &&
      saved.threads[0]?.notes.length === 1 &&
      saved.threads[0]?.notes[0]?.body === "rename this" &&
      saved.threads[0]?.notes[0]?.author === "you" &&
      saved.pending === null,
    saved.threads
  )

  review.pick({ rootId: "root", path: "/w/b.ts" }, 9, false)
  review.settle()
  review.add("   ", "")
  check(
    "an empty comment is a cancel rather than a blank remark",
    useReview.getState().threads.length === 1 &&
      useReview.getState().pending === null
  )

  section("answering one")

  const opened = useReview.getState().threads[0]!.id
  review.reply(opened, "  because the fd is never closed  ")
  check(
    "a reply is another note on the same thread",
    useReview.getState().threads.length === 1 &&
      useReview.getState().threads[0]?.notes.length === 2 &&
      useReview.getState().threads[0]?.notes[1]?.body ===
        "because the fd is never closed",
    useReview.getState().threads[0]
  )

  review.reply(opened, "   ")
  check(
    "an empty reply says nothing",
    useReview.getState().threads[0]?.notes.length === 2
  )

  const byAgent = review.comment({
    rootId: "root",
    path: "/w/c.ts",
    fromLine: 2,
    toLine: 3,
    snippet: "if (x) {}",
    body: "this branch is unreachable",
    author: "agent",
  })
  review.reply(byAgent, "no, x is set above")
  const reviewed = useReview.getState().threads.find((t) => t.id === byAgent)
  check(
    "a thread can be opened by an agent and answered by the reader",
    reviewed?.notes[0]?.author === "agent" &&
      reviewed?.notes[1]?.author === "you",
    "which is the whole of what an AI review has to add to this model"
  )

  check(
    "the count is of notes rather than of threads",
    noteCount(threadsOf(useReview.getState(), "root")) === 4,
    "a thread with three replies is three things said"
  )

  section("which box is open")

  review.openReply(byAgent)
  check(
    "a reply box is a thread being open, on the store",
    useReview.getState().replyTo === byAgent,
    "a widget is rebuilt whenever the review changes; a box that remembered itself in its own DOM would close every time"
  )

  review.reply(byAgent, "and here is why")
  check(
    "saying it closes the box",
    useReview.getState().replyTo === null,
    "a box left open reads as a second reply being expected"
  )

  review.openReply(byAgent)
  review.remove(byAgent)
  check(
    "and deleting the thread takes its box with it",
    useReview.getState().replyTo === null
  )

  review.clear("root")
  check(
    "clearing a root takes its threads",
    useReview.getState().threads.length === 0
  )

  section("what the diff draws")

  check(
    "every line of every range is marked, and only for that file",
    (() => {
      const lines = commentedLines(
        [
          thread("/w/a.ts", 3, 5, [["you", "one"]]),
          thread("/w/b.ts", 9, 9, [["you", "elsewhere"]]),
        ],
        "/w/a.ts"
      )
      return lines.size === 3 && lines.has(3) && lines.has(5) && !lines.has(9)
    })()
  )

  check("a single line reads as one number", rangeLabel({ fromLine: 7, toLine: 7 }) === "7") // prettier-ignore
  check("and a range as two", rangeLabel({ fromLine: 7, toLine: 9 }) === "7–9")

  section("the quoted lines")

  const text = ["one", "two", "three", "four", "five"].join("\n")

  check(
    "the range comes out inclusive of both ends",
    snippetOf(text, 2, 4) === "two\nthree\nfour"
  )

  check(
    "a long range is cut with a line saying how much is missing",
    snippetOf(text, 1, 5, 2) === "one\ntwo\n… 3 more lines",
    "a prompt that stops mid-function reads as the reviewer having meant that much"
  )

  section("the prompt")

  const prompt = reviewPrompt(
    [
      thread("/w/repo/src/a.ts", 12, 14, [["you", "this leaks"]], "open(fd)"),
      thread("/w/repo/src/b.ts", 4, 4, [["you", "rename this"]]),
    ],
    "/w/repo"
  )

  check(
    "paths are relative to the checkout the turn runs in",
    prompt.includes("### src/a.ts:12–14") &&
      !prompt.includes("/w/repo/src/a.ts"),
    prompt
  )

  check("the comment itself is in it", prompt.includes("this leaks"))

  check(
    "the quoted lines are fenced",
    prompt.includes("```\nopen(fd)\n```"),
    "a snippet with a # in it would otherwise be a heading"
  )

  check(
    "a comment with nothing quoted carries no empty fence",
    prompt.includes("### src/b.ts:4\n\nrename this"),
    prompt
  )

  check("the count is stated", prompt.includes("2 comments"))

  check(
    "and one comment is not stated as 1 comments",
    reviewPrompt(
      [thread("/w/repo/a.ts", 1, 1, [["you", "x"]])],
      "/w/repo"
    ).includes("— 1 comment below")
  )

  check(
    "a thread with one note is that note, unattributed",
    prompt.includes("### src/b.ts:4\n\nrename this"),
    "naming an author in a conversation with one voice is noise"
  )

  const argued = reviewPrompt(
    [
      thread(
        "/w/repo/src/a.ts",
        3,
        3,
        [
          ["agent", "this is unreachable"],
          ["you", "no, x is set above"],
        ],
        "if (x) {}"
      ),
    ],
    "/w/repo"
  )

  check(
    "and a thread with several is the exchange, each line attributed",
    argued.includes("**Assistant:** this is unreachable") &&
      argued.includes("**Reviewer:** no, x is set above"),
    "who said what is the whole content of a disagreement"
  )

  check(
    "the order is the order they were written",
    prompt.indexOf("src/a.ts") < prompt.indexOf("src/b.ts"),
    "which is the order the diff was read in"
  )

  finish()
}

await main()
