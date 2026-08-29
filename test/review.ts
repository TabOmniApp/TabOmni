import { check, finish, section } from "./harness"

/**
 * A review left on a diff, and the prompt it becomes.
 *
 * The prompt is the only part worth being sure about: everything else in the
 * feature is a gutter cell or a widget, and this is the thing a turn actually
 * reads. So the pure halves are checked here — how an anchor is built and how it
 * reads, the snippet, and one thread as the question it becomes — with no store,
 * no editor and no chat in the way.
 */
const {
  AGENT_MENTION,
  anchorLabel,
  commentedLines,
  EMPTY_ANCHOR,
  isDeletedOnly,
  isEmptyAnchor,
  mentionsAgent,
  openThreads,
  orderedThreads,
  rangeLabel,
  markMention,
  settle,
  severityAtRank,
  severityRank,
  severitySummary,
  stepThrough,
  snippetOf,
  threadPrompt,
  threadsOf,
  useReview,
  withRow,
} = await import("../src/renderer/lib/files/review")

/* Main's half of the same feature, paired here the way `test/mcp-servers.ts`
 * pairs `readServer` with the renderer's: what a whole-diff review comes back
 * with is a model's output being let into the review, and this is the gate. */
const { findingsIn } = await import("../src/main/review-agent")

type Author = "you" | "agent"

/** A thread, written out at the call site the way the store would hold it. The
 * notes are `[author, body]` pairs so a two-voice thread is one line here. */
const thread = (
  path: string,
  fromLine: number,
  toLine: number,
  said: [Author, string][],
  snippet = "",
  side: "new" | "old" = "new"
) =>
  anchored(
    path,
    side === "new"
      ? { old: null, new: { fromLine, toLine } }
      : { old: { fromLine, toLine }, new: null },
    side === "new" ? { old: null, new: snippet } : { old: snippet, new: null },
    said
  )

/** The other shape a thread can have: one remark about a hunk, quoting the lines
 * that went and the lines that replaced them. */
const hunk = (
  path: string,
  before: { fromLine: number; toLine: number },
  after: { fromLine: number; toLine: number },
  said: [Author, string][],
  snippet: { old: string; new: string }
) => anchored(path, { old: before, new: after }, snippet, said)

const anchored = (
  path: string,
  anchor: {
    old: { fromLine: number; toLine: number } | null
    new: { fromLine: number; toLine: number } | null
  },
  snippet: { old: string | null; new: string | null },
  said: [Author, string][]
) => {
  const at = anchor.new?.fromLine ?? anchor.old?.fromLine ?? 0
  return {
    id: `${path}:${at}`,
    rootId: "root",
    path,
    anchor,
    snippet,
    notes: said.map(([author, body], index) => ({
      id: `${path}:${at}:${index}`,
      author,
      body,
    })),
  }
}

