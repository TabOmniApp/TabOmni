import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type {
  HttpFolder,
  HttpRequestRecord,
  McpServerName,
} from "../src/shared/api"
import { McpServers, type McpSource } from "../src/main/mcp"
import { check, finish, section } from "./harness"

/**
 * The MCP servers, spoken to the way the CLI speaks to them.
 *
 * A real socket and real JSON-RPC rather than calls into the class: what an
 * agent gets is decided by the wire — the token in the path, the method, the
 * shape of a `tools/call` result — and every one of those is a place where a
 * server that "works" is a server the CLI silently refuses to use. The source
 * behind it is a fake, since what the workspace holds is `store.ts`'s business
 * and the point here is the protocol and the gate in front of it.
 */

process.env.TABOMNI_DATA_DIR = await mkdtemp(
  path.join(tmpdir(), "tabomni-mcp-")
)

/** Which servers the fake Settings say are on. Mutated mid-run: turning one off
 * has to bite on the next call, not on the next launch. */
const on = new Set<McpServerName>(["database", "api", "notes"])

let sent = 0

/** The folders, mutable for the same reason as the requests below. */
const folders: HttpFolder[] = [
  {
    id: "folder-1",
    name: "API",
    parentId: null,
    headers: [
      { name: "Authorization", value: "Bearer {{token}}", enabled: true },
    ],
    params: [{ name: "trace", value: "1", enabled: true }],
    createdAt: "",
    updatedAt: "",
  },
]

/** The collection the writing tools work on, mutable the way the store is:
 * `create_request` has to be readable by `list_requests` afterwards, which is
 * the whole point of it. */
const requests: HttpRequestRecord[] = [
  {
    id: "req-1",
    name: "Users",
    method: "GET",
    url: "{{baseUrl}}/users",
    headers: [{ name: "X-Own", value: "own", enabled: true }],
    body: "",
    folderId: "folder-1",
    createdAt: "",
    updatedAt: "",
  },
]

