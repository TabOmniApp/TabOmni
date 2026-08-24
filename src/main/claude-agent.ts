import {
  query,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk"

import type { AssistantMessage, TurnUsage } from "../shared/api"
import { claudeBinary } from "./claude-bin"
import { environment, locate } from "./shell-env"

/**
 * Running one turn of an agent conversation, over `@anthropic-ai/claude-agent-sdk`.
 *
 * Apart from `worktree-chat.ts`, its one caller, because the part worth having
 * on its own is the **driving**: what the SDK hands back moves between
 * versions, and a reader of it tangled into a store and a session id is one
 * nobody wants to re-read when it moves. What is *not* here is policy — which
 * tools a turn may use, where it runs and what it is told about itself are the
 * caller's, passed in.
 *
 * **Why the SDK rather than spawning `claude -p`.** This used to be a
 * `child_process.spawn` of the CLI in print mode, reading
 * `--output-format stream-json` a line at a time (`claude-print.ts`). That shape
 * had one thing wrong with it that no amount of parsing fixes: a turn which met
 * a permission prompt had nobody to answer it, so it stalled or failed. The
 * whole permission picker in the composer exists to work around it. The SDK's
 * `canUseTool` is the missing half — it hands the request back to the host and
 * waits — and it is `onAsk` here, which the composer's `Ask` permission is the
 * one mode to pass. The other four still decide up front, which is why they
 * exist; that is now a choice rather than the only possibility.
 *
 * The CLI is still the thing that runs: `pathToClaudeCodeExecutable` is the
 * user's own `claude`, found the same way it always was, so a turn uses their
 * install and their login rather than a second copy of the CLI with an
 * authentication story of its own.
 */

/** What a turn is: the prompt, where it runs, and what it is allowed to do. */
export type AgentTurn = {
  /** The directory the CLI runs in. Must exist — the CLI refuses otherwise. */
  cwd: string
  prompt: string
  /**
   * The CLI session this turn belongs to.
   *
   * Passed as `sessionId` the first time and `resume` afterwards, which is what
   * makes a second turn a continuation rather than a fresh conversation. The
   * caller owns the id and owns knowing which of the two it is. Must be a UUID:
   * the SDK refuses anything else, as `--session-id` did.
   */
  sessionId: string
  resume: boolean
  /**
   * The model, as an alias the CLI resolves (`opus`, `sonnet`).
   *
   * Left unset for whichever model the user's own `claude` is on, which is not
   * the same as naming today's default here: their choice is a setting of
   * theirs, and this app overriding it silently would be this app deciding.
   */
  model?: string | null
  /** Reasoning effort. Unset for the CLI's own default, for the same reason. */
  effort?: string | null
  /** Pre-approved tools. Only ever a permission — it does not refuse anything,
   * which is why the next field exists. */
  allowedTools?: string[]
  /** What is actually refused. An allow list alone leaves everything else still
   * askable, so this is the half that says no. */
  disallowedTools?: string[]
  /**
   * How much the turn may do without being asked.
   *
   * A mode that ends by asking needs an `onAsk` below to answer it, or it is a
   * turn that stalls: see `PERMISSIONS` in `worktree-chat.ts` for which of the
   * CLI's modes are paired with one and what each is for.
   */
  permissionMode?: string
  /** The MCP config **file**, and whether to refuse the user's own servers with
   * it. A path rather than the servers themselves — see `mcpArgs`. */
  mcpConfig?: string | null
  strictMcp?: boolean
  /** Directories outside `cwd` the turn may read. */
  addDirs?: string[]
  appendSystemPrompt?: string
  /**
   * Who answers a permission prompt, when there is one to answer.
   *
   * Left unset for a turn that must not stop — every mode but `ask` — and
   * setting it is what makes the CLI ask at all: the SDK adds
   * `--permission-prompt-tool stdio` when it is present, and without it a
   * request is decided by the rules alone.
   */
  onAsk?: AskHandler
}

/**
 * Asked what to do about one tool call, answering whenever it can.
 *
 * The turn is **held** for as long as this takes — the CLI is waiting on the
 * other end of a pipe, and there is no timeout on this side. That is the point:
 * somebody has to read the question. A turn that should not wait is one this is
 * not passed for.
 */
export type AskHandler = (request: AskRequest) => Promise<AskDecision>

export type AskRequest = {
  toolName: string
  input: Record<string, unknown>
  /** The sentence the SDK rendered, when it had one — "Claude wants to read
   * foo.txt". Better than anything rebuilt from the two fields above, since the
   * CLI knows which argument of a call is the interesting one. */
  title?: string
  /** Whether there is a rule to remember, so a caller can offer "don't ask
   * again" only when accepting it would do something. */
  canRemember: boolean
  /** Dropped when the turn ends under it — a question nobody will answer. */
  signal: AbortSignal
}

export type AskDecision =
  | {
      allow: true
      /** Honoured only where the SDK suggested a rule; see `canRemember`. */
      remember?: boolean
      /**
       * Fields to change in the call before it runs, **merged** over what was
       * asked rather than replacing it.
       *
       * Merged because that is what every use of it needs: an `AskUserQuestion`
       * is answered by adding the answers while leaving the questions in place —
       * the SDK requires them back — and narrowing a path or a command is the
       * same shape. Replacing wholesale would mean every caller reassembling
       * the parts it did not care about.
       */
      input?: Record<string, unknown>
    }
  | { allow: false; message: string }

export type AgentHandlers = {
  /**
   * One line of the conversation, as it arrives.
   *
   * The caller records and forwards it. Deliberately not done here: where a
   * conversation is written down is the caller's business, and this module has
   * no idea which chat it is running.
   */
  onMessage: (message: AssistantMessage) => void
  /**
   * What a tool call came back with, for a line already sent through
   * `onMessage`.
   *
   * Apart from `onMessage` because it changes a line rather than adding one —
   * the result of a call belongs on the row that call already drew, and a second
   * row saying "and then it returned" is a transcript twice as long saying the
   * same thing. Matched by `toolId`, which is the CLI's own.
   */
  onToolResult: (toolId: string, result: string, failed: boolean) => void
  /**
   * What the turn spent, from the result line that ends it.
   *
   * Reported at all because it is otherwise invisible: the numbers arrive once,
   * on one message, and a host that reads past them has no way to answer "why
   * did that turn cost what it did" afterwards — the transcript the CLI keeps is
   * not this app's to read. Called at most once, and before `onDone`, so the
   * cost lands in the conversation ahead of an error rather than after it.
   */
  onUsage: (usage: TurnUsage) => void
  /** The turn is over. `error` is null when it succeeded. Called exactly once. */
  onDone: (error: string | null) => void
}

/** A turn in flight. `kill` is the only way to stop one. */
export type AgentRun = {
  kill: () => void
}

const NOT_INSTALLED =
  "Claude Code is not installed, or not on the PATH your shell gives it. Install it with: npm install -g @anthropic-ai/claude-code"

/**
 * Starts a turn, or reports that it cannot be started.
 *
 * Resolves once the CLI is actually up — its first message — and the turn itself
 * is over when `onDone` fires. Resolves to null when it could not be started at
 * all, having already called `onDone` with the reason, so a caller has one path
 * for "the turn failed" rather than two.
 *
 * Waiting for that first message is the point rather than an implementation
 * detail: the caller writes down that the CLI now owns this session id, and a
 * session it never opened must not be resumed on the next try. `query()` is
 * lazy — the process starts on the first read of the stream — so "the call
 * returned" is not on its own evidence of anything.
 */
export async function runAgentTurn(
  turn: AgentTurn,
  handlers: AgentHandlers
): Promise<AgentRun | null> {
  // A GUI app inherits almost none of the user's PATH, so where `claude` is has
  // to be asked of their own login shell rather than of `process.env`.
  const binary = await locate(claudeBinary())
  if (!binary) {
    handlers.onDone(NOT_INSTALLED)
    return null
  }

  const abort = new AbortController()
  /** Set by a kill, so the failure that follows one is not reported as a
   * failure: an aborted stream throws like any other. */
  let stopped = false
  /** `onDone` is a promise to the caller that it fires once, and there are three
   * ways to reach the end: the result line, the stream closing, and a throw. */
  let finished = false
  const done = (error: string | null) => {
    if (finished) return
    finished = true
    handlers.onDone(error)
  }

  let stderr = ""

  const conversation = query({
    prompt: turn.prompt,
    options: {
      cwd: turn.cwd,
      abortController: abort,
      // The user's own install, not the SDK's bundled CLI: their login, their
      // settings, their `CLAUDE_BIN` override.
      pathToClaudeCodeExecutable: binary,
      env: environment(),
      // One or the other, never both — the SDK refuses `sessionId` together
      // with `resume`, which is the same rule `--session-id` had.
      ...(turn.resume
        ? { resume: turn.sessionId }
        : { sessionId: turn.sessionId }),
      ...(turn.model ? { model: turn.model } : {}),
      ...(turn.effort ? { effort: turn.effort as Options["effort"] } : {}),
      ...(turn.allowedTools?.length ? { allowedTools: turn.allowedTools } : {}),
      ...(turn.disallowedTools?.length
        ? { disallowedTools: turn.disallowedTools }
        : {}),
      ...permissionArgs(turn.permissionMode),
      ...mcpArgs(turn.mcpConfig, turn.strictMcp),
      ...(turn.addDirs?.length ? { additionalDirectories: turn.addDirs } : {}),
      // The CLI's own system prompt with this app's note after it, rather than
      // in place of it: a bare string here would *replace* the preset, and a
      // turn that had never been told it is Claude Code is a different thing.
      ...(turn.appendSystemPrompt
        ? {
            systemPrompt: {
              type: "preset" as const,
              preset: "claude_code" as const,
              append: turn.appendSystemPrompt,
            },
          }
        : {}),
      ...(turn.onAsk ? { canUseTool: asking(turn.onAsk) } : {}),
      stderr: (data) => {
        // Kept rather than reported as it arrives: the CLI writes warnings here
        // on a turn that goes on to succeed, and only a failure makes them
        // worth showing.
        stderr = (stderr + data).slice(-4000)
      },
    },
  })

  /** Resolved with whether the CLI came up at all — see the note above. */
  let settle: (running: boolean) => void = () => {}
  const running = new Promise<boolean>((resolve) => {
    settle = resolve
  })

  void (async () => {
    try {
      for await (const message of conversation) {
        settle(true)
        read(message, handlers, done)
      }
      // The stream ended without a result line — nothing said the turn failed,
      // so nothing here says so either.
      done(null)
    } catch (error) {
      /*
       * The SDK throws where the old reader only read.
       *
       * An error *result* is delivered as a message and then thrown as an
       * exception, so `read` has already drawn the row and called `done`; the
       * `finished` guard is what keeps this from reporting it twice. What is
       * left for this branch is the turn that never got that far — a CLI that
       * would not launch, a session id it refused — where its own message, or
       * failing that its stderr, is the only account of why.
       */
      done(stopped ? null : failure(error, stderr))
    } finally {
      settle(false)
    }
  })()

  if (!(await running)) return null

  return {
    kill: () => {
      stopped = true
      abort.abort()
    },
  }
}

/**
 * The SDK's `canUseTool`, over this module's own handler.
 *
 * Two things are worth knowing about what it is handed. `suggestions` is the
 * set of rules that would stop the same call being asked about again, and it is
 * echoed back **whole** as `updatedPermissions` — the SDK's own instruction, and
 * the reason `remember` is a flag here rather than a rule this app composes.
 * And `updatedInput` is not optional in spirit: an allow that omits it was
 * rejected outright by CLIs before 2.1.207, so the input comes back either way,
 * unchanged unless the caller replaced it.
 *
 * A denial carries a message because the model reads it and adjusts, which is
 * the difference between "no" and a turn that spends itself retrying.
 */
function asking(onAsk: AskHandler): Options["canUseTool"] {
  return async (toolName, input, context) => {
    const suggestions = context.suggestions ?? []
    const decision = await onAsk({
      toolName,
      input,
      title: context.title,
      canRemember: suggestions.length > 0,
      signal: context.signal,
    })

    if (!decision.allow) {
      return { behavior: "deny", message: decision.message }
    }
    return {
      behavior: "allow",
      // Merged over the call rather than replacing it — see `AskDecision.input`.
      updatedInput: decision.input ? { ...input, ...decision.input } : input,
      ...(decision.remember && suggestions.length > 0
        ? { updatedPermissions: suggestions }
        : {}),
    }
  }
}

/**
 * `bypassPermissions` is the one mode the SDK asks twice about.
 *
 * It refuses the mode outright unless `allowDangerouslySkipPermissions` is set
 * alongside it — a deliberate second opt-in rather than a flag to set once and
 * forget, which is why it is pinned to that mode here rather than passed always.
 */
function permissionArgs(mode: string | undefined): Options {
  if (!mode) return {}
  return {
    permissionMode: mode as Options["permissionMode"],
    ...(mode === "bypassPermissions"
      ? { allowDangerouslySkipPermissions: true }
      : {}),
  }
}

/**
 * The MCP servers, named by the **file** they are written in.
 *
 * Deliberately not the SDK's own `mcpServers` option, which looks like the
 * obvious way to do this: it serialises the config onto the CLI's command line
 * (`--mcp-config <json>`), and these server URLs carry this run's secret. A
 * command line is readable by every process on the machine; the file
 * `mcp.ts` writes is `0600` in `~/.tabomni`. So the path goes through
 * `extraArgs`, which is the same flag with the same file the spawned CLI was
 * given before.
 */
function mcpArgs(config: string | null | undefined, strict?: boolean): Options {
  if (!config) return {}
  return {
    extraArgs: { "mcp-config": config },
    ...(strict ? { strictMcpConfig: true } : {}),
  }
}

function failure(error: unknown, stderr: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim() || stderr.trim() || "The turn failed."
}

let lines = 0

/** An id for one line of a chat, unique within this run. Not a UUID: it never
 * leaves the chat's own file and is only there so a list can be keyed. */
export function lineId(): string {
  return `l${(lines += 1)}`
}

/**
 * One message from the SDK, narrowed to what a chat draws.
 *
 * Everything else it sends — the init line, the status and progress events — is
 * read and not passed on. What is drawn is the assistant's own blocks, the tool
 * results that come back in the `user` messages between them, and the result
 * that ends the turn, which is also the one message carrying what the turn
 * spent.
 */
function read(
  message: SDKMessage,
  handlers: AgentHandlers,
  done: (error: string | null) => void
): void {
  const { onMessage, onToolResult } = handlers

  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "text" && block.text.trim()) {
        onMessage({ id: lineId(), role: "assistant", text: block.text })
      }
      // Only when the model was actually thinking, which is what the effort on
      // the toolbar decides — a turn at `low` sends none of these and draws no
      // rows for them, rather than empty ones.
      if (block.type === "thinking" && block.thinking.trim()) {
        onMessage({ id: lineId(), role: "thinking", text: block.thinking })
      }
      if (block.type === "tool_use") {
        onMessage({
          id: lineId(),
          role: "tool",
          name: block.name,
          ...describeCall(block.name, block.input),
          // The CLI's own id, kept so the result can find this line again.
          toolId: block.id,
        })
      }
    }
    return
  }

  /*
   * A tool's result comes back as a `user` message the CLI wrote, not the
   * user's own.
   *
   * This is the one place the two are confusable and the reason nothing else in
   * this branch is drawn: what arrives here is the transcript's record of the
   * conversation continuing, and the only part of it a chat has not already
   * drawn is what the tools said.
   */
  if (message.type === "user") {
    const content = message.message.content
    if (typeof content === "string") return
    for (const block of content) {
      if (block.type !== "tool_result") continue
      onToolResult(
        block.tool_use_id,
        resultLine(block.content),
        block.is_error === true
      )
    }
    return
  }

  if (message.type === "result") {
    const failed = message.is_error || message.subtype !== "success"
    // Only a successful result carries the assistant's own last word; an error
    // subtype has no `result` field to explain itself with.
    const said =
      "result" in message && typeof message.result === "string"
        ? message.result.trim()
        : ""
    const error = failed
      ? said || `The turn ended as "${message.subtype}".`
      : null
    // Before the error line and before `done`: what a turn spent is worth
    // knowing most about the turn that failed, and a cost written after the
    // failure would read as the cost of something that came next.
    handlers.onUsage(usageOf(message))
    if (error) onMessage({ id: lineId(), role: "error", text: error })
    done(error)
  }
}

