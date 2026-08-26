/**
 * The contract between the Electron main process and the renderer.
 *
 * Types only — no runtime code — so the main process and the frontend can both
 * import it without either one pulling the other's build into scope. The
 * frontend reaches it through the `@shared` alias.
 */

/**
 * One folder the workspace has been pointed at — a repository on this machine,
 * edited and run where it already is.
 *
 * Timestamps cross IPC as ISO strings: structured clone can carry a `Date`, but
 * keeping the wire format explicit means the renderer is never guessing whether
 * it holds a string or a `Date`.
 */
export type WorkspaceFolder = {
  id: string
  /** What the UI calls it. Defaults to the directory's own name. */
  name: string
  /** The absolute host path. Nothing is ever copied out of it: the studio adds
   * a record and reads the files where they are. */
  path: string
  addedAt: string
}

/**
 * The one workspace everything in the studio belongs to.
 *
 * There is deliberately no second one and no switching between them: two
 * folders open at once is what a person working across a frontend and its API
 * actually has, and a switch would take one of them — and every tab, session
 * and connection opened against it — off the screen. Sign-in will bring more
 * than one workspace, and until then the studio always holds this one.
 */
export type WorkspaceRecord = {
  id: string
  name: string
  folders: WorkspaceFolder[]
}

/**
 * One entry in a directory the Explorer is showing.
 *
 * Addressed by its absolute path rather than by an id, unlike everything else
 * that crosses this contract: a note or a request is a record this app created
 * and can name however it likes, while these are the user's own files, already
 * on disk, and the path is the only name they have. It is also what the tab
 * strip uses, so a file has one identity from the tree through to the pane.
 *
 * No size and no modified time: the listing is one `readdir`, and filling
 * either in would mean a `stat` per entry — a real cost on the `node_modules`
 * somebody eventually expands, to show two columns this tree does not have.
 */
export type FileEntry = {
  path: string
  name: string
  /** A symlink is reported as whatever it points at, so a linked directory
   * expands like one. */
  kind: "file" | "directory"
}

/**
 * One file in the search palette's index of the workspace.
 *
 * Separate from `FileEntry` because it answers a different question: that one
 * is a row in a directory somebody opened, this one is a file somewhere in the
 * workspace that nothing has necessarily looked at. `relative` is what is shown
 * and searched — `src/main/files.ts`, always with forward slashes so the string
 * reads the same on every platform — while `path` is the absolute one the tab
 * is opened by.
 */
export type FileIndexEntry = {
  path: string
  relative: string
  /** Which workspace folder it was found under, for the hint beside it: two
   * repositories in one workspace both have a `src/index.ts`. */
  folderId: string
}

/**
 * What git says about one path.
 *
 * The index and the working tree are collapsed into one state on purpose:
 * nothing in the studio stages anything, so "changed and not committed" is the
 * whole of what a row can usefully say. `conflicted` is kept apart because it
 * is the one state where the file on disk is not something anybody wrote.
 */
export type GitFileState =
  "added" | "modified" | "deleted" | "untracked" | "conflicted" | "ignored"

/**
 * One path git has something to say about.
 *
 * `directory` means the entry stands for everything under it: git reports a
 * wholly untracked or ignored directory as itself rather than as its contents,
 * which is what keeps one `node_modules` from being a hundred thousand entries.
 */
export type GitStatusEntry = {
  path: string
  state: GitFileState
  directory: boolean
}

/**
 * One changed file in a checkout — a row of the Explorer's Changes list.
 *
 * `GitStatusEntry` answers "what is this file to git" for a row that already
 * exists in the tree; this answers "what has changed here", which is a
 * different question with a different shape: it is a **list** rather than a
 * lookup, it leaves out the ignored (a repository's ignored files are not
 * anybody's changes), and it carries the line counts, which cost a second git
 * call and are wanted for a handful of paths rather than for all of them.
 */
export type GitChange = {
  path: string
  state: GitFileState
  /**
   * Lines added and removed against `HEAD`, or null when there is no honest
   * number: a binary file, a wholly new directory, a file too large to count,
   * or a repository with no commit to compare against.
   *
   * Null rather than zero, because `+0 -0` is a real answer — a file whose only
   * change is a mode or a line ending — and a row that cannot tell the two
   * apart is a row that lies about one of them.
   */
  added: number | null
  removed: number | null
}

/**
 * A directory the Explorer is watching whose contents changed.
 *
 * The directory rather than what happened in it: `fs.watch` reports a rename as
 * one event or two depending on the platform, and often names only one half of
 * it, while the tree re-reads the whole listing regardless. See `main/watch.ts`.
 */
export type DirectoryChange = { dir: string }

/**
 * What hovering a symbol in the editor says.
 *
 * The pieces tsserver hands back, kept apart rather than pre-rendered into one
 * string: the signature is code and is shown as code, the documentation is
 * markdown, and the tags are the `@param`/`@returns` lines, which the tooltip
 * lays out as a list. Composing them here would be the main process deciding
 * what a tooltip looks like.
 */
export type TsHover = {
  /** `(alias) function defineConfig(config: Config): Config` — the line at the
   * top of the tooltip, highlighted as TypeScript. */
  signature: string
  /** The doc comment, as markdown. Empty when the symbol has none. */
  documentation: string
  tags: { name: string; text: string }[]
}

/** Where a symbol is declared — a file this app can open as a tab, and a
 * 1-based position in it. */
export type TsDefinition = {
  path: string
  line: number
  column: number
}

/**
 * What opening a file gave back.
 *
 * The two refusals are results rather than errors: "this is a PNG" and "this is
 * 40 MB" are things the pane can say plainly, and rejecting would file them
 * beside "the disk went away".
 */
export type FileContent =
  | { kind: "text"; text: string }
  | { kind: "binary" }
  | { kind: "too-large"; size: number }

/** Which SQL engine a database speaks. */
export type DbEngine = "postgres" | "mysql"

/**
 * Where a database's server actually runs.
 *
 * `docker` means the studio created it and owns its container and data
 * directory; `external` means it is someone else's server, reached over
 * plain TCP with credentials the user supplied.
 */
export type DbOrigin = "docker" | "external"

/**
 * A database or connection in the workspace. Never carries a password — that
 * stays inside the main process (see `electron/store.ts`'s `connectionInfoOf`)
 * and is never sent over IPC.
 *
 * Not tied to any one folder: a project's database is generally the same
 * database its frontend and its API both talk to, and filing it under one of
 * the two would only mean picking which panel is allowed to see it.
 */
export type DatabaseRecord = {
  id: string
  name: string
  engine: DbEngine
  origin: DbOrigin
  host: string
  port: number
  user: string
  database: string
  createdAt: string
  updatedAt: string
}

/**
 * One condition in the data browser's filter bar.
 *
 * Values travel as parameters, never as text spliced into the statement — a
 * filter is the one place in this panel where something the user typed becomes
 * part of a `where` clause.
 */
export type Filter = {
  column: string
  operator: FilterOperator
  /** Ignored by the operators that take no value (`is null`, `is not null`). */
  value: string
}

export type FilterOperator =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "contains"
  | "not contains"
  | "starts with"
  | "ends with"
  | "is null"
  | "is not null"

/** How a filter bar's conditions are joined. Flat: no nested groups. */
export type FilterJoin = "and" | "or"

export type FilterSet = {
  join: FilterJoin
  conditions: Filter[]
}

/** What can be changed about an existing connection. */
export type UpdateDatabaseInput = {
  name: string
  host: string
  port: number
  user: string
  /** Left out to keep the stored one — the renderer is never told it. */
  password?: string
  database: string
}

export type NewDatabaseInput =
  | { name: string; engine: DbEngine; origin: "docker" }
  | {
      name: string
      engine: DbEngine
      origin: "external"
      host: string
      port: number
      user: string
      password: string
      database: string
    }

/** What "Test connection" sends before an external connection is saved. */
export type DatabaseConnectionInput = {
  engine: DbEngine
  host: string
  port: number
  user: string
  password: string
  database: string
}

export type ConnectionTestResult =
  { ok: true; version: string } | { ok: false; error: string }

export type DockerStatus =
  { available: true; version: string } | { available: false; reason: string }

/** Which stream a line of process output came from. */
export type ProcessStream = "stdout" | "stderr"

export type ProcessOutput = {
  processId: string
  stream: ProcessStream
  line: string
}

export type ProcessExit = {
  processId: string
  /** `null` when the process was killed by a signal rather than exiting. */
  code: number | null
  signal: string | null
}

