import { spawn, type ChildProcess } from "node:child_process"

import type { AssistantMessage } from "../shared/api"
import { claudeBinary } from "./claude-bin"
import { environment, locate } from "./shell-env"

/**
 * Running one turn of `claude -p`, and reading its event stream.
 *
 * Apart from `worktree-chat.ts`, its one caller, because the part worth having
 * on its own is the **parsing**: `--output-format stream-json` is the CLI's own
 * shape, it changes between versions, and a reader of it tangled into a store
 * and a session id is one nobody wants to re-read when it moves. It was shared
 * with the workspace assistant until that panel was removed, and the split is
 * worth keeping for the same reason it was worth making.
 *
 * What is *not* here is policy. Which tools a turn may use, where it runs and
 * what it is told about itself are the caller's, passed in.
 *
 * A turn is a process. There is nothing to reattach to and no way to interrupt
 * one except a kill, which is the cost of print mode over a pty.
 */

/** What a turn is: the prompt, where it runs, and what it is allowed to do. */
export type PrintTurn = {
  /** The directory the CLI runs in. Must exist — the CLI refuses otherwise. */
  cwd: string
  prompt: string
  /**
   * The CLI session this turn belongs to.
   *
   * Passed as `--session-id` the first time and `--resume` afterwards, which is
   * what makes a second turn a continuation rather than a fresh conversation.
   * The caller owns the id and owns knowing which of the two it is.
   */
  sessionId: string
  resume: boolean
  /**
   * `--model`, as an alias the CLI resolves (`opus`, `sonnet`).
   *
   * Left unset for whichever model the user's own `claude` is on, which is not
   * the same as naming today's default here: their choice is a setting of
   * theirs, and this app overriding it silently would be this app deciding.
   */
  model?: string | null
  /** `--effort`. Unset for the CLI's own default, for the same reason. */
  effort?: string | null
  /** Pre-approved tools. Only ever a permission — it does not refuse anything,
   * which is why the next field exists. */
  allowedTools?: string[]
  /** What is actually refused. `--allowed-tools` alone leaves everything else
   * still askable, so this is the half that says no. */
  disallowedTools?: string[]
  /**
   * `--permission-mode`.
   *
   * Print mode has nobody to ask, so a turn that hits a prompt does not pause —
   * it fails or skips. A conversation that is meant to change files therefore
   * has to say up front how much it may do without asking.
   */
  permissionMode?: string
  /** `--mcp-config`, and whether to refuse the user's own servers with it. */
  mcpConfig?: string | null
  strictMcp?: boolean
  /** Directories outside `cwd` the turn may read. */
  addDirs?: string[]
  appendSystemPrompt?: string
}

export type PrintHandlers = {
  /**
   * One line of the conversation, as it arrives.
   *
   * The caller records and forwards it. Deliberately not done here: where a
   * conversation is written down is the caller's business, and this module has
   * no idea which chat it is running.
   */
  onMessage: (message: AssistantMessage) => void
  /** The turn is over. `error` is null when it succeeded. Called exactly once. */
  onDone: (error: string | null) => void
}

/** A turn in flight. `kill` is the only way to stop one. */
export type PrintRun = {
  kill: () => void
}

/**
 * Starts a turn, or reports that it cannot be started.
 *
 * Resolves as soon as the process is spawned; the turn itself is over when
 * `onDone` fires. Resolves to null when `claude` could not be found, having
 * already called `onDone` with the reason — so a caller has one path for "the
 * turn failed" rather than two.
 */
