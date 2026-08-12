import { objectRows, type SqlResult, type SqlRunner } from "../runner"
import { buildWhere } from "./filters"
import { draftError, newColumn, newColumnDraft, newColumnError } from "./shared"
import {
  PAGE_SIZE,
  type CheckConstraint,
  type Column,
  type EngineAdapter,
  type ForeignKey,
  type Index,
  type LabelRow,
  type NewColumnDraft,
  type Partition,
  type Relation,
  type FilterSet,
  type SortOrder,
  type TableDraft,
  type Trigger,
} from "./types"

/** Quotes an identifier for interpolation into SQL — MySQL's own, not Postgres'. */
function quoteIdent(name: string): string {
  return `\`${name.replaceAll("`", "``")}\``
}

/**
 * A relation's schema-qualified name, quoted.
 *
 * "Schema" here is the database this connection is scoped to — MySQL has no
 * separate namespace layer inside one, unlike Postgres' `public`.
 */
function qualify(relation: Relation): string {
  return `${quoteIdent(relation.schema)}.${quoteIdent(relation.name)}`
}

/**
 * Every `information_schema` column below is aliased to itself, which looks
 * redundant and is not: MySQL 8 serves `information_schema` from the data
 * dictionary and returns *uppercase* names (`COLUMN_TYPE`) for any column
 * left unaliased, while 5.7 returns them lowercase. `objectRows` keys off
 * whatever the server sent, so an unaliased column silently reads back as
 * `undefined` on 8 — which is not an error anywhere, just a table whose
 * every type and key quietly goes missing. An explicit alias is returned
 * verbatim by both versions.
 */

/**
 * Every table and view the connected database owns. `information_schema`
 * itself is excluded the same way Postgres' own catalogs are: it exists in
 * every database and would bury what the user actually created.
 */
async function listRelations(runner: SqlRunner): Promise<Relation[]> {
  const results = await runner.exec(/* sql */ `
    select table_schema as schema_name,
           table_name   as name,
           table_type   as table_type
      from information_schema.tables
     where table_schema = database()
       and table_type in ('BASE TABLE', 'VIEW')
     order by table_name
  `)

  return objectRows<{
    schema_name: string
    name: string
    table_type: string
  }>(results[0]).map((row) => ({
    schema: row.schema_name,
    name: row.name,
    kind: row.table_type === "VIEW" ? "view" : "table",
  }))
}

/**
 * Parses `column_type`'s own rendering of a native enum, e.g.
 * `enum('active','pending','done')`, into its member labels.
 *
 * Not a plain `split(",")`: a label can itself contain a comma, and MySQL
 * doubles embedded single quotes (`it''s ok`) rather than backslash-escaping
 * them, so this walks the string as a small state machine instead of
 * assuming either character is safe to split on blindly.
 */
function parseMysqlEnumValues(columnType: string): string[] | null {
  if (typeof columnType !== "string") return null
  const match = /^enum\((.*)\)$/is.exec(columnType.trim())
  if (!match) return null
  const body = match[1]!

  const values: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (inQuotes) {
      if (ch === "'" && body[i + 1] === "'") {
        current += "'"
        i++
        continue
      }
      if (ch === "'") {
        inQuotes = false
        continue
      }
      current += ch
      continue
    }
    if (ch === "'") {
      inQuotes = true
      continue
    }
    if (ch === ",") {
      values.push(current)
      current = ""
      continue
    }
    // Whitespace between labels outside quotes — ignore.
  }
  values.push(current)
  return values
}

async function listColumns(
  runner: SqlRunner,
  relation: Relation
): Promise<Column[]> {
  const results = await runner.exec(
    /* sql */ `
    select column_name           as column_name,
           column_type           as column_type,
           is_nullable           as is_nullable,
           column_default        as column_default,
           column_key            as column_key,
           generation_expression as generation_expression
      from information_schema.columns
     where table_schema = ? and table_name = ?
     order by ordinal_position
  `,
    [relation.schema, relation.name]
  )

  return objectRows<{
    column_name: string
    column_type: string
    is_nullable: string
    column_default: string | null
    column_key: string
    generation_expression: string | null
  }>(results[0]).map((row) => ({
    name: row.column_name,
    type: row.column_type,
    nullable: row.is_nullable === "YES",
    default: row.generation_expression ? null : row.column_default,
    generatedExpression: row.generation_expression || null,
    primaryKey: row.column_key === "PRI",
    enumValues: parseMysqlEnumValues(row.column_type),
  }))
}

