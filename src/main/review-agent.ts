import { randomUUID } from "node:crypto"
import path, { join } from "node:path"

import {
  REVIEW_SEVERITY_IDS,
  type ReviewFinding,
  type ReviewSeverity,
} from "../shared/api"
import { startAgentSession } from "./claude-agent"
import { changes, fileDiff } from "./git"

/**
 * One question about one review comment, answered and then closed.
 *
 * **This is the second `claude` this app spawns, and the rule it is measured
 * against is worth restating.** `ipc.ts` says the old "no second one" rule still
 * refuses a feature that calls the CLI as a helper — an AI filter, an import
 * button — because a helper turn is a turn nobody asked for. This is not one: it
 * is a name written into a comment by the person writing the comment,
 * and its answer is a note in that thread with `author: "agent"` — the author
 * `lib/files/review.ts` was built with from the start. What the rule is against
 * is a turn that happens *on its way past*, and there is none here — it is
 * reached by writing `@claude-review` in the comment itself.
 *
 * What separates it from a chat, and why it is not one:
 *
 * - **It is one turn, not a conversation.** The session is opened for the
 *   question and closed on the answer, so nothing is resumed, nothing is written
 *   down, and there is no id anybody could send a second message to. A reviewer
 *   who wants a conversation opens a chat and says so — the diff is on screen
 *   beside it.
 * - **It is read-only**, and by the same means the chat's `Plan` and `Read only`
 *   modes are: a tool list applied in this process, no `Bash`. A review reply
 *   that edited the file under the diff being read would be the diff moving out
 *   from under the reader mid-sentence.
 * - **Nothing can stop it to ask.** There is no card and nobody watching, so
 *   `onAsk` is absent and `deciding` refuses an unpermitted call with a sentence
 *   the model can read — which is the right end for a turn whose whole output is
 *   one paragraph.
 *
 * Deliberately **not** a method on `WorktreeChats`: everything that class does is
 * about a conversation that persists — the transcript, the resume, the idle
 * reaper, the ask table — and none of it applies. Sharing the class would mean
 * every one of those growing a "unless it is a review reply" branch.
 */

/**
 * What a review reply may call.
 *
 * `READ_TOOLS` in `worktree-chat.ts` minus the three that do not belong in a
 * turn that owes one paragraph: `TodoWrite` (there is no list to keep), and
 * `Task` (a subagent is a turn inside a turn, and this one is closed the moment
 * it answers). `WebFetch` and `WebSearch` stay — "is this API deprecated" is a
 * real review comment.
 *
 * No `Bash`, for the reason `worktree-chat.ts` gives: a command can write, and
 * no reading of an argument list decides which ones do. `Glob` and `Grep` are
 * the same reconnaissance without a shell.
 */
const REPLY_TOOLS = [
  "ToolSearch",
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
]

/**
 * What the turn is told it is doing.
 *
 * Both halves matter. The first is the shape of the answer: a review comment is
 * answered in a paragraph, and a model that is not told so will return a plan,
 * a numbered list and an offer to make the change — none of which fits in a
 * thread beside the two lines it is about. It is told that markdown is
 * *rendered*, because it is: a thread draws a note through the same
 * `MarkdownView` the chat pane uses, so an identifier in backticks arrives as
 * one rather than as three characters. The second is that it cannot edit,
 * said as well as enforced, so it spends its calls reading rather than finding
 * out by being refused.
 */
const REPLY_PROMPT = [
  "You are answering one comment left on a code review, inside a desktop studio. Your answer is shown as a reply in that comment's thread, beside the lines it is about.",
  "",
  "Answer in prose, in at most a short paragraph or two. Markdown is rendered, so backticks around an identifier and the occasional short list are read as written — but no headings, no numbered plans and no preamble: this is a note beside two lines of code, not a document. If the comment is a question, answer it. If it asserts something, say whether it holds and why. If you need to look at the code around it, read the file; the working tree is this directory.",
  "",
  "This turn is read-only on purpose: the editing tools and the shell are unavailable, so do not try them.",
].join("\n")

/**
 * How long one reply may take before it is given up on.
 *
 * A bound exists here where a chat has none, and the difference is who is
 * waiting. A chat's ask is held for as long as it takes because somebody is
 * reading the question and will answer it; this is a spinner on a button with no
 * Stop beside it, so a CLI that wedges would be a thread stuck saying "asking…"
 * for the rest of the run. Generous enough that a reply which reads three files
 * finishes well inside it.
 */