/**
 * One line of a chat, as it is drawn and as it is kept on disk.
 *
 * Here rather than in the renderer because both sides hold it: the pane draws
 * it, and the main process — which sees every event — is what writes the chat
 * down, so a chat reopened next week is the one that was had.
 *
 * `Assistant` names the *role*, not a panel: the workspace assistant that once
 * shared these types is gone, and a project's chat is the conversation left.
 */
export type AssistantMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string }
  /**
   * The model's own reasoning, drawn as one folded line.
   *
   * Kept apart from `assistant` rather than run in with it: it is what the model
   * thought on the way to the answer, not the answer, and a chat that ran the
   * two together would be a reply nobody can find the end of. There was a
   * `showThinking` setting for this and it was removed when nothing drew these;
   * it is back with them.
   */
  | { id: string; role: "thinking"; text: string }
  /**
   * A tool call, drawn as one line: what it was, what it was about, and what
   * came back.
   *
   * **The one line in a chat that is not append-only.** A call is written when
   * it goes out, because that is when there is something to draw, and its
   * result arrives afterwards — so `result` is filled in on the line that is
   * already on screen, found by `toolId`. The alternative was holding the row
   * back until the result came, which is a chat that shows nothing while the
   * thing worth watching is happening.
   *
   * Every field after `summary` is optional because a chat is read back from
   * disk: a line written before any of them existed has none, and it still has
   * to draw.
   */
  | {
      id: string
      role: "tool"
      name: string
      /** The argument that says which thing it was about — a path, a command, a
       * statement. */
      summary: string
      /** The CLI's own id for the call, which is what its result finds it by. */
      toolId?: string
      /** What the tool call said it was for, in the model's words: the
       * `description` a `Bash` or a `Task` carries. */
      title?: string
      /** The file it was about, absolute, when it was about one — so a row can
       * draw the name with its file-type icon rather than a path that is forty
       * characters of checkout before it says anything. */
      path?: string
      /** One line about what came back: `631 lines`, or the output itself when
       * it was one line. Absent while the call is still running. */
      result?: string
      /**
       * The whole argument the call was made with, for the row that opens.
       *
       * Present **only where `summary` is not already all of it** — a `Read` of
       * one path has nothing more to show, and storing a second copy of a short
       * string on every line would grow the chat's file for nothing. So this is
       * the multi-line command and the 300-character query, and its absence is
       * how a row knows it has no argument worth opening.
       */
      input?: string
      /**
       * The whole of what came back, capped, for the same row.
       *
       * Present only where `result` is a *count* rather than the output itself,
       * which is the same rule `input` follows. It is capped in main
       * (`detailOf`) because a chat is rewritten to disk on every appended line
       * and one `Bash` that printed a build log would otherwise be carried
       * through every write for the life of the conversation.
       */
      output?: string
      /**
       * How much an edit moved — `+3 −1` — read off the call's own input rather
       * than its result.
       *
       * The row draws this **instead of** `result` for a call that has one,
       * because what the CLI sends back for an edit is a sentence naming the
       * absolute path the chip beside it is already showing. `result` is still
       * kept and still drawn when the call *failed*, which is the one time that
       * sentence is the thing worth reading.
       */
      stat?: string
      /** The change itself, as `-`/`+` lines, capped: what the row shows on
       * hover. Not a computed diff — these are the two sides the call was made
       * of. */
      change?: string
      /** Set when the tool call came back an error. */
      failed?: boolean
    }
  | { id: string; role: "error"; text: string }
  /**
   * Something the turn stopped to ask, and what was said back.
   *
   * Written once it has been answered rather than while it is pending: a
   * question on disk is one nobody can answer, because the process that asked
   * it is gone. What is kept is the decision, which is the part worth reading
   * next week — a turn that could edit because somebody allowed it, or a plan
   * that went one way because somebody picked an option.
   */
  | { id: string; role: "ask"; text: string }
  /**
   * What the turn cost, written down as the last line of it.
   *
   * A line of the conversation rather than a field on the record, for the
   * reason every other line is one: a chat holds several turns and each of them
   * cost its own amount, and a total on the record could not say which turn ran
   * on Opus and which on Haiku. Summing the lines is how a chat's total is got
   * (`lib/worktree-chat/usage.ts`), which also means a chat written before this
   * existed reads back as a chat with nothing to say about its cost rather than
   * as one that cost nothing.
   */
  | { id: string; role: "usage"; usage: TurnUsage }

/**
 * What one turn spent, in the numbers that explain the spending.
 *
 * **Why the cache halves are separate.** A turn's prompt is the same size
 * either way — this app's own system prompt, the tool list and every line of
 * the conversation so far — and the whole of the difference between a cheap turn
 * and an expensive one is which side of the cache it landed on: a prompt read
 * from the cache is billed at a tenth, and one written to it at a quarter more
 * than full price. So `cacheRead` and `cacheWrite` are the pair worth reading,
 * and one `input` total would have hidden it. A turn showing 40k written and
 * nothing read is this app having asked for a prefix nobody had asked for yet —
 * a different system prompt, a different tool list, or an hour since the last
 * turn that shared one.
 *
 * Taken from the SDK's `modelUsage` rather than its `usage`, which is
 * documented as the main loop alone: a turn that spawned a subagent spent what
 * the subagent spent, and a `Task` is on the pre-approved list.
 */
export type TurnUsage = {
  /** The model the turn actually ran on, which the toolbar's own `null` does
   * not say — that leaves the user's `claude` to decide, and this is what it
   * decided. Null when the SDK reported no per-model usage at all. */
  model: string | null
  /** Prompt tokens neither cache held. */
  input: number
  /** Prompt tokens written to the cache, at 1.25x. */
  cacheWrite: number
  /** Prompt tokens read from the cache, at 0.1x. */
  cacheRead: number
  output: number
  /** Of `output`, what went on reasoning. The SDK reports this for the main
   * loop only, so it is a floor rather than a total. */
  thinking: number
  /** The SDK's own estimate for the turn, in USD, or null where it reported
   * none — a crashed turn carries zeroes it would be wrong to draw as free. */
  costUsd: number | null
}

/**
 * One thing that happened while a turn was being answered.
 *
 * A turn is one `query()` of `@anthropic-ai/claude-agent-sdk`, so what arrives
 * is the SDK's own message stream, narrowed to the three things a pane draws: a
 * message, a tool it called, and the end of the turn. Anything else in that
 * stream — the init line, the status and progress events — is read by
 * `main/claude-agent.ts` and not passed on. A tool's result and the turn's
 * token counts are passed on, as the two events below that are not a line of
 * the answer.
 */
export type AssistantEvent =
  /** One assistant message, as markdown. A turn can produce several. */
  | { type: "text"; text: string }
  /** The model's reasoning on the way to one of those. */
  | { type: "thinking"; text: string }
  /** A tool the assistant called, drawn as a line rather than in full: the
   * arguments are usually a SQL statement or a request name. */
  | {
      type: "tool"
      name: string
      summary: string
      toolId?: string
      title?: string
      path?: string
      /** The whole argument, where the row is not already showing it — see the
       * same field on the line it becomes. Carried on the event and not only
       * written to the record, or a row would not open until the chat was read
       * back off disk. */
      input?: string
      /** `+3 −1` for an edit — see the same field on the line it becomes. */
      stat?: string
      change?: string
    }
  /**
   * What a tool call came back with, for the line already drawn for it.
   *
   * Its own event rather than a second `tool`, because it changes a row instead
   * of adding one — the only event here that does. A `toolId` nothing is waiting
   * on is ignored, which is what happens to the result of a call whose line was
   * written by a build that had no ids.
   */
  | {
      type: "tool-result"
      toolId: string
      result: string
      /** The whole of it, where `result` is only a count — see `output` on the
       * tool line. */
      output?: string
      failed: boolean
    }
  /**
   * The turn has stopped and is waiting to be answered.
   *
   * The turn is *paused* here, not ended: the CLI is holding the tool call, and
   * it stays held until `answerWorktreeChatAsk` names this ask. Nothing else
   * arrives for this chat in the meantime.
   */
  | { type: "ask"; ask: WorktreeChatAsk }
  /**
   * An ask has been answered, and this is the line recording it.
   *
   * The text comes from the main process rather than being rebuilt by whoever
   * answered: main is what writes the conversation down, and a renderer
   * composing its own version of the same sentence is two spellings of one line
   * waiting to drift apart. Arriving here also means the card can come down.
   */
  | { type: "decision"; text: string }
  /** The turn is over, one way or the other. `error` is set when it failed —
   * including when `claude` itself could not be started. Any ask still pending
   * is gone with it: the process that would have taken the answer has ended. */
  | { type: "done"; error: string | null }
  /**
   * What the turn cost, once it is over.
   *
   * Its own event arriving just before `done` rather than a field on it,
   * because it is a line of the conversation and `done` is not: the same
   * `append` writes it to the chat's file, and a `done` carrying it would have
   * been the one event that both ends a turn and adds to it.
   */
  | { type: "usage"; usage: TurnUsage }