const source: McpSource = {
  enabled: (server) => Promise.resolve(on.has(server)),

  databases: () =>
    Promise.resolve([
      {
        id: "db-1",
        name: "app",
        engine: "postgres",
        origin: "external",
        host: "localhost",
        port: 5432,
        user: "tabomni",
        database: "app",
        createdAt: "",
        updatedAt: "",
      },
    ]),
  query: (databaseId, sql) =>
    Promise.resolve([{ databaseId, sql, id: 1 }, { id: 2 }]),

  requests: () => Promise.resolve(requests),
  requestFolders: () => Promise.resolve(folders),
  environments: () =>
    Promise.resolve([
      {
        id: "env-1",
        name: "Local",
        variables: [
          { name: "baseUrl", value: "http://localhost:3000" },
          { name: "token", value: "secret" },
        ],
      },
    ]),
  activeEnvironmentId: () => Promise.resolve("env-1"),
  send: (input) => {
    sent += 1
    return Promise.resolve({
      status: 200,
      statusText: "OK",
      headers: {},
      body: JSON.stringify({ url: input.url, headers: input.headers }),
      isText: true,
      size: 2,
      timeMs: 1,
      setCookies: [],
    })
  },

  createRequest: (fields) => {
    const request: HttpRequestRecord = {
      id: `req-${requests.length + 1}`,
      ...fields,
      createdAt: "",
      updatedAt: "",
    }
    requests.push(request)
    return Promise.resolve(request)
  },
  updateRequest: (id, patch) => {
    const index = requests.findIndex((record) => record.id === id)
    if (index < 0) throw new Error("gone")
    const updated = { ...requests[index]!, ...patch }
    requests[index] = updated
    return Promise.resolve(updated)
  },
  deleteRequest: (id) => {
    requests.splice(
      requests.findIndex((record) => record.id === id),
      1
    )
    return Promise.resolve()
  },
  createFolder: (fields) => {
    const folder: HttpFolder = {
      id: `folder-${folders.length + 1}`,
      ...fields,
      createdAt: "",
      updatedAt: "",
    }
    folders.push(folder)
    return Promise.resolve(folder)
  },
  updateFolder: (id, patch) => {
    const index = folders.findIndex((record) => record.id === id)
    if (index < 0) throw new Error("gone")
    const updated = { ...folders[index]!, ...patch }
    folders[index] = updated
    return Promise.resolve(updated)
  },
  // The cascade itself is `descendantFolderIds` in `@shared/tree`, which
  // `test/tree.ts` covers; this stands in for the store doing it.
  deleteFolder: (id) => {
    const gone = new Set(
      folders
        .filter((record) => record.id === id || record.parentId === id)
        .map((record) => record.id)
    )
    const taken = requests.filter((request) =>
      gone.has(request.folderId ?? "")
    ).length
    for (const request of [...requests]) {
      if (gone.has(request.folderId ?? "")) {
        requests.splice(requests.indexOf(request), 1)
      }
    }
    for (const folder of [...folders]) {
      if (gone.has(folder.id)) folders.splice(folders.indexOf(folder), 1)
    }
    return Promise.resolve({ folders: gone.size, requests: taken })
  },

  notes: () =>
    Promise.resolve([
      {
        id: "note-1",
        name: "Release",
        folderId: null,
        createdAt: "",
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
    ]),
  noteFolders: () => Promise.resolve([]),
  noteBody: () =>
    Promise.resolve({
      format: "blocks" as const,
      text: JSON.stringify([
        {
          type: "heading",
          props: { level: 2 },
          content: [{ text: "Ship it" }],
        },
        {
          type: "bulletListItem",
          content: [
            { text: "see " },
            {
              type: "link",
              href: "https://example.com",
              content: [{ text: "the plan" }],
            },
          ],
        },
        {
          type: "codeBlock",
          props: { language: "sql" },
          content: [{ text: "select 1" }],
        },
      ]),
    }),
  createNote: (input) =>
    Promise.resolve({
      id: "note-2",
      name: input.name,
      folderId: input.folderId,
      createdAt: "",
      updatedAt: "",
    }),
}

const servers = new McpServers(source)

const configPath = await servers.configPath()
if (!configPath) throw new Error("no config was written")

const config = JSON.parse(await readFile(configPath, "utf8")) as {
  mcpServers: Record<string, { type: string; url: string }>
}

section("the config a session is started with")

check(
  "names one server per panel",
  Object.keys(config.mcpServers).sort().join() ===
    "tabomni-api,tabomni-database,tabomni-notes",
  Object.keys(config.mcpServers)
)
check(
  "over loopback, with a secret in the path",
  /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/database$/.test(
    config.mcpServers["tabomni-database"]!.url
  ),
  config.mcpServers["tabomni-database"]?.url
)
check(
  "as a streamable HTTP server",
  config.mcpServers["tabomni-api"]!.type === "http"
)

const urls = {
  database: config.mcpServers["tabomni-database"]!.url,
  api: config.mcpServers["tabomni-api"]!.url,
  notes: config.mcpServers["tabomni-notes"]!.url,
}

let nextId = 0

/** As much of a reply as the checks below read — one loose shape rather than
 * one per method, since this stands in for a client that is reading fields it
 * hopes are there. */
type Reply = {
  result?: {
    protocolVersion?: string
    capabilities?: Record<string, unknown>
    tools?: { name: string }[]
    content?: { text?: string }[]
    isError?: boolean
  }
  error?: { message?: string }
}

async function rpc(
  url: string,
  method: string,
  params?: unknown,
  init?: RequestInit
): Promise<{ status: number; body: Reply }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: (nextId += 1),
      method,
      params,
    }),
    ...init,
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

/** A tool's result as the text an agent reads. */
async function call(
  url: string,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ text: string; isError: boolean }> {
  const { body } = await rpc(url, "tools/call", { name, arguments: args })
  return {
    text: String(body.result?.content?.[0]?.text ?? body.error?.message ?? ""),
    isError: body.result?.isError === true,
  }
}

section("the handshake")

const initialized = await rpc(urls.database, "initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "test", version: "1" },
})

check(
  "answers in the version it was asked in",
  initialized.body.result?.protocolVersion === "2025-03-26",
  initialized.body
)
check(
  "offers tools and nothing it cannot do",
  Object.keys(initialized.body.result?.capabilities ?? {}).join() === "tools"
)

const notification = await fetch(urls.database, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
})
check("takes a notification without a reply", notification.status === 202)

section("what each server offers")

const dbTools = await rpc(urls.database, "tools/list")
check(
  "the database's three",
  (dbTools.body.result?.tools ?? [])
    .map((tool: { name: string }) => tool.name)
    .join() === "list_databases,list_tables,query",
  dbTools.body.result?.tools ?? []
)

