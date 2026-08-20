import {
  appendFile,
  mkdir,
  mkdtemp,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { TranscriptEntry } from "../src/shared/api"
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
const root = await mkdtemp(path.join(tmpdir(), "tabomni-transcript-"))
process.env.CLAUDE_CONFIG_DIR = path.join(root, "config")

const { TranscriptMirrors } = await import("../src/main/transcript")

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

  // A record this app has no use for — the CLI writes one of these whenever
  // the permission mode is cycled — must be ignored rather than drawn: a newer
  // CLI's own bookkeeping is not part of the conversation.
  await appendFile(
    liveFile,
    `${JSON.stringify({ type: "permission-mode", permissionMode: "plan" })}\n`,
    "utf8"
  )
  await new Promise((resolve) => setTimeout(resolve, 300))
  const afterMode = current().length
  check("a record this app ignores draws nothing", afterMode === 5, afterMode)

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
