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
  type RelationKind,
  type FilterSet,
  type SortOrder,
  type TableDraft,
  type Trigger,
} from "./types"

/** Quotes an identifier for interpolation into SQL. */
function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/**
 * A relation's schema-qualified name, quoted. Safe both interpolated into a
 * query and passed as a `regclass` parameter, which parses quoting itself — and
 * quoting is what keeps a table called `select` or `My Table` working.
 */
function qualify(relation: Relation): string {
  return `${quoteIdent(relation.schema)}.${quoteIdent(relation.name)}`
}

const KINDS: Record<string, RelationKind> = {
  r: "table",
  p: "partitioned",
  v: "view",
  m: "matview",
}

/**
 * Every relation the app owns. Postgres' own catalogs are filtered out: they
 * are the same in every database and would bury the handful of tables that
 * actually matter here.
 */
async function listRelations(runner: SqlRunner): Promise<Relation[]> {
  const results = await runner.exec(/* sql */ `
    select n.nspname as schema, c.relname as name, c.relkind as kind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p', 'v', 'm')
       and n.nspname not in ('pg_catalog', 'information_schema')
       and n.nspname not like 'pg\\_toast%'
       and n.nspname not like 'pg\\_temp%'
     order by n.nspname, c.relname
  `)

  return objectRows<{ schema: string; name: string; kind: string }>(results[0])
    .map((row) => ({
      schema: row.schema,
      name: row.name,
      kind: KINDS[row.kind],
    }))
    .filter((relation): relation is Relation => relation.kind !== undefined)
}

/**
 * Whether this server's `pg_attribute` has an `attgenerated` column, i.e.
 * whether it's Postgres 12+ and understands generated columns at all.
 * Querying a nonexistent catalog column fails at parse time — no
 * `case`/`coalesce` can hide that — so the two possible query texts for
 * `listColumns` have to be chosen by the client, using this probe.
 */
async function hasGeneratedColumnSupport(runner: SqlRunner): Promise<boolean> {
  const results = await runner.exec(/* sql */ `
    select exists (
      select 1 from information_schema.columns
       where table_schema = 'pg_catalog'
         and table_name = 'pg_attribute'
         and column_name = 'attgenerated'
    ) as has_generated
  `)
  return Boolean(results[0]?.rows[0]?.[0])
}

async function listColumns(
  runner: SqlRunner,
  relation: Relation
): Promise<Column[]> {
  const hasGenerated = await hasGeneratedColumnSupport(runner)

  const results = await runner.exec(
    /* sql */ `
    select a.attname                                  as name,
           format_type(a.atttypid, a.atttypmod)       as type,
           not a.attnotnull                           as nullable,
           pg_get_expr(d.adbin, d.adrelid)            as default_expr,
           coalesce(k.primary_key, false)             as primary_key,
           en.labels                                  as enum_values,
           ${hasGenerated ? "(a.attgenerated <> '')" : "false"} as is_generated
      from pg_attribute a
      left join pg_attrdef d
             on d.adrelid = a.attrelid and d.adnum = a.attnum
      left join (
             select unnest(i.indkey) as attnum, true as primary_key
               from pg_index i
              where i.indrelid = $1::regclass and i.indisprimary
           ) k on k.attnum = a.attnum
      left join (
             select enumtypid, array_agg(enumlabel order by enumsortorder) as labels
               from pg_enum
              group by enumtypid
           ) en on en.enumtypid = a.atttypid
     where a.attrelid = $1::regclass
       and a.attnum > 0
       and not a.attisdropped
     order by a.attnum
  `,
    [qualify(relation)]
  )

  return objectRows<{
    name: string
    type: string
    nullable: boolean
    default_expr: string | null
    primary_key: boolean
    enum_values: string[] | null
    is_generated: boolean
  }>(results[0]).map((row) => ({
    name: row.name,
    type: row.type,
    nullable: row.nullable,
    // A generated column's expression lives in the same place a default
    // would (`pg_get_expr(d.adbin, ...)`); `is_generated` only says which
    // bucket it belongs in.
    default: row.is_generated ? null : row.default_expr,
    generatedExpression: row.is_generated ? row.default_expr : null,
    primaryKey: row.primary_key,
    // Not matched for an enum wrapped in a domain, or an array of an enum
    // type — `en.enumtypid` is the element type's oid, not the domain's or
    // the array's. Arrays are already excluded from `isEditableType`, so
    // this loses no behavior; a domain-wrapped enum just renders as `text`.
    enumValues: row.enum_values,
  }))
}

