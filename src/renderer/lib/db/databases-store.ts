import { create } from "zustand"

import { useStudio } from "../store"
import * as repo from "./databases"
import type { DatabaseRecord, NewDatabaseInput } from "./databases"

type DatabasesState = {
  /** Whose databases these are; cleared and reloaded when the project changes. */
  projectId: string | null
  databases: DatabaseRecord[]
  /** Which of the project's databases the Database panel is showing. */
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
  // Follows the open project, the same way `explorer-store` follows this
  // store: switching projects means switching to a different list of
  // databases, and whatever was selected belonged to the project that just
  // closed.
  useStudio.subscribe((studio) => {
    if (studio.projectId === get().projectId) return

    set({
      projectId: studio.projectId,
      databases: [],
      selectedId: null,
      error: null,
    })
    if (studio.projectId) void get().refresh()
  })

  return {
    projectId: useStudio.getState().projectId,
    databases: [],
    selectedId: null,
    loading: false,
    error: null,

    async refresh() {
      const { projectId } = get()
      if (!projectId) return

      set({ loading: true })
      try {
        const databases = await repo.listDatabases(projectId)
        set((state) => ({
          databases,
          loading: false,
          error: null,
          // The selection follows the list rather than being reset outright: a
          // database that is still there stays selected, and the first one
          // stands in the moment there is nothing selected yet.
          selectedId: databases.some(
            (database) => database.id === state.selectedId
          )
            ? state.selectedId
            : (databases[0]?.id ?? null),
        }))
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
    },
  }
})

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
