import { createReadStream } from "node:fs"
import { open, readdir, stat } from "node:fs/promises"
import { watch, type FSWatcher } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import { StringDecoder } from "node:string_decoder"

import type {
  ClaudePermissionMode,
  TranscriptBlock,
  TranscriptEntry,
  TranscriptEvent,
  TranscriptSessionSummary,
  TranscriptUsage,
} from "../shared/api"

/**
 * The chat view of a `claude` session: the CLI's own on-disk transcript,
 * tailed as it is written.
 *
 * There is exactly one `claude` process per session and it is the interactive
 * TUI in a pty (`terminal.ts`). This file does not start anything — it reads.
 * That is the whole point of the design: the chat and the terminal are two
 * ways of drawing one conversation, so neither can drift from the other and
 * toggling between them costs nothing.
 *
 * Why a file rather than a stream: the CLI offers no way to attach a second
 * reader to a session already running. `--output-format stream-json` exists
 * only for a process you spawn yourself, which is what this app used to do —
 * a second `claude`, with a conversation of its own. Reading the transcript
 * is what makes the chat a view of the *running* session instead of a rival
 * to it.
 *
 * What that costs, and it is worth being honest about it:
 *
 *  - **Granularity is the message, not the token.** The CLI appends a line
 *    when a message is complete, so a long reply appears whole rather than
 *    being typed out. There is no `--include-partial-messages` for a file.
 *  - **Permission prompts stay in the TUI.** They are answered at the CLI's
 *    own prompt, by the user, in the terminal view.
 *  - **A question is invisible until it is answered.** The CLI holds an
 *    `AskUserQuestion` back and writes the call and its answer together, so
 *    for the whole time the terminal is showing one, this file has nothing to
 *    report — the chat shows a spinner, and the terminal view is where the
 *    question actually is. A `PreToolUse` hook would close that window; it is
 *    deliberately not taken, since it would make this app a writer of the
 *    CLI's configuration rather than a reader of what it already writes.
 *
 * The session is found by id rather than by guessing at the newest file:
 * `terminal.ts` starts every `claude` session with `--session-id <uuid>`, and
 * the CLI names the transcript after it. Two tabs open on one project
 * therefore mirror their own conversations rather than both racing for
 * whichever file was touched last.
 *
 * One thing this cannot follow: `/clear` at the TUI's prompt starts a new
 * session id, so the pinned file simply stops growing. The sessions drawer is
 * the way back — it lists every conversation in the directory, and picking
 * one re-points the mirror.
 */

/** How often the file is checked regardless of what the watcher reported.
 *
 * `fs.watch` is the fast path, not the reliable one: it misses writes on
 * network and virtualised filesystems, and reports directory changes
 * differently on each platform. A `stat` this often costs nothing and is what
 * keeps a live conversation from stalling on a platform whose watcher stayed
 * quiet. */
const POLL_MS = 1000

/** Long enough that the burst of events one appended line produces is read
 * once, short enough not to be felt as lag. */
const DEBOUNCE_MS = 60

type Mirror = {
  file: string
  /** Bytes already turned into entries — where the next read starts. */
  offset: number
  /** A trailing partial line, held until the rest of it is written. The CLI
   * appends whole lines, but a read can still land mid-write. */
  pending: string
  /** Holds a multi-byte character split across two reads. */
  decoder: StringDecoder
  watcher: FSWatcher | null
  poll: NodeJS.Timeout | null
  debounce: NodeJS.Timeout | null
  /** Reads are serialised: a change arriving mid-read sets `again` rather
   * than starting a second pass over the same bytes. */
  reading: boolean
  again: boolean
  /** Whether the agent still owes a reply, carried between reads: a batch
   * that says nothing about the turn leaves it as it was. */
  working: boolean
  /** The mode of the last turn the CLI recorded, carried the same way. */
  permissionMode: ClaudePermissionMode | null
  /** The conversation's running totals, since a batch only ever carries what
   * the requests in it spent. */
  usage: TranscriptUsage | null
}

export class TranscriptMirrors {
  private readonly mirrors = new Map<string, Mirror>()

  constructor(private readonly emit: (event: TranscriptEvent) => void) {}