const apiTools = await rpc(urls.api, "tools/list")
check(
  "the API panel's nine — three that read, six that write",
  (apiTools.body.result?.tools ?? [])
    .map((tool: { name: string }) => tool.name)
    .join() ===
    "list_requests,get_request,send_request,create_request,update_request," +
      "delete_request,create_folder,update_folder,delete_folder",
  apiTools.body.result?.tools ?? []
)

const noteTools = await rpc(urls.notes, "tools/list")
check(
  "the notes' three",
  (noteTools.body.result?.tools ?? [])
    .map((tool: { name: string }) => tool.name)
    .join() === "list_notes,read_note,create_note"
)

section("a database, by id or by name")

const byName = await call(urls.database, "query", {
  database: "app",
  sql: "select 1",
})
check(
  "a name resolves to the database's id",
  byName.text.includes('"db-1"'),
  byName
)
check(
  "rows come back with a count",
  byName.text.includes('"rowCount": 2'),
  byName
)

const missing = await call(urls.database, "query", {
  database: "nope",
  sql: "select 1",
})
check(
  "an unknown name lists what there is",
  missing.isError && missing.text.includes("app"),
  missing
)

section("a saved request goes out as the panel would send it")

const resolved = await call(urls.api, "get_request", { request: "Users" })
const detail = JSON.parse(resolved.text) as {
  resolved: { url: string; headers: { name: string; value: string }[] }
}

check(
  "its {{variables}} are filled in from the active environment",
  detail.resolved.url.startsWith("http://localhost:3000/users"),
  detail.resolved.url
)
check(
  "its folder's params are inherited",
  detail.resolved.url.includes("trace=1"),
  detail.resolved.url
)
check(
  "its folder's headers are inherited, substituted",
  detail.resolved.headers.some(
    (header) =>
      header.name === "Authorization" && header.value === "Bearer secret"
  ),
  detail.resolved.headers
)
check(
  "and its own headers survive the inheritance",
  detail.resolved.headers.some((header) => header.name === "X-Own")
)

check("reading a request sends nothing", sent === 0)
await call(urls.api, "send_request", { request: "req-1" })
check("sending one sends exactly one", sent === 1)

section("a request an agent writes")

const created = await call(urls.api, "create_request", {
  name: "Create user",
  method: "post",
  url: "{{baseUrl}}/users?trace=1",
  headers: [
    { name: "Content-Type", value: "application/json" },
    { name: "X-Off", value: "off", enabled: false },
  ],
  body: '{"name":"a"}',
  folder: "API",
})
const createdId = (JSON.parse(created.text) as { id: string }).id
const saved = requests.find((record) => record.id === createdId)

check("is saved, not sent", sent === 1 && saved !== undefined, created.text)
check(
  "keeps its {{variables}} as typed",
  saved?.url.includes("{{baseUrl}}") === true,
  saved?.url
)
check("takes the method in any case", saved?.method === "POST", saved?.method)
check(
  "is filed under the folder it named",
  saved?.folderId === "folder-1",
  saved?.folderId
)
check(
  "carries an unticked header as unticked",
  saved?.headers.length === 2 &&
    saved.headers[0]!.enabled === true &&
    saved.headers[1]!.enabled === false,
  saved?.headers
)
check(
  "and is listed like any other afterwards",
  (await call(urls.api, "list_requests")).text.includes("Create user")
)

const refusedMethod = await call(urls.api, "create_request", {
  name: "Purge",
  url: "/purge",
  method: "PURGE",
})
check(
  "a method the panel cannot draw is refused rather than saved",
  refusedMethod.isError && refusedMethod.text.includes("PURGE"),
  refusedMethod
)

const updated = await call(urls.api, "update_request", {
  request: "Create user",
  url: "{{baseUrl}}/people",
  folder: null,
})
// Re-found rather than re-read from `saved`: an update replaces the record, the
// way the store's own whole-collection save does.
const moved = requests.find((record) => record.id === createdId)
check(
  "an update touches only the fields it was given",
  moved?.url === "{{baseUrl}}/people" &&
    moved?.method === "POST" &&
    moved?.body === '{"name":"a"}',
  updated.text
)
check("and `null` moves it to the top level", moved?.folderId === null)