export async function runPrintTurn(
  turn: PrintTurn,
  handlers: PrintHandlers
): Promise<PrintRun | null> {
  // A GUI app inherits almost none of the user's PATH, so where `claude` is has
  // to be asked of their own login shell rather than of `process.env`.
  const binary = await locate(claudeBinary())
  if (!binary) {
    handlers.onDone(
      "Claude Code is not installed, or not on the PATH your shell gives it. Install it with: npm install -g @anthropic-ai/claude-code"
    )
    return null
  }

  const args = [
    "-p",
    turn.prompt,
    // One JSON object per line, which is what makes a reply arrive a message at
    // a time rather than in one lump at the end. `--verbose` is not optional:
    // the CLI refuses the streaming format in print mode without it.
    "--output-format",
    "stream-json",
    "--verbose",
    ...(turn.model ? ["--model", turn.model] : []),
    ...(turn.effort ? ["--effort", turn.effort] : []),
    ...(turn.allowedTools?.length
      ? ["--allowed-tools", turn.allowedTools.join(",")]
      : []),
    ...(turn.disallowedTools?.length
      ? ["--disallowed-tools", turn.disallowedTools.join(",")]
      : []),
    ...(turn.permissionMode ? ["--permission-mode", turn.permissionMode] : []),
    ...(turn.resume
      ? ["--resume", turn.sessionId]
      : ["--session-id", turn.sessionId]),
    ...(turn.mcpConfig
      ? [
          "--mcp-config",
          turn.mcpConfig,
          ...(turn.strictMcp ? ["--strict-mcp-config"] : []),
        ]
      : []),
    ...(turn.addDirs ?? []).flatMap((dir) => ["--add-dir", dir]),
    ...(turn.appendSystemPrompt
      ? ["--append-system-prompt", turn.appendSystemPrompt]
      : []),
  ]

  const child = spawn(binary, args, {
    cwd: turn.cwd,
    // No shell: the prompt is one argument and a shell would make the user's
    // own words part of a command line.
    shell: false,
    env: environment(),
    stdio: ["ignore", "pipe", "pipe"],
  })

  /** Set by a kill, so the close below knows the end was asked for. */
  let killed = false
  /** `onDone` is a promise to the caller that it fires once; the CLI can reach
   * the end by `result`, by a non-zero exit, and by `error`. */
  let finished = false
  const done = (error: string | null) => {
    if (finished) return
    finished = true
    handlers.onDone(error)
  }

  let stderr = ""
  child.stderr?.on("data", (chunk: Buffer) => {
    // Kept rather than reported as it arrives: the CLI writes warnings here on
    // a turn that goes on to succeed, and only a failing exit makes them worth
    // showing.
    stderr = (stderr + chunk.toString("utf8")).slice(-4000)
  })

  readLines(child, (line) => parseEvent(line, handlers.onMessage, done))

  child.on("error", (error) => {
    done(error.message)
  })

  child.on("close", (code) => {
    if (killed) {
      done(null)
      return
    }
    // `result` normally reports the end of the turn; this is the case where the
    // process died before writing one.
    done(code === 0 ? null : stderr.trim() || `claude exited with code ${code}`)
  })

  return {
    kill: () => {
      killed = true
      child.kill("SIGTERM")
    },
  }
}

/** Splits stdout into lines, keeping a partial one for the next chunk: a read
 * can land mid-line, and one line can be a long message. */
function readLines(child: ChildProcess, onLine: (line: string) => void): void {
  let pending = ""

  child.stdout?.on("data", (chunk: Buffer) => {
    pending += chunk.toString("utf8")

    let newline = pending.indexOf("\n")
    while (newline !== -1) {
      const line = pending.slice(0, newline).trim()
      pending = pending.slice(newline + 1)
      if (line) onLine(line)
      newline = pending.indexOf("\n")
    }
  })
}

let lines = 0

/** An id for one line of a chat, unique within this run. Not a UUID: it never
 * leaves the chat's own file and is only there so a list can be keyed. */
export function lineId(): string {
  return `l${(lines += 1)}`
}

/**
 * One line of `stream-json`, narrowed to what a chat draws.
 *
 * Everything else in that stream — the init line, a tool's result, the token
 * counts — is read and not passed on. A line that does not parse is skipped
 * rather than failing the turn: the CLI prints the odd un-tagged line, and one
 * of them is not worth losing an answer over.
 */
function parseEvent(
  line: string,
  onMessage: (message: AssistantMessage) => void,
  done: (error: string | null) => void
): void {
  let event: Record<string, unknown>
  try {
    event = JSON.parse(line) as Record<string, unknown>
  } catch {
    return
  }

  if (event.type === "assistant") {
    const message = event.message as { content?: unknown } | undefined
    for (const block of asArray(message?.content)) {
      if (block.type === "text" && typeof block.text === "string") {
        if (block.text.trim()) {
          onMessage({ id: lineId(), role: "assistant", text: block.text })
        }
      }
      if (block.type === "tool_use" && typeof block.name === "string") {
        onMessage({
          id: lineId(),
          role: "tool",
          name: block.name,
          summary: summarise(block.input),
        })
      }
    }
    return
  }

  if (event.type === "result") {
    const failed = event.is_error === true || event.subtype !== "success"
    const error = failed
      ? typeof event.result === "string" && event.result.trim()
        ? event.result
        : `The turn ended as "${String(event.subtype)}".`
      : null
    if (error) onMessage({ id: lineId(), role: "error", text: error })
    done(error)
  }
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
}

/**
 * One line describing what a tool was called with.
 *
 * A tool call is drawn as a single row, so this is the row: the argument that
 * says which thing it was about — a statement, a request's name, a path —
 * rather than the whole input, which for a query is longer than the answer.
 */
export function summarise(input: unknown): string {
  if (typeof input !== "object" || input === null) return ""
  const record = input as Record<string, unknown>

  for (const key of [
    "sql",
    "request",
    "note",
    "database",
    "file_path",
    "pattern",
    "command",
    "name",
  ]) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) {
      return collapse(value)
    }
  }
  return collapse(JSON.stringify(record))
}

export function collapse(text: string): string {
  const line = text.replaceAll(/\s+/g, " ").trim()
  return line.length > 120 ? `${line.slice(0, 119)}…` : line
}