  /**
   * Starts mirroring one session's transcript into `mirrorId`'s events.
   *
   * The file does not exist until the CLI writes its first line, which is why
   * the directory is what gets watched: a session that has just started is the
   * normal case, not an error.
   */
  async watch(
    mirrorId: string,
    cwd: string,
    claudeSessionId: string
  ): Promise<void> {
    this.unwatch(mirrorId)

    const dir = projectSessionsDir(cwd)
    const mirror: Mirror = {
      file: path.join(dir, `${claudeSessionId}.jsonl`),
      offset: 0,
      pending: "",
      decoder: new StringDecoder("utf8"),
      watcher: null,
      poll: null,
      debounce: null,
      reading: false,
      again: false,
      working: false,
      permissionMode: null,
      usage: null,
    }
    this.mirrors.set(mirrorId, mirror)

    // Whatever is already there, as one replacement rather than a stream of
    // appends — this is also what a re-point from the sessions drawer sends.
    this.emit({
      mirrorId,
      type: "reset",
      entries: [],
      working: false,
      permissionMode: null,
      usage: null,
    })

    try {
      mirror.watcher = watch(dir, { persistent: false }, () => {
        if (mirror.debounce) clearTimeout(mirror.debounce)
        mirror.debounce = setTimeout(
          () => void this.pump(mirrorId),
          DEBOUNCE_MS
        )
      })
    } catch {
      // No directory yet: nothing has ever been run here. The poll below picks
      // the file up once the CLI creates it, so this is not worth reporting.
    }

    mirror.poll = setInterval(() => void this.pump(mirrorId), POLL_MS)
    await this.pump(mirrorId)
  }

  unwatch(mirrorId: string): void {
    const mirror = this.mirrors.get(mirrorId)
    if (!mirror) return
    this.mirrors.delete(mirrorId)
    mirror.watcher?.close()
    if (mirror.poll) clearInterval(mirror.poll)
    if (mirror.debounce) clearTimeout(mirror.debounce)
  }

  stopAll(): void {
    for (const mirrorId of [...this.mirrors.keys()]) this.unwatch(mirrorId)
  }

  /** Reads whatever has been appended, one pass at a time. */
  private async pump(mirrorId: string): Promise<void> {
    const mirror = this.mirrors.get(mirrorId)
    if (!mirror) return

    if (mirror.reading) {
      mirror.again = true
      return
    }

    mirror.reading = true
    try {
      do {
        mirror.again = false
        await this.drain(mirrorId, mirror)
      } while (mirror.again && this.mirrors.has(mirrorId))
    } finally {
      mirror.reading = false
    }
  }

  private async drain(mirrorId: string, mirror: Mirror): Promise<void> {
    let size: number
    try {
      size = (await stat(mirror.file)).size
    } catch {
      // The session has not written anything yet.
      return
    }

    // Smaller than what has already been read means this is not the same file
    // any more — the CLI rewrote it, or the conversation was re-pointed. The
    // honest response is to start over rather than to splice new bytes onto a
    // transcript they did not come from.
    if (size < mirror.offset) {
      mirror.offset = 0
      mirror.pending = ""
      mirror.decoder = new StringDecoder("utf8")
      mirror.working = false
      mirror.permissionMode = null
      mirror.usage = null
      this.emit({
        mirrorId,
        type: "reset",
        entries: [],
        working: false,
        permissionMode: null,
        usage: null,
      })
    }

    if (size === mirror.offset) return

    const length = size - mirror.offset
    const buffer = Buffer.allocUnsafe(length)
    let read: number
    try {
      const handle = await open(mirror.file, "r")
      try {
        ;({ bytesRead: read } = await handle.read(
          buffer,
          0,
          length,
          mirror.offset
        ))
      } finally {
        await handle.close()
      }
    } catch {
      // Rotated or removed between the stat above and the open — the next
      // pass sees the new state.
      return
    }

    mirror.offset += read

    const text = mirror.pending + mirror.decoder.write(buffer.subarray(0, read))
    const lines = text.split("\n")
    // The last piece is only a whole line if the chunk ended on a newline;
    // otherwise it is the start of one still being written.
    mirror.pending = lines.pop() ?? ""

    const { entries, working, permissionMode, spent } = interpret(lines)
    if (working !== null) mirror.working = working
    if (permissionMode !== null) mirror.permissionMode = permissionMode
    if (spent !== null) mirror.usage = accumulate(mirror.usage, spent)

    // Lines the CLI keeps for itself — sidechains, meta turns, `ai-title` —
    // are real appends that yield nothing to draw. A batch that changed the
    // turn or the mode still has to go out, though: neither carries an entry
    // of its own, and a mode cycled at the prompt is exactly such a line.
    if (
      entries.length > 0 ||
      working !== null ||
      permissionMode !== null ||
      spent !== null
    ) {
      this.emit({
        mirrorId,
        type: "append",
        entries,
        working: mirror.working,
        permissionMode: mirror.permissionMode,
        usage: mirror.usage,
      })
    }
  }
}

