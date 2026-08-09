import { useMemo, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Filter as FilterIcon,
  KeyRound,
  Plus,
  Play,
  Table2,
  Trash2,
} from "lucide-react"

import { downloadCsv } from "@/lib/db/csv"
import type { ColumnPref } from "@/lib/db/display"
import { containsDestructiveSql } from "@/lib/db/danger"
import { getAdapter, PAGE_SIZE, type Relation } from "@/lib/db/engines"
import { useExplorer, type QueryTab, type Tab } from "@/lib/db/explorer-store"
import type { SqlResult } from "@/lib/db/runner"
import { IconButton } from "../icon-button"
import {
  AddColumnPopover,
  primaryKeyFromRow,
  ResultGrid,
  type CellEdit,
  type ColumnControl,
} from "./result-grid"
import { FilterBar } from "./filter-bar"
import { RenameDialog } from "./rename-dialog"
import { SqlEditor } from "./sql-editor"

/**
 * "Partitions" only earns a place in the strip for a `partitioned` relation —
 * every other kind would just show an always-empty tab, worse than not
 * offering it at all.
 */
function tabsFor(selected: Relation | null): { id: Tab; label: string }[] {
  const tabs: { id: Tab; label: string }[] = [
    { id: "data", label: "Data" },
    { id: "columns", label: "Columns" },
    { id: "foreignKeys", label: "Foreign Keys" },
    { id: "indexes", label: "Indexes" },
    { id: "checkConstraints", label: "Check Constraints" },
    { id: "triggers", label: "Triggers" },
  ]
  if (selected?.kind === "partitioned") {
    tabs.push({ id: "partitions", label: "Partitions" })
  }
  return tabs
}