/** One of the choices in a question the model asked. */
export type ChatAskOption = {
  label: string
  description: string
}

/** One question, out of the one to four an `AskUserQuestion` carries. */
export type ChatAskQuestion = {
  /** The full text, which is also the key an answer is filed under. */
  question: string
  /** A short label for it — twelve characters or so, the model's own. */
  header: string
  options: ChatAskOption[]
  multiSelect: boolean
}

/**
 * A turn waiting on the user: the thing print mode could not have.
 *
 * Two shapes, because the CLI asks two different things and they are answered
 * differently. A **tool** request is "may I do this", which is yes or no; a
 * **questions** request is `AskUserQuestion`, where the model wrote the options
 * and wants one picked. Both arrive through the SDK's `canUseTool`, which is
 * why they are one type with one answer call rather than two of each.
 *
 * Held in memory in the main process only, and lost if the window reloads —
 * like `sending` in the renderer's own store, and for the same reason: what is
 * on the other end is a process, not a record.
 */
export type WorktreeChatAsk = {
  /**
   * Unique per request.
   *
   * An answer names it, so a card left on screen from a question that has since
   * been withdrawn cannot answer the one that replaced it.
   */
  id: string
  chatId: string
} & (
  | {
      kind: "tool"
      /**
       * The sentence to show — "Claude wants to read foo.txt".
       *
       * The SDK renders it, and it is used rather than rebuilt from the tool
       * name and its input: the CLI knows which argument of a Bash call is the
       * interesting one, and this app would be guessing.
       */
      title: string
      /** The tool, for the line that records the decision afterwards. */
      name: string
      /** What it was about — the same one-liner a tool row carries. */
      summary: string
      /**
       * Whether "don't ask again" is on offer.
       *
       * Only sometimes: the SDK hands back a rule to remember for the calls it
       * can describe as a rule, and there is nothing to offer for the ones it
       * cannot. An `always` answer to an ask without it is treated as a plain
       * allow rather than refused, since the difference is a convenience.
       */
      always: boolean
    }
  | { kind: "questions"; questions: ChatAskQuestion[] }
)

/**
 * What the user said back.
 *
 * `always` writes a permission rule where the SDK suggested one, which is the
 * CLI's own "don't ask again" — it lands in the checkout's
 * `.claude/settings.local.json`, so it is remembered for that branch and goes
 * when the branch does.
 *
 * Answers are arrays even for a question that takes one, so the shape does not
 * depend on `multiSelect` — one place to join them instead of two to get wrong.
 */
export type WorktreeChatAnswer =
  | { kind: "allow"; always?: boolean }
  | { kind: "deny" }
  | { kind: "answers"; answers: Record<string, string[]> }

/**
 * The three MCP servers the studio can put in front of an agent: the
 * workspace's databases, its saved requests, and its notes.
 *
 * One per panel rather than one server with everything on it, because the
 * switch in Settings is per panel: somebody who wants an agent to read their
 * schema has not thereby agreed to let it send their saved requests. The names
 * are the URL's last segment and the server's name in the CLI's config, so a
 * tool the agent calls says which of the three it came from
 * (`mcp__tabomni-database__query`).
 */
export type McpServerName = "database" | "api" | "notes"

/**
 * Which environment the API panel has selected.
 *
 * Spelled out here rather than in either side's own file: the panel writes it
 * and the MCP server reads it, because a request an agent sends has to go to
 * the same host the panel would have sent it to.
 */
export const HTTP_ENVIRONMENT_KEY = "http.environment"

export const MCP_SERVER_NAMES: McpServerName[] = ["database", "api", "notes"]

/**
 * Where each server's switch is kept — written by the Settings dialog, read by
 * the main process both when a session starts and on every tool call.
 *
 * Absent means off. That is the whole of the default: a workspace that has
 * never been to Settings hands an agent nothing.
 */
export const MCP_SETTING_KEYS: Record<McpServerName, string> = {
  database: "mcp.database",
  api: "mcp.api",
  notes: "mcp.notes",
}

export type TerminalOutput = {
  terminalId: string
  /** Raw bytes from the shell, ANSI escapes included. */
  chunk: string
}

export type TerminalExit = {
  terminalId: string
  exitCode: number
  /** Set when the shell was killed by a signal rather than exiting. */
  signal: number | null
}

export type SqlField = {
  name: string
  /** An engine-specific type code. Only used to label columns. */
  dataTypeID: number
  /**
   * Where this value actually comes from, when it's a direct column
   * reference rather than a computed expression — and, for Postgres, when
   * `dbExec` was asked to resolve it (see `resolveSources` below). Lets the
   * UI treat a query's own result like a browsed table's: editable once every
   * field traces back to one table's own row. `schema` is always `""` for
   * MySQL, which has no notion of one separate from the database itself.
   */
  source?: { schema: string; table: string; column: string }
}

/**
 * One result set. Rows are arrays rather than objects so that a query selecting
 * the same column name twice — or no column name at all — still round-trips.
 */
export type SqlResult = {
  fields: SqlField[]
  rows: unknown[][]
  /** Rows written by an INSERT/UPDATE/DELETE. Absent for a SELECT. */
  affectedRows?: number
}

/**
 * One saved HTTP request.
 *
 * Kept in the studio's own directory rather than in any of the workspace's
 * folders, so trying an endpoint never writes a file into someone's working
 * tree.
 */
export type HttpRequestRecord = {
  id: string
  name: string
  method: string
  /** As typed. `{{name}}` variables are resolved against the active
   * environment when the request is sent. */
  url: string
  headers: HttpHeader[]
  /**
   * Query parameters the user unticked.
   *
   * A ticked parameter lives in `url` and nowhere else — that is what keeps
   * the table and the URL from disagreeing. An unticked one has no place in a
   * URL at all, so it waits here with the position it should return to.
   */
  disabledParams?: HttpParkedParam[]
  body: string
  /**
   * Runs after this request's response arrives — reads it, can set an
   * environment variable. Empty or unset does nothing. Executed in a sandbox
   * outside this app's own window (see `runPostResponseScript`), never with
   * access to `DesktopApi`.
   */
  postResponseScript?: string
  /** The folder it sits in, or `null` at the top level. */
  folderId: string | null
  createdAt: string
  updatedAt: string
}

export type HttpParkedParam = {
  name: string
  value: string
  /** Its row in the table, counting the parked ones. */
  index: number
}

export type HttpHeader = {
  name: string
  value: string
  /** Unticked headers are kept but not sent. */
  enabled: boolean
}

/**
 * A group of requests, nested arbitrarily deep, that shares default headers
 * and params.
 *
 * A request has no URL of its own to round-trip a param against here, unlike
 * `HttpRequestRecord.disabledParams` — so `params` is shaped like `headers`
 * instead: every row always applies unless unticked.
 */
export type HttpFolder = {
  id: string
  name: string
  /** The folder it sits in, or `null` at the top level. */
  parentId: string | null
  headers: HttpHeader[]
  params: HttpHeader[]
  createdAt: string
  updatedAt: string
}

/**
 * A named set of variables, chosen one at a time.
 *
 * `{{name}}` is substituted anywhere in a request — URL, headers, body — so
 * the same collection can be pointed at local, staging or a colleague's
 * machine without editing every request.
 */
export type HttpEnvironment = {
  id: string
  name: string
  variables: HttpVariable[]
}

export type HttpVariable = {
  name: string
  value: string
}

/**
 * One cookie in the workspace's jar.
 *
 * Enough of RFC 6265 to be useful against a dev server, and no more: domain
 * and path matching, expiry, and `secure`. There is no browsing context here,
 * so `SameSite` has nothing to be same-site *with*, and `httpOnly` is kept
 * only to be shown — nothing in this app is a document that could read it.
 */
export type HttpCookie = {
  name: string
  value: string
  /** Never with a leading dot: `example.com`, matching `api.example.com`. */
  domain: string
  /** Set without a `Domain` attribute, so only its exact host may have it. */
  hostOnly: boolean
  path: string
  /** ISO 8601, or null for a cookie that was given no lifetime. */
  expiresAt: string | null
  secure: boolean
  httpOnly: boolean
}

