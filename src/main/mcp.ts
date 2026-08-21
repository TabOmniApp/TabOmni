import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { writeFile } from "node:fs/promises"
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"
import path from "node:path"

import {
  MCP_SERVER_NAMES,
  type DatabaseRecord,
  type HttpEnvironment,
  type HttpFolder,
  type HttpHeader,
  type HttpRequestRecord,
  type HttpResponseResult,
  type HttpSendInput,
  type McpServerName,
  type NoteBody,
  type NoteFolder,
  type NoteRecord,
} from "../shared/api"
import {
  METHODS,
  resolveHeaders,
  substitute,
  variablesFrom,
  withFolderParams,
} from "../shared/http-request"
import { isDescendant } from "../shared/tree"
import { dataDir } from "./data-dir"
import { noteMarkdown, parseNote } from "./note-blocks"

/**
 * The workspace, as tools an agent can call — one MCP server per panel.
 *
 * The premise of the app is that a project's tooling belongs in one window;
 * this is the same premise one level down. A `claude` session started here is
 * already inside the workspace, so the databases it is pointed at, the requests
 * saved against them and the notes written about them are things the agent
 * should be able to read without being told how to reach them — and without a
 * second copy of the credentials living in some other config file.
 *
 * **One loopback server, three endpoints**, bound the way `preview.ts` binds
 * its own: 127.0.0.1, a port the OS picks, and a secret this run generated in
 * the first path segment. A fixed port with no secret would put the workspace's
 * databases in front of every process on the machine. Nothing has to find this
 * by convention — the only thing that ever reads the URL is the config file
 * written for a session that is starting.
 *
 * **Every call is checked against Settings**, not just the ones that were on
 * when the session started: turning a server off in the dialog has to mean the
 * agent cannot use it, and a session with an hour of conversation in it is not
 * something the user should have to restart to be listened to.
 *
 * Streamable HTTP rather than a stdio server, which is what saves a second
 * process: a stdio server would be a script spawned per session, and every one
 * of them would need its own way back to this app's state. The transport is
 * JSON-RPC over POST — the responses here are plain JSON rather than an event
 * stream, which the spec allows for a server that never pushes.
 */

/** Bound to nothing but this machine. */
const HOST = "127.0.0.1"

/** The secret in every URL's first path segment, in hex. */
const TOKEN_BYTES = 16

/** What this server speaks. A client asking for another version is answered in
 * its own — the exchange below is the same in all of them. */
const PROTOCOL_VERSION = "2025-06-18"

/** Bodies bigger than this are a mistake, not a tool call. */
const MAX_BODY_BYTES = 4 * 1024 * 1024

/** Rows a query hands back before it is cut short. A tool result is read by a
 * model with a context window, and "the first 200 rows" is a far better answer
 * than a million tokens of table. */
const MAX_ROWS = 200

/** Characters of an HTTP response body a tool result carries. */
const MAX_RESPONSE_CHARS = 20_000

/** What the servers are allowed to reach. Injected rather than imported, like
 * `NoteSource` in `preview.ts`: this file has no opinion about `~/.tabomni`. */
export type McpSource = {
  /** Whether this server is switched on in Settings, asked per call. */
  enabled: (server: McpServerName) => Promise<boolean>

  databases: () => Promise<DatabaseRecord[]>
  query: (
    databaseId: string,
    sql: string,
    params?: unknown[]
  ) => Promise<unknown[]>

  requests: () => Promise<HttpRequestRecord[]>
  requestFolders: () => Promise<HttpFolder[]>
  environments: () => Promise<HttpEnvironment[]>
  /** The environment the panel has selected, or null. */
  activeEnvironmentId: () => Promise<string | null>
  send: (input: HttpSendInput) => Promise<HttpResponseResult>
  createRequest: (input: RequestFields) => Promise<HttpRequestRecord>
  /** Only the fields given are touched. Rejects an id the collection no longer
   * has, since the panel may have deleted it since the agent listed it. */
  updateRequest: (
    id: string,
    patch: Partial<RequestFields>
  ) => Promise<HttpRequestRecord>
  /** Gone for good: the panel has no trash and no undo. */
  deleteRequest: (id: string) => Promise<void>
  createFolder: (input: FolderFields) => Promise<HttpFolder>
  updateFolder: (
    id: string,
    patch: Partial<FolderFields>
  ) => Promise<HttpFolder>
  /** The folder, the folders under it and their requests, the same cascade the
   * panel's own delete makes — the counts are what the agent reports back. */
  deleteFolder: (id: string) => Promise<{ folders: number; requests: number }>

  notes: () => Promise<NoteRecord[]>
  noteFolders: () => Promise<NoteFolder[]>
  noteBody: (id: string) => Promise<NoteBody>
  createNote: (input: {
    name: string
    folderId: string | null
    markdown: string
  }) => Promise<NoteRecord>
}

