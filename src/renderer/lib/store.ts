import { create } from "zustand"

import * as repo from "./db/projects"
import type { FileMap, Project } from "./db/projects"

const LAST_PROJECT_KEY = "last-project-id"

/**
 * Progress while an imported project is being brought up. Opening a folder is
 * a single fast read these days, but it still goes through the overlay: a
 * large repository's file tree is worth a moment on screen rather than a
 * silent pause.
 */
export type SetupState = {
  /** The project being imported, for the overlay's heading. */
  name: string
  /** Set when the import failed; the overlay then waits to be dismissed. */
  error: string | null
}

/**
 * Where to put the cursor in the file a search result points at.
 *
 * `token` is what makes clicking the same result twice work: the line and
 * column would be unchanged, and an effect keyed on those alone would not fire
 * again after the user had scrolled away from it.
 */
export type EditorReveal = {
  /** 1-based, as every other part of the app counts lines. */
  line: number
  column: number
  /** Length of the match, so it lands selected rather than merely scrolled to. */
  length: number
  token: number
}

/**
 * Which of the tabbed panels the workspace pane is showing.
 *
 * Deliberately not the activity rail's own section: the rail chooses the
 * sidebar, and changing the sidebar must not take what is open off the screen.
 * What sets this is picking something to look at — a tab, a table in the tree,
 * a request, a session — wherever that pick was made.
 */
export type Pane = "database" | "api" | "mail" | "webhook" | "spec" | "terminal"