async function listIndexes(
  runner: SqlRunner,
  relation: Relation
): Promise<Index[]> {
  const results = await runner.exec(
    /* sql */ `
    select i.relname     as name,
           am.amname     as method,
           x.indisprimary as is_primary,
           x.indisunique  as is_unique,
           array(
             select a.attname
               from unnest(x.indkey) with ordinality as k(attnum, ord)
               join pg_attribute a
                 on a.attrelid = x.indrelid and a.attnum = k.attnum
              order by k.ord
           ) as columns
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_am am on am.oid = i.relam
     where x.indrelid = $1::regclass
     order by x.indisprimary desc, i.relname
  `,
    [qualify(relation)]
  )

  return objectRows<{
    name: string
    method: string
    is_primary: boolean
    is_unique: boolean
    columns: string[]
  }>(results[0]).map((row) => ({
    name: row.name,
    columns: row.columns,
    method: row.method,
    primary: row.is_primary,
    unique: row.is_unique,
  }))
}

/** Foreign keys declared *from* this relation, read-only — there is no builder for these. */
async function listForeignKeys(
  runner: SqlRunner,
  relation: Relation
): Promise<ForeignKey[]> {
  const results = await runner.exec(
    /* sql */ `
    select c.conname as name,
           array(select a.attname from pg_attribute a
                  where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) as columns,
           rn.nspname as ref_schema,
           rc.relname as ref_table,
           array(select a.attname from pg_attribute a
                  where a.attrelid = c.confrelid and a.attnum = any(c.confkey)) as ref_columns
      from pg_constraint c
      join pg_class rc on rc.oid = c.confrelid
      join pg_namespace rn on rn.oid = rc.relnamespace
     where c.conrelid = $1::regclass
       and c.contype = 'f'
     order by c.conname
  `,
    [qualify(relation)]
  )

  return objectRows<{
    name: string
    columns: string[]
    ref_schema: string
    ref_table: string
    ref_columns: string[]
  }>(results[0]).map((row) => ({
    name: row.name,
    columns: row.columns,
    referencedSchema: row.ref_schema,
    referencedTable: row.ref_table,
    referencedColumns: row.ref_columns,
  }))
}

async function listCheckConstraints(
  runner: SqlRunner,
  relation: Relation
): Promise<CheckConstraint[]> {
  const results = await runner.exec(
    /* sql */ `
    select conname as name, pg_get_constraintdef(oid) as definition
      from pg_constraint
     where conrelid = $1::regclass
       and contype = 'c'
     order by conname
  `,
    [qualify(relation)]
  )

  return objectRows<{ name: string; definition: string }>(results[0])
}

/** User-declared triggers only — `tgisinternal` filters out the machinery
 * Postgres generates for its own purposes, e.g. enforcing a foreign key. */
async function listTriggers(
  runner: SqlRunner,
  relation: Relation
): Promise<Trigger[]> {
  const results = await runner.exec(
    /* sql */ `
    select tgname as name, pg_get_triggerdef(oid) as definition
      from pg_trigger
     where tgrelid = $1::regclass
       and not tgisinternal
     order by tgname
  `,
    [qualify(relation)]
  )

  return objectRows<{ name: string; definition: string }>(results[0])
}

/** Direct children of a partitioned table. Empty for anything else — a plain
 * table, a view, or a partition's own further sub-partitions are out of
 * scope for what this tab shows. */
async function listPartitions(
  runner: SqlRunner,
  relation: Relation
): Promise<Partition[]> {
  const results = await runner.exec(
    /* sql */ `
    select c.relname as name, pg_get_expr(c.relpartbound, c.oid) as bound
      from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
     where i.inhparent = $1::regclass
     order by c.relname
  `,
    [qualify(relation)]
  )

  return objectRows<{ name: string; bound: string }>(results[0])
}