const nothing = await call(urls.api, "update_request", { request: "req-1" })
check(
  "an update with nothing to change says so",
  nothing.isError && nothing.text.includes("Nothing to change"),
  nothing
)
check("none of it sent anything", sent === 1)

const deleted = await call(urls.api, "delete_request", {
  request: "Create user",
})
check(
  "and one deleted is gone from the collection",
  !deleted.isError &&
    requests.every((record) => record.name !== "Create user") &&
    requests.length === 1,
  deleted.text
)

const ghost = await call(urls.api, "delete_request", { request: "Ghost" })
check(
  "a request that is not there is a mistake to correct, not a crash",
  ghost.isError && ghost.text.includes("No request called"),
  ghost
)

section("the folders requests are filed under")

const folder = await call(urls.api, "create_folder", {
  name: "Admin",
  parent: "API",
  headers: [{ name: "X-Admin", value: "1" }],
})
const nested = folders.find((record) => record.name === "Admin")
check(
  "one is made under the folder it named",
  nested?.parentId === "folder-1",
  folder.text
)
check(
  "with the headers it lends to everything inside it",
  nested?.headers[0]?.name === "X-Admin" && nested.params.length === 0,
  nested
)
check(
  "and is listed beside the requests, so an empty one is still visible",
  (await call(urls.api, "list_requests")).text.includes("Admin")
)

const cycle = await call(urls.api, "update_folder", {
  folder: "API",
  parent: "Admin",
})
check(
  "a folder cannot be moved into its own subfolder",
  cycle.isError && cycle.text.includes("cannot be moved into itself"),
  cycle
)

const reparented = await call(urls.api, "update_folder", {
  folder: "Admin",
  parent: null,
  name: "Admin API",
})
const after = folders.find((record) => record.id === nested?.id)
check(
  "moving one to the top level leaves its rows alone",
  after?.parentId === null &&
    after.name === "Admin API" &&
    after.headers.length === 1,
  reparented.text
)

const cascade = await call(urls.api, "delete_folder", { folder: "API" })
check(
  "deleting one says what went with it",
  JSON.parse(cascade.text).alsoDeleted.requests === 1,
  cascade.text
)
check(
  "and takes the requests it held",
  requests.length === 0 && folders.every((record) => record.id !== "folder-1"),
  { requests: requests.length, folders }
)

section("a note is read as markdown")

const note = await call(urls.notes, "read_note", { note: "Release" })
check("headings keep their level", note.text.includes("## Ship it"), note.text)
check(
  "a link keeps its href",
  note.text.includes("- see [the plan](https://example.com)"),
  note.text
)
check(
  "a code block keeps its language",
  note.text.includes("```sql\nselect 1\n```"),
  note.text
)

section("the gate in front of all of it")

on.delete("database")

const refused = await call(urls.database, "query", {
  database: "app",
  sql: "select 1",
})
check(
  "a server switched off refuses the call it is in the middle of",
  refused.isError && refused.text.includes("Settings"),
  refused
)

const listedOff = await rpc(urls.database, "tools/list")
check(
  "and offers no tools while it is off",
  (listedOff.body.result?.tools ?? []).length === 0
)

const stillOn = await call(urls.notes, "read_note", { note: "Release" })
check("its neighbours are unaffected", !stillOn.isError)

on.add("database")

section("nothing else gets in")

const wrongToken = await fetch(
  urls.database.replace(/\/[0-9a-f]{32}\//, `/${"0".repeat(32)}/`),
  { method: "POST", body: "{}" }
)
check("a wrong secret is not found", wrongToken.status === 404)

const wrongPath = await fetch(`${urls.database}/extra`, {
  method: "POST",
  body: "{}",
})
check("nor is a path with more in it", wrongPath.status === 404)

const get = await fetch(urls.database)
check("GET is refused: this server never pushes", get.status === 405)

const fromAPage = await fetch(urls.database, {
  method: "POST",
  headers: {
    origin: "https://evil.example",
    "content-type": "application/json",
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
})
check("a request from a page is refused", fromAPage.status === 403)

const garbage = await fetch(urls.database, { method: "POST", body: "{" })
check("half a JSON body is an error, not a crash", garbage.status === 400)

section("switched off altogether")

on.clear()
check(
  "no server means no config, so a session is started without the flag",
  (await servers.configPath()) === null
)

await servers.stop()

finish()
