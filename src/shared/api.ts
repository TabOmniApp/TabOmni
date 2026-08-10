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

/** Just enough of a column for the agent to filter on it. */
export type AiFilterColumn = {
  name: string
  type: string
}

/** One endpoint the agent found while reading a folder's own source. */
export type ApiImportRequest = {
  name: string
  method: string
  url: string
  /** Headers the source suggests — auth, content-type, anything read off the
   * route/controller. Empty when nothing in the code implied one. */
  headers?: { name: string; value: string }[]
  /** A sample body, when the method takes one and the source implies a shape
   * (a DTO, an interface, a schema). Left out for GET/HEAD and whenever
   * nothing in the code suggests a shape. */
  body?: string
}

/**
 * A resource/controller-shaped group of endpoints, found by reading the
 * folder rather than a fixed spec parser.
 *
 * Flat, not nested: `HttpFolder.parentId` could nest arbitrarily deep, but an
 * import groups by "what file/controller this came from", which has no
 * sub-groups of its own. Every folder built from this lands at the top level.
 */
export type ApiImportFolder = {
  name: string
  requests: ApiImportRequest[]
}

/**
 * What "AI import" proposes after reading a folder. Nothing here is trusted
 * yet — see `aiImportApi`'s doc comment — and nothing is saved until the user
 * confirms in the dialog that shows this.
 */