const REPLY_TIMEOUT_MS = 180_000

export type ReviewReplyRequest = {
  /** The checkout the comment is about — the directory the turn reads in. */
  cwd: string
  /** The whole question, already assembled: `threadPrompt` in
   * `lib/files/review.ts` builds it, and it is checked in `test/review.ts`. */
  prompt: string
  /** `--model`, picked on the review pane's own toolbar — the same alias a
   * chat's `ModelMenu` hands over. Null leaves the turn on whatever the user's
   * own `claude` is configured with. */
  model?: string | null
  /** `--effort`, the same way. */
  effort?: string | null
  /** `CLAUDE_CONFIG_DIR`, when the workspace has a profile — passed through so a
   * reply is billed to the same account the chats are. */
  configDir?: string | null
  /** Settings › MCP's switched-off tools, for the same reason a chat gets them:
   * a tool the workspace turned off should not be in this model's list either. */
  disabledTools?: string[]
}

export type ReviewReplyResult =
  | { text: string }
  /** A sentence for the thread to draw in place of an answer. Never a throw:
   * the renderer has one path for "it did not work" rather than two. */
  | { error: string }

/**
 * Asks, waits, and closes.
 *
 * The assistant's text is collected across replies and joined, because a turn
 * that thinks out loud sends several: `thinking` lines are dropped, which is the
 * one thing that must not reach a thread — it is what the model considered on
 * the way to the answer, not the answer.
 */
export function reviewReply(
  request: ReviewReplyRequest
): Promise<ReviewReplyResult> {
  return oneTurn({
    cwd: request.cwd,
    prompt: request.prompt,
    system: REPLY_PROMPT,
    tools: REPLY_TOOLS,
    timeoutMs: REPLY_TIMEOUT_MS,
    model: request.model,
    effort: request.effort,
    configDir: request.configDir,
    disabledTools: request.disabledTools,
  })
}

/**
 * One read-only turn, opened for a question and closed on the answer.
 *
 * The shape both of this file's turns are: a reply to one comment, and a review
 * of the whole diff. They differ in what they are told, what they may call and
 * how long they are given — everything else about running a `claude` once is
 * here, once.
 */
async function oneTurn(request: {
  cwd: string
  prompt: string
  system: string
  tools: string[]
  timeoutMs: number
  model?: string | null
  effort?: string | null
  configDir?: string | null
  disabledTools?: string[]
  /** One line per tool call, as it goes out — see `ReviewProgressEvent`. Not
   * a transcript this side keeps: the caller draws it and forgets it. */
  onProgress?: (text: string) => void
}): Promise<ReviewReplyResult> {
  const said: string[] = []

  return new Promise<ReviewReplyResult>((resolve) => {
    /** Settled once, whichever of the four ways below gets there first: the turn
     * ending, the process dying, the timeout, or a failure to start. */
    let done = false
    let session: { close: () => void } | null = null

    const finish = (result: ReviewReplyResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      // The session is closed on the way out rather than left to the caller:
      // there is nothing to send a second message to, and a `claude` per
      // unanswered comment is what this whole shape exists to avoid.
      session?.close()
      resolve(result)
    }

    const timer = setTimeout(
      () =>
        finish({
          error: `Claude did not answer within ${Math.round(request.timeoutMs / 1000)}s.`,
        }),
      request.timeoutMs
    )
    // Nothing here is a reason for Electron to stay up at quitting time.
    timer.unref?.()

    void startAgentSession(
      {
        cwd: request.cwd,
        // A fresh id every time, never resumed and never written down: this
        // session has no past and will have no future.
        sessionId: randomUUID(),
        resume: false,
        // Picked on the review pane's own toolbar, the same as a chat's — see
        // `ReviewReplyRequest.model`. Null still means "leave it alone".
        model: request.model ?? null,
        effort: request.effort ?? null,
        configDir: request.configDir ?? null,
        permits: (name) => request.tools.includes(name),
        disallowedTools: request.disabledTools ?? [],
        // The same one every chat uses, which is what keeps this turn inside the
        // same cached prefix rather than paying for a prompt of its own.
        permissionMode: "manual",
        appendSystemPrompt: request.system,
        // No `onAsk` on purpose — see the note at the top of this file.
      },
      {
        onMessage: (message) => {
          if (message.role === "assistant") said.push(message.text)
          // A tool going out is the one thing worth telling whoever is
          // watching a review run: which file it opened, what it searched
          // for. `summary` is already the argument a chat's own tool row
          // leads with (`describeCall` in `claude-agent.ts`), read off the
          // same message rather than recomputed here.
          if (message.role === "tool") {
            request.onProgress?.(
              message.summary
                ? `${message.name}: ${message.summary}`
                : message.name
            )
          }
        },
        // Everything a chat draws and this has nowhere to put. Ignored rather
        // than left off the type, which does not allow it.
        onToolResult: () => {},
        onUsage: () => {},
        onContext: () => {},
        onWindow: () => {},
        onCompacting: () => {},
        onCompacted: () => {},
        onBusy: () => {},
        onAgents: () => {},
        onTurn: (error) => {
          const text = said.join("\n\n").trim()
          if (error) return finish({ error })
          finish(
            text ? { text } : { error: "Claude answered with nothing at all." }
          )
        },
        // Only reached before `onTurn` — a process that died mid-answer, or one
        // that never started. Afterwards `done` is already set and the close
        // this is reporting is the one `finish` asked for.
        onExit: (error) =>
          finish({ error: error ?? "Claude stopped before answering." }),
      },
      request.prompt
    ).then((opened) => {
      if (!opened) return
      // `startAgentSession` resolves on the CLI's first message, by which time
      // the turn may already be over — `finish` has closed nothing in that case,
      // so it is closed here instead.
      if (done) opened.close()
      else session = opened
    })
  })
}

