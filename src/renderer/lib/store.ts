import { create } from "zustand"

import type { WorkspaceFolder } from "@shared/api"
import { isStringArray, recall, remember } from "./tab-memory"
import * as repo from "./workspace"

/** Where the strip's arrangement and the pane on screen are kept. */
const STRIP_KEY = "workbench.strip"

const PANES: Pane[] = ["database", "api", "mail", "webhook", "terminal", "note"]

type RememberedStrip = { tabOrder: string[]; pane: Pane }

function isRememberedStrip(value: unknown): value is RememberedStrip {
  const record = value as Partial<RememberedStrip> | null
  return isStringArray(record?.tabOrder) && PANES.includes(record.pane as Pane)
}

/**
 * Which of the tabbed panels the workspace pane is showing.
 *
 * Deliberately not the activity rail's own section: the rail chooses the
 * sidebar, and changing the sidebar must not take what is open off the screen.
 * What sets this is picking something to look at — a tab, a table in the tree,
 * a request, a session — wherever that pick was made.
 */
export type Pane = "database" | "api" | "mail" | "webhook" | "terminal" | "note"

type StudioState = {
  /** Storage is open and the workspace has been read. */
  loaded: boolean
  storageError: string | null

  /**
   * The folders the workspace is pointed at, in the order they were added.
   *
   * There is no "open" one. Everything the studio shows — sessions, specs,
   * captures — is the whole workspace's at once, which is the point: a
   * frontend and the API it calls are two folders, not two applications to
   * switch between.
   */
  folders: WorkspaceFolder[]
  /** Each folder's checked-out branch, or null when it is not a git
   * repository. Missing until the branch has been read. */
  branches: Record<string, string | null>

  pane: Pane
  /** Puts a panel's own selection on screen. Called by whatever the user
   * picked, not by the rail. */
  showPane: (pane: Pane) => void

  /**
   * The workbench tab strip's order, as prefixed ids (`db:public.users`).
   *
   * Each panel still owns *which* tabs it has open; this owns where they sit
   * relative to each other, which no single panel can answer — a request
   * dropped between two tables is a position none of the three stores has
   * anywhere to record. Empty until the first drag, and reconciled against the
   * tabs that actually exist on every render, so an id left here by a closed
   * tab is inert rather than something to clean up.
   */
  tabOrder: string[]
  setTabOrder: (ids: string[]) => void

  init: () => Promise<void>
  /** Points the workspace at another folder on this machine. */
  addFolder: (input: { path: string; name: string }) => Promise<void>
  renameFolder: (id: string, name: string) => Promise<void>
  /** Drops a folder from the workspace. The directory itself is untouched. */
  removeFolder: (id: string) => Promise<void>
}

/**
 * Strict Mode invokes mount effects twice, so `init` has to be idempotent,
 * not merely fast.
 */
let initPromise: Promise<void> | null = null

export const useStudio = create<StudioState>((set, get) => {
  /** Reads each folder's branch, dropping any that leaves the workspace while
   * the read is in flight. */
  async function load(folders: WorkspaceFolder[]): Promise<void> {
    set({ folders })

    await Promise.all(
      folders.map(async (folder) => {
        const branch = await repo.gitBranch(folder.id).catch(() => null)
        // Discarded if the folder was removed while this was in flight: a
        // branch for a folder nothing shows is a leak, not a cache.
        if (!get().folders.some((current) => current.id === folder.id)) return

        set((state) => ({
          branches: { ...state.branches, [folder.id]: branch },
        }))
      })
    )
  }

  function rememberStrip() {
    const { tabOrder, pane } = get()
    remember(STRIP_KEY, { tabOrder, pane })
  }

  /** Opens storage and reads the workspace. */
  async function bootstrap() {
    // Before the folders, so the strip is arranged by the time the panels have
    // anything to arrange — restoring it afterwards showed one frame of the
    // default order.
    const strip = await recall(STRIP_KEY, isRememberedStrip)
    if (strip) set({ tabOrder: strip.tabOrder, pane: strip.pane })

    let folders: WorkspaceFolder[]
    try {
      folders = (await repo.getWorkspace()).folders
    } catch (error) {
      set({
        loaded: true,
        storageError:
          error instanceof Error ? error.message : "Could not read ~/.tabula",
      })
      return
    }

    set({ loaded: true })
    await load(folders)
  }

  /** Forgets everything read for a folder that has left the workspace. */
  function prune(folders: WorkspaceFolder[]) {
    const kept = new Set(folders.map((folder) => folder.id))
    set((state) => ({
      folders,
      branches: Object.fromEntries(
        Object.entries(state.branches).filter(([id]) => kept.has(id))
      ),
    }))
  }

  return {
    loaded: false,
    storageError: null,

    folders: [],
    branches: {},

    pane: "database",
    tabOrder: [],

    showPane(pane) {
      set({ pane })
      rememberStrip()
    },

    setTabOrder(ids) {
      set({ tabOrder: ids })
      rememberStrip()
    },

    init() {
      initPromise ??= bootstrap()
      return initPromise
    },

    async addFolder(input) {
      // Not caught: the dialog that called this reports the failure and stays
      // open, which is the only place a bad path can be corrected.
      const workspace = await repo.addFolder(input)
      await load(workspace.folders)
    },

    async renameFolder(id, name) {
      set({ folders: (await repo.renameFolder(id, name)).folders })
    },

    async removeFolder(id) {
      prune((await repo.removeFolder(id)).folders)
    },
  }
})
