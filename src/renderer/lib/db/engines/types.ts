import type { FilterSet } from "@shared/api"

import type { SqlResult, SqlRunner } from "../runner"

/** Rows read per page of the data browser, for every engine. */
export const PAGE_SIZE = 100

/**
 * Kinds of relation the panel shows.
 *
 * Postgres alone has `partitioned` (a table split across children) and
 * `matview` (a materialized view); MySQL's adapter only ever produces
 * `table`/`view` — it has neither concept — but the type stays shared so the
 * panel does not need to know which engine it is looking at to render one.
 */
export type RelationKind = "table" | "partitioned" | "view" | "matview"

export type Relation = {
  schema: string
  name: string
  kind: RelationKind
}

export type Column = {
  name: string
  type: string
  nullable: boolean
  default: string | null
  primaryKey: boolean
  /** Native enum members in declaration order, or null when the type isn't a
   * native enum (Postgres `create type ... as enum`, MySQL `enum(...)`). */
  enumValues: string[] | null
  /** The generation expression, or null for an ordinary column. A generated
   * column's `default` is always null instead — it has no separate default. */
  generatedExpression: string | null
}

/** One candidate row for a foreign-key picker: its primary key (as an
 * update/delete key) and a human label to show instead of the raw key. */
export type LabelRow = {
  pk: Record<string, unknown>
  label: string
}

/**
 * One cell the user has changed but not yet saved: `updateCell`'s arguments
 * minus the relation, which is the same for every edit on a page.
 */
export type CellWrite = {
  primaryKey: Record<string, unknown>
  column: string
  value: string | null
}

/**
 * An order the user asked for from a column's header menu. It is layered *on
 * top of* each engine's own stable ordering rather than replacing it, so
 * paging through rows that tie on the sorted column stays consistent.
 */
export type SortOrder = {
  column: string
  direction: "asc" | "desc"
}

/**
 * The filter bar's shape lives in the shared contract: the main process builds
 * one too, when the agent is asked to write a filter from a sentence.
 */
export type { Filter, FilterJoin, FilterOperator, FilterSet } from "@shared/api"

export type Index = {
  name: string
  /** The indexed columns, in declared order — more than one for a composite
   * index. */
  columns: string[]
  /** The index's storage method — Postgres: `btree`/`gin`/`hash`/…; MySQL:
   * `BTREE`/`HASH`/`FULLTEXT`/…. */
  method: string
  primary: boolean
  unique: boolean
}

export type ForeignKey = {
  name: string
  columns: string[]
  referencedSchema: string
  referencedTable: string
  referencedColumns: string[]
}

export type CheckConstraint = {
  name: string
  /** The check expression, as the engine reports it. */
  definition: string
}

/** A trigger declared on this relation — internally generated ones (e.g. the
 * machinery behind a foreign key) are filtered out at the query, not here. */
export type Trigger = {
  name: string
  /** The full, human-readable definition — Postgres: `pg_get_triggerdef`;
   * MySQL: assembled from `information_schema.triggers` since it has no
   * single-string equivalent. */
  definition: string
}

/** One child of a partitioned table — Postgres only; MySQL's adapter never
 * reports a relation as `partitioned` (see `RelationKind`), so its
 * `listPartitions` never has anything to return. */
export type Partition = {
  name: string
  /** The partition's bound expression, e.g. `FOR VALUES FROM (...) TO (...)`,
   * `FOR VALUES IN (...)`, or `DEFAULT`. */
  bound: string
}

/**
 * A column being designed in the new-table dialog. Everything is a string
 * because it is being typed: the draft is validated on the way out, not per
 * keystroke.
 */
export type ColumnDraft = {
  /** Stable identity for a drafted column, independent of its position in the
   * list — a row's array index shifts under it whenever an earlier column is
   * removed, which makes index-as-key unsafe for React. */
  id: string
  name: string
  /** Written as SQL, in whatever the connected engine understands: `text`,
   * `varchar(255)`, `numeric(10,2)`. */
  type: string
  nullable: boolean
  primaryKey: boolean
  /** A default *expression*, not a literal: `now()`, `0`, `'pending'`. */
  default: string
}

export type TableDraft = {
  schema: string
  name: string
  columns: ColumnDraft[]
}

/** A column being added to an existing table — the same shape as `ColumnDraft`
 * minus `id`/`primaryKey`: adding a column to a populated table can't also
 * make it part of the primary key without a value for every existing row. */
