import {
  appendFile,
  mkdir,
  mkdtemp,
  rm,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { TranscriptEntry, TranscriptUsage } from "../src/shared/api"
import { check, finish, section } from "./harness"

/**
 * The chat view reads a file the CLI is still writing to, which is the whole
 * of what can go wrong here: a read that lands mid-line, a multi-byte
 * character split across two reads, a file replaced under the watcher. None of
 * those are reachable by writing a whole transcript and parsing it once, so
 * this drives the real `TranscriptMirrors` against a real file and appends to
 * it the way the CLI does.
 *
 * `CLAUDE_CONFIG_DIR` is what keeps it out of the user's own `~/.claude` — the
 * same variable the CLI itself honours, set before anything reads it.
 */
const root = await mkdtemp(path.join(tmpdir(), "tabula-transcript-"))
process.env.CLAUDE_CONFIG_DIR = path.join(root, "config")

const { TranscriptMirrors, listSessions } =
  await import("../src/main/transcript")

/** A project directory whose encoded name the transcript folder is derived
 * from — the same mapping `projectSessionsDir` does. */
const cwd = path.join(root, "work")
const sessionsDir = path.join(
  process.env.CLAUDE_CONFIG_DIR,
  "projects",
  cwd.replace(/[^a-zA-Z0-9]/g, "-")
)

const userLine = (text: string) =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  })

/** `stop_reason` is what says whether the turn is over, so every assistant
 * line here carries the one a real transcript would. */
const assistantText = (text: string, stop = "end_turn") =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text }], stop_reason: stop },
  })

/** An assistant line carrying the token counts the CLI copies from the API
 * response — the shape the usage bar is read out of. */
const assistantUsage = (
  text: string,
  usage: {
    input?: number
    output?: number
    cacheRead?: number
    cacheCreation?: number
  },
  model = "claude-opus-5"
) =>
  JSON.stringify({
    type: "assistant",
    message: {
      model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: usage.input ?? 0,
        output_tokens: usage.output ?? 0,
        cache_read_input_tokens: usage.cacheRead ?? 0,
        cache_creation_input_tokens: usage.cacheCreation ?? 0,
      },
    },
  })

const toolUse = (id: string, name: string, input: unknown) =>
  JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id, name, input }],
      stop_reason: "tool_use",
    },
  })

const toolResult = (id: string, content: unknown, isError = false) =>
  JSON.stringify({
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: id, content, is_error: isError },
      ],
    },
  })

/** Waits for something the mirror does on its own schedule. Polls rather than
 * sleeping a fixed time: the watcher is usually immediate and the fallback
 * poll is a second behind it, and a test should take the first of those. */
async function waitFor(
  label: string,
  predicate: () => boolean,
  timeoutMs = 5000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  console.log(`       timed out waiting for ${label}`)
  return false
}