/**
 * Whether `sessionId` already has a transcript in `cwd`.
 *
 * What decides between `--session-id` and `--resume` when a session starts:
 * the CLI refuses the first for an id it has already used, and the second for
 * one it has never seen. Asked of the file rather than remembered, because a
 * session this app minted an id for may have died before the CLI wrote
 * anything — leaving an id that is new as far as the CLI is concerned.
 */
export async function hasTranscript(
  cwd: string,
  sessionId: string
): Promise<boolean> {
  try {
    await stat(path.join(projectSessionsDir(cwd), `${sessionId}.jsonl`))
    return true
  } catch {
    return false
  }
}

/**
 * Past conversations the CLI has on disk for `cwd`, most recent first.
 *
 * Not sessions this app started, necessarily — any `claude` run from that
 * directory, this app or a terminal, writes to the same place. There is no
 * CLI command that lists them, so this reads the directory `--resume` itself
 * reads from.
 */
export async function listSessions(
  cwd: string
): Promise<TranscriptSessionSummary[]> {
  const dir = projectSessionsDir(cwd)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    // No directory yet: nothing has ever been run here.
    return []
  }

  const summaries: TranscriptSessionSummary[] = []
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue
    const file = path.join(dir, name)
    let updatedAt: number
    try {
      updatedAt = (await stat(file)).mtimeMs
    } catch {
      continue
    }
    summaries.push({
      id: name.slice(0, -".jsonl".length),
      title: await sessionTitle(file),
      updatedAt,
    })
  }

  summaries.sort((a, b) => b.updatedAt - a.updatedAt)
  return summaries
}

/**
 * One line of the CLI's own on-disk transcript.
 *
 * A superset of the stream-json vocabulary: `isSidechain` and `isMeta` never
 * appear on the wire, only in what the CLI keeps on disk.
 */
type TranscriptLine = {
  type?: string
  /** Carried by a `permission-mode` record, and nothing else. */
  permissionMode?: ClaudePermissionMode
  message?: {
    model?: string
    content?: RawBlock[] | string
    /** Why the assistant stopped. `tool_use` is the one value that means the
     * turn is not over — see `interpret`. */
    stop_reason?: string | null
    usage?: RawUsage
  }
  /** A subagent's own conversation (a `Task` tool call's inner turns), not
   * part of what the person sees. */
  isSidechain?: boolean
  /** Housekeeping the CLI records as a `user` turn for its own bookkeeping —
   * a slash command's own stdout, not something a person sent. */
  isMeta?: boolean
}

/**
 * The token counts the CLI copies onto an assistant line from the API response
 * that produced it.
 *
 * Every field is optional on purpose: this is another process's record, and a
 * count that is missing should cost that one number rather than the whole
 * readout. `server_tool_use`, `service_tier` and the rest of what the CLI
 * writes here are ignored — nothing draws them.
 */
type RawUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/** What one batch of lines spent, before it is folded into the running total.
 * The token counts are sums; `contextTokens` and `model` are levels, taken
 * from the last request in the batch. */
type Spend = {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  contextTokens: number
  model: string | null
}