export type ApiImportResult = {
  folders: ApiImportFolder[]
  /** Endpoints found with no folder to place them in. Imported at the top
   * level. */
  requests: ApiImportRequest[]
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
 * What a session in the Terminal panel runs, all of it on the host and in one
 * of the workspace's folders.
 *
 * `terminal` is the user's own shell; `claude` is a coding CLI installed on the
 * machine, which is the reason this is a union at all — that CLI being absent
 * is a normal state the panel has to show, not an error.
 *
 * Claude Code is one kind, not two. A session is always the interactive CLI in
 * a pty; whether it is drawn as a terminal or as a chat is a view the user
 * toggles, not a different thing to run — see `electron/transcript.ts` for how
 * the chat draws that same session.
 */
export type AgentKind = "terminal" | "claude"

/**
 * Whether one kind of session can be started on this machine.
 *
 * Reported per kind rather than as a single "tools are ready" flag, because the
 * picker offers each one separately: a missing CLI turns its row into an
 * install button and leaves the rest alone.
 */
export type AgentToolStatus = {
  kind: AgentKind
  installed: boolean
  /**
   * What the login shell resolved the command to — a path, or an alias
   * definition for the CLIs that install one. Shown as the row's subtext, and
   * null when nothing was found.
   */
  resolved: string | null
  /** Null for the shell, which is on every machine and installs nothing. */
  installCommand: string | null
}

/**
 * Which model a Claude Code session runs.
 *
 * Aliases rather than pinned model names (`--model opus`, not a dated id):
 * the CLI resolves an alias to the current model behind it, which is what
 * someone picking "Opus" from a menu means — a list of dated ids here would
 * be wrong within weeks and this app has no way to learn the new ones.
 * `default` passes no flag at all, leaving whatever the CLI is configured
 * with alone.
 */
export type ClaudeModel =
  "default" | "fable" | "opus" | "opusplan" | "sonnet" | "haiku"

/**
 * How much a Claude Code session asks before acting.
 *
 * A deliberate subset of the CLI's own `--permission-mode` choices.
 * `bypassPermissions` is left out because it does not work on its own — the
 * CLI refuses it unless the session was also launched with
 * `--dangerously-skip-permissions` — and `manual` because the CLI documents
 * it as an alias for the default, which `default` already is.
 */
export type ClaudePermissionMode = "default" | "plan" | "acceptEdits" | "auto"

/**
 * Where the workspace's choice of the two above is kept.
 *
 * Spelled out here rather than in each side's own file, so the renderer that
 * writes them and the main process that turns them into CLI flags cannot
 * disagree about the key. One choice for the workspace rather than one per
 * folder: it is a preference about how you like to work, not something a
 * repository has an opinion on.
 */
export const CLAUDE_MODEL_KEY = "claude.model"

export const CLAUDE_PERMISSION_MODE_KEY = "claude.permissionMode"

/**
 * Where one entry in the composer's `/` menu came from.
 *
 * Kept on the entry rather than resolved away, because the menu says it: two
 * rows can otherwise look identical and behave differently, and "is this
 * mine or the repository's?" is the first question about a command you did not
 * expect to see.
 */
export type ClaudeSlashSource =
  | "builtin"
  | "project-command"
  | "user-command"
  | "project-skill"
  | "user-skill"

/** One row of the composer's `/` menu — see `electron/claude-commands.ts`. */
export type ClaudeSlashCommand = {
  /** What is typed after the slash: `review`, `frontend:test`, `web-perf`. */
  name: string
  /** One line for the menu. Empty when the file declared no `description`. */
  description: string
  /** A command's own `argument-hint` frontmatter (`[pr-number]`), shown after
   * the name so a command that needs an argument looks like it does. Null for
   * skills and built-ins, which declare none. */
  argumentHint: string | null
  source: ClaudeSlashSource
}

export type TerminalOutput = {
  terminalId: string
  /** Raw bytes from the shell, ANSI escapes included. */
  chunk: string
}

/** One piece of an assistant turn, as the chat view draws it. */
export type TranscriptBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool-use"; toolUseId: string; name: string; input: unknown }

/**
 * One turn of a conversation.
 *
 * Deliberately this app's own vocabulary rather than the CLI's transcript
 * records passed through: that format grows fields with every CLI release, and
 * translating it in exactly one place (`electron/transcript.ts`) is what keeps
 * a version bump from reaching the components. A record that translation does
 * not recognise is ignored there, so a newer CLI adds nothing to what these
 * components must handle.
 */
export type TranscriptEntry =
  | { type: "user"; text: string }
  | { type: "assistant"; blocks: TranscriptBlock[] }
  | { type: "tool-result"; toolUseId: string; text: string; isError: boolean }

/**
 * What a conversation has spent, as the CLI's own transcript records it.
 *
 * Read off the `usage` the CLI copies onto every assistant line from the API
 * response it came from — not counted or estimated here. That is also the
 * limit of what this can be: these are one conversation's tokens, and there is
 * nothing on disk about the account's own five-hour or weekly allowance (the
 * TUI's `/usage` asks the API for it, and only reaches the file when a request
 * is actually refused).
 *
 * No cost: the CLI does not write one, and a figure this app worked out from a
 * price list it carries would be wrong the day prices move and meaningless on
 * a subscription.
 */
/**
 * The account's allowance, as the CLI last saw it.
 *
 * Percentages rather than token counts because that is all the usage endpoint
 * gives for a subscription — `/usage` in the TUI draws the same two bars from
 * the same numbers. Account-wide, so it is spent by every `claude` the user
 * runs, not only by the session in front of them.
 */
export type ClaudeUsageLimits = {
  /** Percent of the rolling five-hour window used, 0–100, or null when the
   * cache does not carry it. */
  sessionPercent: number | null
  /** Percent of the weekly window used, 0–100, or null. */
  weeklyPercent: number | null
  /** ISO timestamps the windows roll over at, when known. */
  sessionResetsAt: string | null
  weeklyResetsAt: string | null
  /**
   * When the CLI last asked the API, in epoch milliseconds — not when this app
   * read the file. The gap between the two is the age of the figures, and it
   * can be an hour: nothing this app does refreshes them.
   */
  fetchedAt: number | null
}

export type TranscriptUsage = {
  /**
   * How much context the most recent request carried — everything the model
   * was sent, cached or not.
   *
   * A level, not a total: it falls when the CLI compacts, which is the point
   * of showing it.
   */
  contextTokens: number
  /** The conversation's totals, summed over every request in it. Cache reads
   * are kept apart from `inputTokens` because they dwarf it — a long session
   * re-reads its whole prompt on every turn. */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  /** The model that answered most recently, or null if none has. `/model`
   * mid-conversation means the totals above may span more than one. */
  model: string | null
}

/**
 * What the chat view is told as a session's transcript is written.
 *
 * Only two shapes, because a file is only ever replaced or appended to:
 * `reset` is the whole conversation from the start, `append` is what has been
 * added since the last event. There is no per-token event and no "turn
 * finished" — the CLI writes a line once a message is complete, so message
 * boundaries are all a reader of the file can see.
 */
export type TranscriptEventBody = {
  type: "reset" | "append"
  entries: TranscriptEntry[]
  /**
   * Whether the agent still owes a reply — read from the transcript, not
   * guessed at from how recently it was written.
   *
   * The CLI records a `stop_reason` on every assistant message: `tool_use`
   * means it is going to carry on, anything else that it has stopped. A user
   * turn puts it back to true. That is the only account of a turn a reader of
   * the file gets, and it is an exact one.
   */
  working: boolean
  /**
   * The mode the session was in for its most recent turn, or null before it
   * has had one.
   *
   * The CLI writes a `permission-mode` record as each prompt is submitted —
   * not when the mode is changed. So this is authoritative but late: a mode
   * cycled with Shift+Tab shows up here only once the next message is sent.
   * What closes that gap is the terminal's own status line, which the pane
   * reads as it goes (`agent-session-view.tsx`).
   */
  permissionMode: ClaudePermissionMode | null
  /**
   * The conversation's usage so far, or null before it has had a reply.
   *
   * Carried on every event rather than sent as a delta: it is a running total
   * the pane draws whole, and a reader that missed one event would otherwise
   * be permanently short.
   */
  usage: TranscriptUsage | null
}

/**
 * One event, tagged with the pane it belongs to.
 *
 * The tag is the session tab's own id, not the CLI's: two tabs may be mirroring
 * two conversations, and it is the tab that has to tell them apart.
 */
export type TranscriptEvent = { mirrorId: string } & TranscriptEventBody

/** A conversation the CLI has on disk for a folder's directory. */
export type TranscriptSessionSummary = {
  /** The CLI's own session id — what `--session-id` set and the transcript
   * file is named after. */
  id: string
  /** The CLI's own generated title, or the session's first message if it has
   * not written one yet. */
  title: string
  /** The transcript file's own modification time. */
  updatedAt: number
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
 * Which of the Inbox panel's two servers caught something.
 *
 * One panel rather than two because they are the same job seen from both
 * sides: what the code sends out that never leaves the machine (mail), and
 * what someone else sends in that has nowhere to arrive (a webhook). The API
 * panel makes requests; this catches them.
 */
export type InboxKind = "mail" | "webhook"

/**
 * One file carried by a captured mail.
 *
 * `dataUrl` is the bytes, and null for anything past the inline ceiling — a
 * preview is what this is for, and holding a 40MB video in the message list to
 * be able to show its name is not worth the memory. There is deliberately no
 * "save to disk": the attachment came from the sender's own code, which
 * already has the file it attached.
 */
export type InboxAttachment = {
  filename: string
  contentType: string
  /** Decoded bytes, not the encoded length on the wire. */
  size: number
  dataUrl: string | null
}

export type InboxMail = {
  /** The envelope's `MAIL FROM`, which is what actually sent it — not the
   * `From:` header, which the message wrote about itself. */
  from: string
  /** Every `RCPT TO` of this transaction: who the message was really
   * delivered to, `Bcc` included, which no header shows. */
  to: string[]
  subject: string
  /** The `From:` and `To:` headers as written, already un-encoded from RFC
   * 2047 — what a mail client would put at the top of the message. */
  headerFrom: string
  headerTo: string
  /** The `text/plain` and `text/html` alternatives, each empty when the
   * message carried none. */
  text: string
  html: string
  attachments: InboxAttachment[]
  /** The whole message as it arrived, headers and encodings included. The one
   * view that can answer "is the app really sending what I think". */
  raw: string
}

export type InboxWebhook = {
  method: string
  /** Path and query string exactly as requested — the panel is a catch-all,
   * so the path is data rather than routing. */
  path: string
  query: { name: string; value: string }[]
  headers: { name: string; value: string }[]
  /** The payload as text, or empty when it was bytes; `isText` says which. */
  body: string
  isText: boolean
  /** Bytes received, whether or not they were kept as text. */
  size: number
}

type InboxCapture = {
  id: string
  /** ISO-8601, so the renderer decides how to say it. */
  receivedAt: string
  /** The one line the list shows: a subject, or a method and path. */
  summary: string
  /** Cleared when the message is opened. What makes the panel an inbox rather
   * than a log. */
  unread: boolean
}

/**
 * One thing either server caught.
 *
 * A union on `kind` rather than two nullable fields, so a mail view cannot be
 * handed a webhook by a component that forgot to check.
 */
export type InboxMessage = InboxCapture &
  (
    | { kind: "mail"; mail: InboxMail }
    | { kind: "webhook"; webhook: InboxWebhook }
  )

/**
 * Whether one of the two servers is up.
 *
 * `error` is almost always a port already in use — the one failure this panel
 * has to be able to say out loud, since the fix is to pick another number
 * rather than to try again.
 */
export type InboxServerStatus = {
  listening: boolean
  port: number
  error: string | null
}

/**
 * Both servers at once.
 *
 * Reported together even though the Mail and Webhooks panels are separate and
 * each starts its own: they are two entries in one map on one manager, and a
 * panel handed only its own half would have no way to notice the other going
 * down.
 */
export type InboxStatus = Record<InboxKind, InboxServerStatus>

/** Where the two servers' ports and auto-start choices are kept — see
 * `CLAUDE_MODEL_KEY` for why this is shared by both sides rather than a key
 * spelled out twice. */
export const INBOX_CONFIG_KEY = "inbox.config"

/** Mailpit's SMTP port, and one beside it for the webhook catcher. What each
 * panel's settings tab starts from. */
export const INBOX_DEFAULT_PORTS: Record<InboxKind, number> = {
  mail: 1025,
  webhook: 1026,
}

/** A message either server has just caught. */
export type InboxEvent = { message: InboxMessage }

/** Sent whenever either server starts, stops, or falls over on its own. */
export type InboxStatusEvent = { status: InboxStatus }

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

  /** Whether Docker is available, and why not when it is not — used when
   * creating a Docker-managed database. */
  dockerStatus: () => Promise<DockerStatus>

  /** The branch checked out in a folder, or null when it is not a git
   * repository. */
  gitBranch: (folderId: string) => Promise<string | null>

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
   * Turns a sentence into filter conditions, using the Claude Code CLI on this
   * machine. The result is a proposal: nothing is applied until the user says
   * so, and anything naming a column that does not exist is dropped.
   */
  aiFilter: (request: string, columns: AiFilterColumn[]) => Promise<FilterSet>

  /**
   * Reads one folder's own source with the Claude Code CLI and proposes API
   * folders/requests to import — routes, controllers, OpenAPI/Swagger specs,
   * GraphQL schemas, whatever it finds. A proposal only: nothing is saved
   * until the user confirms in the import dialog.
   */
  aiImportApi: (folderId: string) => Promise<ApiImportResult>

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
   * Sends one request from the main process rather than the renderer, which
   * puts it outside the page's origin: no CORS preflight, no cookie jar, and
   * headers a browser would refuse to set are sent as typed.
   */
  httpSend: (input: HttpSendInput) => Promise<HttpResponseResult>

  /**
   * Binds one of the two capture servers and resolves with the state of both.
   *
   * One at a time, because Mail and Webhooks are separate panels with separate
   * switches: the webhook catcher is worth leaving up all day, and the SMTP
   * sink is generally only wanted while mail is being worked on. Never
   * rejects — a port already in use comes back as `error` on that server,
   * since the fix is to pick another number rather than to try again.
   */
  inboxStart: (server: InboxKind, port: number) => Promise<InboxStatus>
  /** Closes one, keeping what it caught. */
  inboxStop: (server: InboxKind) => Promise<InboxStatus>
  inboxStatus: () => Promise<InboxStatus>

  /**
   * Everything both servers have caught, newest first.
   *
   * Both kinds in one list, filtered by whichever panel is asking: they share
   * a file and a cap, and two calls that each had to be told about the other's
   * half would be one more thing to keep in step.
   */
  inboxMessages: () => Promise<InboxMessage[]>
  /** Marks one message as having been opened. */
  inboxMarkRead: (id: string) => Promise<void>
  inboxDelete: (id: string) => Promise<void>
  /** Deletes one kind's captures, leaving the other panel's alone. */
  inboxClear: (server: InboxKind) => Promise<void>
  /**
   * Sends a captured webhook on to `url`, verbatim — same method, body and
   * headers, minus the hop-by-hop ones the new connection has to write for
   * itself.
   *
   * The point of catching one at all: a payment provider fires an event once,
   * and the handler that mishandled it can be run against that exact request
   * as many times as it takes. Rejects for a mail, which is not a request.
   */
  inboxReplay: (id: string, url: string) => Promise<HttpResponseResult>

  /** Subscribes to captures from either server. Returns an unsubscribe
   * function. */
  onInboxMessage: (listener: (event: InboxEvent) => void) => () => void
  /** Subscribes to either server going up or down. */
  onInboxStatus: (listener: (event: InboxStatusEvent) => void) => () => void

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
   * Which kinds of session this machine can run, in the order the picker
   * shows them. Each answer costs a login shell, so it is asked for when the
   * picker opens rather than kept live.
   */
  agentTools: () => Promise<AgentToolStatus[]>
  /**
   * Opens a shell running the install command for `kind` and resolves with the
   * id its events are tagged with — the same events as any other session, so
   * the install runs in a pane the user can read and answer.
   */
  agentInstall: (cols: number, rows: number, kind: AgentKind) => Promise<string>

  /**
   * What Claude Code's `/` menu would offer for a session in this folder —
   * the composer's own menu is built from it. Re-read per call rather than
   * cached, since a command file can be added while the app is open.
   */
  claudeCommands: (folderId: string) => Promise<ClaudeSlashCommand[]>

  /**
   * Opens a session of `kind` in one of the folders and resolves with the
   * id its events are tagged with.
   *
   * `claudeSessionId` is generated by the caller and passed to the CLI as
   * `--session-id`, which fixes the name of the transcript file the chat view
   * tails. Generated in the renderer rather than here because the caller is
   * also what remembers it for a reattach after the app is restarted — the
   * pty survives, so nothing runs a command again to learn it a second time.
   * Ignored for every kind but `claude`.
   */
  terminalCreate: (
    folderId: string,
    cols: number,
    rows: number,
    kind: AgentKind,
    claudeSessionId?: string
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
   * Starts mirroring a CLI session's transcript into `mirrorId`'s events —
   * what the chat view draws while the session itself runs in its pty.
   *
   * Reading only: nothing here starts, stops or writes to a `claude`. Calling
   * it again for the same `mirrorId` re-points it, which is how the sessions
   * drawer switches the pane to a different conversation.
   */
  transcriptWatch: (
    mirrorId: string,
    folderId: string,
    claudeSessionId: string
  ) => Promise<void>
  transcriptUnwatch: (mirrorId: string) => Promise<void>

  /** Conversations the CLI has on disk for this folder, most recent first —
   * not sessions this app started, necessarily; any `claude` run from that
   * directory writes to the same place. */
  claudeListSessions: (folderId: string) => Promise<TranscriptSessionSummary[]>

  /** The account's five-hour and weekly allowance, or null when the CLI has
   * never cached one. Read from `~/.claude.json`, never fetched — see
   * `electron/claude-usage.ts`. */
  claudeUsageLimits: () => Promise<ClaudeUsageLimits | null>

  /** Subscribes to transcript events for every mirror. Returns an unsubscribe
   * function. */
  onTranscriptEvent: (listener: (event: TranscriptEvent) => void) => () => void

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
 * What the File menu asks the renderer to do.
 *
 * The menu is a second way to reach dialogs the renderer already owns rather
 * than a second implementation of them: the main process names the intent and
 * the renderer opens the same dialog a button used to.
 */
export type MenuCommand = "add-folder"

/** IPC channel names, shared so main and preload cannot drift apart. */
export const IPC = {
  getWorkspace: "workspace:get",
  addFolder: "workspace:add-folder",
  renameFolder: "workspace:rename-folder",
  removeFolder: "workspace:remove-folder",
  pickDirectory: "workspace:pick-directory",
  pickImages: "workspace:pick-images",
  readImageDataUrl: "files:read-image-data-url",
  clipboardImagePath: "files:clipboard-image-path",
  menuCommand: "menu:command",
  dockerStatus: "docker:status",
  aiFilter: "db:ai-filter",
  aiImportApi: "api:ai-import",
  listDatabases: "databases:list",
  createDatabase: "databases:create",
  updateDatabase: "databases:update",
  deleteDatabase: "databases:delete",
  testDatabaseConnection: "databases:test-connection",
  gitBranch: "git:branch",
  getSetting: "settings:get",
  setSetting: "settings:set",
  dbQuery: "db:query",
  dbExec: "db:exec",
  dbReset: "db:reset",
  listRequests: "http:list",
  saveRequests: "http:save",
  listEnvironments: "http:list-environments",
  saveEnvironments: "http:save-environments",
  listRequestFolders: "http:list-folders",
  saveRequestFolders: "http:save-folders",
  listCookies: "http:list-cookies",
  saveCookies: "http:save-cookies",
  httpSend: "http:send",
  inboxStart: "inbox:start",
  inboxStop: "inbox:stop",
  inboxStatus: "inbox:status",
  inboxMessages: "inbox:messages",
  inboxMarkRead: "inbox:mark-read",
  inboxDelete: "inbox:delete",
  inboxClear: "inbox:clear",
  inboxReplay: "inbox:replay",
  inboxMessage: "inbox:message",
  inboxStatusChanged: "inbox:status-changed",
  startProcess: "process:start",
  stopProcess: "process:stop",
  processOutput: "process:output",
  processExit: "process:exit",
  agentTools: "agent:tools",
  agentInstall: "agent:install",
  claudeCommands: "agent:claude-commands",
  terminalCreate: "terminal:create",
  terminalWrite: "terminal:write",
  terminalResize: "terminal:resize",
  terminalKill: "terminal:kill",
  terminalData: "terminal:data",
  terminalExit: "terminal:exit",
  transcriptWatch: "transcript:watch",
  transcriptUnwatch: "transcript:unwatch",
  transcriptEvent: "transcript:event",
  claudeListSessions: "claude:list-sessions",
  claudeUsageLimits: "claude:usage-limits",
  systemUsage: "system:usage",
} as const