async function main() {
  section("building an anchor row by row")

  /*
   * This is the arithmetic the store used to do and no longer does: which rows a
   * gesture covered is a question only the editor can answer, so `review-marks.ts`
   * walks the rows between two heights and folds each one in through `withRow`.
   * What is checked here is the folding, which is the part that has to be right
   * for a range crossing a hunk to come out as one comment about two files.
   */
  const walk = (rows: ["new" | "old", number][]) =>
    rows.reduce((anchor, [side, line]) => withRow(anchor, side, line), EMPTY_ANCHOR) // prettier-ignore

  /** The same walk as the editor's, as the store is handed it: the anchor plus
   * the two rows the walk saw first and last, which is what the band is closed
   * at — see `ReviewSelection`. */
  const pickup = (rows: ["new" | "old", number][]) => ({
    anchor: walk(rows),
    first: { side: rows[0]![0], line: rows[0]![1] },
    last: { side: rows.at(-1)![0], line: rows.at(-1)![1] },
  })

  check(
    "rows on one side come out as one run, whichever order they arrive in",
    (() => {
      const grown = walk([
        ["new", 10],
        ["new", 14],
        ["new", 4],
      ])
      return (
        grown.new?.fromLine === 4 &&
        grown.new?.toLine === 14 &&
        grown.old === null
      )
    })(),
    "a walk goes downwards, but a drag that turns back walks upwards"
  )

  check(
    "rows on both sides come out as one anchor naming both",
    (() => {
      const across = walk([
        ["old", 40],
        ["old", 41],
        ["new", 12],
        ["new", 13],
      ])
      return (
        across.old?.fromLine === 40 &&
        across.old?.toLine === 41 &&
        across.new?.fromLine === 12 &&
        across.new?.toLine === 13
      )
    })(),
    "a run through a hunk crosses two files, and is still one remark"
  )

  check(
    "a walk that touched nothing is not a comment",
    isEmptyAnchor(EMPTY_ANCHOR) && !isEmptyAnchor(walk([["new", 1]])),
    "every row of the run was a folded bar, which is a line of neither file"
  )

  section("being called into a thread")

  /*
   * `@claude-review` in a comment is what asks Claude, in place of a button —
   * see `AGENT_MENTION`. The boundaries are the whole of the care: a false
   * positive is a turn nobody asked for, a false negative is a question that
   * silently went nowhere.
   */
  check(
    "a comment that says the name is addressed to Claude",
    mentionsAgent(`${AGENT_MENTION} is this actually load bearing?`) &&
      mentionsAgent(`why is this here, ${AGENT_MENTION}?`) &&
      mentionsAgent(`(${AGENT_MENTION})`) &&
      mentionsAgent(`ask ${AGENT_MENTION}`),
    "addressed and then carried on with is the ordinary shape"
  )

  check(
    "and the case it is written in does not matter",
    mentionsAgent("@Claude-Review what about the null case?")
  )

  check(
    "a longer word that starts with it is somebody else",
    !mentionsAgent("@claude-reviewer should look at this") &&
      !mentionsAgent("@claude-review-later"),
    "a note to self is not a summons"
  )

  check(
    "and neither is one buried in an address or a path",
    !mentionsAgent("mail me at bot@claude-review") &&
      !mentionsAgent("see docs/@claude-review"),
    "the leading boundary is what keeps those out"
  )

  check(
    "a comment that never says it asks nothing",
    !mentionsAgent("this leaks") && !mentionsAgent("claude-review"),
    "the @ is the address; without it this is a word in a sentence"
  )

  /* A note is drawn as markdown, so the mention is marked for that renderer
   * rather than wrapped in a React node — see `markMention`. The stored text is
   * untouched, which is what keeps `threadBlock` quoting what was typed. */
  check(
    "the mention is marked as code for the markdown renderer",
    markMention(`hi ${AGENT_MENTION} there`) === `hi \`${AGENT_MENTION}\` there`
  )

  check(
    "and a word that only starts with it is left alone",
    markMention("@claude-reviewer looked") === "@claude-reviewer looked",
    "the same boundaries the summons uses, or the two would disagree on screen"
  )

  section("a review read back against a file that moved")

  /*
   * A review outlives the app now, so a thread comes back addressed by numbers
   * that were true yesterday. `settle` re-addresses it by the **lines it quoted**,
   * which is the durable half of what it stores — see the function.
   */
  const commented = (fromLine: number, toLine: number, quoted: string) => ({
    ...anchored(
      "/w/a.ts",
      { old: null, new: { fromLine, toLine } },
      { old: null, new: quoted },
      [["you", "this leaks"]] as [Author, string][]
    ),
  })

  const file = (...lines: string[]) => lines.join("\n")

  check(
    "a thread whose lines have not moved is handed back untouched",
    (() => {
      const one = commented(2, 2, "open(fd)")
      return settle(one, { old: null, new: file("a", "open(fd)", "b") }) === one
    })(),
    "identity, because `showing` runs on every rebuild of the diff and an array of fresh objects would re-render the pane for nothing"
  )

  check(
    "a thread follows its lines when something is inserted above",
    (() => {
      const moved = settle(commented(2, 3, "open(fd)\nuse(fd)"), {
        old: null,
        new: file("added", "a", "open(fd)", "use(fd)", "b"),
      })
      return (
        moved.anchor.new?.fromLine === 3 &&
        moved.anchor.new?.toLine === 4 &&
        !moved.stale
      )
    })(),
    "the run keeps its length; only where it starts changed"
  )

  check(
    "and when something above it is deleted",
    (() => {
      const moved = settle(commented(4, 4, "open(fd)"), {
        old: null,
        new: file("a", "open(fd)", "b"),
      })
      return moved.anchor.new?.fromLine === 2 && !moved.stale
    })()
  )

  check(
    "a thread whose lines are gone is marked outdated, not dropped",
    (() => {
      const gone = settle(commented(2, 2, "open(fd)"), {
        old: null,
        new: file("a", "b", "c"),
      })
      return gone.stale === true && gone.notes.length === 1
    })(),
    "a remark whose code has gone is still something somebody said"
  )

  check(
    "a run that now appears twice is outdated rather than guessed at",
    (() => {
      const twice = settle(commented(5, 5, "}"), {
        old: null,
        new: file("a", "}", "b", "}", "c"),
      })
      return twice.stale === true
    })(),
    "moving to the first of two identical runs is a comment quietly reattached to the wrong code"
  )

  check(
    "a truncated snippet follows on the lines it did keep",
    (() => {
      const cut = commented(2, 5, "open(fd)\n… 3 more lines")
      const here = settle(cut, { old: null, new: file("a", "open(fd)", "b") })
      const moved = settle(cut, {
        old: null,
        new: file("x", "a", "open(fd)", "b"),
      })
      return !here.stale && !moved.stale && moved.anchor.new?.fromLine === 3
    })(),
    "the `…` line is not in the file, but the prefix above it identifies the start just as well"
  )

  check(
    "a side with no text to check against is left where it is",
    (() => {
      const deleted = anchored(
        "/w/a.ts",
        { old: { fromLine: 7, toLine: 7 }, new: null },
        { old: "gone()", new: null },
        [["you", "why did this go?"]] as [Author, string][]
      )
      return settle(deleted, { old: null, new: "a\nb" }) === deleted
    })(),
    "an unread file is not a missing line"
  )

  section("what a whole-diff review comes back with")

  const fenced = (body: string) => "Here you go:\n\n```json\n" + body + "\n```"

  check(
    "a fenced array of findings is read",
    (() => {
      const found = findingsIn(
        fenced(
          '[{"path":"src/a.ts","fromLine":12,"toLine":14,"body":"this leaks"}]'
        )
      )
      return (
        found?.length === 1 &&
        found[0]?.path === "src/a.ts" &&
        found[0]?.fromLine === 12 &&
        found[0]?.toLine === 14 &&
        found[0]?.body === "this leaks"
      )
    })()
  )

  check(
    "and so is a bare array, for an answer that came back without a fence",
    findingsIn('[{"path":"a.ts","fromLine":1,"toLine":1,"body":"x"}]')
      ?.length === 1
  )

  check(
    "an empty array is a real answer rather than a failure",
    findingsIn(fenced("[]"))?.length === 0,
    "the change is sound, and null is reserved for an answer nothing could read"
  )

  check(
    "an answer with no JSON in it at all is null",
    findingsIn("Looks fine to me.") === null &&
      findingsIn(fenced("not json")) === null,
    "which the caller says out loud rather than showing an empty review"
  )

  check(
    "a finding missing a field is dropped, not guessed at",
    (() => {
      const found = findingsIn(
        fenced(
          '[{"path":"a.ts","fromLine":2,"body":"kept"},' +
            '{"fromLine":3,"toLine":3,"body":"no path"},' +
            '{"path":"b.ts","toLine":4,"body":"no line"},' +
            '{"path":"c.ts","fromLine":5,"toLine":5,"body":"   "},' +
            '{"path":"d.ts","fromLine":0,"toLine":1,"body":"line zero"}]'
        )
      )
      return found?.length === 1 && found[0]?.body === "kept"
    })(),
    "the cost of guessing is a comment pinned to the wrong line"
  )

  check(
    "a finding with no end reads as one line",
    (() => {
      const found = findingsIn(
        fenced('[{"path":"a.ts","fromLine":9,"body":"x"}]')
      )
      return found?.[0]?.fromLine === 9 && found[0]?.toLine === 9
    })(),
    "and so does one whose end is above its start — a bad `toLine` is not a reason to lose the remark"
  )

  check(
    "a severity is read, whatever case it was typed in",
    (() => {
      const found = findingsIn(
        fenced(
          '[{"path":"a.ts","fromLine":1,"toLine":1,"severity":"critical","body":"x"},' +
            '{"path":"a.ts","fromLine":2,"toLine":2,"severity":" High ","body":"y"},' +
            '{"path":"a.ts","fromLine":3,"toLine":3,"severity":"low","body":"z"}]'
        )
      )
      return (
        found?.[0]?.severity === "critical" &&
        found[1]?.severity === "high" &&
        found[2]?.severity === "low"
      )
    })(),
    "case and stray spaces are a model not paying attention, not a different word"
  )

  check(
    "a severity nothing recognises is dropped, and the remark is kept",
    (() => {
      const found = findingsIn(
        fenced(
          '[{"path":"a.ts","fromLine":1,"toLine":1,"severity":"moderate","body":"x"},' +
            '{"path":"a.ts","fromLine":2,"toLine":2,"severity":3,"body":"y"},' +
            '{"path":"a.ts","fromLine":3,"toLine":3,"body":"z"}]'
        )
      )
      return (
        found?.length === 3 &&
        found.every((finding) => finding.severity === undefined)
      )
    })(),
    "guessing a middle would be indistinguishable from a `medium` the model chose"
  )

  check(
    "a finished review reads back worst first",
    severitySummary({ low: 2, critical: 1, high: 3 }) ===
      "1 critical, 3 high, 2 low",
    "the first word decides whether the diff is read now or after lunch"
  )

  check(
    "a level with nothing in it is left out, and nothing rated says nothing",
    severitySummary({ medium: 1, low: 0 }) === "1 medium" &&
      severitySummary({}) === "",
    "`0 low` is a phrase nobody wants, and the comment count is said separately"
  )

  section("how an anchor reads")

  check(
    "one line is one number and a run is two",
    anchorLabel({ old: null, new: { fromLine: 12, toLine: 12 } }) === "12" &&
      anchorLabel({ old: null, new: { fromLine: 12, toLine: 18 } }) === "12–18"
  )

  check(
    "a hunk leads with the working file's numbers and says what the others were",
    anchorLabel({
      old: { fromLine: 8, toLine: 9 },
      new: { fromLine: 12, toLine: 14 },
    }) === "12–14 (was 8–9)",
    "those are the ones somebody can open the file at"
  )

  check(
    "only a wholly deleted range is marked deleted",
    isDeletedOnly({ old: { fromLine: 8, toLine: 9 }, new: null }) &&
      !isDeletedOnly({
        old: { fromLine: 8, toLine: 9 },
        new: { fromLine: 12, toLine: 12 },
      }),
    "a hunk has lines in the working file, so its numbers are not the commit's"
  )

  section("the store's own picking")

  const review = useReview.getState()
  const place = { rootId: "root", path: "/w/a.ts" }
  const oneLine = (line: number) => pickup([["new", line]])

  review.pick(place, oneLine(10))
  check(
    "a press paints one line and does not open the box yet",
    useReview.getState().pending?.anchor.new?.fromLine === 10 &&
      useReview.getState().pending?.anchor.new?.toLine === 10 &&
      useReview.getState().pending?.settled === false,
    "a box drawn mid-drag takes height off the diff and moves the rows"
  )

  review.stretch(place, pickup([["new", 10], ["new", 16]])) // prettier-ignore
  check(
    "a drag replaces the range with the whole span it now covers",
    useReview.getState().pending?.anchor.new?.fromLine === 10 &&
      useReview.getState().pending?.anchor.new?.toLine === 16
  )

  review.stretch(place, pickup([["new", 10], ["new", 12]])) // prettier-ignore
  check(
    "and turning back shrinks it, because the caller recomputes rather than grows",
    useReview.getState().pending?.anchor.new?.toLine === 12,
    "a range grown from itself could only ever get bigger"
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

  review.pick({ rootId: "root", path: "/w/b.ts" }, oneLine(3))
  check(
    "a pick in another file replaces what was pending",
    useReview.getState().pending?.path === "/w/b.ts",
    "a comment cannot be about a range that spans two files"
  )

  review.settle()
  review.add("  rename this  ", { old: null, new: "const x = 1" })
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

  review.pick({ rootId: "root", path: "/w/b.ts" }, oneLine(9))
  review.settle()
  review.add("   ", { old: null, new: "" })
  check(
    "an empty comment is a cancel rather than a blank remark",
    useReview.getState().threads.length === 1 &&
      useReview.getState().pending === null
  )

  section("the deleted side, and both at once")

  review.pick(place, pickup([["old", 772], ["old", 775]])) // prettier-ignore
  review.settle()
  review.add("why did this go?", { old: "  return", new: null })
  const removed = useReview.getState().threads.at(-1)
  check(
    "a comment on deleted lines is kept as the commit's",
    removed?.anchor.new === null &&
      removed?.anchor.old?.fromLine === 772 &&
      removed?.notes[0]?.body === "why did this go?",
    removed
  )

  review.remove(removed!.id)

  review.pick(place, pickup([["old", 40], ["new", 12], ["new", 13]])) // prettier-ignore
  review.settle()
  review.add("this swap is wrong", { old: "gone()", new: "kept()\nadded()" })
  const both = useReview.getState().threads.at(-1)
  check(
    "and a comment on a hunk keeps both halves",
    both?.anchor.old?.fromLine === 40 &&
      both?.anchor.new?.fromLine === 12 &&
      both?.snippet.old === "gone()" &&
      both?.snippet.new === "kept()\nadded()",
    both
  )

  review.remove(both!.id)

  check(
    "a line number means one row on one side and nothing on the other",
    (() => {
      const lines = [
        thread("/w/a.ts", 12, 12, [["you", "kept"]]),
        thread("/w/a.ts", 40, 41, [["you", "gone"]], "", "old"),
      ]
      const now = commentedLines(lines, "/w/a.ts")
      const before = commentedLines(lines, "/w/a.ts", "old")
      return (
        now.size === 1 &&
        now.has(12) &&
        before.size === 2 &&
        before.has(40) &&
        !before.has(12)
      )
    })(),
    "the gutter asks about one side at a time, and the removed rows are the other"
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

  /*
   * The loop this closes: Claude's answer comes back through `reply`, and one
   * that quoted the mention while explaining it would ask itself again, for
   * ever. `asking` is set synchronously by `askAgent` before it awaits anything,
   * so an id absent from it is a turn that was never started — which is also why
   * this can be checked without a `window.desktop` to call.
   */
  review.reply(opened, `yes, ${AGENT_MENTION} is how you reach me`, {
    author: "agent",
    rootPath: "/w",
  })
  check(
    "an agent's own note never summons it again",
    !useReview.getState().asking.includes(opened) &&
      useReview.getState().threads[0]?.notes.length === 3,
    "only what a person said is a summons"
  )

  const byAgent = review.comment({
    rootId: "root",
    path: "/w/c.ts",
    anchor: { old: null, new: { fromLine: 2, toLine: 3 } },
    snippet: { old: null, new: "if (x) {}" },
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
    "the bar counts threads, not the notes in them",
    (() => {
      const mine = threadsOf(useReview.getState(), "root")
      const notes = mine.reduce((sum, one) => sum + one.notes.length, 0)
      return mine.length === 2 && notes === 5
    })(),
    "a thread argued with three times is one place to go and look — and counting notes made asking Claude inflate the review"
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

  section("settling one")

  const settling = useReview.getState().threads[0]!.id
  review.openReply(settling)
  review.resolve(settling, true)
  const settled = () =>
    useReview.getState().threads.find((thread) => thread.id === settling)
  check(
    "resolving a thread marks it and closes its reply box",
    settled()?.resolved === true && useReview.getState().replyTo === null,
    "the box is the 'there is more to say here' affordance"
  )
  check(
    "it is kept, notes and all — folded is not deleted",
    (settled()?.notes.length ?? 0) > 0 &&
      useReview.getState().threads.some((thread) => thread.id === settling)
  )
  check(
    "and it stops being counted",
    !openThreads(useReview.getState().threads).some(
      (thread) => thread.id === settling
    )
  )

  review.resolve(settling, false)
  check(
    "reopening puts it back in the count",
    settled()?.resolved === false &&
      openThreads(useReview.getState().threads).some(
        (thread) => thread.id === settling
      ),
    "a set rather than a toggle: the two ends are two buttons"
  )

  check(
    "a thread written before the field existed reads as open",
    openThreads([thread("/w/a.ts", 1, 1, [["you", "old record"]])]).length ===
      1,
    "`resolved` is absent on everything on disk already"
  )

  section("walking through them")

  /*
   * `⌥↓` / `⌥↑` — the way through a review of twelve files, and the two halves
   * of it that are worth being sure about: the order, and where the next one is.
   */
  const walkable = [
    thread("/w/b.ts", 5, 5, [["agent", "second file"]]),
    thread("/w/a.ts", 40, 41, [["agent", "further down a"]]),
    thread("/w/a.ts", 3, 3, [["agent", "top of a"]]),
  ]

  check(
    "the walk goes by file and then down the page",
    orderedThreads(walkable)
      .map((entry) => entry.notes[0]!.body)
      .join(" | ") === "top of a | further down a | second file",
    "not the order they were opened — four concurrent turns answer in any order"
  )

  check(
    "a settled conversation is not on the walk",
    orderedThreads([
      ...walkable,
      { ...thread("/w/a.ts", 1, 1, [["you", "done"]]), resolved: true },
    ]).length === 3,
    "a walk that kept them gets longer the more work you do"
  )

  check(
    "with nothing focused, forwards is the first and back is the last",
    (() => {
      const order = orderedThreads(walkable)
      return (
        stepThrough(order, null, 1)?.notes[0]?.body === "top of a" &&
        stepThrough(order, null, -1)?.notes[0]?.body === "second file"
      )
    })()
  )

  check(
    "it wraps at both ends",
    (() => {
      const order = orderedThreads(walkable)
      const last = order.at(-1)!
      const first = order[0]!
      return (
        stepThrough(order, last.id, 1)?.id === first.id &&
        stepThrough(order, first.id, -1)?.id === last.id
      )
    })(),
    "a review is walked until it is empty, not until the bottom"
  )

  check(
    "a thread that has left the walk starts it over rather than ending it",
    stepThrough(orderedThreads(walkable), "gone", 1)?.notes[0]?.body ===
      "top of a",
    "the focused one can be resolved or deleted while it is focused"
  )

  check(
    "and an empty review has nowhere to go",
    stepThrough([], null, 1) === null
  )

  check(
    "a severity ranks worst-highest, and nothing ranks 0",
    severityRank("critical") === 4 &&
      severityRank("high") === 3 &&
      severityRank("low") === 1 &&
      severityRank(undefined) === 0 &&
      severityAtRank(4) === "critical" &&
      severityAtRank(0) === undefined,
    "0 is the identity a directory row takes a maximum from"
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

  const prompt = threadPrompt(
    thread("/w/repo/src/a.ts", 12, 14, [["you", "this leaks"]], "open(fd)"),
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
    threadPrompt(
      thread("/w/repo/src/b.ts", 4, 4, [["you", "rename this"]]),
      "/w/repo"
    ).includes("### src/b.ts:4\n\nrename this")
  )

  const gone = threadPrompt(
    thread(
      "/w/repo/src/a.ts",
      772,
      773,
      [["you", "this was load bearing"]],
      "return\n}",
      "old"
    ),
    "/w/repo"
  )

  check(
    "a comment on deleted lines says so on its own heading",
    gone.includes("### src/a.ts:772–773 (deleted — numbers are the commit's)"),
    gone
  )

  check(
    "and the preamble says what to go by instead of the number",
    gone.includes("the quoted lines are what was meant"),
    "a turn that opened the working file at 772 would be reading whatever moved up into the gap"
  )

  check(
    "a thread with one note is that note, unattributed",
    prompt.includes("\n\nthis leaks"),
    "naming an author in a conversation with one voice is noise"
  )

  const argued = threadPrompt(
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
    "/w/repo"
  )

  check(
    "and a thread with several is the exchange, each line attributed",
    argued.includes("**Assistant:** this is unreachable") &&
      argued.includes("**Reviewer:** no, x is set above"),
    "who said what is the whole content of a disagreement"
  )

  section("a comment on a hunk")

  const swap = threadPrompt(
    hunk(
      "/w/repo/src/a.ts",
      { fromLine: 8, toLine: 9 },
      { fromLine: 12, toLine: 13 },
      [["you", "this swap loses the null check"]],
      { old: "if (!x) return\nuse(x)", new: "use(x)\nlog(x)" }
    ),
    "/w/repo"
  )

  check(
    "its heading names the working file's lines and what they replaced",
    swap.includes("### src/a.ts:12–13 (was 8–9)"),
    "the leading numbers are the ones an agent can open the file at"
  )

  check(
    "and it is not marked deleted, because half of it is in the file",
    !swap.includes("(deleted"),
    "that mark means the numbers are the commit's, which here they are not"
  )

  check(
    "the two halves are quoted separately and labelled",
    swap.includes("Removed (lines 8–9 of the committed file):") &&
      swap.includes("if (!x) return") &&
      swap.includes("Now (lines 12–13 of the working file):") &&
      swap.includes("log(x)"),
    "one fence holding both would be the commit's lines read as if in the file"
  )

  check(
    "the removed half is quoted above the half that replaced it",
    swap.indexOf("Removed (lines") < swap.indexOf("Now (lines"),
    "which is the order the reviewer saw them in"
  )

  check(
    "and the preamble explains that heading",
    swap.includes("`12–14 (was 8–9)`"),
    "a shape a turn has not been told about is a shape it will guess at"
  )

  check(
    "a one-sided thread is quoted with no such labels",
    prompt.includes("```\nopen(fd)\n```") && !prompt.includes("Removed (lines"),
    "there is nothing beside it to tell it apart from"
  )

  section("one thread as a question")

  const asked = threadPrompt(
    thread(
      "/w/repo/src/a.ts",
      12,
      14,
      [["you", "is this actually load bearing?"]],
      "if (x) {\n  go()\n}"
    ),
    "/w/repo"
  )

  check(
    "carries the heading, the lines and the remark",
    asked.includes("### src/a.ts:12–14") &&
      asked.includes("```\nif (x) {\n  go()\n}\n```") &&
      asked.includes("is this actually load bearing?"),
    "one block, built by the same function, so the two prompts cannot drift"
  )

  check(
    "and asks for an answer rather than for the change to be made",
    asked.startsWith("A comment left on this checkout") &&
      asked.includes("Answer it.") &&
      !asked.includes("Address every one of them"),
    "the reply lands in the thread; `Ask AI to fix…` is the other button"
  )

  const followUp = threadPrompt(
    thread("/w/repo/src/a.ts", 12, 12, [
      ["you", "why is this here?"],
      ["agent", "it guards the null case"],
      ["you", "x cannot be null on this path"],
    ]),
    "/w/repo"
  )

  check(
    "asking again carries the argument so far, attributed",
    followUp.includes("**Assistant:** it guards the null case") &&
      followUp.includes("**Reviewer:** x cannot be null on this path"),
    "or the second ask is the first question again rather than a follow-up"
  )

  const removedSide = threadPrompt(
    thread("/w/repo/src/a.ts", 7, 7, [["you", "why did this go?"]], "log(x)", "old"), // prettier-ignore
    "/w/repo"
  )

  check(
    "a deleted range says so in its heading",
    removedSide.includes("### src/a.ts:7 (deleted — numbers are the commit's)"),
    "there is nothing at line 7 of the working file to read"
  )

  finish()
}

await main()
