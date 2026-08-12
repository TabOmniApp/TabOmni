/** Statement keywords worth a confirmation before they run. */
const DESTRUCTIVE = /\b(drop|delete|truncate|alter)\b/i

/**
 * Whether `sql` looks like it could destroy something.
 *
 * A heuristic, not a security boundary: it is a speed bump before an
 * irreversible statement runs against a database that may hold real project
 * data, not a parser. A string literal or a column named "delete" can trip
 * it — an occasional extra confirmation is a fair trade for never missing a
 * real `DROP TABLE`.
 */
export function containsDestructiveSql(sql: string): boolean {
  return DESTRUCTIVE.test(sql)
}

/** Statement keywords that can change the schema itself. */
const SCHEMA_CHANGING = /\b(create|drop|alter|truncate|rename)\b/i

/**
 * Whether `sql` might have changed the tables/columns the tree shows — the
 * only case worth re-reading the whole schema for. A plain SELECT (or an
 * INSERT/UPDATE/DELETE, which changes rows, not structure) is the vast
 * majority of what runs in a query tab, and doesn't need the tree, the
 * currently browsed table, or the completion list refreshed out from under
 * it after every run.
 */
export function mayChangeSchema(sql: string): boolean {
  return SCHEMA_CHANGING.test(sql)
}