/**
 * What a whole-diff review may call.
 *
 * The reply's list, and `Read` is the one that matters: the patches go over in
 * the prompt, but a patch is `--unified=0` and a remark about code needs what is
 * around it. A turn that could only see the changed lines would either say
 * nothing useful or invent the context.
 */
const REVIEW_TOOLS = REPLY_TOOLS

/**
 * Longer than a reply's, because this is a different amount of work: a reply
 * answers one question and this reads a file's patch and the files behind it.
 * Still bounded, for the reason a reply is — nobody is watching, and there is no
 * Stop. It is **per file**, not per review: a change of 400 files is 400 turns,
 * and one budget over the lot would be a number nobody could pick.
 */
const REVIEW_TIMEOUT_MS = 300_000

/**
 * How many files are reviewed at once.
 *
 * Each is a `claude` of its own, so this is the number of CLIs resident while a
 * review runs — which is why it is small. Sequential was the first shape and it
 * is unusable at any real size: a hundred files at even twenty seconds each is
 * half an hour of a spinner. Four is the point where the run is bounded by the
 * model rather than by this loop, without a review of a large change becoming
 * the heaviest thing on the machine.
 */
const REVIEW_CONCURRENCY = 4

/**
 * How much of one file's patch goes over before it is dropped.
 *
 * A cap on the text rather than a count of hunks: one 4,000-line generated file
 * is the case that matters. What is dropped is said in that file's own prompt,
 * so a turn given no patch reads the file rather than quietly reporting on
 * nothing. It is a **per-file** budget now — before the split it was the budget
 * for the whole diff, and what that meant on a large change was that files late
 * in the alphabet were never looked at at all.
 */
const PATCH_LIMIT = 240_000

/**
 * What each review turn is told.
 *
 * **The output shape is the whole of the difficulty.** A review that comes back
 * as prose is a review somebody has to read and then re-enter as comments, which
 * is the tedium this feature exists to remove — so it comes back as JSON, and
 * each finding becomes a thread on the lines it names. Everything in the prompt
 * about that is load-bearing:
 *
 * - **One file per turn, and the rest of the change is context.** A turn is told
 *   which files moved with this one and may read any of them, but may comment
 *   only on its own — each of the others has a turn of its own, and a remark
 *   allowed to land anywhere is the same remark arriving as many times as there
 *   are files that could see it.
 * - **The working file's line numbers**, because that is what a thread is
 *   anchored by and what the reader can open the file at. A remark about lines
 *   the change *removed* has to be made against the lines that replaced them —
 *   the reviewer's own comments can name a deleted range, but nothing here can
 *   turn a patch's `-` line into a position without the commit's text, and the
 *   turn does not have it.
 * - **Fewer, better.** A model asked to review a diff will find something to say
 *   about every hunk; the noise costs more to clear than the review saved. The
 *   number is said out loud, and it is a per-file number now — "ten" against one
 *   file is an invitation where against a whole diff it was a ceiling.
 * - **No praise, no summary.** A thread is a thing to act on. "This looks good"
 *   attached to line 40 is a row in the way of the rows that matter.
 */