export type HttpSendInput = {
  method: string
  /** Already resolved: the main process sends exactly this. */
  url: string
  headers: { name: string; value: string }[]
  /** Omitted for methods that carry no body. */
  body: string | null
  timeoutMs: number
}

export type HttpResponseResult = {
  status: number
  statusText: string
  headers: Record<string, string>
  /** The payload as text, or a description of it when it is not text. */
  body: string
  /** Whether `body` is the payload itself rather than a stand-in for bytes. */
  isText: boolean
  /** Bytes received. */
  size: number
  /** Round trip, in milliseconds. */
  timeMs: number
  /**
   * `Set-Cookie` lines, unparsed and unjoined.
   *
   * Separate from `headers` because a response may set several, and folding
   * them into one comma-joined string — which is all a plain header map can
   * hold — cannot be undone: an `Expires` date has a comma in it.
   */
  setCookies: string[]
}

/**
 * One chat in a project: a conversation the app hosts, not a pty it reads.
 *
 * The app hosts it rather than reading one the CLI wrote: one agent turn at a
 * time in the project's own directory, with the app holding the messages. There
 * used to be a session panel that did the opposite — the interactive CLI in a
 * pty, with a chat view tailing its transcript — and this is what replaced it.
 * See `main/worktree-chat.ts`.
 *
 * `id` is also the CLI session id, so the record and the conversation the CLI
 * resumes name the same thing.
 */
/**
 * `--effort`, weakest first.
 *
 * The CLI's own levels rather than a scale of this app's making, so what the
 * picker says and what the turn is given are the same word.
 */
export const CHAT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const

export type ChatEffort = (typeof CHAT_EFFORTS)[number]

/**
 * One model the user's own `claude` will answer on.
 *
 * **Asked of the CLI rather than written down here.** This was a list of four
 * aliases in this file, and the trouble with it is not that it went stale — it
 * is that it was never right for anybody in particular: which models an install
 * offers is a property of that account and that CLI version, so one machine's
 * list has `Opus (1M context)` and a Fable that needs credits while another's
 * has neither, and a hand-written `fable` was an alias no row on this machine's
 * list actually names. `agentModels` asks, and `CHAT_MODEL_FALLBACK` is what a
 * picker draws when the asking failed.
 *
 * `value` is what goes to `--model` and `label`/`description` are the CLI's own
 * words for it, so the picker cannot describe a model differently from the tool
 * that runs it. `efforts` is per model and not a constant: Haiku 4.5 supports
 * no effort levels at all, and an effort picker offering `max` over it is a
 * control that does nothing.
 */
export type AgentModel = {
  /** What `--model` is given. An alias (`opus`), a full id, or the CLI's own
   * `default` row. */
  value: string
  /** `Opus (1M context)` — the CLI's `displayName`. */
  label: string
  /** `Opus 5 with 1M context · Best for everyday, complex tasks`. */
  description: string
  /**
   * The levels this model accepts, weakest first.
   *
   * Three states rather than two, and the third is the point: a list is what
   * the CLI said, `[]` is the CLI saying this model takes no effort at all
   * (Haiku 4.5 does), and **null is nobody having been able to ask** — a
   * fallback row, or a build that read this off something older. Only the
   * second of the three takes the effort picker away; see `chatEfforts`.
   */
  efforts: ChatEffort[] | null
  /** Flag to render a `NEW` badge in the model picker. */
  isNew?: boolean
  /** Flag to render a star icon for recommended/favorite model. */
  isFavorite?: boolean
  /** Explicit sort order for the model picker. */
  order?: number
}

/**
 * What the picker draws when the CLI could not be asked, and until it answers.
 *
 * **Aliases the CLI resolves, and nothing else.** This list grew a set of
 * invented rows once — `Sonnet 5 1M`, `Opus 4.8 1M` and four more, with
 * hand-written labels, descriptions and effort levels — and every one of them
 * was a turn that failed on its argument list, because `--model sonnet-5-1m`
 * names no model on any account. What an install offers is a property of that
 * account and that CLI version, so the only thing safe to write down here is
 * the handful of aliases the CLI has always resolved for itself; anything
 * richer is `agentModels` asking. See `AgentModel`.
 *
 * `efforts` is null on every row for the same reason: nobody asked, so nobody
 * knows, and `chatEfforts` reads that as "offer them all" rather than as a
 * claim about the model.
 */
export const CHAT_MODEL_FALLBACK: AgentModel[] = [
  {
    value: "default",
    label: "Default (recommended)",
    description: "Whatever your claude is configured to use",
    efforts: null,
    isFavorite: true,
    order: 1,
  },
  {
    value: "opus",
    label: "Opus",
    description: "Frontier intelligence and deep reasoning",
    efforts: null,
    order: 2,
  },
  {
    value: "sonnet",
    label: "Sonnet",
    description: "Balanced speed and intelligence for daily tasks",
    efforts: null,
    order: 3,
  },
  {
    value: "haiku",
    label: "Haiku",
    description: "Fastest response time for lightweight tasks",
    efforts: null,
    order: 4,
  },
]

/**
 * The effort levels to offer over one model.
 *
 * Both sides of the same ignorance: a model this app has no row for — a chat
 * carrying a `--model` from a newer build, or a fallback row whose levels nobody
 * could ask about — gets all of them, because refusing a level the CLI would
 * have taken is worse than offering one it will not. Only a model the CLI
 * actually said takes none gets none, and that is what takes the picker away.
 */
export function chatEfforts(
  models: AgentModel[],
  model: string | null
): ChatEffort[] {
  const found = models.find((entry) => entry.value === model)
  return found?.efforts ?? [...CHAT_EFFORTS]
}

/**
 * How much a turn in this chat may do.
 *
 * `plan` and `read` are read-only, `edits` is what a chat opens on, `full` asks
 * nothing at all, and `ask` is the one that stops and puts the question on
 * screen. See `PERMISSIONS` in `main/worktree-chat.ts` for what each one
 * actually runs as.
 *
 * `ask` was impossible until the turn moved to the agent SDK: a `claude -p`
 * had nobody to answer a prompt, so a mode that ended by asking was a turn
 * that stalled. It is the reason the rest of this list is shaped the way it
 * is — four ways to decide up front, because deciding later could not be done.
 *
 * Ordered from least to most, which is the order the menu draws them in; `ask`
 * sits between the read-only pair and `edits`, since a turn that has to ask is
 * doing less on its own than one that does not.
 */
export const CHAT_PERMISSIONS = [
  "plan",
  "read",
  "ask",
  "edits",
  "full",
] as const

export type ChatPermission = (typeof CHAT_PERMISSIONS)[number]

/**
 * What a chat's own toolbar decides, held per chat.
 *
 * Per chat rather than per workspace because that is the unit somebody thinks
 * in: the checkout being refactored wants Opus at `max`, and the chat asking
 * where a function is called wants Haiku at `low`. The composer writes them
 * straight to the record, so a chat reopened after a restart is on the footing
 * it was left on.
 *
 * Whole rather than a patch, everywhere it is passed: three fields written at
 * once cannot half-arrive, and a `null` here means "whatever the user's own
 * `claude` does" rather than "unchanged".
 */
export type WorktreeChatOptions = {
  /** `--model`, or null for whichever model that `claude` is configured on. */
  model: string | null
  /** `--effort`, or null for the CLI's own default. */
  effort: ChatEffort | null
  /**
   * How much this chat's turns may do without being asked.
   *
   * One control rather than two: a plan toggle beside a permission picker is
   * two answers to one question, and "plan, with full access" is a state
   * neither of them meant. Read through `chatOptions` rather than off the
   * record, which is where the toggle this replaced is migrated.
   */
  permission: ChatPermission
  /**
   * The plan toggle this replaced, on records written before the picker.
   *
   * Kept only to be read: `chatOptions` turns a `true` here into
   * `permission: "plan"` and drops the field, so a chat left in plan mode
   * before an update comes back in it. Never written.
   */
  plan?: boolean
}

/**
 * What a new chat opens on.
 *
 * **`default` rather than null**, which is the one of these three that changed
 * and the reason it did: null passes no `--model` at all, so the turn runs on
 * whatever `~/.claude/settings.json` says — and somebody who set `"model":
 * "opus"` for their terminal had every chat in this app on Opus with nothing on
 * screen saying so. `default` is the CLI's own first row, which is the model it
 * recommends for the account; a chat that genuinely wants the global setting
 * can still pick `Inherit` and get null back.
 *
 * `effort` stays null for the reason it always was: the CLI's own default is a
 * judgement about the model, and naming a level here would be this app
 * overriding it for every chat.
 */