/** What an agent may set on a saved request. Not the whole record: an id and
 * the timestamps are the store's, and the post-response script runs in the
 * renderer's sandbox and is not something a tool call gets to write. */
export type RequestFields = {
  name: string
  method: string
  url: string
  headers: HttpHeader[]
  body: string
  folderId: string | null
}

/** What an agent may set on a request folder. The headers and params are the
 * cascade every request under it inherits, which is the only reason a folder is
 * more than a name. */
export type FolderFields = {
  name: string
  parentId: string | null
  headers: HttpHeader[]
  params: HttpHeader[]
}

type Json = Record<string, unknown>

type Tool = {
  name: string
  description: string
  inputSchema: Json
  /** Whatever it returns is what the agent reads: a string is handed over as
   * it is, anything else as formatted JSON. */
  run: (args: Json) => Promise<unknown>
}

export class McpServers {
  private server: Server | null = null
  private port = 0
  private readonly token = randomBytes(TOKEN_BYTES).toString("hex")
  private starting: Promise<number> | null = null

  constructor(private readonly source: McpSource) {}

  /**
   * The config a starting session is pointed at with `--mcp-config`, or null
   * when every server is switched off — in which case the session is started
   * with no flag at all rather than with an empty config.
   *
   * A file rather than the JSON inline on the command line: the URL carries
   * this run's secret, and a command line is readable by every process on the
   * machine while a file in `~/.tabomni` is not.
   */
  async configPath(): Promise<string | null> {
    const on: McpServerName[] = []
    for (const name of MCP_SERVER_NAMES) {
      if (await this.source.enabled(name)) on.push(name)
    }
    if (on.length === 0) return null

    const port = await this.start()
    const mcpServers: Json = {}
    for (const name of on) {
      mcpServers[`tabomni-${name}`] = {
        type: "http",
        url: `http://${HOST}:${port}/${this.token}/${name}`,
      }
    }

    const file = path.join(dataDir(), "mcp.json")
    // Readable by this user and nobody else: it holds the secret.
    await writeFile(file, JSON.stringify({ mcpServers }, null, 2), {
      mode: 0o600,
    })
    return file
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.starting = null
    if (!server) return

    await new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  }

  private start(): Promise<number> {
    if (this.server) return Promise.resolve(this.port)
    this.starting ??= new Promise<number>((resolve, reject) => {
      const server = createServer((request, response) => {
        void this.serve(request, response)
      })

      server.once("error", (error) => {
        this.starting = null
        reject(error)
      })
      server.listen(0, HOST, () => {
        const address = server.address()
        this.port = typeof address === "object" && address ? address.port : 0
        this.server = server
        resolve(this.port)
      })
    })
    return this.starting
  }

