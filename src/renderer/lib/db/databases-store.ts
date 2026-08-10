import { create } from "zustand"

import { recall, remember } from "../tab-memory"
import * as repo from "./databases"
import type { DatabaseRecord, NewDatabaseInput } from "./databases"

/** Which database the panel was last browsing. Without this the panel comes
 * back on the first of the list, and the tabs remembered against the one that
 * was actually open have nothing to be restored into. */
const SELECTED_KEY = "db.selected"

function isDatabaseId(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

type DatabasesState = {
  databases: DatabaseRecord[]
  /** Which of the workspace's databases the Database panel is showing. */
  selectedId: string | null
  loading: boolean
  error: string | null

  refresh: () => Promise<void>
  create: (input: NewDatabaseInput) => Promise<DatabaseRecord>
  /** Rewrites a connection's details, for an `external` record. */
  update: (id: string, input: repo.UpdateDatabaseInput) => Promise<void>
  remove: (id: string) => Promise<void>
  select: (id: string | null) => void
}

export const useDatabases = create<DatabasesState>((set, get) => {
  /** Whether the stored selection has been consulted — see `refresh`. A flag
   * rather than a null check on the value, since "nothing was stored" is an
   * answer and re-asking for it on every refresh is a read per refresh. */
  let consulted = false

  return {
    databases: [],
    selectedId: null,
    loading: false,
    error: null,

    async refresh() {
      set({ loading: true })
      try {
        const databases = await repo.listDatabases()
        // Only the first read consults it: after that the selection on screen
        // is the truth, and a database removed since is one the fallback below
        // handles like any other missing id.
        let last: string | null = null
        if (!consulted) {
          consulted = true
          last = await recall(SELECTED_KEY, isDatabaseId)
        }

        set((state) => {
          const wanted = state.selectedId ?? last ?? null
          return {
            databases,
            loading: false,
            error: null,
            // The selection follows the list rather than being reset outright: a
            // database that is still there stays selected, and the first one
            // stands in the moment there is nothing selected yet.
            selectedId: databases.some((database) => database.id === wanted)
              ? wanted
              : (databases[0]?.id ?? null),
          }
        })
      } catch (error) {
        set({ loading: false, error: message(error) })
      }
    },

    async create(input) {
      const database = await repo.createDatabase(input)
      set((state) => ({
        databases: [...state.databases, database],
        selectedId: database.id,
      }))
      return database
    },

    async update(id, input) {
      await repo.updateDatabase(id, input)
      await get().refresh()
    },

    async remove(id) {
      await repo.deleteDatabase(id)
      set((state) => {
        const databases = state.databases.filter(
          (database) => database.id !== id
        )
        return {
          databases,
          selectedId:
            state.selectedId === id
              ? (databases[0]?.id ?? null)
              : state.selectedId,
        }
      })
    },

    select(id) {
      set({ selectedId: id })
      remember(SELECTED_KEY, id)
    },
  }
})

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