const REVIEW_PROMPT = [
  "You are reviewing one file's uncommitted changes in a repository, inside a desktop studio. What you return is turned into comments pinned to the lines you name, in the same pane the user is reading the diff in — so this is not a report, it is a set of remarks somebody will act on one by one.",
  "",
  'Answer with a single fenced ```json block and nothing else: an array of findings, each `{ "path", "fromLine", "toLine", "severity", "body" }`.',
  "",
  "- `path` is the file under review, exactly as it is named below, relative to the repository. Findings about any other file are discarded — every changed file is reviewed separately, so a problem in one of the others will be caught by its own review rather than by yours.",
  "- `fromLine` and `toLine` are lines of the file **as it is now**, counting from 1, inclusive. Never a line number from the old version: if the problem is something the change deleted, comment on the lines that replaced it.",
  "- `severity` is one of `critical`, `high`, `medium`, `low`. `critical` is data loss, a security hole, or a crash on an ordinary path — reserve it, and expect most reviews to have none. `high` is a real bug on a path that will be taken. `medium` is a case not handled, a leak under load, a name that will mislead the next reader. `low` is a remark worth making that nobody has to act on today. Judge the *defect*, not how confident you are about it: a maybe-bug that would corrupt data is still critical.",
  "- `body` is the remark, in one or two sentences. Markdown is rendered, so backticks around an identifier read as written. Do not restate the severity in it — it is shown as a label beside the comment.",
  "",
  "Read the file before commenting on it: the patch below is `--unified=0` and shows you the changed lines without what surrounds them. The other changed files are listed so you can read the ones that bear on this change — a caller, a type, the other side of a contract — not so you can review them.",
  "",
  "Report only what is worth a reviewer's attention — a bug, a leak, a case not handled, a name that misleads, a rule of this repository broken. Three findings on one file is already a lot; if the change to it is sound, return an empty array and say nothing else. No praise, no summary, no restating what the diff does.",
  "",
  "This turn is read-only on purpose: the editing tools and the shell are unavailable, so do not try them.",
].join("\n")

export type ReviewChangesResult =
  { findings: ReviewFinding[] } | { error: string }

export type ReviewChangesRequest = {
  cwd: string
  model?: string | null
  effort?: string | null
  configDir?: string | null
  disabledTools?: string[]
  /** See `oneTurn`'s own field — this is the one call worth watching run,
   * since a reply is one paragraph and this is a turn per changed file. */
  onProgress?: (text: string) => void
}

/**
 * Every changed file in a checkout, reviewed **one turn per file**.
 *
 * It was one turn over the whole diff, and what killed that was the arithmetic
 * rather than the quality: the patches were concatenated under a single
 * `PATCH_LIMIT`, so a change of any real size — a few hundred files, a
 * regenerated lockfile, a formatting sweep — spent the entire budget on whatever
 * sorted first and the rest of the change was a list of names the turn was free
 * to ignore. A turn per file is the only shape where the hundredth file gets the
 * same attention as the first.
 *
 * What that costs, said plainly so nobody rediscovers it: **N turns is N cached
 * prefixes**, and no turn sees the whole change at once, so a remark that only
 * exists in the relationship between two files is one this will not make. The
 * second is softened rather than solved — every prompt carries the list of
 * changed files and the tools to read them (`REVIEW_PROMPT`) — and the first is
 * simply paid.
 *
 * The patches are gathered here rather than left to the turns to fetch, because
 * they have no shell to fetch them with — `git` is not something a read-only
 * tool list can reach, and this app already knows how to ask (`main/git.ts`).
 * What a turn does for itself is **read the files**, which is the part a patch
 * cannot give it.
 */
