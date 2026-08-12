import type { Column, Filter, FilterSet } from "./types"

/**
 * Turns a filter bar into a `where` clause.
 *
 * The one place in this panel where something the user typed ends up in a
 * statement, so nothing typed is ever spliced into it: a column name is
 * matched against the introspected columns and quoted by the engine, and every
 * value leaves as a bound parameter. The engines differ only in how a
 * placeholder is spelled, which is what `placeholder` is for.
 */
export type WhereClause = {
  /** Empty when nothing filters, so callers can skip the keyword entirely. */
  sql: string
  params: unknown[]
}

const NO_VALUE = new Set(["is null", "is not null"])

/** Whether this operator reads its value at all. */
export function takesValue(operator: Filter["operator"]): boolean {
  return !NO_VALUE.has(operator)
}

export function buildWhere(
  filters: FilterSet | null | undefined,
  columns: Column[],
  quoteIdent: (name: string) => string,
  /** `$1`, `$2`… for Postgres; `?` for MySQL. Given the 1-based position. */
  placeholder: (index: number) => string
): WhereClause {
  const known = new Set(columns.map((column) => column.name))
  const params: unknown[] = []
  const parts: string[] = []

  for (const condition of filters?.conditions ?? []) {
    // A column that no longer exists is dropped rather than quoted into the
    // statement: the alternative is an error about a filter the user cannot
    // see, on a table whose shape has changed underneath it.
    if (!known.has(condition.column)) continue

    const column = quoteIdent(condition.column)
    if (!takesValue(condition.operator)) {
      parts.push(
        `${column} ${condition.operator === "is null" ? "is null" : "is not null"}`
      )
      continue
    }

    // An empty box is not a filter yet — it is a row the user is still
    // filling in, and matching everything against '' would hide the table.
    if (condition.value === "") continue

    const bind = (value: unknown): string => {
      params.push(value)
      return placeholder(params.length)
    }

    switch (condition.operator) {
      case "contains":
        parts.push(`${column} like ${bind(`%${escapeLike(condition.value)}%`)}`)
        break
      case "not contains":
        parts.push(
          `${column} not like ${bind(`%${escapeLike(condition.value)}%`)}`
        )
        break
      case "starts with":
        parts.push(`${column} like ${bind(`${escapeLike(condition.value)}%`)}`)
        break
      case "ends with":
        parts.push(`${column} like ${bind(`%${escapeLike(condition.value)}`)}`)
        break
      default:
        // `=`, `!=`, `>`, `>=`, `<`, `<=` — the operator is one of a closed
        // set, never a string that came from outside.
        parts.push(`${column} ${condition.operator} ${bind(condition.value)}`)
    }
  }

  if (parts.length === 0) return { sql: "", params: [] }
  const join = filters?.join === "or" ? " or " : " and "
  return { sql: `(${parts.join(join)})`, params }
}

/**
 * Escapes what `like` treats as wildcards, so searching for `100%` finds
 * `100%` rather than everything starting with `100`.
 *
 * `\` is the escape character both engines use by default here — Postgres'
 * `like` without an `escape` clause, and MySQL's always.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}
