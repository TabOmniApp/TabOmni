import { create } from "zustand"

import type { DbEngine } from "@shared/api"
import {
  getAdapter,
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
} from "./engines"
import { postgresAdapter } from "./engines/postgres"
import { mayChangeSchema } from "./danger"
import { QUERY_ROW_LIMIT, withRowLimit } from "./row-limit"
import type { ColumnPref } from "./display"
import { pickLabelColumn } from "./field-kind"
import { useStudio } from "../store"
import { useDatabases } from "./databases-store"
import { databaseRunner, type SqlResult, type SqlRunner } from "./runner"

export type Tab =
  | "data"
  | "columns"
  | "foreignKeys"
  | "indexes"
  | "checkConstraints"
  | "triggers"
  | "partitions"

/**
 * What lets a query's own result be edited like a browsed table's page —
 * present only once every field in a single-statement result traces back,
 * unaliased, to the same table's own row, and that table's primary key is
 * covered. Built fresh after every run; gone the moment the query changes.
 */
export type QueryResultEdit = {
  relation: Relation
  columns: Column[]
  foreignKeys: ForeignKey[]
  fkLabels: Record<string, Map<string, string>>
}

/** One SQL console, opened as its own tab in the tab strip. */
export type QueryTab = {
  id: string
  title: string
  sql: string
  results: SqlResult[] | null
  /** Set only when `results` is exactly one editable result — see
   * `QueryResultEdit`. Null for a script, a join, an aggregate, or a table
   * without a primary key: those stay read-only. */
  resultEdit: QueryResultEdit | null
  /** Why `resultEdit` came back null — shown next to the results so a script,
   * a join, or a missing primary key reads as "read-only, and here's why"
   * rather than as a silent absence of the Row/Fields toolbar. Null when
   * `resultEdit` is set, or before anything has run. */
  readOnlyReason: string | null
  /** Whether the trailing "New row" draft is open, for the one result this
   * can ever apply to. */
  inserting: boolean
  /** What actually ran last — the selection rather than `sql` when the console
   * was run over one, with the row cap already appended. A rerun after a row
   * mutation repeats this verbatim, so an edit made in the grid reloads the
   * same rows rather than the whole tab's worth. */
  ranSql: string | null
  /** The cap `runQuery` appended to the last run, or null when the statement
   * limited itself (or couldn't be capped). Only worth showing when the
   * result actually reached it — see `QUERY_ROW_LIMIT`. */
  rowLimit: number | null
  sqlError: string | null
  elapsedMs: number | null
  running: boolean
}

/** Everything the tab strip can hold — a table's own tab, or a query's. */
export type OpenTab =
  { kind: "relation"; relation: Relation } | { kind: "query"; query: QueryTab }