/**
 * MySQL has no single-string index definition the way Postgres'
 * `pg_get_indexdef` does, so one is built here from `information_schema`'s
 * per-column rows — grouped back into one entry per index name.
 */
async function listIndexes(
  runner: SqlRunner,
  relation: Relation
): Promise<Index[]> {
  const results = await runner.exec(
    /* sql */ `
    select index_name  as index_name,
           column_name as column_name,
           non_unique  as non_unique,
           index_type  as index_type
      from information_schema.statistics
     where table_schema = ? and table_name = ?
     order by index_name, seq_in_index
  `,
    [relation.schema, relation.name]
  )

  const byName = new Map<
    string,
    { columns: string[]; nonUnique: number; indexType: string }
  >()
  for (const row of objectRows<{
    index_name: string
    column_name: string
    non_unique: number
    index_type: string
  }>(results[0])) {
    const entry = byName.get(row.index_name) ?? {
      columns: [],
      nonUnique: row.non_unique,
      indexType: row.index_type,
    }
    entry.columns.push(row.column_name)
    byName.set(row.index_name, entry)
  }

  return [...byName.entries()]
    .map(([name, { columns, nonUnique, indexType }]) => ({
      name,
      columns,
      method: indexType,
      primary: name === "PRIMARY",
      unique: nonUnique === 0,
    }))
    .sort((a, b) => (a.primary === b.primary ? 0 : a.primary ? -1 : 1))
}

/** Foreign keys declared *from* this relation, read-only — there is no builder for these. */
async function listForeignKeys(
  runner: SqlRunner,
  relation: Relation
): Promise<ForeignKey[]> {
  const results = await runner.exec(
    /* sql */ `
    select constraint_name         as constraint_name,
           column_name             as column_name,
           referenced_table_schema as referenced_table_schema,
           referenced_table_name   as referenced_table_name,
           referenced_column_name  as referenced_column_name
      from information_schema.key_column_usage
     where table_schema = ?
       and table_name = ?
       and referenced_table_name is not null
     order by constraint_name, ordinal_position
  `,
    [relation.schema, relation.name]
  )

  const byName = new Map<
    string,
    {
      columns: string[]
      refSchema: string
      refTable: string
      refColumns: string[]
    }
  >()
  for (const row of objectRows<{
    constraint_name: string
    column_name: string
    referenced_table_schema: string
    referenced_table_name: string
    referenced_column_name: string
  }>(results[0])) {
    const entry = byName.get(row.constraint_name) ?? {
      columns: [],
      refSchema: row.referenced_table_schema,
      refTable: row.referenced_table_name,
      refColumns: [],
    }
    entry.columns.push(row.column_name)
    entry.refColumns.push(row.referenced_column_name)
    byName.set(row.constraint_name, entry)
  }

  return [...byName.entries()].map(([name, entry]) => ({
    name,
    columns: entry.columns,
    referencedSchema: entry.refSchema,
    referencedTable: entry.refTable,
    referencedColumns: entry.refColumns,
  }))
}

/**
 * CHECK constraints, MySQL 8.0.16+/MariaDB 10.2.1+ only — older servers have
 * neither `information_schema.check_constraints` to query, so the whole
 * thing is wrapped rather than probed for up front: a missing table surfaces
 * as a query error either way, and "no check constraints" is the right read
 * on that error for a server that has no notion of them at all.
 */
async function listCheckConstraints(
  runner: SqlRunner,
  relation: Relation
): Promise<CheckConstraint[]> {
  try {
    const results = await runner.exec(
      /* sql */ `
      select cc.constraint_name as name, cc.check_clause as definition
        from information_schema.table_constraints tc
        join information_schema.check_constraints cc
          on cc.constraint_schema = tc.constraint_schema
         and cc.constraint_name = tc.constraint_name
       where tc.table_schema = ?
         and tc.table_name = ?
         and tc.constraint_type = 'CHECK'
       order by cc.constraint_name
    `,
      [relation.schema, relation.name]
    )
    return objectRows<{ name: string; definition: string }>(results[0])
  } catch {
    return []
  }
}

/** `information_schema.triggers` has no single-string definition the way
 * Postgres' `pg_get_triggerdef` does, so one is assembled from its parts. */