export type NewColumnDraft = {
  name: string
  type: string
  nullable: boolean
  default: string
}

/**
 * Everything the Database panel needs from a SQL engine, so the panel itself
 * never has to branch on Postgres vs MySQL — it asks whichever adapter
 * `getAdapter` hands it for the currently selected database.
 */
export type EngineAdapter = {
  /** Quotes an identifier for interpolation into SQL. */
  quoteIdent(name: string): string
  /** A relation's schema-qualified name, quoted. */
  qualify(relation: Relation): string
  /** Shown in the SQL tab before anything has been typed. */
  defaultSql: string
  /** Every type offered in the "new table"/"add column" type dropdown. */
  columnTypes: string[]
  /** Whether a column of this type is safe to edit through a plain text input. */
  isEditableType(type: string): boolean

  listRelations(runner: SqlRunner): Promise<Relation[]>
  listColumns(runner: SqlRunner, relation: Relation): Promise<Column[]>
  listIndexes(runner: SqlRunner, relation: Relation): Promise<Index[]>
  listForeignKeys(runner: SqlRunner, relation: Relation): Promise<ForeignKey[]>
  listCheckConstraints(
    runner: SqlRunner,
    relation: Relation
  ): Promise<CheckConstraint[]>
  listTriggers(runner: SqlRunner, relation: Relation): Promise<Trigger[]>
  listPartitions(runner: SqlRunner, relation: Relation): Promise<Partition[]>
  /** Rows the browser would show, which is all of them until filtered. */
  countRows(
    runner: SqlRunner,
    relation: Relation,
    columns: Column[],
    filters?: FilterSet | null
  ): Promise<number>
  /**
   * Rows of a table being referenced by a foreign key, identified by
   * `keyColumns` (the referenced column(s) — not necessarily that table's
   * own primary key) alongside a human `labelColumn`.
   *
   * - With `keys`, resolves exactly those key values (a `where ... in (...)`
   *   lookup) — used to label the foreign-key values already visible on a
   *   loaded page, in one batched call rather than one per cell.
   * - Otherwise, with `search`, filters case-insensitively by `labelColumn`.
   * - With neither, returns the first `limit` rows ordered by `keyColumns` —
   *   the picker's initial, unfiltered list.
   *
   * Always queried fresh rather than filtering a cached page, so results
   * stay correct even when the referenced table is larger than one page.
   */
  listLabelRows(
    runner: SqlRunner,
    relation: Relation,
    labelColumn: Column,
    keyColumns: Column[],
    limit: number,
    options?: { search?: string; keys?: unknown[] }
  ): Promise<LabelRow[]>
  readPage(
    runner: SqlRunner,
    relation: Relation,
    columns: Column[],
    offset: number,
    sort?: SortOrder | null,
    filters?: FilterSet | null
  ): Promise<SqlResult>
  /** Every column in the database, keyed by table name, for editor completion. */
  listCompletions(runner: SqlRunner): Promise<Record<string, string[]>>
  /** The server version string, used as a subtitle for the connection. */
  serverVersion(runner: SqlRunner): Promise<string | null>

  initialDraft(schema: string): TableDraft
  newColumn(): ColumnDraft
  /** Why the draft cannot be turned into SQL yet, or null when it can. */
  draftError(draft: TableDraft): string | null
  createTableSql(draft: TableDraft): string

  dropTableSql(relation: Relation): string
  truncateTableSql(relation: Relation): string
  renameTableSql(relation: Relation, newName: string): string
  newColumnDraft(): NewColumnDraft
  newColumnError(column: NewColumnDraft): string | null
  addColumnSql(relation: Relation, column: NewColumnDraft): string
  dropColumnSql(relation: Relation, columnName: string): string
  renameColumnSql(
    relation: Relation,
    columnName: string,
    newName: string
  ): string

  updateCell(
    runner: SqlRunner,
    relation: Relation,
    primaryKey: Record<string, unknown>,
    column: string,
    value: unknown
  ): Promise<void>
  insertRow(
    runner: SqlRunner,
    relation: Relation,
    values: Record<string, unknown>
  ): Promise<void>
  deleteRow(
    runner: SqlRunner,
    relation: Relation,
    primaryKey: Record<string, unknown>
  ): Promise<void>
}