type ExplorerState = {
  /** Which database is being browsed, and how to talk to it. Null with no database selected. */
  databaseId: string | null
  engine: DbEngine | null
  /** Where a new table lands without the user naming one — `public` for
   * Postgres, the connected database's own name for MySQL. */
  defaultSchema: string
  version: string | null

  relations: Relation[]
  loadingRelations: boolean
  /**
   * Bumped once every time `refresh` reads the schema through. The tree
   * watches it to keep the open database's branch in step with a table
   * created, renamed or dropped here, without reading the schema again — and
   * to tell a read that never got through from one that did but left a later
   * failure (the open table's own page) in `error`.
   */
  schemaReads: number
  /** Table and column names, for completion in the SQL console. */
  completions: Record<string, string[]>
  /** Why the database could not be read. */
  error: string | null

  selected: Relation | null
  /** Every tab in the workspace's strip, oldest first — a table's own tab or
   * a query's. `selected` is whichever relation tab is on screen when
   * `activeQueryTabId` is null; otherwise a query tab is on screen. */
  openTabs: OpenTab[]
  /** Which query tab is on screen, or null when a relation tab is instead. */
  activeQueryTabId: string | null
  tab: Tab
  columns: Column[]
  indexes: Index[]
  foreignKeys: ForeignKey[]
  checkConstraints: CheckConstraint[]
  triggers: Trigger[]
  /** Empty for anything but a `partitioned` relation — see `Partition`. */
  partitions: Partition[]
  rowCount: number | null
  page: number
  /** The order asked for from a column's header menu, or null for the
   * engine's own stable ordering. Dropped when another table is opened. */
  sort: SortOrder | null
  /** Conditions the data browser is showing rows through, or null for none.
   * Dropped when another table is opened — they name its columns. */
  filters: FilterSet | null
  /** How the Data tab should *display* each column — hidden, wrapped, number
   * and date formats. Presentation only: nothing here is ever written back to
   * the database, since there is no metadata layer to write it to. Keyed
   * "schema.table" then column name, so it survives switching tables and tabs
   * within a session. */
  columnPrefs: Record<string, Record<string, ColumnPref>>
  data: SqlResult | null
  loadingData: boolean
  /** Human labels for the foreign-key values on the current page, keyed by
   * column name then by the value stringified — filled in shortly after
   * `data`, not blocking the page's own render. */
  fkLabels: Record<string, Map<string, string>>

  /** The same display preferences as `columnPrefs`, but for a query tab's own
   * result — keyed by query tab id rather than "schema.table", since a
   * result's columns may not (yet, or ever) trace back to a single table the
   * way `columnPrefs` assumes. Available for any result, editable or not. */
  queryColumnPrefs: Record<string, Record<string, ColumnPref>>

  /** Re-reads the open database's tables, completions and server version. */
  refresh: () => Promise<void>
  /** Creates a table and opens it. Resolves to an error message on failure. */
  createTable: (draft: TableDraft) => Promise<string | null>
  select: (relation: Relation) => void
  /** Closes one tab (relation or query), falling back to its neighbour — the
   * one on the right, as an editor does — when it was the open one. */
  closeTab: (id: string) => void
  closeOtherTabs: (id: string) => void
  closeAllTabs: () => void
  /** Reorders the tab strip. Only tabs already open are kept, so a stale list
   * can shuffle the tabs but never conjure or drop one. */
  reorderTabs: (ids: string[]) => void
  setTab: (tab: Tab) => void
  setPage: (page: number) => void
  /** Orders the data browser by one column, or clears the order with null. */
  setSort: (sort: SortOrder | null) => void
  /** Narrows the data browser. Null or an empty set shows everything. */
  setFilters: (filters: FilterSet | null) => void
  /** Merges display preferences into one column of the selected table. */
  setColumnPref: (column: string, pref: Partial<ColumnPref>) => void
  /** Un-hides every column of the selected table and clears its formats. */
  resetColumnPrefs: () => void
  /** Re-reads the selected relation's current page, e.g. after a row mutation. */
  reloadPage: () => Promise<void>
  /** Resolves to an error message on failure, so the grid can show it inline. */
  updateCell: (
    primaryKey: Record<string, unknown>,
    column: string,
    value: unknown
  ) => Promise<string | null>
  insertRow: (values: Record<string, unknown>) => Promise<string | null>
  deleteRow: (primaryKey: Record<string, unknown>) => Promise<string | null>
  /** Candidate rows for a foreign-key cell's picker, optionally filtered —
   * see `EngineAdapter.listLabelRows`. */
  searchForeignKeyRows: (fk: ForeignKey, search?: string) => Promise<LabelRow[]>

  /** Drops the selected table. */
  dropTable: () => Promise<string | null>
  /** Empties the selected table. */
  truncateTable: () => Promise<string | null>
  /** Renames the selected table and follows the workspace to its new name. */
  renameTable: (name: string) => Promise<string | null>
  addColumn: (column: NewColumnDraft) => Promise<string | null>
  dropColumn: (columnName: string) => Promise<string | null>
  renameColumn: (columnName: string, newName: string) => Promise<string | null>

  /** Opens a new query tab and focuses it. `sql` seeds its editor — used by
   * "Query in SQL tab" from a table's context menu — and falls back to the
   * engine's own placeholder statement when omitted. */
  openQueryTab: (sql?: string) => void
  selectQueryTab: (id: string) => void
  setQuerySql: (id: string, sql: string) => void
  /** `silent: true` — used to rerun a query after a row mutation, rather
   * than a press of the Run button itself — skips the tab's own `running`
   * flag, so the button doesn't flash "Running…" for a refresh nothing
   * asked it to report on. `sql` runs something other than the tab's whole
   * editor, which is how running a selection works; omitted, a silent rerun
   * repeats `ranSql` and anything else runs the editor. `unlimited: true`
   * skips the row cap — the escape hatch for when the whole result really is
   * wanted. */
  runQuery: (
    id: string,
    options?: { silent?: boolean; sql?: string; unlimited?: boolean }
  ) => Promise<void>
  /** Mutates through a query tab's `resultEdit`, the same way `updateCell` /
   * `insertRow` / `deleteRow` do for the Data tab — then reruns the query so
   * the grid reflects the change. Resolves to an error message on failure. */
  updateQueryCell: (
    tabId: string,
    primaryKey: Record<string, unknown>,
    column: string,
    value: unknown
  ) => Promise<string | null>
  insertQueryRow: (
    tabId: string,
    values: Record<string, unknown>
  ) => Promise<string | null>
  deleteQueryRow: (
    tabId: string,
    primaryKey: Record<string, unknown>
  ) => Promise<string | null>
  setQueryInserting: (tabId: string, inserting: boolean) => void
  /** Merges display preferences into one column of a query tab's result —
   * works for any result, whether or not it turned out to be editable. */
  setQueryColumnPref: (
    tabId: string,
    column: string,
    pref: Partial<ColumnPref>
  ) => void
  resetQueryColumnPrefs: (tabId: string) => void
}

