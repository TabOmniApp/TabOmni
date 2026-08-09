import { useState, type MouseEvent } from "react"
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Eraser,
  Eye,
  Layers,
  ListTree,
  Pencil,
  Plus,
  RefreshCw,
  Table2,
  Terminal,
  Trash2,
} from "lucide-react"

import type { DatabaseRecord } from "@/lib/db/databases"
import { useDatabases } from "@/lib/db/databases-store"
import { useExplorer } from "@/lib/db/explorer-store"
import { CLOSED, useDbTree } from "@/lib/db/tree-store"
import { getAdapter, type Relation, type RelationKind } from "@/lib/db/engines"
import { IconButton } from "../icon-button"
import { PanelHeader } from "../panel-header"
import { SideRow } from "../side-row"
import { EditConnectionDialog } from "./edit-connection-dialog"
import { NewDatabaseDialog } from "./new-database-dialog"
import { NewTableDialog } from "./new-table-dialog"
import { RenameDialog } from "./rename-dialog"

export const KIND_ICONS: Record<RelationKind, typeof Table2> = {
  table: Table2,
  partitioned: Layers,
  view: Eye,
  matview: Layers,
}

export const KIND_LABELS: Record<RelationKind, string> = {
  table: "table",
  partitioned: "partitioned table",
  view: "view",
  matview: "materialized view",
}

const ENGINE_LABEL = { postgres: "Postgres", mysql: "MySQL" } as const

/** What a right-click landed on. One menu serves the whole tree. */
type MenuTarget =
  | { kind: "root" }
  | { kind: "database"; database: DatabaseRecord }
  | { kind: "relation"; database: DatabaseRecord; relation: Relation }

/**
 * Every database the project has, each opening onto its own tables.
 *
 * A branch starts closed and only reads its tables — which is also the only
 * way to find out whether its server answers at all — when it is opened, so
 * loading a project with half a dozen connections in it dials none of them.
 * The workspace still browses one database at a time: opening a table moves it
 * to that table's database, which is why the tree marks whichever one that
 * currently is.
 */