export const DEFAULT_CHAT_OPTIONS: WorktreeChatOptions = {
  model: "default",
  effort: null,
  permission: "edits",
}

/**
 * A record's options as the app uses them — defaults filled in, `plan`
 * migrated, and never the legacy field.
 *
 * One function on both sides of the contract rather than a `??` per caller:
 * main builds an argument list out of these and the composer draws them, and a
 * chat whose toolbar says one thing while its turn runs as another is the one
 * failure worth writing a function to make impossible.
 */
export function chatOptions(
  options?: WorktreeChatOptions | null
): WorktreeChatOptions {
  if (!options) return DEFAULT_CHAT_OPTIONS
  return {
    model: options.model ?? null,
    effort: options.effort ?? null,
    permission: readPermission(options),
  }
}

/**
 * The mode a record is on, as one of the four this build knows.
 *
 * Checked against the list rather than trusted, because these come off disk:
 * a chat written by a newer build names a mode nothing here has heard of, and
 * both sides would then draw a blank label over a turn assembled from
 * `undefined`. Falling back to the default is the one answer that is safe in
 * both directions — it is the least a chat can be on that is still useful.
 */
function readPermission(options: WorktreeChatOptions): ChatPermission {
  if (options.permission && CHAT_PERMISSIONS.includes(options.permission)) {
    return options.permission
  }
  // The toggle this replaced, on a record older than the picker.
  if (options.plan) return "plan"
  return DEFAULT_CHAT_OPTIONS.permission
}

/**
 * Where a chat runs: a project's own working tree.
 *
 * A record rather than a bare id because it is the shape everything about a
 * *place* is passed as — the dock's shells, `FileRoot`, a chat's own record —
 * and it was a pair while `git worktree` checkouts existed beside the project.
 * That whole layer is gone, and what is left is the project itself.
 */
export type ChatPlace = {
  folderId: string
}

/**
 * The place a record names, as the id everything keyed by place uses.
 *
 * Read through this rather than off the field, the way `chatOptions` is: a chat
 * written while chats lived in `git worktree` checkouts has a `worktreeId` and
 * may have no `folderId` at all, and there is nowhere left for it to run. Null
 * is what that reads as, and the listing drops it.
 */
export function chatRootId(chat: { folderId?: string }): string | null {
  return chat.folderId ?? null
}

export type WorktreeChat = {
  id: string
  /**
   * The project it belongs to, and the directory its turns run in.
   *
   * Optional because it was added after the record was, like `started`: a chat
   * written while chats lived in a `git worktree` checkout has only the
   * checkout's id, which names nothing now. Read it through `chatRootId`, which
   * is null for exactly those.
   */
  folderId?: string
  /** The first thing asked, shortened — `"Untitled"` until there is one. */
  title: string
  /**
   * Whether the CLI has been started on this id yet.
   *
   * On the record rather than in memory, because the CLI's own session outlives
   * this app's run: `id` is the session id, so a chat sent to before a restart
   * has to come back as `--resume`. Held in a `Set` at first, which was empty
   * again on every launch — the next message re-offered `--session-id` and the
   * CLI refused it as already in use, which is a chat that can never be
   * continued.
   *
   * Optional because it was added after the record was: a chat written before
   * this has no field, and `undefined` reads as "not started" — the wrong way
   * round for one that was, but only for one turn, and `--session-id` on a used
   * id fails loudly where `--resume` on an unused one fails just as loudly.
   */
  started?: boolean
  /**
   * The model, effort and permission this chat is on.
   *
   * Optional for the same reason `started` is: a chat written before the
   * toolbar existed has no field, and a missing one reads as
   * `DEFAULT_CHAT_OPTIONS` — which is exactly how those turns already ran.
   * Read it through `chatOptions`, never directly.
   */
  options?: WorktreeChatOptions
  createdAt: string
  updatedAt: string
}

/** One of those events, tagged with the chat it belongs to: several chats can
 * be answering at once, so a listener has to know which one this is. */
export type WorktreeChatEvent = AssistantEvent & { chatId: string }

/**
 * A group of notes, nested arbitrarily deep.
 *
 * Shaped like `HttpFolder` minus the cascading headers and params, because a
 * note folder inherits nothing down the tree — it is a place to put things and
 * not a set of defaults. Kept as its own type rather than a shared "folder" so
 * that giving one of the two panels something the other has no use for does
 * not mean widening a record both of them store.
 */
export type NoteFolder = {
  id: string
  name: string
  /** The folder it sits in, or `null` at the top level. */
  parentId: string | null
  createdAt: string
  updatedAt: string
}

/**
 * One note in the workspace — its listing, not its text.
 *
 * The body lives beside the manifest as its own `.md` file (see
 * `store.ts`'s `NOTES_DIR`) rather than inline here, for two reasons: a note
 * grows without bound and this list is rewritten whenever anything is renamed
 * or moved, and a directory of markdown files is something the user can grep,
 * open in an editor, or put under version control without this app's help.
 */
export type NoteRecord = {
  id: string
  name: string
  /** The note folder it is filed under, or `null` at the top level. Not a
   * workspace folder — notes belong to the workspace, not to a repository. */
  folderId: string | null
  createdAt: string
  updatedAt: string
}

/**
 * The language a note's fenced block carries when it holds a drawing.
 *
 * A drawing is a scene of shapes and images, which markdown has no syntax for,
 * so the note keeps only the id and the scene lives in its own file. A fence is
 * what that id travels in: it round-trips through any markdown parser
 * untouched, and a plain reader sees a short code block rather than a wall of
 * JSON. Shared because the renderer writes these and the store deletes the
 * files behind them.
 */
export const DRAWING_LANGUAGE = "drawing"

/**
 * A note's body, and which of the two formats it is in.
 *
 * A note is BlockNote's block model, written as JSON — the editor's own
 * document rather than a markdown rendering of it, because BlockNote's markdown
 * export is lossy by its own documentation and a note kept as markdown would
 * have been passed through that converter on every keystroke.
 *
 * `markdown` is what a note written by an older build still holds. The store
 * hands it over as it found it and says so, because the conversion needs a
 * parser that only the renderer has; the renderer converts once and the next
 * write leaves JSON behind. The markdown file is *not* deleted — it is the
 * user's own text and the migration is not the moment to be sure.
 */
export type NoteBody = {
  format: "blocks" | "markdown"
  text: string
}

/**
 * One block of a note's document — BlockNote's own model, as it is on disk.
 *
 * Deliberately structural rather than BlockNote's `Block`: everything that
 * walks a document does so without caring what is in it, and `Block` carries
 * the schema's three type parameters through every signature it touches.
 *
 * Here rather than beside the renderer's walks over it because the main
 * process reads the same file now — the preview server renders a note to HTML
 * itself (`main/note-html.ts`), so the shape of a note is no longer one side's
 * private business. It does not cross a channel; both sides read the format.
 */
export type NoteBlock = {
  id?: string
  type?: string
  props?: Record<string, unknown>
  content?: unknown
  children?: NoteBlock[]
}

/**
 * The machine's headroom, and this app's share of it, over the interval since
 * the previous reading.
 *
 * Memory is bytes and CPU is a percentage of the whole machine — every core
 * counted, so a single pinned core on a ten-core machine is 10%. Both of the
 * app's own figures are the sum over every process Electron runs, not just the
 * main one; neither counts the agent and shell sessions, which are children of
 * the pty daemon rather than of this app.
 */
export type SystemUsage = {
  /** How busy the machine's cores were, 0–100. */
  cpuPercent: number
  cores: number
  /** Physical memory, in bytes. */
  memoryTotal: number
  /**
   * What the kernel would hand out on demand — free pages plus the cache it
   * would evict for the asking, not free pages alone. See
   * `electron/system-usage.ts` for why the difference matters on macOS.
   */
  memoryAvailable: number
  /** This app's CPU, on the same all-cores scale as `cpuPercent`. */
  appCpuPercent: number
  /** The same figure as a percentage of one core, which is what Activity
   * Monitor and `top` show — it exceeds 100 for a busy multi-threaded app. */
  appCoreCpuPercent: number
  /** Resident memory across every process the app runs, in bytes. */
  appMemory: number
  appProcesses: number
}