export async function reviewChanges(
  request: ReviewChangesRequest
): Promise<ReviewChangesResult> {
  const rows = await changes(request.cwd)
  // One entry per path: `changes` returns a row per side of the index, and a
  // file that is staged and then edited again is two rows of one file.
  //
  // A row's `path` is **absolute** and everything downstream of here wants it
  // relative — the prompt names the file that way, `names` matches the model's
  // answer against it, and the renderer joins it back onto the root. Taking it
  // as relative was a `join(cwd, absolute)` that named no file at all, so every
  // turn was skipped and a review of a dozen files came back instantly with
  // nothing to say. A directory row (a wholly untracked directory is one entry)
  // is dropped: there is no patch for it, and its files are not listed.
  const paths = [
    ...new Set(
      rows
        .filter((row) => !row.directory)
        .map((row) => path.relative(request.cwd, row.path))
        .filter((relative) => relative && !relative.startsWith(".."))
    ),
  ].sort()
  /** The new files, which `git diff HEAD` says nothing about — they are in no
   * commit and, unstaged, in no index either. Skipping them for want of a patch
   * left exactly the files most worth reading unreviewed, so their turn is told
   * the whole file is the change instead. */
  const untracked = new Set(
    rows
      .filter((row) => row.state === "untracked" && !row.directory)
      .map((row) => path.relative(request.cwd, row.path))
  )
  if (paths.length === 0) {
    return { error: "Nothing has changed in this checkout." }
  }

  request.onProgress?.(
    `Reviewing ${paths.length} changed file${paths.length === 1 ? "" : "s"}…`
  )

  const findings: ReviewFinding[] = []
  const errors: string[] = []
  /** Files that actually reached a turn, which is not `paths.length`: one git
   * will not diff never gets one. Kept so "everything failed" below can tell
   * itself apart from "there was nothing to do". */
  let attempted = 0
  let done = 0
  let next = 0

  // A worker pool rather than `Promise.all` over the lot: the second is
  // `paths.length` CLIs at once, which on a large change is the machine.
  const worker = async () => {
    for (;;) {
      const relative = paths[next++]
      if (relative === undefined) return

      const answer = await reviewFile(
        request,
        relative,
        paths,
        untracked.has(relative)
      )
      done += 1
      if (answer !== null) {
        attempted += 1
        // One file failing is not the review failing. It is collected and, if
        // every file failed, spoken for below — a run that reviewed 399 files
        // and lost one to a timeout should still hand over the 399.
        if ("error" in answer) errors.push(`${relative}: ${answer.error}`)
        else findings.push(...answer.findings)
      }
      request.onProgress?.(`${done}/${paths.length} · ${relative}`)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(REVIEW_CONCURRENCY, paths.length) }, worker)
  )

  // Only when nothing at all came back, and only then: an error surfaces as a
  // failed review with no comments, so a partial run must not take this path.
  const first = errors[0]
  if (first !== undefined && errors.length === attempted) {
    return { error: first }
  }

  // The pool finishes out of order and the comments are drawn in the order they
  // arrive, so they are put back into the diff's own order here.
  findings.sort(
    (a, b) => a.path.localeCompare(b.path) || a.fromLine - b.fromLine
  )
  return { findings }
}

/**
 * One changed file, reviewed.
 *
 * `null` is "there was nothing to review" — a file git will not diff, binary or
 * gone from the index — which is neither a finding nor a failure and so is
 * neither counted nor reported.
 */