async function listTriggers(
  runner: SqlRunner,
  relation: Relation
): Promise<Trigger[]> {
  const results = await runner.exec(
    /* sql */ `
    select trigger_name    as name,
           action_timing   as timing,
           event_manipulation as event,
           action_statement as statement
      from information_schema.triggers
     where trigger_schema = ?
       and event_object_table = ?
     order by trigger_name
  `,
    [relation.schema, relation.name]
  )

  return objectRows<{
    name: string
    timing: string
    event: string
    statement: string
  }>(results[0]).map((row) => ({
    name: row.name,
    definition: `CREATE TRIGGER ${row.name} ${row.timing} ${row.event} ON ${relation.name} FOR EACH ROW ${row.statement}`,
  }))
}

/** MySQL relations never come out of `listRelations` as `partitioned` (see
 * `RelationKind`), so this tab never actually shows for one here — kept only
 * to satisfy `EngineAdapter`. */
async function listPartitions(): Promise<Partition[]> {
  return []
}

/** Escapes `%`/`_`/`\` for interpolation into a `like` pattern — MySQL's
 * default escape character is `\`, so no separate `escape` clause is needed. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** Rows of a table referenced by a foreign key: `keyColumns` plus
 * `labelColumn`, resolved by exact key(s), filtered by search, or the first
 * page ordered by `keyColumns` — see `EngineAdapter.listLabelRows`. */
async function listLabelRows(
  runner: SqlRunner,
  relation: Relation,
  labelColumn: Column,
  keyColumns: Column[],
  limit: number,
  options?: { search?: string; keys?: unknown[] }
): Promise<LabelRow[]> {
  const keyIdents = keyColumns.map((column) => quoteIdent(column.name))
  const labelIdent = quoteIdent(labelColumn.name)
  const select = [...keyIdents, labelIdent].join(", ")

  const params: unknown[] = []
  let where = ""
  if (options?.keys && options.keys.length > 0 && keyIdents[0]) {
    // Composite FKs never reach here (see `findSoleColumnForeignKey`), so
    // there is exactly one key column to match against.
    const placeholders = options.keys.map((key) => {
      params.push(key)
      return "?"
    })
    where = `where ${keyIdents[0]} in (${placeholders.join(", ")})`
  } else if (options?.search) {
    params.push(`%${escapeLikePattern(options.search)}%`)
    where = `where ${labelIdent} like ?`
  }
  const order = keyIdents.length > 0 ? `order by ${keyIdents.join(", ")}` : ""

  const results = await runner.exec(
    `select ${select} from ${qualify(relation)} ${where} ${order} limit ${limit}`,
    params
  )
  const rows = results[0]
  if (!rows) return []

  return rows.rows.map((row) => {
    const pk: Record<string, unknown> = {}
    keyColumns.forEach((column, index) => {
      pk[column.name] = row[index]
    })
    const labelValue = row[keyColumns.length]
    return {
      pk,
      label:
        labelValue === null || labelValue === undefined
          ? ""
          : String(labelValue),
    }
  })
}

async function countRows(
  runner: SqlRunner,
  relation: Relation,
  columns: Column[] = [],
  filters?: FilterSet | null
): Promise<number> {
  const where = buildWhere(filters, columns, quoteIdent, () => "?")
  const results = await runner.exec(
    `select count(*) as count from ${qualify(relation)}` +
      (where.sql ? ` where ${where.sql}` : ""),
    where.params
  )
  const count = results[0]?.rows[0]?.[0]
  return typeof count === "number" ? count : 0
}

/**
 * Reads one page of a relation. A plain table with no primary key has no
 * `ctid`-like fallback in MySQL, so it is left in whatever order the storage
 * engine returns — usually stable for InnoDB, but not guaranteed.
 *
 * A `sort` the user picked leads, with the primary key kept behind it so rows
 * tying on the sorted column don't shuffle between pages.
 */
