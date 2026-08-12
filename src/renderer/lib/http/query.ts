import type { HttpParkedParam } from "@shared/api"

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

/** A row of the parameters table: in the URL, or parked beside it. */
export type ParamRow = QueryParam & { enabled: boolean }

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

/** A name for a parameter added by hand, unique among the ones already there. */
export function nextParamName(rows: { name: string }[]): string {
  const taken = new Set(rows.map((row) => row.name))
  if (!taken.has("param")) return "param"
  let index = 2
  while (taken.has(`param${index}`)) index++
  return `param${index}`
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
 * The table's rows: what the URL carries, with the parked ones slotted back
 * where they were unticked.
 */
export function paramRows(
  params: QueryParam[],
  parked: HttpParkedParam[]
): ParamRow[] {
  const rows: ParamRow[] = params.map((param) => ({ ...param, enabled: true }))

  // Ascending, so each insertion lands before the next one's index is used.
  for (const item of [...parked].sort((a, b) => a.index - b.index)) {
    const at = Math.min(Math.max(item.index, 0), rows.length)
    rows.splice(at, 0, { name: item.name, value: item.value, enabled: false })
  }
  return rows
}

/**
 * The other direction: rows back into the URL's parameters and the parked
 * list. Round-trips with `paramRows` — a row's index *is* where it returns.
 */
export function splitRows(rows: ParamRow[]): {
  params: QueryParam[]
  parked: HttpParkedParam[]
} {
  return {
    params: rows
      .filter((row) => row.enabled)
      .map((row) => ({ name: row.name, value: row.value })),
    parked: rows.flatMap((row, index) =>
      row.enabled ? [] : [{ name: row.name, value: row.value, index }]
    ),
  }
}