  private async serve(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    // A request with an `Origin` is a page's, and no page has any business
    // here: this is the DNS-rebinding guard the spec asks a local server for.
    if (request.headers.origin) return end(response, 403, "Forbidden")

    const [token, name, ...rest] = (request.url ?? "")
      .split("?")[0]!
      .split("/")
      .filter(Boolean)

    if (
      rest.length > 0 ||
      !token ||
      !matches(token, this.token) ||
      !isServerName(name)
    ) {
      return end(response, 404, "Not found")
    }

    // GET is the spec's optional server-to-client stream, and this server never
    // pushes; DELETE ends a session it never started.
    if (request.method !== "POST")
      return end(response, 405, "Method not allowed")

    let message: Json
    try {
      message = JSON.parse(await body(request)) as Json
    } catch (error) {
      return json(response, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: messageOf(error) },
      })
    }

    const id = message.id
    const method = typeof message.method === "string" ? message.method : ""

    // A notification — `notifications/initialized` is the one that arrives —
    // has no id and takes no reply.
    if (id === undefined || id === null) return end(response, 202, "")

    try {
      const result = await this.dispatch(name, method, asJson(message.params))
      return json(response, 200, { jsonrpc: "2.0", id, result })
    } catch (error) {
      return json(response, 200, {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: messageOf(error) },
      })
    }
  }

  private async dispatch(
    name: McpServerName,
    method: string,
    params: Json
  ): Promise<Json> {
    if (method === "initialize") {
      const asked = params.protocolVersion
      return {
        protocolVersion: typeof asked === "string" ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: `tabomni-${name}`, version: "1" },
      }
    }
    if (method === "ping") return {}

    if (method === "tools/list") {
      // An empty list rather than an error, so a session started while the
      // server was on and then switched off says "no tools" rather than
      // failing to connect.
      if (!(await this.source.enabled(name))) return { tools: [] }
      return {
        tools: this.tools(name).map(
          ({ name: tool, description, inputSchema }) => ({
            name: tool,
            description,
            inputSchema,
          })
        ),
      }
    }

    if (method !== "tools/call") {
      throw new Error(`Unknown method: ${method}`)
    }

    const tool = this.tools(name).find(
      (candidate) => candidate.name === params.name
    )
    if (!tool) throw new Error(`Unknown tool: ${String(params.name)}`)

    // Checked here and not only when the session started: the switch in
    // Settings is the answer at the moment of the call.
    if (!(await this.source.enabled(name))) {
      return toolError(
        `TabOmni's ${name} tools are switched off. Turn them on in Settings › MCP.`
      )
    }

    try {
      const result = await tool.run(asJson(params.arguments))
      return {
        content: [
          {
            type: "text",
            text:
              typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2),
          },
        ],
      }
    } catch (error) {
      // A failed tool is a result the model can read and correct — a bad table
      // name is a typo to fix, not a transport failure.
      return toolError(messageOf(error))
    }
  }

  private tools(name: McpServerName): Tool[] {
    switch (name) {
      case "database":
        return this.databaseTools()
      case "api":
        return this.apiTools()
      case "notes":
        return this.noteTools()
    }
  }

  private databaseTools(): Tool[] {
    const find = async (asked: unknown): Promise<DatabaseRecord> =>
      pick(
        await this.source.databases(),
        asked,
        "database",
        (record) => record.name
      )

    return [
      {
        name: "list_databases",
        description:
          "The databases this workspace is connected to: id, name, engine and where each one lives.",
        inputSchema: { type: "object", properties: {} },
        run: async () =>
          (await this.source.databases()).map((record) => ({
            id: record.id,
            name: record.name,
            engine: record.engine,
            host: record.host,
            port: record.port,
            database: record.database,
          })),
      },
      {
        name: "list_tables",
        description:
          "The tables and views in a database, with their schema. A starting point; anything more detailed is a query against information_schema.",
        inputSchema: {
          type: "object",
          properties: {
            database: {
              type: "string",
              description: "The database's id or name, from list_databases.",
            },
          },
          required: ["database"],
        },
        run: async (args) => {
          const record = await find(args.database)
          // The system schemas differ per engine and nothing else does — both
          // engines answer `information_schema.tables`.
          const hidden =
            record.engine === "postgres"
              ? ["pg_catalog", "information_schema"]
              : ["mysql", "information_schema", "performance_schema", "sys"]
          const placeholders = hidden
            .map((_, index) =>
              record.engine === "postgres" ? `$${index + 1}` : "?"
            )
            .join(", ")

          return this.rows(
            await this.source.query(
              record.id,
              `select table_schema, table_name, table_type
                 from information_schema.tables
                where table_schema not in (${placeholders})
             order by table_schema, table_name`,
              hidden
            )
          )
        },
      },
      {
        name: "query",
        description:
          `Runs SQL against one of the workspace's databases and returns the rows, at most ${MAX_ROWS} of them. ` +
          "Use parameters ($1, $2 for Postgres; ? for MySQL) rather than pasting values into the statement.",
        inputSchema: {
          type: "object",
          properties: {
            database: {
              type: "string",
              description: "The database's id or name, from list_databases.",
            },
            sql: { type: "string" },
            params: {
              type: "array",
              description: "Values for the statement's placeholders.",
              items: {},
            },
          },
          required: ["database", "sql"],
        },
        run: async (args) => {
          const record = await find(args.database)
          const sql = text(args.sql, "sql")
          const params = Array.isArray(args.params) ? args.params : undefined
          return this.rows(await this.source.query(record.id, sql, params))
        },
      },
    ]
  }

  /** Rows, cut to `MAX_ROWS`, saying so when they were cut. */
  private rows(rows: unknown[]): Json {
    return {
      rowCount: rows.length,
      truncated: rows.length > MAX_ROWS,
      rows: rows.slice(0, MAX_ROWS),
    }
  }

  private apiTools(): Tool[] {
    const find = async (asked: unknown): Promise<HttpRequestRecord> =>
      pick(
        await this.source.requests(),
        asked,
        "request",
        (record) => record.name
      )

    const findFolder = async (asked: unknown): Promise<HttpFolder> =>
      pick(
        await this.source.requestFolders(),
        asked,
        "request folder",
        (record) => record.name
      )

    /** The folder an argument names, or the top level. `null` is given
     * explicitly by `update_request` to move a request out of its folder, so it
     * is a value here rather than a missing one. */
    const folderId = async (
      asked: unknown,
      field = "folder"
    ): Promise<string | null> => {
      if (asked === undefined || asked === null) return null
      const wanted = text(asked, field).trim()
      if (!wanted) return null
      return pick(
        await this.source.requestFolders(),
        wanted,
        "request folder",
        (record) => record.name
      ).id
    }

    /** A request as it would actually go out: variables substituted, folders'
     * headers and params inherited. The panel's own resolution, from
     * `shared/http-request.ts`. */
    const resolve = async (request: HttpRequestRecord) => {
      const [environments, activeId, folders] = await Promise.all([
        this.source.environments(),
        this.source.activeEnvironmentId(),
        this.source.requestFolders(),
      ])
      const variables = variablesFrom(environments, activeId)
      const url = substitute(
        withFolderParams(request.url, request.folderId, folders),
        variables
      )
      return {
        method: request.method,
        url,
        headers: resolveHeaders(request, folders, variables),
        body: request.body ? substitute(request.body, variables) : null,
      }
    }

    return [
      {
        name: "list_requests",
        description:
          "The HTTP requests saved in this workspace: id, name, method and the URL as saved, with its {{variables}} unresolved. Also the folders they are filed under, with the headers and params each one lends to every request inside it.",
        inputSchema: { type: "object", properties: {} },
        run: async () => {
          const [requests, folders] = await Promise.all([
            this.source.requests(),
            this.source.requestFolders(),
          ])
          const byId = new Map(
            folders.map((folder) => [folder.id, folder.name])
          )
          return {
            // Listed here rather than by a tool of their own, and listed at all
            // because a folder can now be written: an empty one is invisible in
            // the requests alone, and naming a parent needs the folder to have
            // been seen.
            folders: folders.map((folder) => ({
              id: folder.id,
              name: folder.name,
              parent: folder.parentId ? byId.get(folder.parentId) : null,
              headers: folder.headers,
              params: folder.params,
            })),
            requests: requests.map((request) => ({
              id: request.id,
              name: request.name,
              method: request.method,
              url: request.url,
              folder: request.folderId ? byId.get(request.folderId) : null,
            })),
          }
        },
      },
      {
        name: "get_request",
        description:
          "One saved request, as saved and as it would be sent — the URL, headers and body with the active environment's variables filled in.",
        inputSchema: {
          type: "object",
          properties: {
            request: {
              type: "string",
              description: "The request's id or name, from list_requests.",
            },
          },
          required: ["request"],
        },
        run: async (args) => {
          const request = await find(args.request)
          return { saved: request, resolved: await resolve(request) }
        },
      },
      {
        name: "send_request",
        description:
          "Sends one of the saved requests and returns the response. It goes out exactly as the API panel would send it, against the active environment — a real request to a real server, so read what it does before calling it.",
        inputSchema: {
          type: "object",
          properties: {
            request: {
              type: "string",
              description: "The request's id or name, from list_requests.",
            },
          },
          required: ["request"],
        },
        run: async (args) => {
          const request = await find(args.request)
          const resolved = await resolve(request)
          if (!resolved.url.trim()) throw new Error("This request has no URL.")

          const response = await this.source.send({
            method: resolved.method,
            url: resolved.url,
            headers: resolved.headers,
            body: resolved.body,
            timeoutMs: 30_000,
          })

          return {
            request: { method: resolved.method, url: resolved.url },
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            timeMs: Math.round(response.timeMs),
            size: response.size,
            body: response.body.slice(0, MAX_RESPONSE_CHARS),
            truncated: response.body.length > MAX_RESPONSE_CHARS,
          }
        },
      },
      {
        name: "create_request",
        description:
          "Saves a new request in the API panel. Nothing is sent: this writes the request down, and send_request is what runs it. Write `{{variables}}` as they are — a URL of {{baseUrl}}/users is the right thing to save, since substitution happens when the request is sent.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "What the panel will call it.",
            },
            method: {
              type: "string",
              description: `One of ${METHODS.join(", ")}. Left out, GET.`,
            },
            url: {
              type: "string",
              description:
                "The URL as saved, query string and {{variables}} included.",
            },
            headers: HEADERS_SCHEMA,
            body: { type: "string" },
            folder: {
              type: "string",
              description:
                "The name or id of a request folder to file it under, from list_requests. Left out, it goes at the top level. The folder's own headers and params are inherited when the request is sent.",
            },
          },
          required: ["name", "url"],
        },
        run: async (args) => {
          const request = await this.source.createRequest({
            name: text(args.name, "name").trim() || "New request",
            method: methodOf(args.method, "GET"),
            url: text(args.url, "url"),
            headers: headerList(args.headers),
            body: optionalText(args.body, "body") ?? "",
            folderId: await folderId(args.folder),
          })
          return { id: request.id, name: request.name }
        },
      },
      {
        name: "update_request",
        description:
          "Changes a saved request. Only the fields given are touched and the rest are left alone — but `headers` replaces the whole list rather than merging into it, so read the request first with get_request and send back the list you want.",
        inputSchema: {
          type: "object",
          properties: {
            request: {
              type: "string",
              description: "The request's id or name, from list_requests.",
            },
            name: { type: "string" },
            method: {
              type: "string",
              description: `One of ${METHODS.join(", ")}.`,
            },
            url: { type: "string" },
            headers: HEADERS_SCHEMA,
            body: { type: "string" },
            folder: {
              type: ["string", "null"],
              description:
                "The name or id of a request folder to move it to. `null` moves it to the top level.",
            },
          },
          required: ["request"],
        },
        run: async (args) => {
          const existing = await find(args.request)

          const patch: Partial<RequestFields> = {}
          if (args.name !== undefined)
            patch.name = text(args.name, "name").trim()
          if (args.method !== undefined)
            patch.method = methodOf(args.method, existing.method)
          if (args.url !== undefined) patch.url = text(args.url, "url")
          if (args.headers !== undefined)
            patch.headers = headerList(args.headers)
          if (args.body !== undefined) patch.body = text(args.body, "body")
          // `in` rather than `!== undefined`: `null` is the way to move a
          // request out of its folder, and is a field that was given.
          if ("folder" in args) patch.folderId = await folderId(args.folder)

          if (Object.keys(patch).length === 0) {
            throw new Error(
              "Nothing to change. Give at least one of name, method, url, headers, body or folder."
            )
          }

          const request = await this.source.updateRequest(existing.id, patch)
          return { saved: request }
        },
      },
      {
        name: "delete_request",
        description:
          "Deletes a saved request. Permanent: the API panel has no trash and no undo, so the request and its headers, body and script are gone. Delete one because the user asked for that request to go, not to tidy up after yourself.",
        inputSchema: {
          type: "object",
          properties: {
            request: {
              type: "string",
              description: "The request's id or name, from list_requests.",
            },
          },
          required: ["request"],
        },
        run: async (args) => {
          const request = await find(args.request)
          await this.source.deleteRequest(request.id)
          return { deleted: { id: request.id, name: request.name } }
        },
      },
      {
        name: "create_folder",
        description:
          "Makes a folder in the API panel to file requests under. Its headers and params are lent to every request inside it, at any depth — which is what a folder is for beyond grouping: the collection's `Authorization` belongs on the folder rather than copied into each request.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            parent: {
              type: "string",
              description:
                "The name or id of a folder to nest this one in, from list_requests. Left out, it goes at the top level.",
            },
            headers: FOLDER_HEADERS_SCHEMA,
            params: FOLDER_PARAMS_SCHEMA,
          },
          required: ["name"],
        },
        run: async (args) => {
          const folder = await this.source.createFolder({
            name: text(args.name, "name").trim() || "New folder",
            parentId: await folderId(args.parent, "parent"),
            headers: headerList(args.headers),
            params: headerList(args.params, "params"),
          })
          return { id: folder.id, name: folder.name }
        },
      },
      {
        name: "update_folder",
        description:
          "Changes a folder. Only the fields given are touched, and `headers` and `params` each replace the whole list rather than merging into it — read them from list_requests first.",
        inputSchema: {
          type: "object",
          properties: {
            folder: {
              type: "string",
              description: "The folder's id or name, from list_requests.",
            },
            name: { type: "string" },
            parent: {
              type: ["string", "null"],
              description:
                "The name or id of a folder to move this one into. `null` moves it to the top level.",
            },
            headers: FOLDER_HEADERS_SCHEMA,
            params: FOLDER_PARAMS_SCHEMA,
          },
          required: ["folder"],
        },
        run: async (args) => {
          const existing = await findFolder(args.folder)

          const patch: Partial<FolderFields> = {}
          if (args.name !== undefined)
            patch.name = text(args.name, "name").trim()
          if (args.headers !== undefined)
            patch.headers = headerList(args.headers)
          if (args.params !== undefined)
            patch.params = headerList(args.params, "params")
          if ("parent" in args) {
            const parentId = await folderId(args.parent, "parent")
            // Refused with an answer rather than ignored: the panel's own drag
            // guard can be a silent no-op because the folder visibly stays
            // where it was, and a tool call has nothing to look at.
            if (
              parentId &&
              isDescendant(
                parentId,
                existing.id,
                await this.source.requestFolders()
              )
            ) {
              throw new Error(
                "A folder cannot be moved into itself or into one of its own subfolders."
              )
            }
            patch.parentId = parentId
          }

          if (Object.keys(patch).length === 0) {
            throw new Error(
              "Nothing to change. Give at least one of name, parent, headers or params."
            )
          }

          const folder = await this.source.updateFolder(existing.id, patch)
          return { saved: folder }
        },
      },
      {
        name: "delete_folder",
        description:
          "Deletes a folder, the folders inside it and every request they hold. Permanent, and it takes more than what was named: the counts come back so you can say what went. There is no trash and no undo, so delete a folder because the user asked for that folder to go.",
        inputSchema: {
          type: "object",
          properties: {
            folder: {
              type: "string",
              description: "The folder's id or name, from list_requests.",
            },
          },
          required: ["folder"],
        },
        run: async (args) => {
          const folder = await findFolder(args.folder)
          const gone = await this.source.deleteFolder(folder.id)
          return {
            deleted: { id: folder.id, name: folder.name },
            // Without the folder named — that is `deleted` above — so this is
            // exactly what a sentence back to the user has to own up to.
            alsoDeleted: {
              folders: gone.folders - 1,
              requests: gone.requests,
            },
          }
        },
      },
    ]
  }

  private noteTools(): Tool[] {
    return [
      {
        name: "list_notes",
        description:
          "The notes in this workspace: id, name, the folder each is filed under, and when it was last written.",
        inputSchema: { type: "object", properties: {} },
        run: async () => {
          const [notes, folders] = await Promise.all([
            this.source.notes(),
            this.source.noteFolders(),
          ])
          const byId = new Map(
            folders.map((folder) => [folder.id, folder.name])
          )
          return notes.map((note) => ({
            id: note.id,
            name: note.name,
            folder: note.folderId ? byId.get(note.folderId) : null,
            updatedAt: note.updatedAt,
          }))
        },
      },
      {
        name: "read_note",
        description:
          "One note as markdown. Drawings, pictures and attachments are named rather than included — they are files of the workspace's own.",
        inputSchema: {
          type: "object",
          properties: {
            note: {
              type: "string",
              description: "The note's id or name, from list_notes.",
            },
          },
          required: ["note"],
        },
        run: async (args) => {
          const note = pick(
            await this.source.notes(),
            args.note,
            "note",
            (record) => record.name
          )
          const body = await this.source.noteBody(note.id)
          // A note written by an older build is already markdown; the editor's
          // own model has to be rendered into it.
          return body.format === "markdown"
            ? body.text
            : noteMarkdown(parseNote(body.text))
        },
      },
      {
        name: "create_note",
        description:
          "Writes a new note into the workspace from markdown. Only ever creates: an existing note is never overwritten, because a note may hold drawings and pictures that markdown cannot carry.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            markdown: { type: "string" },
            folder: {
              type: "string",
              description:
                "The name or id of a note folder to file it under. Left out, it goes at the top level.",
            },
          },
          required: ["name", "markdown"],
        },
        run: async (args) => {
          const folders = await this.source.noteFolders()
          const folder =
            args.folder === undefined || args.folder === null
              ? null
              : pick(
                  folders,
                  args.folder,
                  "note folder",
                  (record) => record.name
                )

          const note = await this.source.createNote({
            name: text(args.name, "name").trim(),
            folderId: folder?.id ?? null,
            markdown: text(args.markdown, "markdown"),
          })
          return { id: note.id, name: note.name }
        },
      },
    ]
  }
}

