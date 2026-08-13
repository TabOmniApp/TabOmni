import { create } from "zustand"

import type { WorkspaceFolder } from "@shared/api"
import { isStringArray, recall, remember } from "./tab-memory"
import { useRail } from "./rail"
import * as repo from "./workspace"

/** Where the strip's arrangement and the pane on screen are kept. */
const STRIP_KEY = "workbench.strip"

/** Every pane there is — the list `lib/panels.ts` walks to reach all six
 * panels' tabs without naming any of them. */
export const PANES: Pane[] = [
  "files",
  "database",
  "api",
  "mail",
  "terminal",
  "note",
]

type RememberedStrip = { tabOrder: string[]; pane: Pane; section?: Pane }

function isRememberedStrip(value: unknown): value is RememberedStrip {
  const record = value as Partial<RememberedStrip> | null
  return (
    isStringArray(record?.tabOrder) &&
    PANES.includes(record.pane as Pane) &&
    // Optional: written by a build that did not remember the sidebar yet.
    (record.section === undefined || PANES.includes(record.section))
  )
}

/**
 * Which of the tabbed panels the workspace pane is showing.
 *
 * Deliberately not the activity rail's own section: the rail chooses the
 * sidebar, and changing the sidebar must not take what is open off the screen.
 * What sets this is picking something to look at — a tab, a table in the tree,
 * a request, a session — wherever that pick was made.
 */
export type Pane = "files" | "database" | "api" | "mail" | "terminal" | "note"

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
  /**
   * Puts a panel's own selection on screen, and brings its sidebar with it.
   *
   * Called by whatever the user picked, not by the rail. The sidebar follows
   * because the two halves are about the same thing: opening a note from the
   * tab strip while the Explorer's tree is showing used to mark a row in a
   * list nobody could see, which is the same failure as a folded folder — one
   * level up.
   */
  showPane: (pane: Pane) => void

  /**
   * Which sidebar the rail is showing.
   *
   * The same six ids as `Pane`, and deliberately a separate value: the rail
   * moves this on its own, so a sidebar can be read while another panel's tab
   * stays on screen. What is *not* symmetric is the other direction — picking
   * something moves both, because a selection nobody can see the sidebar for is
   * half an answer.
   */
  section: Pane
  /** The rail's own pick, which moves the sidebar and nothing else. */
  setSection: (section: Pane) => void

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
    const { tabOrder, pane, section } = get()
    remember(STRIP_KEY, { tabOrder, pane, section })
  }

  /** Opens storage and reads the workspace. */
  async function bootstrap() {
    // Before the folders, so the strip is arranged by the time the panels have
    // anything to arrange — restoring it afterwards showed one frame of the
    // default order.
    const strip = await recall(STRIP_KEY, isRememberedStrip)
    if (strip) {
      set({
        tabOrder: strip.tabOrder,
        pane: strip.pane,
        // A layout written before the rail was remembered has no section in
        // it; the pane's own is the closest thing to where it was left.
        section: strip.section ?? strip.pane,
      })
    }

    let folders: WorkspaceFolder[]
    try {
      folders = (await repo.getWorkspace()).folders
    } catch (error) {
      set({
        loaded: true,
        storageError:
          error instanceof Error ? error.message : "Could not read ~/.tabomni",
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
    section: "files",
    tabOrder: [],

    showPane(pane) {
      // Not onto a section taken off the rail: hiding one is saying "this is
      // not a way into the studio for me", and a pick should not put it back.
      const hidden = useRail.getState().hidden
      set((state) => ({
        pane,
        section: hidden.includes(pane) ? state.section : pane,
      }))
      rememberStrip()
    },

    setSection(section) {
      set({ section })
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