export function DatabaseTree() {
  const databases = useDatabases((state) => state.databases)
  const projectId = useDatabases((state) => state.projectId)
  const openDatabaseId = useDatabases((state) => state.selectedId)
  const removeDatabase = useDatabases((state) => state.remove)

  const expanded = useDbTree((state) => state.expanded)
  const branches = useDbTree((state) => state.branches)
  const toggleBranch = useDbTree((state) => state.toggle)
  const reloadBranch = useDbTree((state) => state.reload)
  const openRelation = useDbTree((state) => state.open)
  const activateDatabase = useDbTree((state) => state.activate)

  const selected = useExplorer((state) => state.selected)
  const engine = useExplorer((state) => state.engine)
  const version = useExplorer((state) => state.version)
  const setTab = useExplorer((state) => state.setTab)
  const openQueryTab = useExplorer((state) => state.openQueryTab)
  const renameTable = useExplorer((state) => state.renameTable)
  const dropTable = useExplorer((state) => state.dropTable)
  const truncateTable = useExplorer((state) => state.truncateTable)

  const [query, setQuery] = useState("")
  const [addingDatabase, setAddingDatabase] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<DatabaseRecord | null>(null)
  const [removing, setRemoving] = useState<DatabaseRecord | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null)
  const [renaming, setRenaming] = useState<Relation | null>(null)
  const [pending, setPending] = useState<{
    kind: "drop" | "truncate"
    relation: Relation
  } | null>(null)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [pendingBusy, setPendingBusy] = useState(false)
  /** A database that would not answer, and what it said. The dialog is the
   * whole report — see `useDbTree.toggle`. */
  const [unreachable, setUnreachable] = useState<{
    database: DatabaseRecord
    error: string
  } | null>(null)

  const needle = query.trim().toLowerCase()

  /** An open branch's tables, narrowed by the filter box. */
  function tablesOf(database: DatabaseRecord): Relation[] {
    const { relations } = branches[database.id] ?? CLOSED
    if (!needle) return relations
    return relations.filter((relation) =>
      relation.name.toLowerCase().includes(needle)
    )
  }

  async function toggle(database: DatabaseRecord) {
    const failure = await toggleBranch(database)
    if (failure) setUnreachable({ database, error: failure })
  }

  async function reload(database: DatabaseRecord) {
    const failure = await reloadBranch(database)
    if (failure) setUnreachable({ database, error: failure })
  }

  /**
   * Moves the workspace onto a table, and says whether it got there — every
   * table action in the store runs against whichever database is open, so a
   * menu item aimed at a table in some other database has to move there
   * first, and must not act at all if it couldn't.
   */
  async function openTable(
    database: DatabaseRecord,
    relation: Relation
  ): Promise<boolean> {
    const failure = await openRelation(database, relation)
    if (failure) {
      setUnreachable({ database, error: failure })
      return false
    }
    return true
  }

  async function activate(database: DatabaseRecord): Promise<boolean> {
    const failure = await activateDatabase(database)
    if (failure) {
      setUnreachable({ database, error: failure })
      return false
    }
    return true
  }

  /**
   * One handler for the whole tree rather than one per row: a row's own
   * `onContextMenu` would have to call `stopPropagation` to keep a click on it
   * from also reading as a click on the empty area below, and that would stop
   * the event from ever reaching the trigger that opens the menu in the first
   * place. Reading `event.target` here instead needs nothing stopped — the
   * same as `request-list.tsx`.
   */
  function onTreeContextMenu(event: MouseEvent) {
    const element = event.target as HTMLElement
    const databaseId =
      element.closest<HTMLElement>("[data-database-id]")?.dataset.databaseId
    const database = databases.find((candidate) => candidate.id === databaseId)
    if (!database) {
      setMenuTarget({ kind: "root" })
      return
    }

    const key =
      element.closest<HTMLElement>("[data-relation]")?.dataset.relation
    const relation = (branches[database.id] ?? CLOSED).relations.find(
      (candidate) => relationKey(candidate) === key
    )
    setMenuTarget(
      relation
        ? { kind: "relation", database, relation }
        : { kind: "database", database }
    )
  }

  return (
    <ContextMenu>
      <div className="flex h-full flex-col">
        <PanelHeader title="Database">
          <IconButton
            label="Add a database"
            disabled={!projectId}
            onClick={() => setAddingDatabase(true)}
          >
            <Plus />
          </IconButton>
        </PanelHeader>

        {databases.length > 0 && (
          <div className="shrink-0 border-b px-2 py-1.5">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter tables…"
              aria-label="Filter tables"
              spellCheck={false}
              className="h-7 border-transparent bg-muted/60 text-xs md:text-xs"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto py-1">
          {!projectId ? null : (
            <ContextMenuTrigger
              render={
                <div
                  className="flex min-h-full flex-col"
                  onContextMenu={onTreeContextMenu}
                />
              }
            >
              {databases.length === 0 ? (
                <Empty className="p-4">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Database />
                    </EmptyMedia>
                    <EmptyTitle>No database yet</EmptyTitle>
                    <EmptyDescription className="text-xs">
                      Create one, or connect to a database you already have.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button size="xs" onClick={() => setAddingDatabase(true)}>
                      <Plus data-icon="inline-start" />
                      Add a database
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <ul>
                  {databases.map((database) => {
                    const branch = branches[database.id] ?? CLOSED
                    const isOpen = expanded[database.id] === true
                    const isCurrent = database.id === openDatabaseId
                    const tables = tablesOf(database)

                    return (
                      <li key={database.id} data-database-id={database.id}>
                        <SideRow
                          title={summarise(
                            database,
                            isCurrent ? version : null
                          )}
                          onClick={() => void toggle(database)}
                          className={cn(
                            isCurrent && "font-medium text-foreground"
                          )}
                        >
                          {branch.loading ? (
                            <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : isOpen ? (
                            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <Database className="size-3.5 shrink-0" />
                          <span className="truncate">{database.name}</span>
                          <span className="ml-auto shrink-0 pl-2 text-[0.65rem] text-muted-foreground">
                            {ENGINE_LABEL[database.engine]}
                          </span>
                        </SideRow>

                        {isOpen && (
                          <ul>
                            {branch.error ? (
                              <li className="py-1 pr-2 pl-6 font-mono text-xs whitespace-pre-wrap text-destructive">
                                {branch.error}
                              </li>
                            ) : tables.length === 0 ? (
                              <li className="py-1 pr-2 pl-6 text-xs text-muted-foreground">
                                {needle
                                  ? `No tables match “${query.trim()}”.`
                                  : "No tables."}
                              </li>
                            ) : (
                              tables.map((relation) => {
                                const Icon = KIND_ICONS[relation.kind]
                                const active =
                                  isCurrent &&
                                  selected?.schema === relation.schema &&
                                  selected.name === relation.name

                                return (
                                  <li
                                    key={relationKey(relation)}
                                    data-relation={relationKey(relation)}
                                  >
                                    <SideRow
                                      indent={1}
                                      active={active}
                                      title={`${relation.name} — ${KIND_LABELS[relation.kind]}`}
                                      onClick={() =>
                                        void openTable(database, relation)
                                      }
                                    >
                                      <Icon className="size-3.5 shrink-0" />
                                      <span className="truncate">
                                        {relation.name}
                                      </span>
                                    </SideRow>
                                  </li>
                                )
                              })
                            )}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </ContextMenuTrigger>
          )}
        </div>

        {creating && engine && (
          <NewTableDialog onClose={() => setCreating(false)} />
        )}

        {addingDatabase && projectId && (
          <NewDatabaseDialog
            projectId={projectId}
            onClose={() => setAddingDatabase(false)}
          />
        )}

        {editing && (
          <EditConnectionDialog
            database={editing}
            onClose={() => setEditing(null)}
          />
        )}

        {renaming && (
          <RenameDialog
            title={`Rename ${KIND_LABELS[renaming.kind]}`}
            label="Table name"
            currentName={renaming.name}
            onRename={(name) => renameTable(name)}
            onClose={() => setRenaming(null)}
          />
        )}

        <AlertDialog
          open={unreachable !== null}
          onOpenChange={(open) => {
            if (!open) setUnreachable(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Can&apos;t reach “{unreachable?.database.name}”
              </AlertDialogTitle>
              <AlertDialogDescription>
                {unreachable?.database.origin === "docker"
                  ? "Its container may not be running. Start Docker, or the container, and try again."
                  : "Check that the server is running and that the connection details are right."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="font-mono text-xs whitespace-pre-wrap text-destructive">
              {unreachable?.error}
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel>Close</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (!unreachable) return
                  const { database } = unreachable
                  setUnreachable(null)
                  // A branch that is already open is re-read where it stands;
                  // one that never got to open is opened again.
                  void (expanded[database.id]
                    ? reload(database)
                    : toggle(database))
                }}
              >
                Try again
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={removing !== null}
          onOpenChange={(open) => {
            if (!open) {
              setRemoving(null)
              setRemoveError(null)
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove “{removing?.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                {removing?.origin === "docker"
                  ? "This deletes its container and its data. This can't be undone."
                  : "Only the connection is removed — the database itself is untouched."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {removeError && (
              <p className="font-mono text-xs whitespace-pre-wrap text-destructive">
                {removeError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removeBusy}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={removeBusy}
                onClick={async () => {
                  if (!removing) return
                  setRemoveBusy(true)
                  setRemoveError(null)
                  try {
                    await removeDatabase(removing.id)
                    setRemoving(null)
                  } catch (error) {
                    setRemoveError(
                      error instanceof Error ? error.message : String(error)
                    )
                  } finally {
                    setRemoveBusy(false)
                  }
                }}
              >
                {removeBusy ? "Removing…" : "Remove"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={pending !== null}
          onOpenChange={(open) => {
            if (!open) {
              setPending(null)
              setPendingError(null)
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pending?.kind === "drop"
                  ? `Drop “${pending.relation.name}”?`
                  : `Truncate “${pending?.relation.name}”?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pending?.kind === "drop"
                  ? "This deletes the table and everything in it. This can't be undone."
                  : "This deletes every row in the table. This can't be undone."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {pendingError && (
              <p className="font-mono text-xs whitespace-pre-wrap text-destructive">
                {pendingError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pendingBusy}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={pendingBusy}
                onClick={async () => {
                  if (!pending) return
                  setPendingBusy(true)
                  setPendingError(null)
                  const failure =
                    pending.kind === "drop"
                      ? await dropTable()
                      : await truncateTable()
                  setPendingBusy(false)
                  if (failure) {
                    setPendingError(failure)
                    return
                  }
                  setPending(null)
                }}
              >
                {pendingBusy
                  ? "Working…"
                  : pending?.kind === "drop"
                    ? "Drop"
                    : "Truncate"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {menuTarget?.kind === "root" && (
        <ContextMenuContent className="w-52">
          <ContextMenuItem
            disabled={!projectId}
            onClick={() => setAddingDatabase(true)}
          >
            <Plus />
            Add a database…
          </ContextMenuItem>
        </ContextMenuContent>
      )}

      {menuTarget?.kind === "database" && (
        <ContextMenuContent className="w-52">
          <ContextMenuItem
            onClick={async () => {
              if (await activate(menuTarget.database)) setCreating(true)
            }}
          >
            <Plus />
            New table…
          </ContextMenuItem>
          <ContextMenuItem
            onClick={async () => {
              if (await activate(menuTarget.database)) openQueryTab()
            }}
          >
            <Terminal />
            New query tab
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void reload(menuTarget.database)}>
            <RefreshCw />
            Reload schema
          </ContextMenuItem>

          <ContextMenuSeparator />
          {/* Only a connection can be edited: a database the studio created
              has an address Docker decides and credentials baked into its
              container. */}
          {menuTarget.database.origin === "external" && (
            <ContextMenuItem onClick={() => setEditing(menuTarget.database)}>
              <Pencil />
              Edit connection…
            </ContextMenuItem>
          )}
          <ContextMenuItem
            variant="destructive"
            onClick={() => {
              setRemoving(menuTarget.database)
              setRemoveError(null)
            }}
          >
            <Trash2 />
            Remove database…
          </ContextMenuItem>
        </ContextMenuContent>
      )}

      {menuTarget?.kind === "relation" && (
        <ContextMenuContent className="w-52">
          <ContextMenuItem
            onClick={async () => {
              if (await openTable(menuTarget.database, menuTarget.relation)) {
                setTab("data")
              }
            }}
          >
            <Table2 />
            Browse rows
          </ContextMenuItem>
          <ContextMenuItem
            onClick={async () => {
              if (await openTable(menuTarget.database, menuTarget.relation)) {
                setTab("columns")
              }
            }}
          >
            <ListTree />
            Columns
          </ContextMenuItem>
          <ContextMenuItem
            onClick={async () => {
              if (!(await openTable(menuTarget.database, menuTarget.relation)))
                return
              openQueryTab(
                `select *\n  from ${getAdapter(menuTarget.database.engine).qualify(menuTarget.relation)}\n limit 100;`
              )
            }}
          >
            <Terminal />
            Query in SQL tab
          </ContextMenuItem>

          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() =>
              void navigator.clipboard.writeText(
                relationKey(menuTarget.relation)
              )
            }
          >
            <Copy />
            Copy name
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void reload(menuTarget.database)}>
            <RefreshCw />
            Reload schema
          </ContextMenuItem>

          {/* A view is renamed, emptied and dropped by statements this app does
            not generate — `alter table`/`truncate`/`drop table` are the wrong
            ones for it — so those are left off rather than offered and failing. */}
          {(menuTarget.relation.kind === "table" ||
            menuTarget.relation.kind === "partitioned") && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={async () => {
                  if (
                    await openTable(menuTarget.database, menuTarget.relation)
                  ) {
                    setRenaming(menuTarget.relation)
                  }
                }}
              >
                <Pencil />
                Rename table…
              </ContextMenuItem>
              <ContextMenuItem
                variant="destructive"
                onClick={async () => {
                  // Awaited before the confirmation opens, not after it is
                  // accepted: the statement runs against whichever database is
                  // open, and that had better already be this one.
                  if (
                    !(await openTable(menuTarget.database, menuTarget.relation))
                  ) {
                    return
                  }
                  setPending({
                    kind: "truncate",
                    relation: menuTarget.relation,
                  })
                  setPendingError(null)
                }}
              >
                <Eraser />
                Truncate table
              </ContextMenuItem>
              <ContextMenuItem
                variant="destructive"
                onClick={async () => {
                  if (
                    !(await openTable(menuTarget.database, menuTarget.relation))
                  ) {
                    return
                  }
                  setPending({ kind: "drop", relation: menuTarget.relation })
                  setPendingError(null)
                }}
              >
                <Trash2 />
                Drop table
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
}

/** What a database's row says when hovered: where it lives, and — for the one
 * the workspace has open — which server version answered. */
function summarise(database: DatabaseRecord, version: string | null): string {
  return [
    `${database.name} — ${ENGINE_LABEL[database.engine]}`,
    database.origin === "docker"
      ? "Created here"
      : `${database.host}:${database.port}`,
    version,
  ]
    .filter(Boolean)
    .join(" — ")
}

function relationKey(relation: Relation): string {
  return `${relation.schema}.${relation.name}`
}