export function DatabaseWorkspace() {
  const tab = useExplorer((state) => state.tab)
  const setTab = useExplorer((state) => state.setTab)
  const selected = useExplorer((state) => state.selected)
  const activeQueryTabId = useExplorer((state) => state.activeQueryTabId)
  const tabs = tabsFor(selected)

  return (
    <div className="flex h-full min-w-0 flex-col">
      {!activeQueryTabId && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as Tab)}
            className="min-w-0"
          >
            <TabsList variant="line" className="h-7">
              {tabs.map((item) => (
                <TabsTrigger
                  key={item.id}
                  value={item.id}
                  disabled={!selected}
                  className="px-2 text-xs"
                >
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {activeQueryTabId ? (
          // Keyed by tab: the console's editor takes its document once, on
          // mount, so switching query tabs has to give it a fresh one rather
          // than leave the previous tab's text (and selection) on screen.
          <SqlConsole key={activeQueryTabId} tabId={activeQueryTabId} />
        ) : !selected ? (
          <Empty className="size-full border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Table2 />
              </EmptyMedia>
              <EmptyTitle>No table selected</EmptyTitle>
              <EmptyDescription>
                Pick a table on the left to browse its rows, or open a query tab
                to run anything.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : tab === "columns" ? (
          <ColumnsPanel />
        ) : tab === "foreignKeys" ? (
          <ForeignKeysPanel />
        ) : tab === "indexes" ? (
          <IndexesPanel />
        ) : tab === "checkConstraints" ? (
          <CheckConstraintsPanel />
        ) : tab === "triggers" ? (
          <TriggersPanel />
        ) : tab === "partitions" ? (
          <PartitionsPanel />
        ) : (
          <DataBrowser />
        )}
      </div>
    </div>
  )
}

function DataBrowser() {
  const data = useExplorer((state) => state.data)
  const rowCount = useExplorer((state) => state.rowCount)
  const page = useExplorer((state) => state.page)
  const setPage = useExplorer((state) => state.setPage)
  const loading = useExplorer((state) => state.loadingData)
  const columns = useExplorer((state) => state.columns)
  const foreignKeys = useExplorer((state) => state.foreignKeys)
  const fkLabels = useExplorer((state) => state.fkLabels)
  const selected = useExplorer((state) => state.selected)
  const engine = useExplorer((state) => state.engine)
  const updateCellAction = useExplorer((state) => state.updateCell)
  const insertRowAction = useExplorer((state) => state.insertRow)
  const deleteRowAction = useExplorer((state) => state.deleteRow)
  const searchForeignKeyRowsAction = useExplorer(
    (state) => state.searchForeignKeyRows
  )
  const sort = useExplorer((state) => state.sort)
  const setSort = useExplorer((state) => state.setSort)
  const filters = useExplorer((state) => state.filters)
  const setFilters = useExplorer((state) => state.setFilters)
  const columnPrefs = useExplorer((state) => state.columnPrefs)
  const setColumnPref = useExplorer((state) => state.setColumnPref)
  const resetColumnPrefs = useExplorer((state) => state.resetColumnPrefs)
  const renameColumn = useExplorer((state) => state.renameColumn)
  const dropColumn = useExplorer((state) => state.dropColumn)
  const addColumnAction = useExplorer((state) => state.addColumn)

  const [inserting, setInserting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<unknown[] | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [renamingColumn, setRenamingColumn] = useState<string | null>(null)
  const [pendingDropColumn, setPendingDropColumn] = useState<string | null>(
    null
  )
  const [dropColumnError, setDropColumnError] = useState<string | null>(null)
  const [dropColumnBusy, setDropColumnBusy] = useState(false)

  const prefs = selected
    ? (columnPrefs[`${selected.schema}.${selected.name}`] ?? EMPTY_PREFS)
    : EMPTY_PREFS
  const hidden = columns.filter((column) => prefs[column.name]?.hidden)

  const from = page * PAGE_SIZE
  const shown = data?.rows.length ?? 0
  const total = rowCount ?? 0
  const hasMore = from + shown < total

  const isView = selected?.kind === "view" || selected?.kind === "matview"
  const hasPrimaryKey = columns.some((column) => column.primaryKey)
  const canEdit = !isView && hasPrimaryKey

  // Memoized for the same reason the SQL console's are: the grid only skips a
  // render when the props it is handed are the same objects as last time.
  const edit: CellEdit | undefined = useMemo(
    () =>
      canEdit
        ? {
            columns,
            foreignKeys,
            engine: engine!,
            isEditableType: getAdapter(engine!).isEditableType,
            fkLabels,
            searchForeignKeyRows: searchForeignKeyRowsAction,
            onUpdateCell: (primaryKey, column, value) =>
              updateCellAction(primaryKey, column, value),
            onRequestDelete: (row) => {
              setPendingDelete(row)
              setDeleteError(null)
            },
            onRequestInsert: () => setInserting(true),
            inserting,
            onCancelInsert: () => setInserting(false),
            onInsertRow: async (values) => {
              const failure = await insertRowAction(values)
              if (!failure) setInserting(false)
              return failure
            },
            onAddColumn: {
              columnTypes: getAdapter(engine!).columnTypes,
              onSubmit: addColumnAction,
            },
          }
        : undefined,
    [
      canEdit,
      columns,
      foreignKeys,
      engine,
      fkLabels,
      inserting,
      searchForeignKeyRowsAction,
      updateCellAction,
      insertRowAction,
      addColumnAction,
    ]
  )

  // A view's columns can be hidden and formatted like any other, but not
  // reordered by the engine's own ordering, renamed or dropped.
  const control: ColumnControl = useMemo(
    () => ({
      prefs,
      onPref: setColumnPref,
      sort,
      onSort: setSort,
      onRename: isView ? undefined : (column) => setRenamingColumn(column),
      onDrop: isView
        ? undefined
        : (column) => {
            setPendingDropColumn(column)
            setDropColumnError(null)
          },
    }),
    [prefs, setColumnPref, sort, setSort, isView]
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {total === 0
            ? "0 rows"
            : `${from + 1}–${from + shown} of ${total} row${total === 1 ? "" : "s"}`}
        </span>
        {loading && (
          <span className="animate-pulse text-[0.65rem] text-muted-foreground">
            loading…
          </span>
        )}
        {!isView && !hasPrimaryKey && (
          <span className="text-[0.65rem] text-muted-foreground">
            No primary key — edit from the SQL tab instead.
          </span>
        )}

        {canEdit && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => setInserting((current) => !current)}
          >
            <Plus data-icon="inline-start" />
            Row
          </Button>
        )}

        <FilterBar columns={columns} filters={filters} onChange={setFilters} />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="xs" variant="ghost" disabled={columns.length === 0}>
                <Columns3 data-icon="inline-start" />
                Fields
                {hidden.length > 0 && (
                  <span className="ml-1 rounded-full bg-muted px-1.5 text-[0.65rem] tabular-nums">
                    {columns.length - hidden.length}/{columns.length}
                  </span>
                )}
              </Button>
            }
          />
          <DropdownMenuContent
            align="start"
            className="max-h-80 w-56 overflow-auto"
          >
            {columns.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.name}
                checked={!prefs[column.name]?.hidden}
                onCheckedChange={(checked) =>
                  setColumnPref(column.name, { hidden: !checked })
                }
                className="font-mono text-xs"
              >
                {column.name}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => resetColumnPrefs()}>
              Reset fields
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="xs"
          variant="ghost"
          disabled={!data || data.rows.length === 0}
          onClick={() =>
            data && downloadCsv(data, `${selected?.name ?? "data"}.csv`)
          }
        >
          <Download data-icon="inline-start" />
          Export
        </Button>

        <div className="ml-auto flex items-center gap-0.5">
          <span className="mr-1 text-[0.65rem] text-muted-foreground tabular-nums">
            {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          <IconButton
            label="Previous page"
            disabled={page === 0 || loading}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft />
          </IconButton>
          <IconButton
            label="Next page"
            disabled={!hasMore || loading}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {data ? (
          <ResultGrid result={data} edit={edit} control={control} />
        ) : (
          <Hint>Reading rows…</Hint>
        )}
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null)
            setDeleteError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this row?</AlertDialogTitle>
            <AlertDialogDescription>
              This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="font-mono text-xs whitespace-pre-wrap text-destructive">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteBusy}
              onClick={async () => {
                if (!pendingDelete || !data) return
                setDeleteBusy(true)
                const failure = await deleteRowAction(
                  primaryKeyFromRow(data.fields, columns, pendingDelete)
                )
                setDeleteBusy(false)
                if (failure) {
                  setDeleteError(failure)
                  return
                }
                setPendingDelete(null)
              }}
            >
              {deleteBusy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {renamingColumn && (
        <RenameDialog
          title="Rename column"
          label="Column name"
          currentName={renamingColumn}
          onRename={(name) => renameColumn(renamingColumn, name)}
          onClose={() => setRenamingColumn(null)}
        />
      )}

      <AlertDialog
        open={pendingDropColumn !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDropColumn(null)
            setDropColumnError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Drop column “{pendingDropColumn}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the column and every value in it. This can&apos;t be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dropColumnError && (
            <p className="font-mono text-xs whitespace-pre-wrap text-destructive">
              {dropColumnError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dropColumnBusy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={dropColumnBusy}
              onClick={async () => {
                if (!pendingDropColumn) return
                setDropColumnBusy(true)
                const failure = await dropColumn(pendingDropColumn)
                setDropColumnBusy(false)
                if (failure) {
                  setDropColumnError(failure)
                  return
                }
                setPendingDropColumn(null)
              }}
            >
              {dropColumnBusy ? "Dropping…" : "Drop column"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** No column preferences set for this table — a shared empty object, so the
 * grid isn't handed a new one on every render. */
const EMPTY_PREFS: Record<string, ColumnPref> = {}

function ColumnsPanel() {
  const columns = useExplorer((state) => state.columns)
  const engine = useExplorer((state) => state.engine)
  const addColumn = useExplorer((state) => state.addColumn)
  const dropColumn = useExplorer((state) => state.dropColumn)

  const [pendingDrop, setPendingDrop] = useState<{
    column: string
    primaryKey: boolean
  } | null>(null)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [pendingBusy, setPendingBusy] = useState(false)

  async function confirmDrop() {
    if (!pendingDrop) return
    setPendingBusy(true)
    setPendingError(null)
    const failure = await dropColumn(pendingDrop.column)
    setPendingBusy(false)
    if (failure) {
      setPendingError(failure)
      return
    }
    setPendingDrop(null)
  }

  return (
    <div className="h-full overflow-auto">
      <div className="flex h-9 items-center justify-between gap-2 border-b bg-card px-3">
        <h3 className="text-[0.7rem] font-medium tracking-wider text-muted-foreground uppercase">
          Columns
        </h3>
        <AddColumnPopover
          columnTypes={getAdapter(engine!).columnTypes}
          onSubmit={addColumn}
          trigger={
            <Button size="xs" variant="ghost">
              <Plus data-icon="inline-start" />
              Column
            </Button>
          }
        />
      </div>

      <table className="w-full border-separate border-spacing-0 text-left text-xs">
        <thead>
          <tr>
            <th
              scope="col"
              className="border-b bg-card px-3 py-1.5 font-medium whitespace-nowrap text-muted-foreground"
            >
              #
            </th>
            {["Column", "Type", "Nullable", "Default"].map((label) => (
              <th
                key={label}
                scope="col"
                className="border-b bg-card px-3 py-1.5 font-medium whitespace-nowrap text-muted-foreground"
              >
                {label}
              </th>
            ))}
            <th className="border-b bg-card" />
          </tr>
        </thead>
        <tbody>
          {columns.map((column, index) => (
            <tr key={column.name} className="hover:bg-muted/40">
              <td className="border-b px-3 py-1.5 text-muted-foreground tabular-nums">
                {index + 1}
              </td>
              <td className="border-b px-3 py-1.5 font-mono whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                  {column.primaryKey && (
                    <KeyRound
                      className="size-3 shrink-0 text-muted-foreground"
                      aria-label="Primary key"
                    />
                  )}
                  {column.name}
                </span>
              </td>
              <td className="border-b px-3 py-1.5 font-mono whitespace-nowrap text-muted-foreground">
                {column.type}
              </td>
              <td className="border-b px-3 py-1.5 text-muted-foreground">
                {column.nullable ? "yes" : "no"}
              </td>
              <td className="border-b px-3 py-1.5 font-mono text-muted-foreground">
                {column.default ?? "—"}
              </td>
              <td className="border-b px-2 py-1 text-center">
                <IconButton
                  label={`Drop column ${column.name}`}
                  onClick={() =>
                    setPendingDrop({
                      column: column.name,
                      primaryKey: column.primaryKey,
                    })
                  }
                  className="hover:text-destructive"
                >
                  <Trash2 />
                </IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <AlertDialog
        open={pendingDrop !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDrop(null)
            setPendingError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Drop column “{pendingDrop?.column}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDrop?.primaryKey
                ? "This column is part of the primary key — dropping it will make this table read-only in the Data tab. This can't be undone."
                : "This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingError && (
            <p className="font-mono text-xs whitespace-pre-wrap text-destructive">
              {pendingError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pendingBusy}
              onClick={() => void confirmDrop()}
            >
              {pendingBusy ? "Working…" : "Drop column"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ForeignKeysPanel() {
  const foreignKeys = useExplorer((state) => state.foreignKeys)

  return (
    <div className="h-full overflow-auto">
      <div className="flex h-9 items-center border-b bg-card px-3">
        <h3 className="text-[0.7rem] font-medium tracking-wider text-muted-foreground uppercase">
          Foreign keys
        </h3>
      </div>
      {foreignKeys.length === 0 ? (
        <Hint>No foreign keys.</Hint>
      ) : (
        <ul className="space-y-1 px-3 py-3">
          {foreignKeys.map((fk) => (
            <li key={fk.name} className="font-mono text-xs">
              <span>{fk.name}</span>
              <p className="text-muted-foreground">
                {fk.columns.join(", ")} → {fk.referencedSchema}.
                {fk.referencedTable}({fk.referencedColumns.join(", ")})
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function IndexesPanel() {
  const indexes = useExplorer((state) => state.indexes)

  // Flattened one row per column — a composite index repeats its name down
  // as many rows as it has columns, the same shape most DB clients show it.
  const rows = indexes.flatMap((index) =>
    index.columns.map((column) => ({ index, column }))
  )

  return (
    <div className="h-full overflow-auto">
      <div className="flex h-9 items-center border-b bg-card px-3">
        <h3 className="text-[0.7rem] font-medium tracking-wider text-muted-foreground uppercase">
          Indexes
        </h3>
      </div>
      {indexes.length === 0 ? (
        <Hint>No indexes.</Hint>
      ) : (
        <table className="w-full border-separate border-spacing-0 text-left text-xs">
          <thead>
            <tr>
              {["Index Name", "Column", "Index Type"].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="border-b bg-card px-3 py-1.5 font-medium whitespace-nowrap text-muted-foreground"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ index, column }, position) => (
              <tr
                key={`${index.name}-${column}-${position}`}
                className="hover:bg-muted/40"
              >
                <td className="border-b px-3 py-1.5 font-mono whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    {index.primary && (
                      <KeyRound
                        className="size-3 shrink-0 text-muted-foreground"
                        aria-label="Primary"
                      />
                    )}
                    {index.name}
                  </span>
                </td>
                <td className="border-b px-3 py-1.5 font-mono whitespace-nowrap text-muted-foreground">
                  {column}
                </td>
                <td className="border-b px-3 py-1.5 text-muted-foreground">
                  {index.method}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function CheckConstraintsPanel() {
  const checkConstraints = useExplorer((state) => state.checkConstraints)

  return (
    <div className="h-full overflow-auto">
      <div className="flex h-9 items-center border-b bg-card px-3">
        <h3 className="text-[0.7rem] font-medium tracking-wider text-muted-foreground uppercase">
          Check constraints
        </h3>
      </div>
      {checkConstraints.length === 0 ? (
        <Hint>No check constraints.</Hint>
      ) : (
        <table className="w-full border-separate border-spacing-0 text-left text-xs">
          <thead>
            <tr>
              {["Name", "Definition"].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="border-b bg-card px-3 py-1.5 font-medium whitespace-nowrap text-muted-foreground"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {checkConstraints.map((check) => (
              <tr key={check.name} className="hover:bg-muted/40">
                <td className="border-b px-3 py-1.5 font-mono whitespace-nowrap">
                  {check.name}
                </td>
                <td className="border-b px-3 py-1.5 font-mono whitespace-nowrap text-muted-foreground">
                  {check.definition}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function TriggersPanel() {
  const triggers = useExplorer((state) => state.triggers)

  return (
    <div className="h-full overflow-auto">
      <div className="flex h-9 items-center border-b bg-card px-3">
        <h3 className="text-[0.7rem] font-medium tracking-wider text-muted-foreground uppercase">
          Triggers
        </h3>
      </div>
      {triggers.length === 0 ? (
        <Hint>No triggers.</Hint>
      ) : (
        <table className="w-full border-separate border-spacing-0 text-left text-xs">
          <thead>
            <tr>
              {["Name", "Definition"].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="border-b bg-card px-3 py-1.5 font-medium whitespace-nowrap text-muted-foreground"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {triggers.map((trigger) => (
              <tr key={trigger.name} className="hover:bg-muted/40">
                <td className="border-b px-3 py-1.5 font-mono whitespace-nowrap">
                  {trigger.name}
                </td>
                <td className="border-b px-3 py-1.5 font-mono whitespace-nowrap text-muted-foreground">
                  {trigger.definition}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function PartitionsPanel() {
  const partitions = useExplorer((state) => state.partitions)

  return (
    <div className="h-full overflow-auto">
      <div className="flex h-9 items-center border-b bg-card px-3">
        <h3 className="text-[0.7rem] font-medium tracking-wider text-muted-foreground uppercase">
          Partitions
        </h3>
      </div>
      {partitions.length === 0 ? (
        <Hint>No partitions.</Hint>
      ) : (
        <table className="w-full border-separate border-spacing-0 text-left text-xs">
          <thead>
            <tr>
              {["Name", "Bound"].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="border-b bg-card px-3 py-1.5 font-medium whitespace-nowrap text-muted-foreground"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {partitions.map((partition) => (
              <tr key={partition.name} className="hover:bg-muted/40">
                <td className="border-b px-3 py-1.5 font-mono whitespace-nowrap">
                  {partition.name}
                </td>
                <td className="border-b px-3 py-1.5 font-mono whitespace-nowrap text-muted-foreground">
                  {partition.bound}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * Finds the tab, so the console itself can be written against a query that
 * exists — which is what lets its hooks (`useMemo` over the grid's props, in
 * particular) sit anywhere in the body rather than above an early return.
 *
 * Subscribing to this one tab rather than to `openTabs` also keeps a keystroke
 * in another tab's editor from rendering this one.
 */
function SqlConsole({ tabId }: { tabId: string }) {
  const entry = useExplorer((state) =>
    state.openTabs.find(
      (item) => item.kind === "query" && item.query.id === tabId
    )
  )
  // The tab can vanish out from under this component between closing it and
  // the workspace picking its replacement.
  if (!entry || entry.kind !== "query") return null
  return <QueryConsole tabId={tabId} query={entry.query} />
}

function QueryConsole({ tabId, query }: { tabId: string; query: QueryTab }) {
  const setQuerySql = useExplorer((state) => state.setQuerySql)
  const runQuery = useExplorer((state) => state.runQuery)
  const completions = useExplorer((state) => state.completions)
  const engine = useExplorer((state) => state.engine)
  const queryColumnPrefs = useExplorer((state) => state.queryColumnPrefs)
  const setQueryColumnPref = useExplorer((state) => state.setQueryColumnPref)
  const resetQueryColumnPrefs = useExplorer(
    (state) => state.resetQueryColumnPrefs
  )
  const updateQueryCell = useExplorer((state) => state.updateQueryCell)
  const insertQueryRow = useExplorer((state) => state.insertQueryRow)
  const deleteQueryRow = useExplorer((state) => state.deleteQueryRow)
  const setQueryInserting = useExplorer((state) => state.setQueryInserting)
  const searchForeignKeyRowsAction = useExplorer(
    (state) => state.searchForeignKeyRows
  )

  const [editorHeight, setEditorHeight] = useState(200)
  const [confirmRun, setConfirmRun] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<unknown[] | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [filterText, setFilterText] = useState("")
  // What is highlighted in the editor, "" when nothing is — running over a
  // selection is how a console lets one statement of a script be tried without
  // deleting the rest of it.
  const [selection, setSelection] = useState("")
  // A fresh run's rows have nothing to do with whatever was typed to narrow
  // the previous ones. Adjusted during the render that first sees the new
  // results, rather than in an effect that would flash the stale filter over
  // one frame of new data.
  const [shownResults, setShownResults] = useState(query.results)

  const results = query.results
  const resultEdit = query.resultEdit

  if (shownResults !== results) {
    setShownResults(results)
    setFilterText("")
  }

  const pendingSql = selection.trim() || query.sql
  const requestRun = () => {
    if (containsDestructiveSql(pendingSql)) setConfirmRun(true)
    else void runQuery(tabId, { sql: pendingSql })
  }

  // Fields/Export work off the result's own columns, whether or not it
  // turned out to be editable — hiding a column or downloading a CSV needs
  // nothing beyond what any query result already has.
  const singleResult = results?.length === 1 ? results[0]! : null

  // Only worth saying that rows were capped when the cap actually bit — a
  // result short of it is the whole answer whether or not a limit was added.
  const capReached =
    query.rowLimit !== null &&
    singleResult !== null &&
    singleResult.rows.length >= query.rowLimit
  const prefs = queryColumnPrefs[tabId] ?? EMPTY_PREFS
  const hidden =
    singleResult?.fields.filter((field) => prefs[field.name]?.hidden) ?? []

  // A client-side narrowing of the rows already in hand — not a new query —
  // so it works over a join or an aggregate exactly as well as it does over
  // a browsed table's own row.
  const needle = filterText.trim().toLowerCase()

  // The grid is memoized, so these three are what decide whether it re-renders
  // at all. Rebuilt inline they would be new objects on every keystroke in the
  // editor and every move of its cursor, which over a wide table is the whole
  // grid laid out again per character typed.
  const filteredResult = useMemo(
    () =>
      singleResult && needle
        ? {
            ...singleResult,
            rows: singleResult.rows.filter((row) =>
              row.some(
                (cell) =>
                  cell !== null &&
                  cell !== undefined &&
                  String(cell).toLowerCase().includes(needle)
              )
            ),
          }
        : singleResult,
    [singleResult, needle]
  )

  const edit: CellEdit | undefined = useMemo(
    () =>
      resultEdit
        ? {
            columns: resultEdit.columns,
            foreignKeys: resultEdit.foreignKeys,
            engine: engine!,
            isEditableType: getAdapter(engine!).isEditableType,
            fkLabels: resultEdit.fkLabels,
            searchForeignKeyRows: searchForeignKeyRowsAction,
            onUpdateCell: (primaryKey, column, value) =>
              updateQueryCell(tabId, primaryKey, column, value),
            onRequestDelete: (row) => {
              setPendingDelete(row)
              setDeleteError(null)
            },
            onRequestInsert: () => setQueryInserting(tabId, true),
            inserting: query.inserting,
            onCancelInsert: () => setQueryInserting(tabId, false),
            onInsertRow: async (values) => {
              const failure = await insertQueryRow(tabId, values)
              if (!failure) setQueryInserting(tabId, false)
              return failure
            },
          }
        : undefined,
    [
      resultEdit,
      engine,
      tabId,
      query.inserting,
      searchForeignKeyRowsAction,
      updateQueryCell,
      insertQueryRow,
      setQueryInserting,
    ]
  )

  const control: ColumnControl | undefined = useMemo(
    () =>
      singleResult
        ? {
            prefs,
            onPref: (column, pref) => setQueryColumnPref(tabId, column, pref),
          }
        : undefined,
    [singleResult, prefs, tabId, setQueryColumnPref]
  )

  return (
    <div className="flex h-full flex-col">
      <div style={{ height: `${editorHeight}px` }} className="shrink-0">
        <SqlEditor
          value={query.sql}
          onChange={(sql) => setQuerySql(tabId, sql)}
          onRun={requestRun}
          onSelectionChange={setSelection}
          completions={completions}
          engine={engine ?? "postgres"}
        />
      </div>

      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the editor"
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          const top = event.currentTarget.parentElement?.getBoundingClientRect()
          if (!top) return
          setEditorHeight(
            Math.min(top.height - 120, Math.max(80, event.clientY - top.top))
          )
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        className="h-1 shrink-0 cursor-row-resize touch-none transition-colors hover:bg-ring/50"
      />

      <div className="flex shrink-0 items-center gap-2 border-y px-2 py-1.5">
        <Button size="xs" onClick={requestRun} disabled={query.running}>
          <Play data-icon="inline-start" />
          {query.running
            ? "Running…"
            : selection.trim()
              ? "Run selection"
              : "Run"}
        </Button>
        <span className="text-[0.65rem] text-muted-foreground">⌘↵</span>

        {capReached && (
          <>
            <span
              className="text-[0.65rem] text-muted-foreground"
              title="Add your own LIMIT to the statement to control this."
            >
              First {query.rowLimit} rows
            </span>
            <Button
              size="xs"
              variant="ghost"
              disabled={query.running}
              onClick={() =>
                void runQuery(tabId, { sql: pendingSql, unlimited: true })
              }
            >
              Run without limit
            </Button>
          </>
        )}

        {query.readOnlyReason && (
          <span
            className="ml-auto truncate text-[0.65rem] text-muted-foreground"
            title={query.readOnlyReason}
          >
            Read-only: {query.readOnlyReason}
          </span>
        )}

        {query.elapsedMs !== null && !query.sqlError && (
          <span
            className={cn(
              "shrink-0 text-[0.65rem] text-muted-foreground tabular-nums",
              !query.readOnlyReason && "ml-auto"
            )}
          >
            {summarise(query.results)} in {query.elapsedMs}ms
          </span>
        )}
      </div>

      {singleResult && singleResult.fields.length > 0 && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
          <div className="relative">
            <FilterIcon className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              placeholder="Filter rows…"
              spellCheck={false}
              className="h-7 w-40 pl-6 text-xs md:text-xs"
            />
          </div>
          {needle && filteredResult && (
            <span className="text-[0.65rem] text-muted-foreground tabular-nums">
              {filteredResult.rows.length}/{singleResult.rows.length}
            </span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="xs" variant="ghost">
                  <Columns3 data-icon="inline-start" />
                  Fields
                  {hidden.length > 0 && (
                    <span className="ml-1 rounded-full bg-muted px-1.5 text-[0.65rem] tabular-nums">
                      {singleResult.fields.length - hidden.length}/
                      {singleResult.fields.length}
                    </span>
                  )}
                </Button>
              }
            />
            <DropdownMenuContent
              align="start"
              className="max-h-80 w-56 overflow-auto"
            >
              {singleResult.fields.map((field) => (
                <DropdownMenuCheckboxItem
                  key={field.name}
                  checked={!prefs[field.name]?.hidden}
                  onCheckedChange={(checked) =>
                    setQueryColumnPref(tabId, field.name, { hidden: !checked })
                  }
                  className="font-mono text-xs"
                >
                  {field.name}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => resetQueryColumnPrefs(tabId)}>
                Reset fields
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size="xs"
            variant="ghost"
            disabled={!filteredResult || filteredResult.rows.length === 0}
            onClick={() =>
              filteredResult &&
              downloadCsv(filteredResult, `${query.title.toLowerCase()}.csv`)
            }
          >
            <Download data-icon="inline-start" />
            Export
          </Button>

          {resultEdit && (
            <span className="ml-auto truncate font-mono text-[0.65rem] text-muted-foreground">
              Editing {resultEdit.relation.schema}.{resultEdit.relation.name}
            </span>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {query.sqlError ? (
          <pre className="px-3 py-2 font-mono text-xs whitespace-pre-wrap text-destructive">
            {query.sqlError}
          </pre>
        ) : results === null ? (
          <Hint>Run a statement to see its result.</Hint>
        ) : results.length === 0 ? (
          <Hint>Statement completed.</Hint>
        ) : filteredResult ? (
          <ResultGrid
            result={filteredResult}
            edit={edit}
            control={control}
            emptyLabel={needle ? "No rows match the filter." : "No rows."}
          />
        ) : (
          // A script runs several statements, and hiding all but the last would
          // quietly drop output.
          results.map((result, index) => (
            <section key={index} className="border-b last:border-b-0">
              {(results.length > 1 || result.fields.length > 0) && (
                <div className="flex items-center justify-between gap-2 px-3 pt-2">
                  {results.length > 1 ? (
                    <h3 className="text-[0.65rem] text-muted-foreground">
                      Statement {index + 1}
                    </h3>
                  ) : (
                    <span />
                  )}
                  {result.fields.length > 0 && result.rows.length > 0 && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        downloadCsv(result, `query-result-${index + 1}.csv`)
                      }
                    >
                      <Download data-icon="inline-start" />
                      Export
                    </Button>
                  )}
                </div>
              )}
              <ResultGrid result={result} />
            </section>
          ))
        )}
      </div>

      <AlertDialog open={confirmRun} onOpenChange={setConfirmRun}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run this statement?</AlertDialogTitle>
            <AlertDialogDescription>
              This looks like it includes DROP, DELETE, TRUNCATE, or ALTER — it
              can permanently remove data or change the schema. This can&apos;t
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                void runQuery(tabId, { sql: pendingSql })
                setConfirmRun(false)
              }}
            >
              Run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null)
            setDeleteError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this row?</AlertDialogTitle>
            <AlertDialogDescription>
              This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="font-mono text-xs whitespace-pre-wrap text-destructive">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteBusy}
              onClick={async () => {
                if (!pendingDelete || !resultEdit || !singleResult) return
                setDeleteBusy(true)
                const failure = await deleteQueryRow(
                  tabId,
                  primaryKeyFromRow(
                    singleResult.fields,
                    resultEdit.columns,
                    pendingDelete
                  )
                )
                setDeleteBusy(false)
                if (failure) {
                  setDeleteError(failure)
                  return
                }
                setPendingDelete(null)
              }}
            >
              {deleteBusy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Rows returned across every statement of the script that just ran. */
function summarise(results: SqlResult[] | null): string {
  const rows = (results ?? []).reduce(
    (total, result) => total + result.rows.length,
    0
  )
  return `${rows} row${rows === 1 ? "" : "s"}`
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>
}
