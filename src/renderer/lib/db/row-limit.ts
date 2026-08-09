/**
 * Rows a query tab returns when the statement doesn't limit itself.
 *
 * `select * from products` against a real table is otherwise a way to hang the
 * app: every row crosses IPC and lands in one grid. 500 is enough to see what a
 * query returns, which is what a console is for — reading the whole table is
 * the data browser's job, a page at a time.
 */
export const QUERY_ROW_LIMIT = 500

/** Leading whitespace and comments, stripped to reach the first keyword. */
const LEADING_NOISE = /^(?:\s|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/

/** Statements that return rows and take a trailing `limit`. */
const ROW_RETURNING = /^(?:select|with|table|values)\b/i

/** Says how many rows it wants already — the user's number wins. */
const SELF_LIMITED = /\b(?:limit|offset|fetch)\b/i

/**
 * Clauses that make a trailing `limit` either a syntax error or a change of
 * meaning: it has to precede `for update`/`lock in share mode`, and `into`
 * writes rows somewhere rather than returning them. A data-modifying CTE
 * (`with x as (...) insert ...`) reads as row-returning by its first keyword
 * but must never be capped.
 */
const UNCAPPABLE =
  /\b(?:for\s+(?:update|share|no\s+key\s+update|key\s+share)|lock\s+in\s+share\s+mode|into|insert|update|delete|merge)\b/i

/**
 * `sql` with a row cap appended, or null when it already limits itself or
 * can't take one.
 *
 * A heuristic over the text, not a parser — the same trade `containsDestructiveSql`
 * makes, but pointed the other way: every uncertain case returns null, so the
 * worst outcome is a query that runs uncapped rather than one rewritten into
 * something the user didn't ask for. Postgres and MySQL spell this clause the
 * same way, so it needs no engine adapter; an engine that spells it `top n`
 * would.
 */
export function withRowLimit(sql: string, limit: number): string | null {
  const trimmed = sql.trim().replace(/;+\s*$/, "")
  if (!trimmed) return null
  // A script: which of its statements the cap belongs on is a guess, and a
  // `;` inside a string literal means this isn't even reliably a script.
  if (trimmed.includes(";")) return null
  if (!ROW_RETURNING.test(trimmed.replace(LEADING_NOISE, ""))) return null
  if (SELF_LIMITED.test(trimmed) || UNCAPPABLE.test(trimmed)) return null
  // On its own line so a trailing `-- comment` can't swallow it.
  return `${trimmed}\nlimit ${limit}`
}