async function reviewFile(
  request: ReviewChangesRequest,
  relative: string,
  all: string[],
  isNew: boolean
): Promise<ReviewChangesResult | null> {
  const patch = await fileDiff(request.cwd, join(request.cwd, relative))
  if (!patch && !isNew) return null

  const prompt = [
    `Review the changes to \`${relative}\`.`,
    "",
    !patch
      ? "This file is new — the whole of it is the change, and there is no patch to show. Read it."
      : patch.length > PATCH_LIMIT
        ? "Its patch is too large to include here. Read the file instead."
        : ["```diff", patch, "```"].join("\n"),
    "",
    ...(all.length > 1
      ? [
          `The same change touches ${all.length} files in all. Read any that bear on this one; comment only on \`${relative}\`.`,
          ...all.map((path) => `- ${path}`),
        ]
      : []),
  ].join("\n")

  const answer = await oneTurn({
    cwd: request.cwd,
    prompt,
    system: REVIEW_PROMPT,
    tools: REVIEW_TOOLS,
    timeoutMs: REVIEW_TIMEOUT_MS,
    model: request.model,
    effort: request.effort,
    configDir: request.configDir,
    disabledTools: request.disabledTools,
    // Which file a tool call belongs to, because up to `REVIEW_CONCURRENCY` of
    // these are interleaving in the one progress list.
    onProgress: (text) => request.onProgress?.(`${relative} · ${text}`),
  })
  if ("error" in answer) return answer

  const found = findingsIn(answer.text)
  if (found === null) {
    return { error: "Claude answered, but not with findings this could read." }
  }
  // A finding about somebody else's file is dropped rather than kept, for the
  // reason `REVIEW_PROMPT` gives the model: that file has a turn of its own, and
  // a remark every turn that could see it is allowed to make is a remark left
  // once per file that imports it.
  return { findings: found.filter((finding) => names(finding.path, relative)) }
}

/** Whether a model's `path` is the file it was asked about. Lenient about the
 * two ways it drifts — a `./` in front, or a separator this platform writes the
 * other way — and about nothing else. */
function names(said: string, relative: string): boolean {
  const tidy = (path: string) => path.replace(/\\/g, "/").replace(/^\.\//, "")
  return tidy(said) === tidy(relative)
}

/**
 * The findings out of an answer, or null when there are none to be had.
 *
 * **Defensive on purpose, and only so far.** A model told to answer with one
 * fenced block usually does, and sometimes puts a sentence in front of it — so
 * the fence is looked for first and the outermost brackets second. What is not
 * done is repair: a finding missing a field, or naming a line that is not a
 * number, is *dropped* rather than guessed at, because the cost of guessing is a
 * comment pinned to the wrong line and the cost of dropping is one remark.
 *
 * Null is "nothing here was JSON at all", which the caller says out loud. An
 * empty array is a real answer — the change is sound — and reads as one.
 *
 * Pure, and checked in `test/review.ts`.
 */
export function findingsIn(text: string): ReviewFinding[] | null {
  const fenced = /```(?:json)?\s*([[{][\s\S]*?)```/.exec(text)
  const source = fenced?.[1] ?? bracketed(text)
  if (source === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

  return parsed.flatMap((entry) => {
    const found = asFinding(entry)
    return found ? [found] : []
  })
}

/** The outermost `[…]`, for an answer that came back without a fence. */
function bracketed(text: string): string | null {
  const from = text.indexOf("[")
  const to = text.lastIndexOf("]")
  return from === -1 || to <= from ? null : text.slice(from, to + 1)
}

/** One entry, if it is one. Everything is checked because none of it was typed
 * by anybody — this is a model's output being let into the review. */
function asFinding(entry: unknown): ReviewFinding | null {
  if (typeof entry !== "object" || entry === null) return null
  const row = entry as Record<string, unknown>

  const path = typeof row.path === "string" ? row.path.trim() : ""
  const body = typeof row.body === "string" ? row.body.trim() : ""
  const from = Number(row.fromLine)
  const to = Number(row.toLine)
  if (!path || !body) return null
  if (!Number.isInteger(from) || from < 1) return null

  // A `toLine` that is missing, not a number, or above its start reads as a
  // one-line finding rather than as a reason to drop the remark.
  const end = Number.isInteger(to) && to >= from ? to : from
  return { path, fromLine: from, toLine: end, body, severity: severityOf(row) }
}

/**
 * The severity a finding claimed, if it claimed one this can read.
 *
 * Lenient about **case and whitespace only** — `"High"` and `" high "` are the
 * same word typed by a model that was not paying attention, and refusing them
 * would drop the label off a real finding. Nothing else is mapped: `"warning"`,
 * `"P2"` and `"moderate"` come back undefined and the comment is drawn without
 * a label, which is the same rule `asFinding` follows for a line number that is
 * not a number. Guessing a middle here would be worse than saying nothing,
 * because a `medium` nobody chose is indistinguishable from one the model did.
 */
function severityOf(row: Record<string, unknown>): ReviewSeverity | undefined {
  const said =
    typeof row.severity === "string" ? row.severity.trim().toLowerCase() : ""
  return REVIEW_SEVERITY_IDS.find((id) => id === said)
}