/** The shape a request's headers and a folder's own rows all take: the
 * record's own, which is what `list_requests` and `get_request` hand back — a
 * model that read a list can write the same one back without reshaping it. */
function rowsSchema(what: string): Json {
  return {
    type: "array",
    description: `Replaces ${what}. \`enabled: false\` keeps a row without sending it, the way an unticked row in the panel does.`,
    items: {
      type: "object",
      properties: {
        name: { type: "string" },
        value: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["name", "value"],
    },
  }
}

const HEADERS_SCHEMA = rowsSchema("the request's headers")
const FOLDER_HEADERS_SCHEMA = rowsSchema(
  "the headers this folder lends to every request inside it"
)
const FOLDER_PARAMS_SCHEMA = rowsSchema(
  "the query parameters this folder adds to every request inside it"
)

function headerList(value: unknown, field = "headers"): HttpHeader[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new Error(`"${field}" must be a list of { name, value } objects.`)
  }
  return value.map((entry, index) => {
    const row = asJson(entry)
    const name = text(row.name, `${field}[${index}].name`).trim()
    if (!name) throw new Error(`"${field}[${index}].name" is empty.`)
    return {
      name,
      value: optionalText(row.value, `${field}[${index}].value`) ?? "",
      // A row an agent wrote is one it meant to send, unless it said so.
      enabled: row.enabled !== false,
    }
  })
}