/**
 * What `window.desktop` exposes. Every *method* is asynchronous because each
 * one crosses the IPC boundary; the handful of plain values are constants
 * captured in the preload.
 */
export type DesktopApi = {
  /** The host platform, for the few places the shell has to differ — the
   * window's title bar being one. */
  platform: "darwin" | "win32" | "linux"

  /** The workspace and the folders in it. Always resolves: a first run gets
   * an empty default workspace rather than nothing. */
  getWorkspace: () => Promise<WorkspaceRecord>
  /**
   * Points the workspace at an existing folder, worked on where it already is.
   *
   * Nothing is copied and nothing is written into it. Resolves with the whole
   * workspace rather than the new folder alone, so the renderer never has to
   * splice a list the main process just rewrote.
   */
  addFolder: (input: { path: string; name: string }) => Promise<WorkspaceRecord>
  renameFolder: (id: string, name: string) => Promise<WorkspaceRecord>
  /**
   * Drops a folder from the workspace. The directory itself is untouched —
   * what goes is the studio's record of it, which is all the studio ever had.
   */
  removeFolder: (id: string) => Promise<WorkspaceRecord>

  /** Opens a folder picker and resolves with the chosen path, or null. */
  pickDirectory: () => Promise<string | null>

  /** Opens a file picker scoped to images and resolves with the chosen
   * paths — empty when the user cancels. For the agent chat composer's
   * attach button. */
  pickImages: () => Promise<string[]>
  /**
   * Files, chosen in the OS picker and handed back as absolute paths.
   *
   * `directory` only says where the dialog opens — the paths come back from the
   * user's own click, so this is not a read and nothing is gated on it. Reading
   * one is still an ordinary `files:*` call and still inside `insideAny`.
   */
  pickFiles: (directory?: string) => Promise<string[]>
  /**
   * The real path behind a dropped/selected `File`, for the same composer's
   * drag-and-drop — a sandboxed, context-isolated renderer never gets one on
   * the `File` object itself. Unlike everything else here, this never
   * crosses into the main process: it runs entirely in the preload script,
   * which is where Electron's `webUtils.getPathForFile` must be called from.
   */
  getPathForFile: (file: File) => string
  /**
   * An image's bytes as a data URL, for the same composer's thumbnails.
   * The renderer's own origin (`app://studio`, or the dev server) is not
   * `file://`, and Chromium refuses to load a `file://` subresource from any
   * other origin — so the only way to preview a dropped/picked image is to
   * read it here and hand back bytes the `<img>` tag can use directly.
   */
  readImageDataUrl: (path: string) => Promise<string>
  /**
   * The image on the system clipboard, written to a temp file, as a path —
   * or null when the clipboard holds no image.
   *
   * For pasting a screenshot into a terminal, where the pty is a byte stream
   * in another process and a path is the only thing an image can be said in.
   * A file copied in Finder needs none of this: it has a path already, and
   * `getPathForFile` hands it over without a copy. This is the other case,
   * where the bytes exist nowhere but the clipboard.
   */
  clipboardImagePath: () => Promise<string | null>

  /** Subscribes to the File menu. Returns an unsubscribe function. */
  onMenuCommand: (listener: (command: MenuCommand) => void) => () => void

  /**
   * Fires when the notes on disk changed underneath the panel — which so far
   * means the MCP server wrote one for an agent (`main/mcp.ts`).
   *
   * A listing the renderer read at launch cannot notice that; without this a
   * note an agent had just written would not appear until the next run.
   */
  onNotesChanged: (listener: () => void) => () => void

  /**
   * The same, for the saved requests and the folders they are filed under: an
   * agent can write, move or delete one through the MCP server, and the API
   * panel is holding the collection it read at launch.
   *
   * It matters more here than for the notes, because the panel saves the whole
   * collection at once: a panel that never re-read would write its stale list
   * back over the agent's request the next time anything in it was edited. A
   * deletion is the other half — a tab onto a record that is gone can draw
   * nothing.
   */
  onRequestsChanged: (listener: () => void) => () => void

  /** Whether Docker is available, and why not when it is not — used when
   * creating a Docker-managed database. */
  dockerStatus: () => Promise<DockerStatus>

  /** The branch checked out in a folder, or null when it is not a git
   * repository. */
  gitBranch: (folderId: string) => Promise<string | null>
  /**
   * What git says about the files in a folder — for the colours Explorer draws
   * its rows in, and the `deleted` on a tab whose file has gone.
   *
   * Empty for a folder that is not a repository, which is an answer and not a
   * failure. Capped at `MAX_STATUS_ENTRIES`; see `main/git.ts` for why a
   * wholly untracked or ignored directory arrives as one entry rather than as
   * its contents.
   */
  gitStatus: (folderId: string) => Promise<GitStatusEntry[]>

  /**
   * What has changed in one folder, as a list.
   *
   * Ignored paths are left out — see `GitChange`.
   */
  gitChanges: (folderId: string) => Promise<GitChange[]>
  /**
   * A file as `HEAD` has it — the left-hand side of a diff.
   *
   * `null` when `HEAD` does not have it, which is the ordinary answer for a file
   * somebody has just written: the diff against it is the whole file added. Also
   * null for a directory that is not a repository at all, and for a repository
   * with no commits yet, both of which are the same thing to a diff.
   *
   * Takes the path rather than a root and a relative path, like every other read
   * of a file in the workspace, and is gated the same way.
   */
  fileAtHead: (filePath: string) => Promise<string | null>

  getSetting: (key: string) => Promise<string | null>
  setSetting: (key: string, value: string) => Promise<void>

  /** Every database or connection in the workspace. */
  listDatabases: () => Promise<DatabaseRecord[]>
  /**
   * Adds a database: either a new one in a Docker container, or a connection
   * to one that already exists.
   */
  createDatabase: (input: NewDatabaseInput) => Promise<DatabaseRecord>
  /**
   * Removes a database. For a Docker-managed one, this also removes its
   * container and data directory; for a connection, only the record goes — the
   * server itself is untouched.
   */
  /**
   * Changes a connection's details. Only for one the studio did not create:
   * a Docker-managed database's address is Docker's to decide and its
   * credentials were baked into the container, so nothing here could be
   * edited into anything but a broken record.
   */
  updateDatabase: (
    id: string,
    input: UpdateDatabaseInput
  ) => Promise<DatabaseRecord>
  deleteDatabase: (id: string) => Promise<void>
  /** Tries a connection without saving it, for the "Test connection" button. */
  testDatabaseConnection: (
    input: DatabaseConnectionInput
  ) => Promise<ConnectionTestResult>

  /**
   * Runs one parameterised statement against a database and returns
   * object-shaped rows.
   */
  dbQuery: <T>(
    databaseId: string,
    sql: string,
    params?: unknown[]
  ) => Promise<T[]>
  /**
   * Runs `sql` and returns one array-shaped result per statement. A statement
   * with parameters must be sent on its own: binding needs the extended
   * protocol, which handles a single statement.
   */
  dbExec: (
    databaseId: string,
    sql: string,
    params?: unknown[],
    /** `resolveSources: true` fills in each field's `source` (see
     * `SqlField`) — an extra round trip for Postgres, so it's opt-in rather
     * than paid by every call (schema introspection, the Data tab's paging,
     * …) that has no use for it. */
    options?: { resolveSources?: boolean }
  ) => Promise<SqlResult[]>
  /**
   * Deletes a Docker-managed database's data and recreates it empty. Rejects
   * for a connection to an external database — resetting someone else's
   * database is not this app's call to make.
   */
  dbReset: (databaseId: string) => Promise<void>

  /**
   * The Explorer's reads and writes, over the workspace's own folders.
   *
   * Every one of these takes an absolute path and is refused unless that path
   * is inside a folder the workspace has been added — see `insideAny` in
   * `main/files.ts`. That check is the reason these are a set of narrow calls
   * rather than a "run this fs operation" pair: the main process has to be able
   * to say what each one is allowed to touch.
   */
  listDirectory: (dirPath: string) => Promise<FileEntry[]>
  /** A file's text, or why there is none to show. */
  readTextFile: (filePath: string) => Promise<FileContent>
  writeTextFile: (filePath: string, text: string) => Promise<void>
  /** Both resolve to the new thing's absolute path, which is what the tree
   * selects and the strip opens. */
  createFile: (dirPath: string, name: string) => Promise<string>
  createDirectory: (dirPath: string, name: string) => Promise<string>
  /** Renames in place — a name, not a path, so this can never be a move out of
   * the workspace. Resolves to the new path. */
  renamePath: (target: string, name: string) => Promise<string>
  /** To the system trash, not `unlink`: this is somebody's source file, and the
   * OS already has the undo for it. */
  trashPath: (target: string) => Promise<void>
  /** Shows it in Finder/Explorer/the desktop's file manager. */
  revealPath: (target: string) => Promise<void>
  /**
   * An image in the workspace, as a `data:` URL the pane can draw.
   *
   * Bytes rather than a path because the renderer is not on a `file://` origin
   * and Chromium will not load a `file://` subresource from any other one —
   * the same reason the chat composer's attachments are read this way. This is
   * the checked twin of `readImageDataUrl`: that one takes a path from a
   * system picker, this one takes a path from the tree and so is held to the
   * workspace's folders like every other `files:*` call.
   */
  readImageFile: (filePath: string) => Promise<string>
  /**
   * A picture next to a document, as a `data:` URL.
   *
   * The markdown preview's `./logo.png` — a relative URL a browser has no base
   * to resolve against. `dir` is the directory of the document that named it;
   * main joins the two, since the renderer never builds a path, and the join
   * is held to the workspace's folders like the path in `readImageFile`.
   */
  readImageRelative: (dir: string, relative: string) => Promise<string>
  /**
   * The TypeScript server's answers, for the editor's tooltips and its
   * go-to-definition.
   *
   * A real `tsserver` in the main process — the folder's own copy where it has
   * one — because nothing in the renderer can see past the file in front of it
   * and can therefore say nothing about an import. See `main/tsserver.ts`.
   *
   * The three sync calls are how it learns what is in the editor rather than
   * what is on disk: without them a hover would answer for the last saved
   * version, at positions that no longer line up with what is on screen.
   */
  tsOpen: (filePath: string, text: string) => Promise<void>
  tsChange: (filePath: string, text: string) => Promise<void>
  tsClose: (filePath: string) => Promise<void>
  /** Both take 1-based line and column, which is what tsserver counts in — the
   * editor converts (`placeOf` in `lib/files/typescript.ts`), since CodeMirror
   * addresses a document by offset. Null and empty rather than an error for
   * "nothing here". */
  tsHover: (
    filePath: string,
    line: number,
    column: number
  ) => Promise<TsHover | null>
  tsDefinition: (
    filePath: string,
    line: number,
    column: number
  ) => Promise<TsDefinition[]>

  /**
   * Every file in the workspace, for the search palette.
   *
   * A walk, not a read, and the only call here that is: `⌘P` has to answer for
   * files nothing has opened a directory of yet. Build directories are skipped
   * (`IGNORED_DIRECTORIES`) and the result is capped (`MAX_INDEXED_FILES`) —
   * the tree remains the way to anything past either line. Nothing caches it in
   * the main process; the renderer asks once and holds it for the run.
   */
  listWorkspaceFiles: () => Promise<FileIndexEntry[]>

  /**
   * The directories the tree wants told about — every folder it has open, as
   * one set that replaces whatever was being watched before.
   *
   * The whole set rather than a watch/unwatch pair because the renderer already
   * holds it: `expanded` is what is on screen, and a call that says "these" can
   * never leave the main process watching a folder that was collapsed while a
   * message was in flight. Anything outside the workspace's folders is dropped
   * on arrival, like every other `files:*` call, and each folder's own `.git`
   * is added to whatever is sent — a commit changes every colour in the tree
   * and no directory the tree has open.
   */
  watchDirectories: (dirs: string[]) => Promise<void>
  /** Subscribes to those directories changing. Returns an unsubscribe
   * function. */
  onDirectoryChanged: (listener: (event: DirectoryChange) => void) => () => void

  /** The workspace's saved requests, oldest first. */
  listRequests: () => Promise<HttpRequestRecord[]>
  /** Replaces the whole collection: the renderer owns the list, and one write
   * per change keeps the file and the panel from drifting apart. */
  saveRequests: (requests: HttpRequestRecord[]) => Promise<void>
  /** The workspace's environments. */
  listEnvironments: () => Promise<HttpEnvironment[]>
  saveEnvironments: (environments: HttpEnvironment[]) => Promise<void>

  /** The groups those requests are filed under — not to be confused with the
   * workspace's own folders, which are directories on disk. */
  listRequestFolders: () => Promise<HttpFolder[]>
  saveRequestFolders: (folders: HttpFolder[]) => Promise<void>

  /** The workspace's cookie jar. */
  listCookies: () => Promise<HttpCookie[]>
  saveCookies: (cookies: HttpCookie[]) => Promise<void>

  /**
   * The models the user's own `claude` offers, for the composer's picker.
   *
   * Asked of the CLI over the agent SDK's control channel rather than being a
   * list in the contract — see `AgentModel`. It costs a `claude` process and no
   * tokens, and main holds the answer for the run, so a renderer may call it as
   * often as a picker opens. Empty where the CLI could not be asked, which is
   * the picker's cue to draw `CHAT_MODEL_FALLBACK`.
   */
  agentModels: () => Promise<AgentModel[]>
  /** Every chat in every project — the listing; the lines are read one chat
   * at a time. */
  listWorktreeChats: () => Promise<WorktreeChat[]>
  /** A new, empty chat in a checkout or in a project's own working tree. Made
   * up front so the tab exists before anything has been said in it. */
  createWorktreeChat: (place: ChatPlace) => Promise<WorktreeChat>
  readWorktreeChat: (id: string) => Promise<AssistantMessage[]>
  deleteWorktreeChat: (id: string) => Promise<void>
  /** What a chat is called. Its title is the first thing asked in it until
   * somebody names it, and a name is what it is found by later. An empty one is
   * ignored rather than blanking the row. */
  renameWorktreeChat: (id: string, title: string) => Promise<void>
  /**
   * The model, effort and permission for one chat.
   *
   * Its own call rather than an argument to `sendWorktreeChat`, because the
   * toolbar is used before anything is sent: somebody picks Haiku and then
   * types, and a choice that only landed with a message would be a control that
   * looks set and is not.
   */
  setWorktreeChatOptions: (
    id: string,
    options: WorktreeChatOptions
  ) => Promise<void>
  /**
   * Answers what a turn stopped to ask — see `WorktreeChatAsk`.
   *
   * Named by ask id rather than by chat, even though a chat has at most one
   * pending at a time: the card is on screen while the turn is paused, and an
   * answer that arrived for the question before it would otherwise be applied
   * to this one. An id nothing is waiting on is ignored.
   */
  answerWorktreeChatAsk: (
    askId: string,
    answer: WorktreeChatAnswer
  ) => Promise<void>
  /** Runs one turn. Rejects when that chat is still answering. */
  sendWorktreeChat: (id: string, prompt: string) => Promise<void>
  /** Kills the turn in flight. There is nothing gentler in print mode. */
  stopWorktreeChat: (id: string) => Promise<void>
  /** Every chat's events, tagged with the chat. Returns an
   * unsubscribe. */
  onWorktreeChatEvent: (
    listener: (event: WorktreeChatEvent) => void
  ) => () => void

  /** Every note in the workspace, and the folders they are filed under —
   * their listings only; a body is read one at a time. */
  listNotes: () => Promise<NoteRecord[]>
  saveNotes: (notes: NoteRecord[]) => Promise<void>
  listNoteFolders: () => Promise<NoteFolder[]>
  saveNoteFolders: (folders: NoteFolder[]) => Promise<void>

  /** One note's body. Empty for a note whose file does not exist yet — which
   * is every note until the first thing is typed into it. */
  readNote: (id: string) => Promise<NoteBody>
  /** Takes the format too, so that copying a note an older build wrote — which
   * `duplicate` does before anything has converted it — lands as the markdown
   * it still is rather than as markdown in a file named `.json`. */
  writeNote: (id: string, body: NoteBody) => Promise<void>
  /** Deletes those notes' bodies. Takes a list because deleting a folder
   * takes every note under it, and one call is one pass over the directory. */
  deleteNotes: (ids: string[]) => Promise<void>

  /**
   * Where this note can be read outside the studio — a loopback URL to paste
   * into a browser, or to hand to something that reads pages.
   *
   * Asking for it is what starts the server, so a workspace whose notes are
   * never shared never binds a port. The URL carries a secret this run
   * generated, so it is only guessable by whoever was given it.
   */
  notePreviewUrl: (id: string) => Promise<string>

  /**
   * One drawing's scene, as the text of its `.excalidraw` file — Excalidraw's
   * own format, so a scene can be opened at excalidraw.com or in the editor's
   * desktop app without this studio.
   *
   * Text rather than a parsed object: the main process only stores it, and a
   * type here would be this app's second opinion about a schema Excalidraw
   * owns. Empty for a drawing that has never been saved.
   */
  readDrawing: (id: string) => Promise<string>
  writeDrawing: (id: string, scene: string) => Promise<void>
  /** Deletes those drawings' scenes — what deleting the note holding them
   * takes with it. */
  deleteDrawings: (ids: string[]) => Promise<void>
  /**
   * The drawing as a picture, written beside its scene whenever the scene is
   * saved.
   *
   * For the preview server, which renders a note in the main process and so
   * has no Excalidraw to draw a scene with — turning one into an image needs a
   * canvas and a font stack, which is a renderer. This is that export, done
   * once by the side that already has the editor loaded. Always the light
   * rendering: the preview page is one page and does not follow the studio's
   * theme toggle.
   */
  writeDrawingSvg: (id: string, svg: string) => Promise<void>

  /**
   * A file dropped into a note — a picture, in practice — kept in the workspace
   * so the note still has it once the file it came from has moved.
   *
   * The name is the renderer's, `<uuid>.<ext>`, and is checked before it becomes
   * a filename for the same reason a note id is. The bytes cross as a
   * `Uint8Array` rather than base64: this is the one call in the contract that
   * carries a file's contents, and structured clone already moves bytes without
   * a third of them being spent on the encoding.
   *
   * See `shared/note-files.ts` for the URL the note writes down, and why these
   * are files rather than data URLs in the document.
   */
  writeNoteFile: (fileName: string, bytes: Uint8Array) => Promise<void>
  /** Copies one — what duplicating a note does, so that the copy and the
   * original do not share a file either of them can delete. */
  copyNoteFile: (fromName: string, toName: string) => Promise<void>
  /** Deletes them, along with the notes that held them. */
  deleteNoteFiles: (fileNames: string[]) => Promise<void>

  /**
   * Sends one request from the main process rather than the renderer, which
   * puts it outside the page's origin: no CORS preflight, no cookie jar, and
   * headers a browser would refuse to set are sent as typed.
   */
  httpSend: (input: HttpSendInput) => Promise<HttpResponseResult>

  /** Runs a command in one of the folders; resolves with its process id. */
  startProcess: (
    folderId: string,
    command: string,
    args: string[]
  ) => Promise<string>
  stopProcess: (processId: string) => Promise<void>

  /** Subscribes to process output. Returns an unsubscribe function. */
  onProcessOutput: (listener: (event: ProcessOutput) => void) => () => void
  /** Subscribes to process exits. Returns an unsubscribe function. */
  onProcessExit: (listener: (event: ProcessExit) => void) => () => void

  /**
   * Opens a shell in one of the folders and resolves with the id its events are
   * tagged with.
   *
   * The user's own login shell, and the only thing this starts: the agent CLIs
   * used to be kinds of session here, and what runs one now is a project's chat
   * (`main/worktree-chat.ts`) rather than a pty the renderer asked for.
   *
   * The folder is named by **id** rather than by path, so main resolves the
   * directory from its own record: a path handed over by the renderer would be
   * a cwd this process had to validate, and the rule here is that the renderer
   * never names a directory main has not already written down (`insideAny` in
   * `files.ts` is the same rule for reads).
   */
  terminalCreate: (
    folderId: string,
    cols: number,
    rows: number
  ) => Promise<string>
  /** Sends keystrokes to a shell. */
  terminalWrite: (terminalId: string, data: string) => Promise<void>
  /** Tells a shell its new size. */
  terminalResize: (
    terminalId: string,
    cols: number,
    rows: number
  ) => Promise<void>
  terminalKill: (terminalId: string) => Promise<void>

  /** Subscribes to shell output. Returns an unsubscribe function. */
  onTerminalData: (listener: (event: TerminalOutput) => void) => () => void
  /** Subscribes to shells exiting. Returns an unsubscribe function. */
  onTerminalExit: (listener: (event: TerminalExit) => void) => () => void

  /**
   * The machine's CPU and memory headroom, and this app's share of it,
   * measured since the previous call — see `electron/system-usage.ts`.
   *
   * Polled, deliberately, rather than pushed: a reading only exists because
   * something asked for it, and the interval between two asks is the interval
   * the percentages are averaged over.
   */
  systemUsage: () => Promise<SystemUsage>
}

