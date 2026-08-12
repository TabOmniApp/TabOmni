import { create } from "zustand"

import type { DatabaseRecord } from "./databases"
import { useDatabases } from "./databases-store"
import { getAdapter, type Relation } from "./engines"
import { useExplorer } from "./explorer-store"
import { databaseRunner } from "./runner"

/** One database's branch of the tree, as far as it has been read. */
export type Branch = {
  relations: Relation[]
  loading: boolean
  /**
   * Why this database could not be read — an address nothing answers on, a
   * container that isn't running, credentials it rejects. Null before the
   * branch has ever been opened, and once it has been read.
   */
  error: string | null
}

/** A database nobody has opened yet. Shared, so a render isn't handed a new
 * object for every closed branch. */
export const CLOSED: Branch = { relations: [], loading: false, error: null }

type TreeState = {
  /**
   * Which databases are open, by id. Every one starts closed: opening a
   * branch is what connects to its server, so nothing is dialled until the
   * user asks for it.
   */
  expanded: Record<string, true>
  branches: Record<string, Branch>

  /**
   * Opens a closed branch, or closes an open one. Resolves to an error
   * message when the database could not be reached — the panel puts that in
   * front of the user, and the branch stays closed, since an unreachable
   * database has nothing to show underneath it.
   */
  toggle: (database: DatabaseRecord) => Promise<string | null>
  /** Re-reads one database's tables. Resolves to an error message on failure. */
  reload: (database: DatabaseRecord) => Promise<string | null>
  /**
   * Opens `relation` in the workspace, moving the workspace to its database
   * first. Resolves to an error message when that database could not be read.
   */
  open: (database: DatabaseRecord, relation: Relation) => Promise<string | null>
  /**
   * Moves the workspace to `database` without opening a table — for the
   * actions in a database's own context menu, which all run against whichever
   * database the workspace has open. Resolves to an error message when it
   * could not be read.
   */
  activate: (database: DatabaseRecord) => Promise<string | null>
}

export const useDbTree = create<TreeState>((set, get) => {
  function patch(databaseId: string, branch: Branch) {
    set((state) => ({
      branches: { ...state.branches, [databaseId]: branch },
    }))
  }

  /**
   * Reads one database's tables into its branch, and hands back why it could
   * not be, if it could not be.
   *
   * There is nothing to check a connection with but a statement — a
   * connection is opened lazily, by the first one sent through it — so
   * listing the tables *is* the connection check.
   *
   * The database the workspace has open is read through the explorer's own
   * refresh instead of directly: that reads the completions and the server
   * version alongside the tables, and reloads whatever table is on screen.
   * Its `schemaReads` counter is what says whether the read itself got
   * through, as opposed to something afterwards — the open table's own page —
   * having failed.
   */
  async function read(database: DatabaseRecord): Promise<string | null> {
    const previous = get().branches[database.id] ?? CLOSED
    patch(database.id, { ...previous, loading: true, error: null })

    if (useDatabases.getState().selectedId === database.id) {
      const before = useExplorer.getState().schemaReads
      await useExplorer.getState().refresh()
      const { relations, schemaReads, error } = useExplorer.getState()
      if (schemaReads === before) {
        const failure = error ?? "This database could not be read."
        patch(database.id, {
          relations: previous.relations,
          loading: false,
          error: failure,
        })
        return failure
      }
      patch(database.id, { relations, loading: false, error: null })
      return null
    }

    try {
      const relations = await getAdapter(database.engine).listRelations(
        databaseRunner(database.id)
      )
      patch(database.id, { relations, loading: false, error: null })
      return null
    } catch (error) {
      const failure = message(error)
      patch(database.id, { relations: [], loading: false, error: failure })
      return failure
    }
  }

  // A table created, renamed or dropped through the workspace — or by DDL run
  // in a query tab — already makes the explorer re-read the schema. The open
  // database's branch follows that reading rather than repeating it.
  let mirrored = useExplorer.getState().schemaReads
  useExplorer.subscribe((state) => {
    if (state.schemaReads === mirrored) return
    mirrored = state.schemaReads
    if (!state.databaseId) return
    patch(state.databaseId, {
      relations: state.relations,
      loading: false,
      error: null,
    })
  })

  /*
   * Open the branch holding the table that just reached the pane.
   *
   * A table is selected from the tab strip and the search palette as well as
   * from the tree, and a tree that marks a row inside a collapsed branch has
   * marked nothing. Reading the schema is what opening a branch means, so this
   * goes through the same `toggle` a click would.
   *
   * Keyed on the *selection changing*, not on the branch being shut: the sidebar
   * used to do this in a render effect that also watched `expanded`, so
   * collapsing the database of the table on screen re-opened it on the next
   * render and the branch could not be closed at all. Living here rather than in
   * the component also means a collapse survives the sidebar unmounting when
   * another rail section is picked.
   */
  let shown = selectionKey(useExplorer.getState())
  useExplorer.subscribe((state) => {
    const key = selectionKey(state)
    if (key === shown) return
    shown = key
    if (key === null) return

    const databaseId = useDatabases.getState().selectedId
    if (!databaseId || get().expanded[databaseId]) return
    const database = useDatabases
      .getState()
      .databases.find((candidate) => candidate.id === databaseId)
    // The failure is the pane's to report — it is showing the same table this
    // would have revealed, and its error with it.
    if (database) void get().toggle(database)
  })

  return {
    expanded: {},
    branches: {},

    async toggle(database) {
      if (get().expanded[database.id]) {
        set((state) => {
          const expanded = { ...state.expanded }
          delete expanded[database.id]
          return { expanded }
        })
        return null
      }

      // Only a branch that has never been read costs a read. Re-reading one
      // goes through the explorer for the open database, and that reloads the
      // table on screen — so collapsing a branch and opening it again made the
      // grid flash "Loading…" for rows nothing had changed. An open database's
      // branch follows the schema reads above, and any branch can be re-read
      // from the Refresh in its own menu.
      const branch = get().branches[database.id]
      if (!branch || branch.error) {
        const failure = await read(database)
        if (failure) return failure
      }
      set((state) => ({
        expanded: { ...state.expanded, [database.id]: true },
      }))
      return null
    },

    reload: read,

    async open(database, relation) {
      const databases = useDatabases.getState()
      if (databases.selectedId !== database.id) {
        // Selected first, so `read` goes through the explorer and leaves the
        // workspace holding this database's own schema and completions.
        databases.select(database.id)
        const failure = await read(database)
        if (failure) return failure
      }
      useExplorer.getState().select(relation)
      return null
    },

    async activate(database) {
      const databases = useDatabases.getState()
      const wasOpen = databases.selectedId === database.id
      if (!wasOpen) databases.select(database.id)

      // Freshly moved to, or open all along but never read — the first
      // database of a project is selected for the workspace before anything
      // has connected to it.
      const branch = get().branches[database.id]
      if (!wasOpen || !branch) return read(database)
      return branch.error
    },
  }
})

/**
 * Which table the pane is showing, as one comparable value — null while a query
 * tab is on screen, since `selected` outlives a switch to one. Coming back from
 * a query tab to the table's own tab is a change, and reveals it again.
 */
function selectionKey(state: {
  selected: Relation | null
  activeQueryTabId: string | null
}): string | null {
  if (state.activeQueryTabId !== null || !state.selected) return null
  return `${state.selected.schema}.${state.selected.name}`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
