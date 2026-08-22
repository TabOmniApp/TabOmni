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
  /** Set when it was found in a `git worktree` checkout of that folder rather
   * than in the folder itself. Two checkouts of one project hold the same
   * `relative` for every file, so the branch is the only thing that tells a
   * row from its twin. */
  worktreeId?: string
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
 * shared these types is gone, and a worktree's chat is the conversation left.
 */
export type AssistantMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string }
  /** A tool call, drawn as one line: what it was and what it was about. */
  | { id: string; role: "tool"; name: string; summary: string }
  | { id: string; role: "error"; text: string }

/**
 * One thing that happened while a turn was being answered.
 *
 * A turn is `claude -p` in `--output-format stream-json`, so what arrives is
 * the CLI's own event stream, narrowed to the three things a pane draws: a
 * message, a tool it called, and the end of the turn. Anything else in that
 * stream — the init line, a tool's result, the token counts — is read by
 * `main/claude-print.ts` and not passed on.
 */
export type AssistantEvent =
  /** One assistant message, as markdown. A turn can produce several. */
  | { type: "text"; text: string }
  /** A tool the assistant called, drawn as a line rather than in full: the
   * arguments are usually a SQL statement or a request name. */
  | { type: "tool"; name: string; summary: string }
  /** The turn is over, one way or the other. `error` is set when it failed —
   * including when `claude` itself could not be started. */
  | { type: "done"; error: string | null }

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
 * One `git worktree` of a workspace folder: a second checkout, on its own
 * branch, that this app created.
 *
 * The point is isolation. Two agents on one project stand on each other — the
 * same files, the same branch, the same index — and a worktree is git's own
 * answer to that: a directory and a branch of its own, sharing the single
 * object store, so nothing is copied and nothing is duplicated. It is what
 * Conductor is built on.
 *
 * **This is the one place the studio creates a directory.** Everywhere else a
 * folder is somewhere already on the machine, worked on where it is, and the
 * rule is that nothing is written into it that the user did not ask for. A
 * worktree is asked for, and it goes under `~/.tabomni/worktrees/` rather than
 * beside the repository — so a project's directory stays exactly as its owner
 * left it, and removing every worktree leaves no trace in it.
 *
 * The record is the app's own list, not git's. `git worktree list` is still the
 * truth about what exists on disk (see `worktrees()` in `main/git.ts`); this is
 * what lets the renderer name one by id and main resolve that to a cwd without
 * trusting a path from the renderer.
 */
export type WorktreeRecord = {
  id: string
  /** The workspace folder it was cut from. */
  folderId: string
  /** The branch checked out in it, created with it. */
  branch: string
  /** Absolute path to the checkout. */
  path: string
  /** What the branch was cut from — `HEAD`, `main`, `origin/main`. Kept so the
   * chat can say where this checkout came from; optional because it was added
   * after the record was. */
  from?: string
  createdAt: string
}

/**
 * One chat in a worktree: a conversation the app hosts, not a pty it reads.
 *
 * The app hosts it rather than reading one the CLI wrote: `claude -p` per turn
 * in the checkout's own directory, with the app holding the messages. There
 * used to be a session panel that did the opposite — the interactive CLI in a
 * pty, with a chat view tailing its transcript — and this is what replaced it.
 * See `main/worktree-chat.ts`, including why it runs with edits pre-approved.
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
 * The models a chat can be put on.
 *
 * Aliases rather than full names — `opus` is whichever Opus that `claude` is
 * the latest of — because pinning `claude-opus-5` here would mean this list
 * going stale every time the CLI learns a newer one. An alias it does not know
 * fails the turn loudly, which is why these are a list and not a text field.
 */
export const CHAT_MODELS: { id: string; label: string }[] = [
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "fable", label: "Fable" },
  { id: "haiku", label: "Haiku" },
]

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
   * A turn that reads and does not write: the plan, and nothing changed.
   *
   * Deliberately **not** `--permission-mode plan`, which cannot work in print
   * mode — leaving plan mode is `ExitPlanMode`, which is a prompt, and there is
   * nobody to answer it. See `PLAN_TOOLS` in `main/worktree-chat.ts`.
   */
  plan: boolean
}

/** A chat with nothing chosen: the CLI's own model and effort, and free to
 * edit, which is what the panel did before there was a toolbar. */
export const DEFAULT_CHAT_OPTIONS: WorktreeChatOptions = {
  model: null,
  effort: null,
  plan: false,
}

export type WorktreeChat = {
  id: string
  worktreeId: string
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
   * The model, effort and plan switch this chat is on.
   *
   * Optional for the same reason `started` is: a chat written before the
   * toolbar existed has no field, and a missing one reads as
   * `DEFAULT_CHAT_OPTIONS` — which is exactly how those turns already ran.
   */
  options?: WorktreeChatOptions
  createdAt: string
  updatedAt: string
}