/** Escapes `%`/`_`/`\` for interpolation into an `ilike` pattern — Postgres'
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
      return `$${params.length}`
    })
    where = `where ${keyIdents[0]} in (${placeholders.join(", ")})`
  } else if (options?.search) {
    params.push(`%${escapeLikePattern(options.search)}%`)
    where = `where ${labelIdent}::text ilike $${params.length}`
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
  // Not `reltuples`: that is a planner estimate, and it reads -1 until the
  // table has been analysed, which is exactly when someone is looking at a
  // table they just created.
  const where = buildWhere(filters, columns, quoteIdent, (index) => `$${index}`)
  const results = await runner.exec(
    `select count(*)::int as count from ${qualify(relation)}` +
      (where.sql ? ` where ${where.sql}` : ""),
    where.params
  )
  const count = results[0]?.rows[0]?.[0]
  return typeof count === "number" ? count : 0
}

/**
 * Reads one page of a relation.
 *
 * Rows come back in whatever order the heap gives them unless asked otherwise,
 * which makes paging skip and repeat rows. The primary key is the stable choice;
 * failing that, a plain table can be ordered by its physical `ctid`.
 *
 * A `sort` the user picked leads, but never replaces that stable ordering:
 * rows tying on the sorted column would otherwise come back in a different
 * arrangement per page.
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
  const stable =
    keys.length > 0
      ? keys.map((column) => quoteIdent(column.name))
      : relation.kind === "table" || relation.kind === "partitioned"
        ? ["ctid"]
        : []

  // Only a column the introspection actually returned can be ordered by —
  // never a name straight off the wire.
  const sorted =
    sort && columns.some((column) => column.name === sort.column)
      ? [
          `${quoteIdent(sort.column)} ${sort.direction === "desc" ? "desc" : "asc"} nulls last`,
        ]
      : []
  const order = [...sorted, ...stable]

  const where = buildWhere(filters, columns, quoteIdent, (index) => `$${index}`)

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
 * type: `public.todos.` and `todos.` should complete the same way.
 */
async function listCompletions(
  runner: SqlRunner
): Promise<Record<string, string[]>> {
  const results = await runner.exec(/* sql */ `
    select n.nspname   as schema,
           c.relname   as relation,
           a.attname   as column
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where a.attnum > 0
       and not a.attisdropped
       and c.relkind in ('r', 'p', 'v', 'm')
       and n.nspname not in ('pg_catalog', 'information_schema')
       and n.nspname not like 'pg\\_toast%'
       and n.nspname not like 'pg\\_temp%'
     order by n.nspname, c.relname, a.attnum
  `)

  const schema: Record<string, string[]> = {}
  for (const row of objectRows<{
    schema: string
    relation: string
    column: string
  }>(results[0])) {
    // CodeMirror's schema completion crashes on any non-string entry, and a
    // driver quirk (e.g. a column-less row) is not worth taking the whole
    // editor down over.
    if (typeof row.column !== "string") continue
    for (const key of [`${row.schema}.${row.relation}`, row.relation]) {
      ;(schema[key] ??= []).push(row.column)
    }
  }
  return schema
}

/** The server version string, used as a subtitle for the connection. */
async function serverVersion(runner: SqlRunner): Promise<string | null> {
  const results = await runner.exec(`select version()`)
  const value = results[0]?.rows[0]?.[0]
  if (typeof value !== "string") return null
  // "PostgreSQL 17.4 on aarch64-…, compiled by …" — the tail is noise here.
  return value.split(" on ")[0] ?? value
}