/** The subset of the CLI's message vocabulary this app reads. */
type RawBlock = {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

/**
 * Transcript lines as the entries the pane draws.
 *
 * Deliberately this app's own vocabulary rather than the CLI's records passed
 * through: that format grows fields with every CLI release, and translating it
 * in exactly one place is what keeps a version bump from reaching the
 * components. A line this does not recognise is ignored, so a newer CLI adds
 * nothing the renderer must handle.
 */
function interpret(lines: string[]): {
  entries: TranscriptEntry[]
  /** The turn state after these lines, or null when none of them said
   * anything about it. */
  working: boolean | null
  /** The mode after these lines, or null when none of them said. */
  permissionMode: ClaudePermissionMode | null
  /** What these lines spent, or null when none of them carried a usage. */
  spent: Spend | null
} {
  const entries: TranscriptEntry[] = []
  let working: boolean | null = null
  let permissionMode: ClaudePermissionMode | null = null
  let spent: Spend | null = null

  for (const line of lines) {
    if (line.trim() === "") continue

    let record: TranscriptLine
    try {
      record = JSON.parse(line) as TranscriptLine
    } catch {
      continue
    }

    // Written as each prompt is submitted, recording the mode that turn ran
    // under — not when the mode is changed. Authoritative, and a turn behind.
    if (record.type === "permission-mode") {
      if (record.permissionMode) permissionMode = record.permissionMode
      continue
    }

    // A subagent's own back-and-forth (`Task` tool calls), never part of the
    // conversation the pane draws.
    if (record.isSidechain) continue

    if (record.type === "user") {
      // Housekeeping the CLI inserts for itself — a command's own stdout
      // wrapped in a fake turn, not something a person sent or saw.
      if (record.isMeta) continue

      // Both a real message and a tool result put the turn back on the
      // agent: it is now the one that owes something.
      working = true

      const toolResults = contentOf(record).filter(
        (block) => block.type === "tool_result"
      )
      if (toolResults.length > 0) {
        for (const block of toolResults) {
          entries.push({
            type: "tool-result",
            toolUseId: block.tool_use_id ?? "",
            text: flatten(block.content),
            isError: block.is_error === true,
          })
        }
        continue
      }

      const text = userText(record.message?.content)
      if (text) entries.push({ type: "user", text })
      continue
    }

    if (record.type === "assistant") {
      // The CLI's own account of whether it is finished, which is the only
      // one a reader of the file gets. `tool_use` means another message is
      // coming; `end_turn`, `stop_sequence`, `max_tokens` and an interrupted
      // turn's empty reason all mean it has stopped.
      working = record.message?.stop_reason === "tool_use"

      spent = spend(spent, record)

      const blocks = contentOf(record).flatMap(assistantBlock)
      if (blocks.length > 0) entries.push({ type: "assistant", blocks })
    }
  }

  return { entries, working, permissionMode, spent }
}

/**
 * One assistant line's tokens, added to what the batch has spent so far.
 *
 * `<synthetic>` is skipped: the CLI writes an assistant line under that model
 * for its own messages — an API error it is reporting, a turn it interrupted —
 * with no request behind it. Its usage is zeros, so including it would cost
 * nothing but it would still put `<synthetic>` on screen as the model that
 * answered.
 */
function spend(soFar: Spend | null, record: TranscriptLine): Spend | null {
  const model = record.message?.model
  const usage = record.message?.usage
  if (!usage || model === "<synthetic>") return soFar

  const input = usage.input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheCreation = usage.cache_creation_input_tokens ?? 0

  return {
    input: (soFar?.input ?? 0) + input,
    output: (soFar?.output ?? 0) + (usage.output_tokens ?? 0),
    cacheRead: (soFar?.cacheRead ?? 0) + cacheRead,
    cacheCreation: (soFar?.cacheCreation ?? 0) + cacheCreation,
    // Everything the request carried, cached or not — which is what the
    // context window is filled with. The output is not part of it: it becomes
    // context for the *next* request, and that one reports its own.
    contextTokens: input + cacheRead + cacheCreation,
    model: model ?? soFar?.model ?? null,
  }
}

/** The running total after a batch. */
function accumulate(
  total: TranscriptUsage | null,
  spent: Spend
): TranscriptUsage {
  return {
    contextTokens: spent.contextTokens,
    inputTokens: (total?.inputTokens ?? 0) + spent.input,
    outputTokens: (total?.outputTokens ?? 0) + spent.output,
    cacheReadTokens: (total?.cacheReadTokens ?? 0) + spent.cacheRead,
    cacheCreationTokens:
      (total?.cacheCreationTokens ?? 0) + spent.cacheCreation,
    model: spent.model ?? total?.model ?? null,
  }
}

function contentOf(record: TranscriptLine): RawBlock[] {
  const content = record.message?.content
  return Array.isArray(content) ? content : []
}

function assistantBlock(block: RawBlock): TranscriptBlock[] {
  switch (block.type) {
    case "text":
      return block.text ? [{ type: "text", text: block.text }] : []
    case "thinking":
      return block.thinking ? [{ type: "thinking", text: block.thinking }] : []
    case "tool_use":
      return [
        {
          type: "tool-use",
          toolUseId: block.id ?? "",
          name: block.name ?? "unknown tool",
          input: block.input,
        },
      ]
    default:
      return []
  }
}

/**
 * A tool result as text.
 *
 * The CLI records a bare string for most tools and a block list for the ones
 * that can return more than text; either way the pane shows it as output.
 */
function flatten(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block: RawBlock) =>
      block.type === "text" ? (block.text ?? "") : `[${block.type ?? "block"}]`
    )
    .join("\n")
}