async function readPage(
  runner: SqlRunner,
  relation: Relation,
  columns: Column[],
  offset: number,
  sort?: SortOrder | null,
  filters?: FilterSet | null
): Promise<SqlResult> {
  const keys = columns.filter((column) => column.primaryKey)
  const stable = keys.map((column) => quoteIdent(column.name))

  // Only a column the introspection actually returned can be ordered by —
  // never a name straight off the wire. MySQL sorts NULLs first ascending,
  // and has no `nulls last`, so `is null` supplies it.
  const sorted =
    sort && columns.some((column) => column.name === sort.column)
      ? [
          `${quoteIdent(sort.column)} is null`,
          `${quoteIdent(sort.column)} ${sort.direction === "desc" ? "desc" : "asc"}`,
        ]
      : []
  const order = [...sorted, ...stable]

  const where = buildWhere(filters, columns, quoteIdent, () => "?")

  const results = await runner.exec(
    `select * from ${qualify(relation)}` +
      (where.sql ? ` where ${where.sql}` : "") +
      (order.length > 0 ? ` order by ${order.join(", ")}` : "") +
      ` limit ${PAGE_SIZE} offset ${offset}`,
    where.params
  )

  return results[0] ?? { fields: [], rows: [] }
}

/**
 * Every column in the database, keyed by table name, for editor completion.
 *
 * Both the qualified and the bare name are listed, because that is how people
 * type: `mydb.todos.` and `todos.` should complete the same way.
 */
async function listCompletions(
  runner: SqlRunner
): Promise<Record<string, string[]>> {
  const results = await runner.exec(/* sql */ `
    select table_schema as table_schema,
           table_name   as table_name,
           column_name  as column_name
      from information_schema.columns
     where table_schema = database()
     order by table_name, ordinal_position
  `)

  const schema: Record<string, string[]> = {}
  for (const row of objectRows<{
    table_schema: string
    table_name: string
    column_name: string
  }>(results[0])) {
    // CodeMirror's schema completion crashes on any non-string entry, and a
    // driver quirk (e.g. a column-less row) is not worth taking the whole
    // editor down over.
    if (typeof row.column_name !== "string") continue
    for (const key of [
      `${row.table_schema}.${row.table_name}`,
      row.table_name,
    ]) {
      ;(schema[key] ??= []).push(row.column_name)
    }
  }
  return schema
}

/** The server version string, used as a subtitle for the connection. */
async function serverVersion(runner: SqlRunner): Promise<string | null> {
  const results = await runner.exec(`select version() as version`)
  const value = results[0]?.rows[0]?.[0]
  return typeof value === "string" ? value : null
}

/** Every type offered in the type dropdown. */
const COLUMN_TYPES = [
  "text",
  "varchar(255)",
  "char(10)",
  "tinyint(1)",
  "smallint",
  "int",
  "int unsigned auto_increment",
  "bigint",
  "decimal(10,2)",
  "float",
  "double",
  "date",
  "time",
  "datetime",
  "timestamp",
  "json",
  "blob",
  "enum('a', 'b')",
]

/** The columns most tables start with, so the form opens usable. */
function initialDraft(schema: string): TableDraft {
  return {
    schema,
    name: "",
    columns: [
      {
        id: crypto.randomUUID(),
        name: "id",
        type: "int unsigned auto_increment",
        nullable: false,
        primaryKey: true,
        default: "",
      },
      {
        id: crypto.randomUUID(),
        name: "created_at",
        type: "timestamp",
        nullable: false,
        primaryKey: false,
        default: "current_timestamp",
      },
    ],
  }
}

/**
 * Renders the draft as `create table`.
 *
 * Identifiers are quoted, which is what makes a column called `order` or one
 * called `Name` work. Types and defaults are passed through as written: they
 * are SQL expressions, and there is no way to quote `decimal(10,2)` or
 * `current_timestamp` into something MySQL still understands.
 */
function createTableSql(draft: TableDraft): string {
  const columns = draft.columns.filter(
    (column) => column.name.trim() && column.type.trim()
  )

  const lines = columns.map((column) => {
    let line = `  ${quoteIdent(column.name.trim())} ${column.type.trim()}`
    if (!column.nullable && !column.primaryKey) line += " not null"
    if (column.default.trim()) line += ` default ${column.default.trim()}`
    return line
  })

  const keys = columns.filter((column) => column.primaryKey)
  if (keys.length > 0) {
    const names = keys.map((column) => quoteIdent(column.name.trim()))
    lines.push(`  primary key (${names.join(", ")})`)
  }

  // MySQL has no schema-qualified `create table` across a connection scoped
  // to one database — the table name alone is enough, and the schema on the
  // draft is only there so `TableDraft` has one shape for both engines.
  const table = quoteIdent(draft.name.trim())
  return `create table ${table} (\n${lines.join(",\n")}\n);\n`
}

function dropTableSql(relation: Relation): string {
  return `drop table ${quoteIdent(relation.name)};\n`
}