type StudioState = {
  /** Storage is open and projects have been loaded. */
  loaded: boolean
  storageError: string | null

  projects: Project[]
  projectId: string | null
  /** The open project's checked-out branch, or null when it is not a git
   * repository (or nothing is open yet). */
  gitBranch: string | null

  /** The open project's tree: every file, with no contents. */
  entries: repo.FileEntry[]
  /**
   * Contents of the files a search result has opened, not of the project.
   *
   * A cache, in other words: an imported repository can be far too large to
   * hold whole.
   */
  files: FileMap
  /** Paths open as tabs, in strip order. `openPath` is whichever is active —
   * it is always one of these, or null when none are open. */
  openTabs: string[]
  openPath: string | null
  /** Set while a file's contents are on their way from disk. */
  loadingPath: string | null
  /** Why the open file cannot be shown — too large, or binary. */
  fileError: string | null
  /** Set by whoever opened the file at a position; cleared once consumed is
   * unnecessary — consumers key off `token`. */
  reveal: EditorReveal | null

  /** Non-null while a project is being imported. */
  setup: SetupState | null

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
  /**
   * Re-reads the open project's tree.
   *
   * Opening a project is the only other thing that fills `entries`, which was
   * enough while nothing in the studio wrote files. The Spec panel does, and a
   * spec it had just created was missing from the tree until the project was
   * reopened.
   */
  refreshEntries: () => Promise<void>
  /** Adds an existing folder as a project, run and edited where it is. */
  importProject: (input: { path: string; name: string }) => Promise<void>
  /** Closes the setup overlay after a failure. */
  dismissSetup: () => void
  openProject: (id: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  renameProject: (id: string, name: string) => Promise<void>

  selectFile: (path: string | null) => void
  /** Opens a file as a tab, reusing one already open for it. */
  openTab: (path: string) => void
  /** Opens a file and puts the cursor on one of its lines. */
  openFileAt: (
    path: string,
    position: { line: number; column: number; length: number }
  ) => void
  /** Closes one tab, falling back to its neighbour — the one on the right,
   * as an editor does — when it was the active one. */
  closeTab: (path: string) => void
  closeOtherTabs: (path: string) => void
  closeAllTabs: () => void
  /** Reorders the tab strip. Only tabs already open are kept, so a stale list
   * can shuffle the tabs but never conjure or drop one. */
  reorderTabs: (paths: string[]) => void
}

/**
 * Strict Mode invokes mount effects twice, so `init` has to be idempotent,
 * not merely fast.
 */
let initPromise: Promise<void> | null = null

export const useStudio = create<StudioState>((set, get) => {
  /** Fetches one file's contents into the cache, or records why it cannot. */
  async function loadFile(projectId: string, path: string): Promise<void> {
    set({ loadingPath: path, fileError: null })
    try {
      const content = await repo.readFile(projectId, path)
      // Discarded if the user moved on, or switched project, while it was read:
      // writing it into the cache would be harmless, but clearing `loadingPath`
      // for a file that is no longer open would not.
      if (get().projectId !== projectId || get().openPath !== path) return

      set((state) => ({
        files: { ...state.files, [path]: content },
        loadingPath: null,
      }))
    } catch (error) {
      if (get().projectId !== projectId || get().openPath !== path) return
      set({
        loadingPath: null,
        fileError: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Opens storage and reopens the last project, if there is one. */
  async function bootstrap() {
    let projects: Project[]
    try {
      projects = await repo.listProjects()
    } catch (error) {
      set({
        loaded: true,
        storageError:
          error instanceof Error ? error.message : "Could not read ~/.tabula",
      })
      return
    }

    set({ projects, loaded: true })
    if (projects.length === 0) return

    const remembered = await repo.getSetting(LAST_PROJECT_KEY)
    const target =
      projects.find((project) => project.id === remembered) ?? projects[0]!
    await get().openProject(target.id)
  }

  /** Brings an imported project up with the progress overlay showing. */
  async function bringUp(
    name: string,
    add: () => Promise<Project>
  ): Promise<void> {
    set({ setup: { name, error: null } })
    try {
      const project = await add()
      set({ projects: await repo.listProjects() })
      await get().openProject(project.id)
      set({ setup: null })
    } catch (error) {
      // Not rethrown: `setup` is where a failure is reported, and the caller is
      // a dialog that has already closed itself by the time this settles.
      set((state) => ({
        setup: state.setup
          ? {
              ...state.setup,
              error: error instanceof Error ? error.message : String(error),
            }
          : null,
      }))
    }
  }

  return {
    loaded: false,
    storageError: null,

    projects: [],
    projectId: null,
    gitBranch: null,
    entries: [],
    files: {},
    openTabs: [],
    openPath: null,
    loadingPath: null,
    fileError: null,
    reveal: null,

    setup: null,
    pane: "database",
    tabOrder: [],

    showPane(pane) {
      set({ pane })
    },

    setTabOrder(ids) {
      set({ tabOrder: ids })
    },

    init() {
      initPromise ??= bootstrap()
      return initPromise
    },

    async refreshEntries() {
      const { projectId } = get()
      if (!projectId) return

      const entries = await repo.listFiles(projectId)
      // Discarded if the user switched projects while the walk was running:
      // one project's tree shown as another's is worse than a stale one.
      if (get().projectId !== projectId) return
      set({ entries })
    },

    async importProject(input) {
      await bringUp(input.name, () => repo.importProject(input))
    },

    dismissSetup() {
      set({ setup: null })
    },

    async openProject(id) {
      const entries = await repo.listFiles(id)

      // The cache is dropped rather than merged: paths are per project, and a
      // stale `src/App.tsx` from the last one would be shown as this one's.
      set({
        projectId: id,
        gitBranch: null,
        entries,
        files: {},
        openTabs: [],
        openPath: null,
        loadingPath: null,
        fileError: null,
        reveal: null,
        // Every panel clears its own tabs on a project change, so an order
        // over them means nothing here — and holding it would put the next
        // project's tabs in the last one's arrangement.
        tabOrder: [],
      })
      await repo.setSetting(LAST_PROJECT_KEY, id)

      const branch = await repo.gitBranch(id)
      // Discarded if the user switched projects while this was in flight.
      if (get().projectId === id) set({ gitBranch: branch })
    },

    async deleteProject(id) {
      await repo.deleteProject(id)
      const projects = await repo.listProjects()
      set({ projects })

      if (get().projectId !== id) return

      if (projects.length === 0) {
        set({
          projectId: null,
          gitBranch: null,
          entries: [],
          files: {},
          openTabs: [],
          openPath: null,
          loadingPath: null,
          fileError: null,
          reveal: null,
          tabOrder: [],
        })
        return
      }
      await get().openProject(projects[0]!.id)
    },

    async renameProject(id, name) {
      await repo.renameProject(id, name)
      set({ projects: await repo.listProjects() })
    },

    selectFile(path) {
      const { projectId, files, entries } = get()
      set({ openPath: path, fileError: null })
      if (path === null || projectId === null) return

      // Already in hand, from an earlier visit.
      if (path in files) return

      const entry = entries.find((candidate) => candidate.path === path)
      if (entry && !entry.editable) {
        set({
          fileError: `${path} is not editable text, so it is not opened here.`,
        })
        return
      }
      void loadFile(projectId, path)
    },

    openTab(path) {
      const { openTabs } = get()
      if (!openTabs.includes(path)) set({ openTabs: [...openTabs, path] })
      get().selectFile(path)
    },

    openFileAt(path, position) {
      get().openTab(path)
      set((state) => ({
        reveal: {
          ...position,
          // Monotonic rather than derived from the position, so opening the
          // same match twice is two distinct reveals.
          token: (state.reveal?.token ?? 0) + 1,
        },
      }))
    },

    closeTab(path) {
      const { openTabs, openPath } = get()
      const index = openTabs.indexOf(path)
      if (index === -1) return

      const remaining = openTabs.filter((_, position) => position !== index)
      set({ openTabs: remaining })
      if (openPath !== path) return

      get().selectFile(remaining[index] ?? remaining[index - 1] ?? null)
    },

    closeOtherTabs(path) {
      if (!get().openTabs.includes(path)) return
      set({ openTabs: [path] })
      get().selectFile(path)
    },

    closeAllTabs() {
      set({ openTabs: [] })
      get().selectFile(null)
    },

    reorderTabs(paths) {
      const current = new Set(get().openTabs)
      const reordered = paths.filter((path) => current.has(path))
      if (reordered.length !== current.size) return
      set({ openTabs: reordered })
    },
  }
})
