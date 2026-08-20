import type { HttpParkedParam } from "@shared/api"
import type { QueryParam } from "@shared/http-request"

/*
 * The pure half of a URL — splitting it, putting it back, and substituting
 * `{{name}}` — now lives in `@shared/http-request`, because the main process
 * sends the workspace's saved requests too (`main/mcp.ts`) and had to resolve
 * them the same way. Re-exported here so this file is still the one place the
 * panel asks about a query string.
 */
export {
  joinQuery,
  splitQuery,
  substitute,
  unresolved,
  type QueryParam,
} from "@shared/http-request"

/** A row of the parameters table: in the URL, or parked beside it. */
export type ParamRow = QueryParam & { enabled: boolean }

/** A name for a parameter added by hand, unique among the ones already there. */
export function nextParamName(rows: { name: string }[]): string {
  const taken = new Set(rows.map((row) => row.name))
  if (!taken.has("param")) return "param"
  let index = 2
  while (taken.has(`param${index}`)) index++
  return `param${index}`
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