/**
 * Guards against a slow load overwriting a newer one: every load takes a token
 * and drops its result if another has started since.
 */
let token = 0

/** Names new query tabs "Query 1", "Query 2"… — never reused, even once one
 * of those numbers is closed. */
let queryCounter = 0

/** Guards a silent `runQuery` against overlapping itself — its own
 * concurrency check, kept off the tab's `running` field so a silent refresh
 * never flips the Run button's own busy state. */
const silentlyRunning = new Set<string>()

/** Everything read from a database, cleared when the selection changes. */
function blank() {
  return {
    version: null,
    relations: [],
    loadingRelations: false,
    completions: {},
    error: null,
    selected: null,
    openTabs: [],
    activeQueryTabId: null,
    tab: "data" as Tab,
    columns: [],
    indexes: [],
    foreignKeys: [],
    checkConstraints: [],
    triggers: [],
    partitions: [],
    rowCount: null,
    page: 0,
    sort: null,
    filters: null,
    columnPrefs: {},
    data: null,
    loadingData: false,
    fkLabels: {},
    queryColumnPrefs: {},
  }
}

/**
 * Human labels for the foreign-key values visible on one loaded page —
 * batched per FK column (one lookup for every distinct value on the page)
 * rather than fetched per cell. Best-effort: a referenced table this
 * connection can't currently read (permissions, or it's since been dropped)
 * just leaves that column showing its raw value instead of failing the page.
 */
async function loadFkLabels(
  engineAdapter: EngineAdapter,
  run: SqlRunner,
  foreignKeys: ForeignKey[],
  data: SqlResult
): Promise<Record<string, Map<string, string>>> {
  const result: Record<string, Map<string, string>> = {}

  await Promise.all(
    foreignKeys
      .filter((fk) => fk.columns.length === 1)
      .map(async (fk) => {
        const columnName = fk.columns[0]!
        const fieldIndex = data.fields.findIndex(
          (field) => field.name === columnName
        )
        if (fieldIndex === -1) return

        const values = [
          ...new Set(
            data.rows
              .map((row) => row[fieldIndex])
              .filter((value) => value !== null && value !== undefined)
          ),
        ]
        if (values.length === 0) return

        try {
          const referenced: Relation = {
            schema: fk.referencedSchema,
            name: fk.referencedTable,
            kind: "table",
          }
          const referencedColumns = await engineAdapter.listColumns(
            run,
            referenced
          )
          const keyColumns = referencedColumns.filter((column) =>
            fk.referencedColumns.includes(column.name)
          )
          if (keyColumns.length === 0) return
          const labelColumn = pickLabelColumn(referencedColumns, keyColumns)

          const labelRows = await engineAdapter.listLabelRows(
            run,
            referenced,
            labelColumn,
            keyColumns,
            values.length,
            { keys: values }
          )
          result[columnName] = new Map(
            labelRows.map((row) => [
              String(row.pk[keyColumns[0]!.name]),
              row.label,
            ])
          )
        } catch {
          // Best-effort — see doc comment above.
        }
      })
  )

  return result
}