function truncateTableSql(relation: Relation): string {
  return `truncate table ${quoteIdent(relation.name)};\n`
}

function renameTableSql(relation: Relation, newName: string): string {
  return `rename table ${quoteIdent(relation.name)} to ${quoteIdent(newName.trim())};\n`
}

function addColumnSql(relation: Relation, column: NewColumnDraft): string {
  let line = `alter table ${quoteIdent(relation.name)} add column ${quoteIdent(column.name.trim())} ${column.type.trim()}`
  if (!column.nullable) line += " not null"
  if (column.default.trim()) line += ` default ${column.default.trim()}`
  return line + ";\n"
}

function dropColumnSql(relation: Relation, columnName: string): string {
  return `alter table ${quoteIdent(relation.name)} drop column ${quoteIdent(columnName)};\n`
}

/** `rename column` is MySQL 8.0+; older servers only have the whole-definition
 * `change column`, which this app has no column definition to re-emit. */
function renameColumnSql(
  relation: Relation,
  columnName: string,
  newName: string
): string {
  return `alter table ${quoteIdent(relation.name)} rename column ${quoteIdent(columnName)} to ${quoteIdent(newName.trim())};\n`
}

/**
 * Whether a column of this MySQL type is safe to edit through a plain text
 * input. `json` and binary types are shown pretty-printed / as a byte count
 * by `ResultGrid` and do not round-trip back through a text field.
 */
function isEditableType(type: string): boolean {
  const normalized = type.trim().toLowerCase()
  if (normalized.startsWith("json")) return false
  if (
    normalized.startsWith("blob") ||
    normalized.startsWith("binary") ||
    normalized.startsWith("varbinary")
  ) {
    return false
  }
  return true
}

/**
 * Builds `` `a` = ? and `b` = ? ``, appending each value to `params` in the
 * same pass the clause is built in.
 */
function whereClause(key: Record<string, unknown>, params: unknown[]): string {
  return Object.entries(key)
    .map(([name, value]) => {
      params.push(value)
      return `${quoteIdent(name)} = ?`
    })
    .join(" and ")
}

async function updateCell(
  runner: SqlRunner,
  relation: Relation,
  primaryKey: Record<string, unknown>,
  column: string,
  value: unknown
): Promise<void> {
  const params: unknown[] = [value]
  const where = whereClause(primaryKey, params)
  await runner.exec(
    `update ${qualify(relation)} set ${quoteIdent(column)} = ? where ${where}`,
    params
  )
}

/** Inserts a row. Columns the user never touched are left out of the
 * statement entirely, so an `auto_increment` id or a `default` still applies —
 * an empty `values` inserts an all-default row. */
async function insertRow(
  runner: SqlRunner,
  relation: Relation,
  values: Record<string, unknown>
): Promise<void> {
  const entries = Object.entries(values)
  if (entries.length === 0) {
    await runner.exec(`insert into ${qualify(relation)} () values ()`)
    return
  }

  const columns = entries.map(([name]) => quoteIdent(name)).join(", ")
  const placeholders = entries.map(() => "?").join(", ")
  const params = entries.map(([, value]) => value)
  await runner.exec(
    `insert into ${qualify(relation)} (${columns}) values (${placeholders})`,
    params
  )
}

async function deleteRow(
  runner: SqlRunner,
  relation: Relation,
  primaryKey: Record<string, unknown>
): Promise<void> {
  const params: unknown[] = []
  const where = whereClause(primaryKey, params)
  await runner.exec(`delete from ${qualify(relation)} where ${where}`, params)
}

export const mysqlAdapter: EngineAdapter = {
  quoteIdent,
  qualify,
  defaultSql: `select * from information_schema.tables
 where table_schema = database()
 order by table_name;
`,
  columnTypes: COLUMN_TYPES,
  isEditableType,

  listRelations,
  listColumns,
  listIndexes,
  listForeignKeys,
  listCheckConstraints,
  listTriggers,
  listPartitions,
  countRows,
  listLabelRows,
  readPage,
  listCompletions,
  serverVersion,

  initialDraft,
  newColumn,
  draftError,
  createTableSql,

  dropTableSql,
  truncateTableSql,
  renameTableSql,
  newColumnDraft,
  newColumnError,
  addColumnSql,
  dropColumnSql,
  renameColumnSql,

  updateCell,
  insertRow,
  deleteRow,
}