/** A method the panel can actually draw. Anything else is refused rather than
 * saved: the picker only holds `METHODS`, so a request saved with some other
 * method would be a row the user can neither read nor correct. */
function methodOf(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback
  const wanted = text(value, "method").trim().toUpperCase()
  if (!(METHODS as readonly string[]).includes(wanted)) {
    throw new Error(
      `"${wanted}" is not a method this workspace saves. Use one of: ${METHODS.join(", ")}.`
    )
  }
  return wanted
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return text(value, field)
}

/** The one record an argument names, by id or by name. A name nothing matches
 * — or two records match — is the sort of mistake worth spelling out, since the
 * model's next move is to pick from the list it is given. */
function pick<T extends { id: string }>(
  records: T[],
  asked: unknown,
  kind: string,
  nameOf: (record: T) => string
): T {
  const wanted = text(asked, kind).trim()
  const byId = records.find((record) => record.id === wanted)
  if (byId) return byId

  const named = records.filter(
    (record) => nameOf(record).toLowerCase() === wanted.toLowerCase()
  )
  if (named.length === 1) return named[0]!

  const known = records.map(nameOf).join(", ") || "none"
  if (named.length > 1) {
    throw new Error(
      `More than one ${kind} is called "${wanted}". Use its id instead.`
    )
  }
  throw new Error(
    `No ${kind} called "${wanted}". This workspace has: ${known}.`
  )
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`"${field}" must be a string.`)
  return value
}

function toolError(message: string): Json {
  return { content: [{ type: "text", text: message }], isError: true }
}

function isServerName(value: string | undefined): value is McpServerName {
  return MCP_SERVER_NAMES.includes(value as McpServerName)
}

/** Constant-time, and over digests so two different lengths can be compared at
 * all — the same comparison `preview.ts` makes. */
function matches(given: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(given).digest(),
    createHash("sha256").update(expected).digest()
  )
}

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        request.destroy()
        reject(new Error("Request too large"))
        return
      }
      chunks.push(chunk)
    })
    request.on("error", reject)
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

function asJson(value: unknown): Json {
  return typeof value === "object" && value !== null ? (value as Json) : {}
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function json(response: ServerResponse, status: number, payload: Json): void {
  const text = JSON.stringify(payload)
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  })
  response.end(text)
}

function end(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" })
  response.end(message)
}