/**
 * What the turn spent, out of the result line.
 *
 * `modelUsage` rather than `usage`, because the SDK documents the latter as the
 * main agent loop alone: a turn that ran a subagent spent what the subagent
 * spent, `Task` is pre-approved here, and a cost that quietly omitted it would
 * be wrong in exactly the case somebody is looking it up for. Summed across
 * models for the same reason — compaction and a subagent on another model are
 * both this turn — and labelled with whichever of them did the most input,
 * since that is the one the toolbar was talking about.
 *
 * Cumulative-across-turns is not a worry here: the SDK says so of
 * streaming-input sessions, and this app spawns a process per turn with a
 * string prompt, so each result is its own turn's.
 *
 * `thinking` is the exception that comes off `usage`, which is the only place
 * the SDK breaks the output down; being main-loop only makes it a floor, and a
 * floor answers the question it is read for — whether reasoning is where the
 * output went.
 */
export function usageOf(message: SDKMessage & { type: "result" }): TurnUsage {
  const models = Object.entries(message.modelUsage ?? {})

  const total = models.reduce(
    (sum, [, use]) => ({
      input: sum.input + (use.inputTokens || 0),
      cacheWrite: sum.cacheWrite + (use.cacheCreationInputTokens || 0),
      cacheRead: sum.cacheRead + (use.cacheReadInputTokens || 0),
      output: sum.output + (use.outputTokens || 0),
    }),
    { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }
  )

  const busiest = models.reduce<[string, number] | null>(
    (best, [name, use]) => {
      const read = (use.inputTokens || 0) + (use.cacheReadInputTokens || 0)
      return best === null || read > best[1] ? [name, read] : best
    },
    null
  )

  const cost = message.total_cost_usd
  return {
    model: busiest?.[0] ?? null,
    ...total,
    thinking: message.usage?.output_tokens_details?.thinking_tokens ?? 0,
    // A crashed turn reports zero for everything, and a zero drawn as `$0.00`
    // is this app claiming a turn was free rather than that nobody counted it.
    costUsd: typeof cost === "number" && cost > 0 ? cost : null,
  }
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

/**
 * A tool call as the three things a row draws it from.
 *
 * Pulled out of `summarise` rather than folded into it, because a row wants the
 * pieces apart: the file goes in a chip with its own icon, the model's
 * `description` is the sentence the row leads with, and the argument is the
 * muted mono text after it. One string could not have been split back up —
 * "is this a path" is not a question to ask of text somebody's command wrote.
 *
 * `Task` is the reason `summary` is not always `summarise`: its input is a
 * description, a whole prompt and a subagent type, none of which the key list
 * names, so every subagent row was the JSON of the entire prompt collapsed to
 * 120 characters. What a row wants there is which agent ran.
 */
export function describeCall(
  name: string,
  input: unknown
): {
  summary: string
  title?: string
  path?: string
  stat?: string
  change?: string
} {
  const record =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {}

  const text = (key: string): string | undefined => {
    const value = record[key]
    return typeof value === "string" && value.trim() ? value : undefined
  }

  const path = text("file_path") ?? text("notebook_path")
  const title = text("description")
  const summary =
    name === "Task"
      ? (text("subagent_type") ?? "")
      : // Nothing at all rather than `summarise`'s `{}`: a row that says the
        // empty object says less than a row that says only the tool's name.
        Object.keys(record).length === 0
        ? ""
        : summarise(record)

  return {
    summary,
    ...(title ? { title: collapse(title) } : {}),
    ...(path ? { path } : {}),
    ...changeOf(name, record),
  }
}

const CHANGE_LINES = 16

export function changeOf(
  name: string,
  record: Record<string, unknown>
): { stat?: string; change?: string } {
  const string = (value: unknown): string | null =>
    typeof value === "string" ? value : null

  /** One edit as its two sides, `null` for a side the call does not have. */
  const pairs: { old: string | null; now: string | null }[] = []

  if (name === "Edit") {
    pairs.push({
      old: string(record.old_string),
      now: string(record.new_string),
    })
  } else if (name === "MultiEdit" && Array.isArray(record.edits)) {
    for (const edit of record.edits) {
      const one = edit as Record<string, unknown>
      pairs.push({ old: string(one?.old_string), now: string(one?.new_string) })
    }
  } else if (name === "Write") {
    pairs.push({ old: null, now: string(record.content) })
  } else if (name === "NotebookEdit") {
    pairs.push({ old: null, now: string(record.new_source) })
  } else {
    return {}
  }

  const lines: string[] = []
  let added = 0
  let removed = 0

  for (const pair of pairs) {
    // An empty string is a real side — deleting a block, or writing an empty
    // file — so the split is guarded on null rather than on falsiness.
    const before = pair.old === null ? [] : splitLines(pair.old)
    const after = pair.now === null ? [] : splitLines(pair.now)
    removed += before.length
    added += after.length

    for (const line of before) lines.push(`- ${line}`)
    for (const line of after) lines.push(`+ ${line}`)
  }

  if (added === 0 && removed === 0) return {}

  const stat = [added > 0 ? `+${added}` : "", removed > 0 ? `−${removed}` : ""]
    .filter(Boolean)
    .join(" ")

  const shown = lines.slice(0, CHANGE_LINES)
  if (lines.length > shown.length) {
    shown.push(`… ${lines.length - shown.length} more`)
  }

  return { stat, change: shown.join("\n") }
}

/** The lines of one side of an edit. A trailing newline is the end of the last
 * line rather than an empty line after it, which is what `split` would make of
 * it — and an empty side has no lines at all. */
function splitLines(text: string): string[] {
  if (text === "") return []
  return text.replace(/\n$/, "").split("\n")
}

/**
 * What a tool call came back with, in one line.
 *
 * A count rather than the output itself once there is more than a line of it:
 * a `Read` returns the file, and a row that tried to show it would be the file
 * in the transcript. One line is shown as it stands, because "the command
 * printed nothing" and "the command printed `3`" are the two answers somebody
 * scanning the rows is actually looking for.
 *
 * Lines rather than bytes because that is the unit the tools themselves work
 * in — `Read` is given a line count and refuses past one — so it is the number
 * the next call will be phrased in.
 */
export function resultLine(content: unknown): string {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((block) => {
              const record = block as Record<string, unknown>
              return typeof record?.text === "string" ? record.text : ""
            })
            .join("\n")
        : ""

  const trimmed = text.trim()
  if (!trimmed) return ""

  const lines = trimmed.split("\n")
  return lines.length === 1
    ? collapse(lines[0]!)
    : `${lines.length.toLocaleString()} lines`
}