/**
 * Where the CLI keeps `cwd`'s transcripts — the same folder `--resume`
 * itself reads from.
 *
 * There is no command that answers this, so it is derived the way the CLI's
 * own naming turns out to work, confirmed against a real `~/.claude/projects`:
 * every character outside `[A-Za-z0-9]` in the absolute path becomes a dash.
 *
 * `CLAUDE_CONFIG_DIR` moves the whole tree, so a user who sets it would
 * otherwise get a chat view that never fills in. It is only read from this
 * process's own environment, which means it is honoured when the app was
 * launched from a shell that had it and not when it was launched from the
 * Dock with the variable set in a shell profile — the pty gets its
 * environment from a login shell (`shell-env.ts`), and this side does not.
 */
function projectSessionsDir(cwd: string): string {
  const root = process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude")
  return path.join(root, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"))
}

/** The text of a real user turn — a plain string for older transcripts, or
 * an array with the text blocks broken out, for newer ones. */
function userText(content: RawBlock[] | string | undefined): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
}

/**
 * A slash command as the line it was invoked as.
 *
 * The CLI stores one as pseudo-tags rather than as the person typed it (the
 * renderer's `lib/terminal/slash-command.ts` unwraps the same thing for the
 * transcript, at more length). Only the title needs it here — a session whose
 * first message was a command would otherwise be listed in the drawer as
 * `<command-name>/model</command-name> <command-message>…`.
 */
function unwrapCommand(text: string): string {
  const name = /<command-name>([^<]*)<\/command-name>/.exec(text)
  if (!name) return text
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)
  return `${name[1]?.trim() ?? ""} ${args?.[1]?.trim() ?? ""}`
}

function clampTitle(text: string): string {
  const oneLine = unwrapCommand(text).replace(/\s+/g, " ").trim()
  return oneLine.length > 80 ? `${oneLine.slice(0, 79)}…` : oneLine
}

/**
 * A human title for one session, read only as far as it has to be.
 *
 * The CLI writes its own generated title as an `ai-title` line once the
 * conversation has enough in it — that wins when present. Until then, or if
 * it never does for a short session, the first real message stands in.
 */
async function sessionTitle(file: string): Promise<string> {
  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })

  let fallback: string | null = null
  try {
    for await (const line of rl) {
      if (line.includes('"type":"ai-title"')) {
        const record = JSON.parse(line) as { aiTitle?: string }
        if (record.aiTitle) return record.aiTitle
        continue
      }

      if (fallback !== null || !line.includes('"type":"user"')) continue
      const record = JSON.parse(line) as TranscriptLine
      if (record.isMeta || record.isSidechain) continue
      const text = userText(record.message?.content)
      if (text) fallback = text
    }
  } finally {
    rl.close()
  }

  return fallback ? clampTitle(fallback) : "Untitled session"
}