/**
 * What the menus ask the renderer to do.
 *
 * The menu is a second way to reach things the renderer already owns rather
 * than a second implementation of them: the main process names the intent and
 * the renderer opens the same dialog a button used to, closes the tab ⌘W would
 * have closed, or shows the sidebar ⌘B would have shown.
 */
export type MenuCommand =
  "add-folder" | "close-tab" | "toggle-sidebar" | "open-settings"

/** IPC channel names, shared so main and preload cannot drift apart. */
export const IPC = {
  getWorkspace: "workspace:get",
  addFolder: "workspace:add-folder",
  renameFolder: "workspace:rename-folder",
  removeFolder: "workspace:remove-folder",
  pickDirectory: "workspace:pick-directory",
  pickImages: "workspace:pick-images",
  pickFiles: "workspace:pick-files",
  readImageDataUrl: "files:read-image-data-url",
  clipboardImagePath: "files:clipboard-image-path",
  menuCommand: "menu:command",
  notesChanged: "notes:changed",
  requestsChanged: "http:changed",
  dockerStatus: "docker:status",
  listDatabases: "databases:list",
  createDatabase: "databases:create",
  updateDatabase: "databases:update",
  deleteDatabase: "databases:delete",
  testDatabaseConnection: "databases:test-connection",
  gitBranch: "git:branch",
  gitStatus: "git:status",
  gitChanges: "git:changes",
  fileAtHead: "git:file-at-head",
  getSetting: "settings:get",
  setSetting: "settings:set",
  dbQuery: "db:query",
  dbExec: "db:exec",
  dbReset: "db:reset",
  listDirectory: "files:list",
  readTextFile: "files:read-text",
  writeTextFile: "files:write-text",
  createFile: "files:create-file",
  createDirectory: "files:create-directory",
  renamePath: "files:rename",
  trashPath: "files:trash",
  revealPath: "files:reveal",
  readImageFile: "files:read-image",
  readImageRelative: "files:read-image-relative",
  listWorkspaceFiles: "files:index",
  watchDirectories: "files:watch",
  directoryChanged: "files:changed",
  tsOpen: "ts:open",
  tsChange: "ts:change",
  tsClose: "ts:close",
  tsHover: "ts:hover",
  tsDefinition: "ts:definition",
  listRequests: "http:list",
  saveRequests: "http:save",
  listEnvironments: "http:list-environments",
  saveEnvironments: "http:save-environments",
  listRequestFolders: "http:list-folders",
  saveRequestFolders: "http:save-folders",
  listCookies: "http:list-cookies",
  saveCookies: "http:save-cookies",
  httpSend: "http:send",
  agentModels: "agent:models",
  listWorktreeChats: "worktree-chats:list",
  createWorktreeChat: "worktree-chats:create",
  readWorktreeChat: "worktree-chats:read",
  deleteWorktreeChat: "worktree-chats:delete",
  renameWorktreeChat: "worktree-chats:rename",
  setWorktreeChatOptions: "worktree-chats:options",
  answerWorktreeChatAsk: "worktree-chats:answer",
  sendWorktreeChat: "worktree-chats:send",
  stopWorktreeChat: "worktree-chats:stop",
  worktreeChatEvent: "worktree-chats:event",
  listNotes: "notes:list",
  saveNotes: "notes:save",
  listNoteFolders: "notes:list-folders",
  saveNoteFolders: "notes:save-folders",
  readNote: "notes:read",
  writeNote: "notes:write",
  deleteNotes: "notes:delete",
  notePreviewUrl: "notes:preview-url",
  readDrawing: "drawings:read",
  writeDrawing: "drawings:write",
  deleteDrawings: "drawings:delete",
  writeDrawingSvg: "drawings:write-svg",
  writeNoteFile: "note-files:write",
  copyNoteFile: "note-files:copy",
  deleteNoteFiles: "note-files:delete",
  startProcess: "process:start",
  stopProcess: "process:stop",
  processOutput: "process:output",
  processExit: "process:exit",
  terminalCreate: "terminal:create",
  terminalWrite: "terminal:write",
  terminalResize: "terminal:resize",
  terminalKill: "terminal:kill",
  terminalData: "terminal:data",
  terminalExit: "terminal:exit",
  systemUsage: "system:usage",
} as const
