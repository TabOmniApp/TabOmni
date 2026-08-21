import type { HttpEnvironment, HttpFolder, HttpRequestRecord } from "./api"

/**
 * What a saved request turns into on the wire: its variables substituted, its
 * folders' headers and params inherited, its query string split and rejoined.
 *
 * Here rather than in the renderer, which is where all of it was written and
 * still is where the API panel uses it, because a second reader arrived: the
 * MCP server in `main/mcp.ts` sends the workspace's saved requests for an
 * agent, and a request sent from there has to be the same request the panel
 * would send. Two copies of "which header wins" is exactly the drift the IPC
 * contract exists to prevent.
 *
 * Runtime code in `shared/` and not only types, as `shared/note-files.ts`
 * already is: this is a pure function of its arguments, with no window, no
 * store and nothing of Node's — which is what makes it safe for both sides.
 * The renderer keeps importing it through `lib/http/query.ts` and
 * `lib/http/folders.ts`, which re-export it.
 */

/**
 * The methods this app deals in: what the panel's picker offers, and what a
 * request written through the MCP server is allowed to be saved as.
 *
 * Here rather than beside the picker for the second reason — the panel can only
 * draw a method that is on this list, so a request saved with any other one is
 * a row the user cannot read or correct. Ordered by how often they are reached
 * for rather than alphabetically.
 */
export const METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const

/**
 * The query string of a request URL, as a list.
 *
 * A parameter that is going to be sent lives in the URL and nowhere else: two
 * copies would be two things to keep in step, and the moment they disagree
 * the user cannot tell which one will be sent. Only an unticked parameter is
 * kept aside — it has no place in a URL, and there is no ambiguity about
 * something that is not being sent.
 */
export type QueryParam = {
  name: string
  value: string
}

/**
 * Splits a URL around its query string.
 *
 * String work rather than `new URL`: what the user typed is often neither
 * absolute nor finished — `{{baseUrl}}/users?id=1` has no scheme to parse.
 */
export function splitQuery(url: string): {
  /** Everything before the `?`. */
  base: string
  params: QueryParam[]
  /** Everything from `#` on, kept aside so rewriting the query cannot eat it. */
  hash: string
}
export function splitQuery(url: string) {
  const hashAt = url.indexOf("#")
  const hash = hashAt === -1 ? "" : url.slice(hashAt)
  const withoutHash = hashAt === -1 ? url : url.slice(0, hashAt)

  const queryAt = withoutHash.indexOf("?")
  if (queryAt === -1) return { base: withoutHash, params: [], hash }

  const query = withoutHash.slice(queryAt + 1)
  const params = query === "" ? [] : query.split("&").map(parsePair)
  return { base: withoutHash.slice(0, queryAt), params, hash }
}

function parsePair(pair: string): QueryParam {
  const equals = pair.indexOf("=")
  if (equals === -1) return { name: decode(pair), value: "" }
  return {
    name: decode(pair.slice(0, equals)),
    value: decode(pair.slice(equals + 1)),
  }
}

/** Percent-decoding that survives a half-typed escape like `%z`. */
function decode(part: string): string {
  try {
    return decodeURIComponent(part.replaceAll("+", " "))
  } catch {
    return part
  }
}

/**
 * Puts a URL back together.
 *
 * An unnamed parameter is kept rather than dropped: a row being renamed is
 * empty for a keystroke or two, and dropping it would take the input the user
 * is typing in with it. Emptying the list drops the `?` altogether.
 */
export function joinQuery(
  base: string,
  params: QueryParam[],
  hash: string
): string {
  if (params.length === 0) return base + hash
  const query = params
    .map(
      (param) =>
        `${encodeURIComponent(param.name)}=${encodeURIComponent(param.value)}`
    )
    .join("&")
  return `${base}?${query}${hash}`
}

/** `{{name}}` — the only interpolation syntax the client understands. */
const VARIABLE = /\{\{\s*([\w.-]+)\s*\}\}/g

/**
 * Replaces every `{{name}}` with the value the active environment gives it.
 *
 * A name nothing defines is left exactly as written rather than blanked: a
 * request that quietly sent `/users/` instead of `/users/{{id}}` would be far
 * harder to notice than one that plainly still says `{{id}}`.
 */
export function substitute(
  text: string,
  variables: Record<string, string>
): string {
  return text.replace(VARIABLE, (whole, name: string) =>
    name in variables ? variables[name]! : whole
  )
}

/** The names still unresolved in a piece of text, in order, without repeats. */
export function unresolved(text: string): string[] {
  const names = [...text.matchAll(VARIABLE)].map((match) => match[1]!)
  return [...new Set(names)]
}

/**
 * The variables in force: the active environment's, by name.
 *
 * `baseUrl` has no built-in value here — an environment that defines its own
 * is what lets a bare path like `/api/users` resolve to something.
 */
export function variablesFrom(
  environments: HttpEnvironment[],
  activeId: string | null
): Record<string, string> {
  const variables: Record<string, string> = {}

  const active = environments.find((environment) => environment.id === activeId)
  for (const variable of active?.variables ?? []) {
    const name = variable.name.trim()
    if (name) variables[name] = variable.value
  }
  return variables
}

/** A folder's own ancestors, root-first, ending with the folder itself. */
function folderChain(
  folderId: string | null,
  folders: HttpFolder[]
): HttpFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const chain: HttpFolder[] = []
  const seen = new Set<string>()
  let current = folderId
  while (current && !seen.has(current)) {
    seen.add(current)
    const folder = byId.get(current)
    if (!folder) break
    chain.push(folder)
    current = folder.parentId
  }
  return chain.reverse()
}

/**
 * The headers a request actually sends: every ancestor folder's own,
 * outermost first, then the request's — so a request's header always wins
 * over an inherited one of the same name, and a deeper folder wins over a
 * shallower one.
 */
export function resolveHeaders(
  request: HttpRequestRecord,
  folders: HttpFolder[],
  variables: Record<string, string>
): { name: string; value: string }[] {
  const chain = folderChain(request.folderId, folders)
  const all = [...chain.flatMap((folder) => folder.headers), ...request.headers]
  const byName = new Map<string, { name: string; value: string }>()
  for (const header of all) {
    if (!header.enabled || header.name.trim() === "") continue
    const name = substitute(header.name.trim(), variables)
    byName.set(name.toLowerCase(), {
      name,
      value: substitute(header.value, variables),
    })
  }
  return [...byName.values()]
}

/**
 * A request's URL with its ancestor folders' default params filled in —
 * only for a name the request's own query string doesn't already have, so a
 * request always wins over an inherited default.
 */
export function withFolderParams(
  url: string,
  folderId: string | null,
  folders: HttpFolder[]
): string {
  const defaults = folderChain(folderId, folders)
    .flatMap((folder) => folder.params)
    .filter((param) => param.enabled && param.name.trim() !== "")
  if (defaults.length === 0) return url

  const { base, params, hash } = splitQuery(url)
  const present = new Set(params.map((param) => param.name))
  const extra = defaults
    .filter((param) => !present.has(param.name.trim()))
    .map((param) => ({ name: param.name.trim(), value: param.value }))
  if (extra.length === 0) return url

  return joinQuery(base, [...params, ...extra], hash)
}
