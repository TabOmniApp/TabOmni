import type { SqlField, SqlResult } from "@shared/api"

export type { SqlField, SqlResult }

/**
 * Somewhere SQL can be run. The database panel is written against this rather
 * than against the IPC call directly, so the panel stays testable and the
 * transport can change without touching it.
 */
export type SqlRunner = {
  /**
   * Runs `sql` and returns one result per statement.
   *
   * A statement with parameters must be sent on its own: binding is only
   * possible through the extended protocol, which handles a single statement.
   *
   * `resolveSources: true` fills in each field's `source` — where a query
   * tab's own results, not a browsed table, get their editing metadata from.
   */
  exec(
    sql: string,
    params?: unknown[],
    options?: { resolveSources?: boolean }
  ): Promise<SqlResult[]>
}

/**
 * Runs against one database, over IPC.
 *
 * A runner is only meaningful with a database attached — there is no shared
 * database to fall back to. Identifier quoting is not part of this: Postgres
 * and MySQL disagree on it, so that lives with each engine's own adapter
 * (see `./engines`) instead of here.
 */
export function databaseRunner(databaseId: string): SqlRunner {
  return {
    exec(sql, params, options) {
      return window.desktop.dbExec(databaseId, sql, params, options)
    },
  }
}

/**
 * Zips a result back into objects. Introspection queries control their own
 * column names, so the array/object mismatch is theirs to undo.
 */
export function objectRows<T>(result: SqlResult | undefined): T[] {
  if (!result) return []
  return result.rows.map((row) => {
    const object: Record<string, unknown> = {}
    result.fields.forEach((field, index) => {
      object[field.name] = row[index]
    })
    return object as T
  })
}