/** Every type offered in the type dropdown. */
const COLUMN_TYPES = [
  "text",
  "varchar(255)",
  "character varying",
  "char(10)",
  "boolean",
  "smallint",
  "integer",
  "bigint",
  "smallserial",
  "serial",
  "bigserial",
  "numeric",
  "numeric(10,2)",
  "real",
  "double precision",
  "money",
  "date",
  "time",
  "timetz",
  "timestamp",
  "timestamptz",
  "interval",
  "uuid",
  "json",
  "jsonb",
  "xml",
  "bytea",
  "inet",
  "cidr",
  "macaddr",
  "bit(1)",
  "bit varying",
  "tsvector",
  "tsquery",
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
        type: "serial",
        nullable: false,
        primaryKey: true,
        default: "",
      },
      {
        id: crypto.randomUUID(),
        name: "created_at",
        type: "timestamptz",
        nullable: false,
        primaryKey: false,
        default: "now()",
      },
    ],
  }
}

/**
 * Renders the draft as `create table`.
 *
 * Identifiers are quoted, which is what makes a column called `order` or one
 * called `Name` work. Types and defaults are passed through as written: they
 * are SQL expressions, and there is no way to quote `numeric(10,2)` or
 * `now()` into something Postgres still understands.
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

  const table = `${quoteIdent(draft.schema)}.${quoteIdent(draft.name.trim())}`
  return `create table ${table} (\n${lines.join(",\n")}\n);\n`
}

function dropTableSql(relation: Relation): string {
  return `drop table ${qualify(relation)};\n`
}

function truncateTableSql(relation: Relation): string {
  return `truncate table ${qualify(relation)};\n`
}

function renameTableSql(relation: Relation, newName: string): string {
  return `alter table ${qualify(relation)} rename to ${quoteIdent(newName.trim())};\n`
}

function addColumnSql(relation: Relation, column: NewColumnDraft): string {
  let line = `alter table ${qualify(relation)} add column ${quoteIdent(column.name.trim())} ${column.type.trim()}`
  if (!column.nullable) line += " not null"
  if (column.default.trim()) line += ` default ${column.default.trim()}`
  return line + ";\n"
}

function dropColumnSql(relation: Relation, columnName: string): string {
  return `alter table ${qualify(relation)} drop column ${quoteIdent(columnName)};\n`
}

function renameColumnSql(
  relation: Relation,
  columnName: string,
  newName: string
): string {
  return `alter table ${qualify(relation)} rename column ${quoteIdent(columnName)} to ${quoteIdent(newName.trim())};\n`
}

/**
 * Whether a column of this Postgres type is safe to edit through a plain text
 * input.
 *
 * `jsonb`/`json` and arrays are shown pretty-printed by `ResultGrid`, which
 * does not round-trip back into the literal syntax Postgres expects
 * (`{1,2,3}` for an array, not `[1,2,3]`), and `bytea` is not shown as text at
 * all. Editing those from the grid is left to the SQL tab.
 */
function isEditableType(type: string): boolean {
  const normalized = type.trim().toLowerCase()
  if (normalized.endsWith("[]")) return false
  if (normalized === "json" || normalized === "jsonb") return false
  if (normalized === "bytea") return false
  return true
}

/**
 * Builds `"a" = $1 and "b" = $2`, appending each value to `params` in the same
 * pass the clause is built in — so the clause text and the params array can
 * never drift out of sync, including when `params` already has entries (an
 * `update`'s new value comes before its `where`).
 */
function whereClause(key: Record<string, unknown>, params: unknown[]): string {
  return Object.entries(key)
    .map(([name, value]) => {
      params.push(value)
      return `${quoteIdent(name)} = $${params.length}`
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
    `update ${qualify(relation)} set ${quoteIdent(column)} = $1 where ${where}`,
    params
  )
}

/** Inserts a row. Columns the user never touched are left out of the
 * statement entirely, so a `serial` id or a `default now()` still applies —
 * an empty `values` inserts an all-default row. */
async function insertRow(
  runner: SqlRunner,
  relation: Relation,
  values: Record<string, unknown>
): Promise<void> {
  const entries = Object.entries(values)
  if (entries.length === 0) {
    await runner.exec(`insert into ${qualify(relation)} default values`)
    return
  }

  const columns = entries.map(([name]) => quoteIdent(name)).join(", ")
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ")
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

export const postgresAdapter: EngineAdapter = {
  quoteIdent,
  qualify,
  defaultSql: `select * from information_schema.tables
 where table_schema not in ('pg_catalog', 'information_schema')
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
