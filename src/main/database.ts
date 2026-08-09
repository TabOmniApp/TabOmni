import { Pool as PgPool, type QueryArrayResult } from "pg"
import {
  createPool as createMysqlPool,
  type FieldPacket,
  type Pool as MysqlPool,
} from "mysql2/promise"

import type {
  ConnectionTestResult,
  DatabaseConnectionInput,
  DbEngine,
  SqlResult,
} from "../shared/api"

export type ConnectionInfo = {
  engine: DbEngine
  host: string
  port: number
  user: string
  password: string
  database: string
}

export type ExecOptions = { resolveSources?: boolean }

/** Somewhere SQL can be run — one live connection to one database. */
interface EngineConnection {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>
  exec(
    sql: string,
    params?: unknown[],
    options?: ExecOptions
  ): Promise<SqlResult[]>
  close(): Promise<void>
}

/**
 * How long a first connection attempt may keep failing before giving up.
 *
 * A database container's server needs a moment after `docker run` (or
 * `docker start`) before it accepts connections — this is not a timeout on
 * queries, only on the handshake that opens the pool.
 */
const CONNECT_RETRY_MS = 10_000
const CONNECT_RETRY_INTERVAL_MS = 500

/** Retries `open` until it succeeds or the retry window runs out. */
async function retryConnect<T>(open: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + CONNECT_RETRY_MS
  for (;;) {
    try {
      return await open()
    } catch (error) {
      if (Date.now() >= deadline) throw error
      await new Promise((resolve) =>
        setTimeout(resolve, CONNECT_RETRY_INTERVAL_MS)
      )
    }
  }
}

type PgFieldSource = { schema: string; table: string; column: string }

/**
 * Resolves every field's `tableID`/`columnID` (0 for a computed expression,
 * not a direct column reference) back to a schema-qualified table and column
 * name, in one round trip regardless of how many distinct tables the fields
 * across every statement's result touch.
 */
async function resolvePgSources(
  pool: PgPool,
  results: QueryArrayResult[]
): Promise<Map<string, PgFieldSource>> {
  const tableIds = new Set<number>()
  for (const result of results) {
    for (const field of result.fields) {
      if (field.tableID > 0) tableIds.add(field.tableID)
    }
  }
  if (tableIds.size === 0) return new Map()

  const { rows } = await pool.query(
    `select a.attrelid, a.attnum, a.attname, c.relname, n.nspname
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where a.attrelid = any($1::oid[])
        and a.attnum > 0
        and not a.attisdropped`,
    [[...tableIds]]
  )

  const sources = new Map<string, PgFieldSource>()
  for (const row of rows as {
    attrelid: number
    attnum: number
    attname: string
    relname: string
    nspname: string
  }[]) {
    sources.set(`${row.attrelid}:${row.attnum}`, {
      schema: row.nspname,
      table: row.relname,
      column: row.attname,
    })
  }
  return sources
}

function toPgResult(
  result: QueryArrayResult,
  sources: Map<string, PgFieldSource>
): SqlResult {
  return {
    fields: result.fields.map((field) => {
      const source =
        field.tableID > 0
          ? sources.get(`${field.tableID}:${field.columnID}`)
          : undefined
      return {
        name: field.name,
        dataTypeID: field.dataTypeID,
        ...(source && { source }),
      }
    }),
    rows: result.rows,
    affectedRows: result.rowCount ?? undefined,
  }
}

class PgConnection implements EngineConnection {
  constructor(private readonly pool: PgPool) {}

  static async open(info: ConnectionInfo): Promise<PgConnection> {
    const pool = new PgPool({
      host: info.host,
      port: info.port,
      user: info.user,
      password: info.password,
      database: info.database,
      max: 5,
    })
    // A pool connects lazily; force one connection now so a bad host/port/
    // credential surfaces here rather than on the panel's first query.
    await retryConnect(async () => {
      const client = await pool.connect()
      client.release()
    })
    return new PgConnection(pool)
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const { rows } = await this.pool.query(sql, params)
    return rows as T[]
  }