export const useExplorer = create<ExplorerState>((set, get) => {
  /**
   * The currently selected database.
   *
   * Throws rather than returning null: every action here is reached from UI
   * that only exists while a database is open, so a missing id is a bug, and
   * the message surfaces in the panel either way.
   */
  function runner(): SqlRunner {
    const { databaseId } = get()
    if (!databaseId) throw new Error("No database is open.")
    return databaseRunner(databaseId)
  }

  function adapter() {
    const { engine } = get()
    if (!engine) throw new Error("No database is open.")
    return getAdapter(engine)
  }

  /**
   * Columns, indexes and one page of the selected relation.
   *
   * `page` is clamped to the last page that still has rows: a row delete, a
   * truncate, or any other statement run from the SQL console can shrink the
   * table out from under whatever page was open, and re-requesting that page
   * would otherwise come back empty with "Previous" wrongly disabled.
   */
  async function loadRelation(relation: Relation, page: number) {
    const mine = ++token
    const engineAdapter = adapter()

    set({ loadingData: true })
    try {
      // Columns first, alone: counting rows through a filter needs them, and
      // a `where` built without them would quietly drop every condition and
      // report the whole table.
      const columns = await engineAdapter.listColumns(runner(), relation)
      if (mine !== token) return

      const [
        indexes,
        foreignKeys,
        checkConstraints,
        triggers,
        partitions,
        rowCount,
      ] = await Promise.all([
        engineAdapter.listIndexes(runner(), relation),
        engineAdapter.listForeignKeys(runner(), relation),
        engineAdapter.listCheckConstraints(runner(), relation),
        engineAdapter.listTriggers(runner(), relation),
        engineAdapter.listPartitions(runner(), relation),
        engineAdapter.countRows(runner(), relation, columns, get().filters),
      ])
      if (mine !== token) return

      const lastPage = Math.max(0, Math.ceil(rowCount / PAGE_SIZE) - 1)
      const clamped = Math.min(page, lastPage)

      const data = await engineAdapter.readPage(
        runner(),
        relation,
        columns,
        clamped * PAGE_SIZE,
        get().sort,
        get().filters
      )
      if (mine !== token) return

      set({
        columns,
        indexes,
        foreignKeys,
        checkConstraints,
        triggers,
        partitions,
        rowCount,
        data,
        page: clamped,
        loadingData: false,
        fkLabels: {},
        error: null,
      })

      // Labels are a progressive enhancement, not part of the page's own
      // data — fetched after the grid can already render, and dropped
      // silently if a newer load has started since.
      void loadFkLabels(engineAdapter, runner(), foreignKeys, data).then(
        (fkLabels) => {
          if (mine === token) set({ fkLabels })
        }
      )
    } catch (error) {
      if (mine !== token) return
      set({ loadingData: false, error: message(error) })
    }
  }

  /** Re-reads the currently selected relation's current (possibly now-stale) page. */
  async function reloadPage() {
    const { selected, page } = get()
    if (selected) await loadRelation(selected, page)
  }

  /** Merges `partial` into one query tab, leaving every other tab untouched. */
  function patchQuery(id: string, partial: Partial<QueryTab>) {
    set((state) => ({
      openTabs: state.openTabs.map((item) =>
        item.kind === "query" && item.query.id === id
          ? { kind: "query" as const, query: { ...item.query, ...partial } }
          : item
      ),
    }))
  }

  type ResultEditOutcome = {
    edit: QueryResultEdit | null
    reason: string | null
  }

  /**
   * Whether a query's result can be edited like a browsed table's page, and
   * what it takes to do that — see `QueryResultEdit`. Always returns a
   * `reason` alongside a null `edit`, so a script, a join, or a missing
   * primary key reads as "read-only, and here's why" in the UI instead of a
   * silent absence of the Row/Fields toolbar.
   *
   * Deliberately conservative: an aliased column, a join across tables, a
   * relation this database's tree doesn't already know about, or a table
   * whose primary key isn't fully present in the result all fall back to
   * read-only, the same as they would with no editing metadata at all.
   */
  async function buildResultEdit(
    result: SqlResult
  ): Promise<ResultEditOutcome> {
    if (result.fields.length === 0) {
      return { edit: null, reason: "No columns." }
    }

    const sources = result.fields.map((field) => field.source)
    if (sources.some((source) => !source)) {
      return {
        edit: null,
        reason:
          "Includes a computed column, or the engine didn't say what table it's from.",
      }
    }
    const first = sources[0]!
    const sameTable = sources.every(
      (source) =>
        source!.schema === first.schema && source!.table === first.table
    )
    if (!sameTable) return { edit: null, reason: "Spans more than one table." }
    // The grid correlates a result's columns to the introspected ones by
    // name — an aliased column would silently pair with the wrong one.
    if (
      !sources.every(
        (source, index) => source!.column === result.fields[index]!.name
      )
    ) {
      return { edit: null, reason: "A column is renamed with an alias." }
    }

    const relation = get().relations.find(
      (candidate) =>
        candidate.schema === first.schema && candidate.name === first.table
    )
    if (!relation) {
      return {
        edit: null,
        reason: `"${first.schema}.${first.table}" isn't a table this panel knows about.`,
      }
    }
    // A view's rows aren't written back through the table this app knows —
    // same reasoning `isView`/`canEdit` in the Data tab already follow.
    if (relation.kind === "view" || relation.kind === "matview") {
      return { edit: null, reason: "A view can't be edited here." }
    }

    const engineAdapter = adapter()
    const [columns, foreignKeys] = await Promise.all([
      engineAdapter.listColumns(runner(), relation),
      engineAdapter.listForeignKeys(runner(), relation),
    ])

    const primaryKeyColumns = columns.filter((column) => column.primaryKey)
    if (primaryKeyColumns.length === 0) {
      return { edit: null, reason: "This table has no primary key." }
    }
    const fieldNames = new Set(result.fields.map((field) => field.name))
    if (!primaryKeyColumns.every((column) => fieldNames.has(column.name))) {
      return {
        edit: null,
        reason: "The primary key isn't fully included in the result.",
      }
    }

    const fkLabels = await loadFkLabels(
      engineAdapter,
      runner(),
      foreignKeys,
      result
    )
    return { edit: { relation, columns, foreignKeys, fkLabels }, reason: null }
  }

  /** Where a new table lands without the user naming one. */
  function defaultSchemaFor(engine: DbEngine, databaseName: string): string {
    return engine === "postgres" ? "public" : databaseName
  }

  // Follows the selected database. Switching means switching engines and
  // connections, so everything read from the old one is dropped rather than
  // left on screen belonging to a database that is no longer open.
  useDatabases.subscribe((state) => {
    const database =
      state.databases.find((candidate) => candidate.id === state.selectedId) ??
      null
    if ((database?.id ?? null) === get().databaseId) return

    token += 1
    set({
      ...blank(),
      databaseId: database?.id ?? null,
      engine: database?.engine ?? null,
      defaultSchema: database
        ? defaultSchemaFor(database.engine, database.database)
        : "public",
    })
  })

  return {
    databaseId: null,
    engine: null,
    defaultSchema: "public",
    version: null,

    relations: [],
    loadingRelations: false,
    schemaReads: 0,
    completions: {},
    error: null,

    selected: null,
    openTabs: [],
    activeQueryTabId: null,
    tab: "data",
    columns: [],
    indexes: [],
    foreignKeys: [],
    checkConstraints: [],
    triggers: [],
    partitions: [],
    rowCount: null,
    page: 0,
    sort: null,
    filters: null,
    columnPrefs: {},
    data: null,
    loadingData: false,
    fkLabels: {},
    queryColumnPrefs: {},

    /**
     * Reads the open database's schema.
     *
     * Never called on mount: a database is only connected to because something
     * asked for it — a branch of the tree being opened, or an action that runs
     * against it — so the panel can be opened, and a project with a database
     * in it loaded, without dialling anything.
     */
    async refresh() {
      if (!get().databaseId) return
      const engineAdapter = adapter()

      set({ loadingRelations: true })
      try {
        const [relations, completions, version] = await Promise.all([
          engineAdapter.listRelations(runner()),
          engineAdapter.listCompletions(runner()).catch(() => ({})),
          engineAdapter.serverVersion(runner()).catch(() => null),
        ])
        set({
          relations,
          completions,
          version,
          loadingRelations: false,
          schemaReads: get().schemaReads + 1,
          error: null,
          // A table dropped here, or from a query tab, takes its tab with it.
          // Query tabs are untouched — they don't name a relation the schema
          // reload could have invalidated.
          openTabs: get().openTabs.filter(
            (item) =>
              item.kind === "query" ||
              relations.some((relation) =>
                sameRelation(relation, item.relation)
              )
          ),
        })

        // A query tab on screen isn't affected by a relation vanishing —
        // nothing below concerns it.
        if (get().activeQueryTabId !== null) return

        // A dropped table must not stay selected; a surviving one is reloaded
        // because its rows or columns may have changed.
        const { selected, page } = get()
        if (!selected) return

        const alive = relations.some(
          (relation) =>
            relation.schema === selected.schema &&
            relation.name === selected.name
        )
        if (alive) {
          await loadRelation(selected, page)
        } else {
          // The open table is gone (dropped here, or from a query tab). Its
          // tab went with it just above, so fall through to whichever tab is
          // left rather than to the empty state.
          const next = get().openTabs[0]
          if (next?.kind === "relation") get().select(next.relation)
          else if (next?.kind === "query") get().selectQueryTab(next.query.id)
          else set(closedSelection())
        }
      } catch (error) {
        set({ loadingRelations: false, error: message(error) })
      }
    },

    async createTable(draft) {
      try {
        await runner().exec(adapter().createTableSql(draft))
      } catch (error) {
        // Handed back rather than stored: the dialog stays open on a name
        // clash or a bad type so the draft can be fixed instead of retyped.
        return message(error)
      }

      await get().refresh()

      const created = get().relations.find(
        (relation) =>
          relation.schema === draft.schema &&
          relation.name === draft.name.trim()
      )
      if (created) get().select(created)

      return null
    },

    select(relation) {
      // Before the early return below: clicking the table that is already
      // selected still means "show me that table", which matters now that the
      // pane may be showing another panel entirely.
      useStudio.getState().showPane("database")

      const { selected, activeQueryTabId, openTabs } = get()
      if (
        activeQueryTabId === null &&
        selected &&
        selected.schema === relation.schema &&
        selected.name === relation.name
      ) {
        return
      }
      set({
        // Opening a table it already has a tab for reuses that tab rather
        // than stacking a second one, the way an editor does.
        openTabs: openTabs.some(
          (item) =>
            item.kind === "relation" && sameRelation(item.relation, relation)
        )
          ? openTabs
          : [...openTabs, { kind: "relation" as const, relation }],
        selected: relation,
        activeQueryTabId: null,
        page: 0,
        // Both name columns of the table being left behind.
        sort: null,
        filters: null,
        tab: "data",
        columns: [],
        indexes: [],
        foreignKeys: [],
        checkConstraints: [],
        triggers: [],
        partitions: [],
        rowCount: null,
        data: null,
      })
      void loadRelation(relation, 0)
    },

    closeTab(id) {
      const { openTabs, selected, activeQueryTabId } = get()
      const index = openTabs.findIndex((item) => tabId(item) === id)
      if (index === -1) return

      const remaining = openTabs.filter((_, position) => position !== index)
      set({ openTabs: remaining })

      const activeId =
        activeQueryTabId ?? (selected ? relationKey(selected) : null)
      if (activeId !== id) return

      const next = remaining[index] ?? remaining[index - 1]
      if (!next) {
        set({ ...closedSelection(), activeQueryTabId: null })
        return
      }
      if (next.kind === "relation") get().select(next.relation)
      else get().selectQueryTab(next.query.id)
    },

    closeOtherTabs(id) {
      const keep = get().openTabs.find((item) => tabId(item) === id)
      if (!keep) return
      set({ openTabs: [keep] })
      if (keep.kind === "relation") get().select(keep.relation)
      else get().selectQueryTab(keep.query.id)
    },

    closeAllTabs() {
      set({ openTabs: [], activeQueryTabId: null, ...closedSelection() })
    },

    reorderTabs(ids) {
      const { openTabs } = get()
      const byId = new Map(openTabs.map((item) => [tabId(item), item]))
      const reordered = ids
        .map((id) => byId.get(id))
        .filter((item): item is OpenTab => item !== undefined)
      if (reordered.length !== openTabs.length) return
      set({ openTabs: reordered })
    },

    setTab(tab) {
      set({ tab })
    },

    setPage(page) {
      const { selected } = get()
      if (!selected || page < 0) return
      set({ page })
      void loadRelation(selected, page)
    },

    setSort(sort) {
      const { selected } = get()
      // Back to the first page: the row that was on screen is somewhere else
      // entirely under a new order.
      set({ sort, page: 0 })
      if (selected) void loadRelation(selected, 0)
    },

    setFilters(filters) {
      const { selected } = get()
      // Back to the first page: page 12 of a narrower table is usually not a
      // page at all.
      set({ filters, page: 0 })
      if (selected) void loadRelation(selected, 0)
    },

    setColumnPref(column, pref) {
      const { selected } = get()
      if (!selected) return
      const key = relationKey(selected)
      set((state) => ({
        columnPrefs: {
          ...state.columnPrefs,
          [key]: {
            ...state.columnPrefs[key],
            [column]: { ...state.columnPrefs[key]?.[column], ...pref },
          },
        },
      }))
    },

    resetColumnPrefs() {
      const { selected } = get()
      if (!selected) return
      const key = relationKey(selected)
      set((state) => {
        const next = { ...state.columnPrefs }
        delete next[key]
        return { columnPrefs: next }
      })
    },

    setQueryColumnPref(tabId, column, pref) {
      set((state) => ({
        queryColumnPrefs: {
          ...state.queryColumnPrefs,
          [tabId]: {
            ...state.queryColumnPrefs[tabId],
            [column]: { ...state.queryColumnPrefs[tabId]?.[column], ...pref },
          },
        },
      }))
    },

    resetQueryColumnPrefs(tabId) {
      set((state) => {
        const next = { ...state.queryColumnPrefs }
        delete next[tabId]
        return { queryColumnPrefs: next }
      })
    },

    reloadPage,

    async updateCell(primaryKey, column, value) {
      const { selected } = get()
      if (!selected) return "No table is selected."

      try {
        await adapter().updateCell(
          runner(),
          selected,
          primaryKey,
          column,
          value
        )
      } catch (error) {
        return message(error)
      }
      await reloadPage()
      return null
    },

    async insertRow(values) {
      const { selected } = get()
      if (!selected) return "No table is selected."

      try {
        await adapter().insertRow(runner(), selected, values)
      } catch (error) {
        return message(error)
      }
      await reloadPage()
      return null
    },

    async deleteRow(primaryKey) {
      const { selected } = get()
      if (!selected) return "No table is selected."

      try {
        await adapter().deleteRow(runner(), selected, primaryKey)
      } catch (error) {
        return message(error)
      }
      await reloadPage()
      return null
    },

    async searchForeignKeyRows(fk, search) {
      const engineAdapter = adapter()
      const referenced: Relation = {
        schema: fk.referencedSchema,
        name: fk.referencedTable,
        kind: "table",
      }
      const referencedColumns = await engineAdapter.listColumns(
        runner(),
        referenced
      )
      const keyColumns = referencedColumns.filter((column) =>
        fk.referencedColumns.includes(column.name)
      )
      if (keyColumns.length === 0) return []
      const labelColumn = pickLabelColumn(referencedColumns, keyColumns)

      return engineAdapter.listLabelRows(
        runner(),
        referenced,
        labelColumn,
        keyColumns,
        50,
        search ? { search } : undefined
      )
    },

    async dropTable() {
      const { selected } = get()
      if (!selected) return "No table is selected."

      try {
        await runner().exec(adapter().dropTableSql(selected))
      } catch (error) {
        return message(error)
      }
      // The table is gone: `refresh`'s "is it still alive" check clears the
      // selection on its own, the same as any other relation that vanished.
      await get().refresh()
      return null
    },

    async truncateTable() {
      const { selected } = get()
      if (!selected) return "No table is selected."

      try {
        await runner().exec(adapter().truncateTableSql(selected))
      } catch (error) {
        return message(error)
      }
      await get().refresh()
      return null
    },

    async renameTable(name) {
      const { selected } = get()
      if (!selected) return "No table is selected."

      try {
        await runner().exec(adapter().renameTableSql(selected, name))
      } catch (error) {
        return message(error)
      }

      // The relation now has a different name, so `refresh`'s generic "is this
      // still in the list" checks would see the old name vanish and both clear
      // the selection and close its tab — exactly the wrong call for a rename.
      // Moving both to the new name first makes it a survivor instead, which
      // also keeps the tab where it was in the strip.
      const renamed = { ...selected, name: name.trim() }
      set((state) => ({
        selected: renamed,
        openTabs: state.openTabs.map((item) =>
          item.kind === "relation" && sameRelation(item.relation, selected)
            ? { kind: "relation" as const, relation: renamed }
            : item
        ),
      }))
      await get().refresh()
      return null
    },

    async addColumn(column) {
      const { selected } = get()
      if (!selected) return "No table is selected."

      try {
        await runner().exec(adapter().addColumnSql(selected, column))
      } catch (error) {
        return message(error)
      }
      await get().refresh()
      return null
    },

    async dropColumn(columnName) {
      const { selected } = get()
      if (!selected) return "No table is selected."

      try {
        await runner().exec(adapter().dropColumnSql(selected, columnName))
      } catch (error) {
        return message(error)
      }
      await get().refresh()
      return null
    },

    async renameColumn(columnName, newName) {
      const { selected, sort } = get()
      if (!selected) return "No table is selected."
      if (!newName.trim()) return "A column needs a name."

      try {
        await runner().exec(
          adapter().renameColumnSql(selected, columnName, newName)
        )
      } catch (error) {
        return message(error)
      }
      // Both the order and the display preferences are keyed by column name,
      // which the rename has just invalidated — carry them across rather than
      // leaving them pointing at a name the table no longer has.
      if (sort?.column === columnName) {
        set({ sort: { ...sort, column: newName.trim() } })
      }
      const key = relationKey(selected)
      set((state) => {
        const columns = state.columnPrefs[key]
        if (!columns?.[columnName]) return {}
        const next = { ...columns, [newName.trim()]: columns[columnName]! }
        delete next[columnName]
        return { columnPrefs: { ...state.columnPrefs, [key]: next } }
      })
      await get().refresh()
      return null
    },

    openQueryTab(sql) {
      useStudio.getState().showPane("database")
      const id = `q${++queryCounter}`
      const query: QueryTab = {
        id,
        title: `Query ${queryCounter}`,
        sql:
          sql ??
          (get().engine ? adapter().defaultSql : postgresAdapter.defaultSql),
        results: null,
        resultEdit: null,
        readOnlyReason: null,
        inserting: false,
        ranSql: null,
        rowLimit: null,
        sqlError: null,
        elapsedMs: null,
        running: false,
      }
      set((state) => ({
        openTabs: [...state.openTabs, { kind: "query" as const, query }],
        activeQueryTabId: id,
      }))
    },

    selectQueryTab(id) {
      useStudio.getState().showPane("database")
      set({ activeQueryTabId: id })
    },

    setQuerySql(id, sql) {
      set((state) => ({
        openTabs: state.openTabs.map((item) =>
          item.kind === "query" && item.query.id === id
            ? { kind: "query" as const, query: { ...item.query, sql } }
            : item
        ),
      }))
    },

    async runQuery(id, options) {
      const silent = options?.silent ?? false
      const entry = get().openTabs.find(
        (item) => item.kind === "query" && item.query.id === id
      )
      if (!entry || entry.kind !== "query") return
      // A silent rerun refreshes the grid on screen, so it repeats what
      // produced it verbatim — the selection rather than the whole editor,
      // and the same cap — instead of deriving either again from an editor
      // the user may have kept typing in.
      const replay = silent ? entry.query.ranSql : null
      const requested = (options?.sql ?? entry.query.sql).trim()
      const capped =
        replay || options?.unlimited
          ? null
          : withRowLimit(requested, QUERY_ROW_LIMIT)
      const sql = replay ?? capped ?? requested
      if (!sql) return

      if (silent) {
        if (silentlyRunning.has(id)) return
        silentlyRunning.add(id)
      } else {
        if (entry.query.running) return
        patchQuery(id, { running: true })
      }
      // The previous run's grid stays on screen (just as a browsed table's
      // page does while its next one loads) rather than flashing to the
      // empty "no result" state — the difference that matters most for
      // `updateQueryCell`/`insertQueryRow`/`deleteQueryRow`, which rerun the
      // very same query to pick up the row they just changed.
      patchQuery(id, { sqlError: null })
      const started = performance.now()

      try {
        const results = await runner().exec(sql, undefined, {
          resolveSources: true,
        })
        // Only a lone statement's result ever gets edit affordances — a
        // script's later statements could have anything to do with its
        // earlier ones, and re-running the whole thing just to refresh one
        // grid would repeat side effects that already happened.
        const outcome =
          results.length === 1
            ? await buildResultEdit(results[0]!)
            : { edit: null, reason: null }
        patchQuery(id, {
          results,
          resultEdit: outcome.edit,
          readOnlyReason: outcome.reason,
          inserting: false,
          ranSql: sql,
          rowLimit: replay
            ? entry.query.rowLimit
            : capped
              ? QUERY_ROW_LIMIT
              : null,
          elapsedMs: Math.round(performance.now() - started),
          running: false,
        })
      } catch (error) {
        patchQuery(id, {
          sqlError: message(error),
          elapsedMs: Math.round(performance.now() - started),
          running: false,
        })
        return
      } finally {
        if (silent) silentlyRunning.delete(id)
      }

      // Only worth the tree (and the open table, and completions) a refresh
      // when the statement could have actually changed the schema — a plain
      // SELECT, or a DML statement, leaves all of that exactly as it was.
      if (mayChangeSchema(sql)) await get().refresh()
    },

    async updateQueryCell(tabId, primaryKey, column, value) {
      const entry = get().openTabs.find(
        (item) => item.kind === "query" && item.query.id === tabId
      )
      const edit = entry?.kind === "query" ? entry.query.resultEdit : null
      if (!edit) return "No editable result."

      try {
        await adapter().updateCell(
          runner(),
          edit.relation,
          primaryKey,
          column,
          value
        )
      } catch (error) {
        return message(error)
      }
      await get().runQuery(tabId, { silent: true })
      return null
    },

    async insertQueryRow(tabId, values) {
      const entry = get().openTabs.find(
        (item) => item.kind === "query" && item.query.id === tabId
      )
      const edit = entry?.kind === "query" ? entry.query.resultEdit : null
      if (!edit) return "No editable result."

      try {
        await adapter().insertRow(runner(), edit.relation, values)
      } catch (error) {
        return message(error)
      }
      await get().runQuery(tabId, { silent: true })
      return null
    },

    async deleteQueryRow(tabId, primaryKey) {
      const entry = get().openTabs.find(
        (item) => item.kind === "query" && item.query.id === tabId
      )
      const edit = entry?.kind === "query" ? entry.query.resultEdit : null
      if (!edit) return "No editable result."

      try {
        await adapter().deleteRow(runner(), edit.relation, primaryKey)
      } catch (error) {
        return message(error)
      }
      await get().runQuery(tabId, { silent: true })
      return null
    },

    setQueryInserting(tabId, inserting) {
      patchQuery(tabId, { inserting })
    },
  }
})

function sameRelation(a: Relation, b: Relation): boolean {
  return a.schema === b.schema && a.name === b.name
}

/** A tab's stable identity in the strip — a query's own id, or the relation
 * it stands for. */
function tabId(tab: OpenTab): string {
  return tab.kind === "relation" ? relationKey(tab.relation) : tab.query.id
}

/** Everything that only makes sense while a table is open. */
function closedSelection() {
  return {
    selected: null,
    columns: [],
    indexes: [],
    foreignKeys: [],
    checkConstraints: [],
    triggers: [],
    partitions: [],
    rowCount: null,
    data: null,
    sort: null,
  }
}

/** The key a relation's column preferences are stored under. */
function relationKey(relation: Relation): string {
  return `${relation.schema}.${relation.name}`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