/** One of those events, tagged with the chat it belongs to: several worktrees
 * can be answering at once, so a listener has to know which one this is. */
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
   *
   * `worktreeId` asks about one of that folder's checkouts instead, which is a
   * repository of its own with its own branch and its own uncommitted work —
   * the same `worktreeId ?? folderId` resolve `terminalCreate` does, and for
   * the same reason: an id, never a path. It falls back to the folder when the
   * checkout has gone, which is the honest answer for a root that is about to
   * leave the tree.
   */
  gitStatus: (
    folderId: string,
    worktreeId?: string | null
  ) => Promise<GitStatusEntry[]>

  /**
   * What has changed in one checkout, as a list.
   *
   * The same `worktreeId ?? folderId` resolve as `gitStatus`, and for the same
   * reason: a checkout is a repository of its own with its own uncommitted work.
   * Ignored paths are left out — see `GitChange`.
   */
  gitChanges: (
    folderId: string,
    worktreeId?: string | null
  ) => Promise<GitChange[]>
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
   * The TypeScript server's answers, for the editor's tooltips and its
   * go-to-definition.
   *
   * A real `tsserver` in the main process — the folder's own copy where it has
   * one — because Monaco's built-in worker sees a single file and can therefore
   * say nothing about an import. See `main/tsserver.ts`.
   *
   * The three sync calls are how it learns what is in the editor rather than
   * what is on disk: without them a hover would answer for the last saved
   * version, at positions that no longer line up with what is on screen.
   */
  tsOpen: (filePath: string, text: string) => Promise<void>
  tsChange: (filePath: string, text: string) => Promise<void>
  tsClose: (filePath: string) => Promise<void>
  /** Both take 1-based line and column, which is what tsserver and Monaco both
   * count in. Null and empty rather than an error for "nothing here". */
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

  /** Every chat in every worktree — the listing; the lines are read one chat
   * at a time. */
  listWorktreeChats: () => Promise<WorktreeChat[]>
  /** A new, empty chat in a worktree. Made up front so the tab exists before
   * anything has been said in it. */
  createWorktreeChat: (worktreeId: string) => Promise<WorktreeChat>
  readWorktreeChat: (id: string) => Promise<AssistantMessage[]>
  deleteWorktreeChat: (id: string) => Promise<void>
  /**
   * The model, effort and plan switch for one chat.
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
  /** Runs one turn. Rejects when that chat is still answering. */
  sendWorktreeChat: (id: string, prompt: string) => Promise<void>
  /** Kills the turn in flight. There is nothing gentler in print mode. */
  stopWorktreeChat: (id: string) => Promise<void>
  /** Every worktree chat's events, tagged with the chat. Returns an
   * unsubscribe. */
  onWorktreeChatEvent: (
    listener: (event: WorktreeChatEvent) => void
  ) => () => void

  /**
   * The worktrees this app has made, newest last.
   *
   * Reconciled against `git worktree list` on the way out, so a checkout
   * somebody removed by hand is not offered as somewhere to work.
   */
  listWorktrees: () => Promise<WorktreeRecord[]>
  /**
   * Adds a worktree to `folderId` on a new branch cut from `from`.
   *
   * Resolves to the record, or to an error message — a branch name already
   * taken is an ordinary answer a dialog has to show, not a fault. `from` is a
   * committish: `HEAD`, `main`, `origin/main`.
   */
  createWorktree: (
    folderId: string,
    branch: string,
    from: string
  ) => Promise<{ worktree: WorktreeRecord } | { error: string }>
  /** Removes the checkout and forgets the record. The **branch is kept**: the
   * commits are the work, and removing a directory is not a reason to drop
   * them. */
  removeWorktree: (id: string) => Promise<void>

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
    args: string[],
    /** Run in this worktree of the folder rather than in the folder itself —
     * an id, for the reason `terminalCreate` takes one. */
    worktreeId?: string
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
   * used to be kinds of session here, and what runs one now is a worktree's
   * chat (`main/worktree-chat.ts`) rather than a pty the renderer asked for.
   */
  terminalCreate: (
    folderId: string,
    cols: number,
    rows: number,
    /**
     * Run in this worktree of the folder rather than in the folder itself.
     *
     * An **id** rather than a path, so main resolves the directory from its own
     * record: a path handed over by the renderer would be a cwd this process
     * had to validate, and the rule here is that the renderer never names a
     * directory main has not already written down (`insideAny` in `files.ts` is
     * the same rule for reads).
     */
    worktreeId?: string
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
  listWorktreeChats: "worktree-chats:list",
  createWorktreeChat: "worktree-chats:create",
  readWorktreeChat: "worktree-chats:read",
  deleteWorktreeChat: "worktree-chats:delete",
  setWorktreeChatOptions: "worktree-chats:options",
  sendWorktreeChat: "worktree-chats:send",
  stopWorktreeChat: "worktree-chats:stop",
  worktreeChatEvent: "worktree-chats:event",
  listWorktrees: "worktrees:list",
  createWorktree: "worktrees:create",
  removeWorktree: "worktrees:remove",
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