try {
  await mkdir(sessionsDir, { recursive: true })

  // ---------------------------------------------------------------------
  section("reading a transcript")

  type Event = {
    mirrorId: string
    type: string
    entries: TranscriptEntry[]
    working: boolean
    permissionMode: string | null
    usage: TranscriptUsage | null
  }
  const events: Event[] = []
  const mirrors = new TranscriptMirrors((event) =>
    events.push(event as unknown as Event)
  )

  /** Every entry the mirror has reported since the last `reset`. */
  function current(): TranscriptEntry[] {
    const entries: TranscriptEntry[] = []
    for (const event of events) {
      if (event.type === "reset") entries.length = 0
      entries.push(...event.entries)
    }
    return entries
  }

  /** The turn state as of the last event that carried one. */
  function working(): boolean {
    return events.at(-1)?.working ?? false
  }

  /** The mode as of the last event, which is what the composer follows. */
  function mode(): string | null {
    return events.at(-1)?.permissionMode ?? null
  }

  /** The running total as of the last event, which is what the usage bar
   * draws — every event carries it whole, not as a delta. */
  function usage(): TranscriptUsage | null {
    return events.at(-1)?.usage ?? null
  }

  const historyFile = path.join(sessionsDir, "history-session.jsonl")
  await writeFile(
    historyFile,
    [
      userLine("hello"),
      assistantText("hi there"),
      toolUse("t1", "Bash", { command: "ls" }),
      toolResult("t1", "a\nb"),
      // The CLI's own bookkeeping, never part of what the person saw.
      JSON.stringify({
        type: "user",
        isMeta: true,
        message: { content: "noise" },
      }),
      JSON.stringify({
        type: "assistant",
        isSidechain: true,
        message: { content: [{ type: "text", text: "subagent" }] },
      }),
      "",
    ].join("\n"),
    "utf8"
  )

  await mirrors.watch("tab-0", cwd, "history-session")
  await waitFor("the existing transcript", () => current().length === 4)

  const history = current()
  check("skips meta and sidechain records", history.length === 4, history)
  check(
    "reads a user turn",
    history[0]?.type === "user" && history[0].text === "hello",
    history[0]
  )
  check(
    "reads an assistant turn",
    history[1]?.type === "assistant" &&
      history[1].blocks[0]?.type === "text" &&
      history[1].blocks[0].text === "hi there",
    history[1]
  )
  check(
    "reads a tool call",
    history[2]?.type === "assistant" &&
      history[2].blocks[0]?.type === "tool-use" &&
      history[2].blocks[0].name === "Bash",
    history[2]
  )
  check(
    "reads a tool result as its own entry",
    history[3]?.type === "tool-result" &&
      history[3].toolUseId === "t1" &&
      history[3].text === "a\nb",
    history[3]
  )
  // The transcript ends on a tool result, so the agent still owes a reply.
  check("a turn left mid-flight reads as working", working() === true)

  mirrors.unwatch("tab-0")
  events.length = 0

  // ---------------------------------------------------------------------
  section("listSessions")

  const titledFile = path.join(sessionsDir, "titled-session.jsonl")
  await writeFile(
    titledFile,
    [
      userLine("the first thing asked"),
      JSON.stringify({ type: "ai-title", aiTitle: "A generated title" }),
      "",
    ].join("\n"),
    "utf8"
  )

  // Ordering is by mtime, so it has to be set rather than assumed from the
  // order the files happened to be written in.
  await utimes(historyFile, new Date(1000), new Date(1000))
  await utimes(titledFile, new Date(2000), new Date(2000))

  const sessions = await listSessions(cwd)
  check("lists every transcript", sessions.length === 2, sessions)
  check(
    "most recently written first",
    sessions[0]?.id === "titled-session",
    sessions.map((entry) => entry.id)
  )
  check(
    "prefers the CLI's own generated title",
    sessions[0]?.title === "A generated title",
    sessions[0]
  )
  check(
    "falls back to the first message",
    sessions[1]?.title === "hello",
    sessions[1]
  )
  check(
    "a directory that does not exist lists nothing",
    (await listSessions(path.join(root, "never-used"))).length === 0
  )
  check(
    "a session with no file lists nothing rather than failing",
    (await listSessions(path.join(root, "gone"))).length === 0
  )

  // ---------------------------------------------------------------------
  section("usage")

  const usageFile = path.join(sessionsDir, "usage-session.jsonl")
  await writeFile(usageFile, `${userLine("start")}\n`, "utf8")

  await mirrors.watch("tab-usage", cwd, "usage-session")
  await waitFor("the opening line", () => current().length === 1)
  check(
    "a conversation with no reply yet reports no usage",
    usage() === null,
    usage()
  )

  await appendFile(
    usageFile,
    `${assistantUsage("first", {
      input: 10,
      output: 100,
      cacheRead: 4000,
      cacheCreation: 500,
    })}\n`,
    "utf8"
  )
  await waitFor("the first usage", () => usage() !== null)
  check(
    "context is everything the request carried, cached or not",
    usage()?.contextTokens === 4510,
    usage()
  )
  check(
    "the model that answered is reported",
    usage()?.model === "claude-opus-5"
  )

  await appendFile(
    usageFile,
    `${assistantUsage("second", {
      input: 5,
      output: 200,
      cacheRead: 4600,
      cacheCreation: 300,
    })}\n`,
    "utf8"
  )
  await waitFor("the second usage", () => usage()?.outputTokens === 300)
  // Tokens are the conversation's, so they are summed; context is the last
  // request's, so it is replaced. Getting that backwards is what would make a
  // context bar climb past the window and never come down.
  check(
    "token totals are summed across requests",
    usage()?.inputTokens === 15 &&
      usage()?.outputTokens === 300 &&
      usage()?.cacheReadTokens === 8600 &&
      usage()?.cacheCreationTokens === 800,
    usage()
  )
  check(
    "context is the last request's, not a sum",
    usage()?.contextTokens === 4905,
    usage()
  )

  // What a compaction looks like from here: the next request carries far less
  // than the one before it, and the bar has to follow it down.
  await appendFile(
    usageFile,
    `${assistantUsage("after compaction", {
      input: 2,
      output: 50,
      cacheRead: 900,
      cacheCreation: 100,
    })}\n`,
    "utf8"
  )
  await waitFor("the compacted request", () => usage()?.contextTokens === 1002)
  check(
    "a compaction brings the context back down",
    usage()?.contextTokens === 1002 && usage()?.outputTokens === 350,
    usage()
  )

  // The CLI writes one of these for its own messages — an API error, an
  // interrupted turn — with no request behind it. Counting it costs nothing,
  // but it would put `<synthetic>` on screen as the model that answered.
  await appendFile(
    usageFile,
    `${assistantUsage("interrupted", {}, "<synthetic>")}\n`,
    "utf8"
  )
  await waitFor("the synthetic line", () => current().length === 5)
  check(
    "a synthetic message leaves the model alone",
    usage()?.model === "claude-opus-5" && usage()?.contextTokens === 1002,
    usage()
  )

  mirrors.unwatch("tab-usage")
  events.length = 0

  // ---------------------------------------------------------------------
  section("tailing a live transcript")

  const liveFile = path.join(sessionsDir, "live-session.jsonl")

  await mirrors.watch("tab-1", cwd, "live-session")
  check(
    "a session with nothing written yet starts empty",
    events.length === 1 && events[0]?.type === "reset",
    events
  )

  await appendFile(liveFile, `${userLine("first")}\n`, "utf8")
  await waitFor("the first line", () => current().length === 1)
  check("picks up a line appended after watching began", current().length === 1)

  // The case the pane used to get wrong: the agent has been asked something
  // and has written nothing back yet. There is no tool call to infer a turn
  // from, and the reply being "still being written" is exactly what the
  // spinner is for.
  check("a question with no reply yet reads as working", working() === true)

  await appendFile(
    liveFile,
    `${assistantText("second")}\n${toolUse("t9", "Read", { file: "x" })}\n`,
    "utf8"
  )
  await waitFor("two more lines", () => current().length === 3)
  check("picks up a batch of lines", current().length === 3)

  check("a turn that called a tool is still working", working() === true)

  await appendFile(liveFile, `${toolResult("t9", "done")}\n`, "utf8")
  await waitFor("the tool result", () => current().length === 4)
  // A finished tool says nothing about whether the agent is done — it now
  // owes a reply to the result, which is why the shape of the last entry was
  // never a sound thing to read this off.
  check("a finished tool leaves the turn running", working() === true)

  await appendFile(liveFile, `${assistantText("all done")}\n`, "utf8")
  await waitFor("the closing message", () => working() === false)
  check("an end_turn reply ends the turn", working() === false)

  // Shift+Tab at the CLI's own prompt writes one of these and nothing else —
  // no entry to draw, which is why an empty batch still has to be reported.
  check("no mode reported until the CLI writes one", mode() === null)
  await appendFile(
    liveFile,
    `${JSON.stringify({ type: "permission-mode", permissionMode: "plan" })}\n`,
    "utf8"
  )
  await waitFor("the mode change", () => mode() === "plan")
  check("a mode cycled at the prompt is reported", mode() === "plan")

  const beforeMode = current().length
  check("a mode record draws nothing of its own", beforeMode === 5, beforeMode)

  // A read landing mid-write is the case a naive tail gets wrong: the half
  // line must be held, not parsed and dropped.
  const wholeLine = `${assistantText("split across two writes")}\n`
  await appendFile(liveFile, wholeLine.slice(0, 20), "utf8")
  await new Promise((resolve) => setTimeout(resolve, 300))
  check(
    "a half-written line yields nothing yet",
    current().length === 5,
    current().length
  )

  await appendFile(liveFile, wholeLine.slice(20), "utf8")
  await waitFor("the completed line", () => current().length === 6)
  check("the line arrives once it is whole", current().length === 6)

  // The same again, but splitting a multi-byte character down the middle —
  // decoded per read, the two halves would each become a replacement
  // character and the JSON would no longer parse.
  const multibyte = Buffer.from(`${userLine("naïve — 日本語")}\n`, "utf8")
  const cut = multibyte.indexOf(Buffer.from("日", "utf8")) + 1
  await appendFile(liveFile, multibyte.subarray(0, cut))
  await new Promise((resolve) => setTimeout(resolve, 300))
  await appendFile(liveFile, multibyte.subarray(cut))
  await waitFor("the multi-byte line", () => current().length === 7)

  const entries = current()
  const last = entries.at(-1) as { type: string; text: string } | undefined
  check(
    "a character split across two reads survives",
    last?.type === "user" && last.text === "naïve — 日本語",
    last
  )

  // Shorter than what has been read means it is not the same conversation any
  // more, and splicing new bytes onto the old transcript would invent one.
  const resets = events.filter((event) => event.type === "reset").length
  await truncate(liveFile, 0)
  await appendFile(liveFile, `${userLine("started over")}\n`, "utf8")
  await waitFor(
    "a reset after truncation",
    () => events.filter((event) => event.type === "reset").length > resets
  )
  await waitFor("the replacement line", () => current().length === 1)
  const afterReset = current().at(-1) as { text: string } | undefined
  check(
    "a truncated file starts the transcript over",
    current().length === 1 && afterReset?.text === "started over",
    current()
  )

  mirrors.stopAll()
  const settled = events.length
  await appendFile(liveFile, `${userLine("ignored")}\n`, "utf8")
  await new Promise((resolve) => setTimeout(resolve, 400))
  check("stopAll stops reporting", events.length === settled)
} finally {
  await rm(root, { recursive: true, force: true })
}

finish()