  async exec(
    sql: string,
    params?: unknown[],
    options?: ExecOptions
  ): Promise<SqlResult[]> {
    // Binding needs the extended protocol, which only runs one statement —
    // the same restriction the panel's own doc comments already describe.
    if (params && params.length > 0) {
      const result = await this.pool.query({
        text: sql,
        values: params,
        rowMode: "array",
      })
      const sources = options?.resolveSources
        ? await resolvePgSources(this.pool, [result])
        : new Map<string, PgFieldSource>()
      return [toPgResult(result, sources)]
    }

    // No params: the simple query protocol, which is what lets several
    // `;`-separated statements run as one script. `pg` resolves with an
    // array when more than one statement completed, and a single result
    // otherwise — a real runtime behaviour its own types don't declare,
    // hence the `unknown` before checking it by hand.
    const raw: unknown = await this.pool.query({ text: sql, rowMode: "array" })
    const results = Array.isArray(raw)
      ? (raw as QueryArrayResult[])
      : [raw as QueryArrayResult]
    const sources = options?.resolveSources
      ? await resolvePgSources(this.pool, results)
      : new Map<string, PgFieldSource>()
    return results.map((result) => toPgResult(result, sources))
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

/**
 * `rows` is a `ResultSetHeader`-shaped object rather than an array for a
 * statement with nothing to select — an INSERT/UPDATE/DELETE — leaving
 * nothing to show but how many rows it touched.
 */
function toMysqlResult(
  rows: unknown,
  fields: FieldPacket[] | undefined,
  resolveSources: boolean
): SqlResult {
  if (!Array.isArray(rows)) {
    const header = rows as { affectedRows?: number }
    return { fields: [], rows: [], affectedRows: header.affectedRows }
  }
  return {
    fields: (fields ?? []).map((field) => {
      // Unlike Postgres, the origin table/column is already right there on
      // the field packet — `orgTable` is empty for a computed expression,
      // never a table this app could look columns up on, hence the guard.
      const source =
        resolveSources && field.orgTable
          ? {
              schema: field.db ?? "",
              table: field.orgTable,
              column: field.orgName || field.name,
            }
          : undefined
      return {
        name: field.name,
        dataTypeID: field.columnType ?? field.type ?? 0,
        ...(source && { source }),
      }
    }),
    // Requested with `rowsAsArray: true`, so these are already array-shaped.
    rows: rows as unknown[][],
  }
}

class MysqlConnection implements EngineConnection {
  constructor(private readonly pool: MysqlPool) {}

  static async open(info: ConnectionInfo): Promise<MysqlConnection> {
    const pool = createMysqlPool({
      host: info.host,
      port: info.port,
      user: info.user,
      password: info.password,
      database: info.database,
      // A script pasted into the SQL tab is exactly the multi-statement case
      // this exists for; a single query has nothing to lose by allowing it.
      multipleStatements: true,
      connectionLimit: 5,
    })
    await retryConnect(async () => {
      const connection = await pool.getConnection()
      connection.release()
    })
    return new MysqlConnection(pool)
  }

  /** Object-shaped rows — the default mysql2 gives with no `rowsAsArray`. */
  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const [rows] = await this.pool.query(sql, params)
    return (Array.isArray(rows) ? rows : []) as T[]
  }

  async exec(
    sql: string,
    params?: unknown[],
    options?: ExecOptions
  ): Promise<SqlResult[]> {
    // mysql2 types bound parameters as its own union of the values it knows
    // how to serialise. These arrived over IPC from boxes the user typed into,
    // so they are `unknown` until the driver looks at them — and it is the
    // driver that should say so, with a message about the value, rather than
    // this narrowing them to something they may not be.
    const values = params as Parameters<MysqlPool["execute"]>[1]
    const resolveSources = options?.resolveSources ?? false

    const [rows, fields] =
      params && params.length > 0
        ? await this.pool.execute({ sql, rowsAsArray: true }, values)
        : await this.pool.query({ sql, rowsAsArray: true })

    // `multipleStatements` makes a script's fields come back as one
    // `FieldPacket[]` per statement — an array of arrays — where a single
    // statement's fields come back flat. That nesting is a more reliable
    // signal than the rows' own shape, which already varies per statement
    // (a row array for a SELECT, a result-header object for a write).
    if (Array.isArray(fields) && Array.isArray(fields[0])) {
      const rowSets = rows as unknown as unknown[]
      const fieldSets = fields as unknown as FieldPacket[][]
      return rowSets.map((set, index) =>
        toMysqlResult(set, fieldSets[index], resolveSources)
      )
    }

    return [
      toMysqlResult(rows, fields as unknown as FieldPacket[], resolveSources),
    ]
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

async function openConnection(info: ConnectionInfo): Promise<EngineConnection> {
  return info.engine === "postgres"
    ? PgConnection.open(info)
    : MysqlConnection.open(info)
}

/**
 * Live connections to real Postgres and MySQL servers, keyed by database id —
 * whether the server is a Docker container this app created or an external
 * one the user pointed it at.
 *
 * Opened lazily and held for the session: only the databases actually open
 * in the panel are ever connected to.
 */
export class SqlConnections {
  private readonly open = new Map<string, Promise<EngineConnection>>()

  constructor(
    private readonly connectionInfoOf: (
      databaseId: string
    ) => Promise<ConnectionInfo>
  ) {}

  async query<T>(
    databaseId: string,
    sql: string,
    params?: unknown[]
  ): Promise<T[]> {
    const connection = await this.get(databaseId)
    return connection.query<T>(sql, params)
  }

  async exec(
    databaseId: string,
    sql: string,
    params?: unknown[],
    options?: ExecOptions
  ): Promise<SqlResult[]> {
    const connection = await this.get(databaseId)
    return connection.exec(sql, params, options)
  }

  /** Tries a connection without keeping it, for the "Test connection" button. */
  async testConnection(
    input: DatabaseConnectionInput
  ): Promise<ConnectionTestResult> {
    let connection: EngineConnection | null = null
    try {
      connection = await openConnection(input)
      const [row] = await connection.query<{ version: string }>(
        "select version() as version"
      )
      return { ok: true, version: row?.version ?? "connected" }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      await connection?.close().catch(() => {})
    }
  }

  /** Closes one database's connection, if it was ever opened. */
  async close(databaseId: string): Promise<void> {
    const pending = this.open.get(databaseId)
    if (!pending) return

    this.open.delete(databaseId)
    // Await the in-flight open before closing: a half-opened pool would
    // otherwise be left dangling instead of torn down.
    const connection = await pending.catch(() => null)
    await connection?.close().catch(() => {})
  }

  /** Closes every connection. Called when the app quits. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.open.keys()].map((id) => this.close(id)))
  }

  private get(databaseId: string): Promise<EngineConnection> {
    let pending = this.open.get(databaseId)
    if (pending) return pending

    pending = this.connectionInfoOf(databaseId).then(openConnection)
    this.open.set(databaseId, pending)
    // A failed open must not be cached, or the database could never recover.
    pending.catch(() => this.open.delete(databaseId))
    return pending
  }
}
