import { create } from "zustand"

import { isStringArray, recall, remember } from "./tab-memory"

/** Whether the column is showing, and what in it is folded shut. */
const COLUMN_KEY = "projects.column"

/**
 * The four things the left column can stack.
 *
 * `projects` is this column's own; the other three are the panels' lists, which
 * were the right-hand panel's tabs before and are sections here — see
 * `WorkspaceSidebar`. Not `Section` from `lib/rail.ts`: that is the four ways
 * into the *workbench* and its `files` is the Explorer, which stayed on the
 * right.
 *
 * Which of them are actually drawn is `SIDEBAR_SECTIONS` below, and it is not
 * all of them right now.
 */
export type SidebarSection = "projects" | "database" | "note" | "api"

/**
 * Which of them the column actually draws.
 *
 * **Projects only, for now** — Conductor's left column, which is the shape this
 * is being held against: the projects and their branches, and nothing else
 * competing for the height. `Database`, `Notes` and `API` are *hidden* rather
 * than removed: the panels, their stores, their panes and their tabs are all
 * still here and still work, and `⌘P` indexes every table, request and note, so
 * nothing has become unreachable. Putting one back is adding its id to this
 * list.
 *
 * The type above keeps all four on purpose. It is what `TITLES` and `Section`
 * are keyed by, so a hidden section stays spelled out rather than becoming a
 * string nothing checks.
 */
export const SIDEBAR_SECTIONS: SidebarSection[] = ["projects"]

type RememberedColumn = {
  sidebar: boolean
  collapsed: string[]
  /** Both optional: written by a build whose Explorer could not follow a
   * checkout, and so had neither of them. */
  checkout?: Record<string, string>
  activeFolderId?: string | null
  /** Optional for the same reason: the column held only the projects then. */
  shutSections?: string[]
}

function isRememberedColumn(value: unknown): value is RememberedColumn {
  const record = value as Partial<RememberedColumn> | null
  return (
    typeof record?.sidebar === "boolean" &&
    isStringArray(record?.collapsed) &&
    (record.checkout === undefined || isIdMap(record.checkout)) &&
    (record.activeFolderId === undefined ||
      record.activeFolderId === null ||
      typeof record.activeFolderId === "string") &&
    (record.shutSections === undefined || isStringArray(record.shutSections))
  )
}

function isIdMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === "string")
  )
}

type ProjectsState = {
  /**
   * Whether the left column is showing.
   *
   * Its own toggle rather than sharing the panels' `⌘B`: the two columns are
   * about different things — one is the workspace's projects, one is whichever
   * panel the section tabs are on — and a single key that took both would leave
   * the workbench with no left edge at all. Remembered, because a column that
   * comes back every launch is a column somebody closes every launch.
   */
  sidebar: boolean
  toggleSidebar: () => void

  /**
   * Which of the column's sections are folded shut.
   *
   * Shut rather than open, the same way the projects are: a section shown again
   * (see `SIDEBAR_SECTIONS`) turns up open rather than hiding until somebody
   * finds the setting. Several can be open at once — that is the point of
   * stacking them instead of switching between them, and it is why the folds are
   * kept while only one section is drawn: they cost nothing and are what the
   * others come back to.
   */
  shutSections: string[]
  toggleSection: (section: SidebarSection) => void

  /**
   * Which projects are drawn shut.
   *
   * Collapsed rather than expanded ids, so a folder added later opens rather
   * than hiding the worktrees filed under it.
   */
  collapsed: string[]
  toggleFolder: (folderId: string) => void

  /**
   * Which checkout each project is being **read in** — the worktree id, or
   * absent for the project's own working tree.
   *
   * This is what Explorer draws: one tree per project, showing the branch that
   * is being worked in rather than every checkout at once. A worktree is a
   * whole copy of the project, so listing them side by side was three copies of
   * one repository in one tree — the question somebody has open is "the files
   * of the thing I am working on", and the thing they are working on is the row
   * they clicked in this column.
   *
   * Per project rather than one for the whole workspace: two projects are open
   * at once on purpose (a frontend and its API), and a single selection would
   * mean picking a branch in one of them silently moved the other.
   */
  checkout: Record<string, string>

  /**
   * The project being worked in, or null before anything has been clicked.
   *
   * Explorer draws **this one**, and only this one: what somebody has open is
   * the files of the thing they are working on, and every other project's tree
   * above and below it is a list to scroll past. The workspace still holds them
   * all — that is what the column is, and clicking a row there is what moves
   * this.
   *
   * Which *checkout* of it is `checkout` above, kept per project so coming back
   * to one lands on the branch it was left on rather than on its main working
   * tree.
   */
  activeFolderId: string | null

  /** Works in a project, in one of its checkouts — null for its own working
   * tree. The one call the column's rows make. */
  setActive: (folderId: string, worktreeId?: string | null) => void

  /** Reads the remembered column. Idempotent: Strict Mode mounts twice. */
  restore: () => Promise<void>
}

export const useProjects = create<ProjectsState>((set, get) => {
  let restorePromise: Promise<void> | null = null

  function rememberColumn() {
    const { sidebar, collapsed, checkout, activeFolderId, shutSections } = get()
    remember(COLUMN_KEY, {
      sidebar,
      collapsed,
      checkout,
      activeFolderId,
      shutSections,
    })
  }

  return {
    // Open by default: it is the way to every project and every worktree, and
    // closed only because somebody closed it.
    sidebar: true,
    collapsed: [],
    checkout: {},
    activeFolderId: null,

    setActive(folderId, worktreeId = null) {
      const { checkout, activeFolderId } = get()
      const next = { ...checkout }
      if (worktreeId === null) delete next[folderId]
      else next[folderId] = worktreeId

      if (
        activeFolderId === folderId &&
        (checkout[folderId] ?? null) === worktreeId
      ) {
        return
      }

      set({ activeFolderId: folderId, checkout: next })
      rememberColumn()
    },

    toggleSidebar() {
      set({ sidebar: !get().sidebar })
      rememberColumn()
    },

    shutSections: [],

    toggleSection(section) {
      const { shutSections } = get()
      set({
        shutSections: shutSections.includes(section)
          ? shutSections.filter((entry) => entry !== section)
          : [...shutSections, section],
      })
      rememberColumn()
    },

    toggleFolder(folderId) {
      const { collapsed } = get()
      set({
        collapsed: collapsed.includes(folderId)
          ? collapsed.filter((id) => id !== folderId)
          : [...collapsed, folderId],
      })
      rememberColumn()
    },

    restore() {
      restorePromise ??= (async () => {
        const stored = await recall(COLUMN_KEY, isRememberedColumn)
        if (stored) {
          set({
            sidebar: stored.sidebar,
            collapsed: stored.collapsed,
            // Neither is checked against a list here: the folders and the
            // worktrees are both read after this, and `shownRoot` falls back —
            // to the first project, and to a project's own working tree — for
            // an id that names nothing. A checkout removed while the app was
            // shut is a tree that opens on the project rather than on an error.
            checkout: stored.checkout ?? {},
            activeFolderId: stored.activeFolderId ?? null,
            shutSections: stored.shutSections ?? [],
          })
        }
      })()
      return restorePromise
    },
  }
})
