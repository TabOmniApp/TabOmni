import { useEffect } from "react"
import { create } from "zustand"

import type { GitChange } from "@shared/api"
import { useProjects } from "../projects"
import { useStudio } from "../store"
import { useWorktrees } from "../worktree/store"
import { useGitStatus } from "./git-status"
import { fileRoots } from "./roots"

/**
 * What has changed in a checkout: the Explorer's `Changes` list, and the diff
 * tab a row in it opens.
 *
 * Kept apart from `git-status.ts`, which the tree's colours come from, because
 * the two are asked for at different times and at different cost. That one is
 * read for **every** root, so a file in any checkout can be coloured; this one
 * is read for the **one** checkout being worked in, since `git diff --numstat`
 * is a second git call and nobody wants one for a branch nothing on screen is
 * about. Same underlying `git status`, two shapes: a lookup by path there, an
 * ordered list with line counts here.
 *
 * It does not watch anything of its own either. `useGitStatus` already debounces
 * the watchers, `.git` included, and its answer for a root changing identity is
 * exactly the signal "something moved in here" — so the list re-reads off that
 * rather than keeping a second set of timers that could disagree with it.
 *
 * **The list is the Explorer's `Changes` tab; the pane is the diff.** A row
 * there picks a file and `open` puts that checkout's diff tab on screen —
 * `openIds` is the strip's membership, one tab per checkout, and the tab's id
 * *is* the root's, which is what makes `rootOf` in `lib/panels.ts` the identity
 * function here. So reviewing twelve files is twelve clicks and one tab, which
 * is the whole point: the sidebar list this replaced opened a file tab per row.
 * The file selected is remembered per root — coming back to a branch lands where
 * it was left.
 *
 * Nothing forgets a root's *answer*, unlike `useGitStatus`, which prunes the
 * ones that have left the workspace. It has to: its answers are consulted for
 * every path in the tree, so a stale one would colour a row. These are read only
 * for a root with a tab open.
 */
type ChangesState = {
  /** Keyed by `FileRoot.id`, which is `worktreeId ?? folderId`. */
  byRoot: Record<string, GitChange[]>
  /** Roots being read right now, so the tab can say "reading" the first time
   * without saying it on every re-read behind an answer already on screen. */
  loading: string[]

  /** Roots with a `Changes` tab open, oldest first — the strip's
   * membership. Ids here are root ids, which are the tab ids. */
  openIds: string[]
  selectedId: string | null
  /** Which file the tab is showing the diff of, per root. */
  selectedPath: Record<string, string | null>

  /**
   * Reads one root now.
   *
   * Takes the three fields it needs rather than a whole `FileRoot` — which
   * satisfies this structurally anyway — because the caller is an effect: the
   * root record is rebuilt on every render of the panel, and a dependency on
   * the object would be a `git diff` per render.
   */
  refresh: (root: {
    id: string
    folderId: string
    worktreeId: string | null
  }) => Promise<void>

  /** Opens the diff tab for a root and puts it on screen — a row in the
   * Explorer's `Changes` list, and a checkout's own menu. */
  open: (rootId: string) => void
  select: (rootId: string) => void
  close: (rootId: string) => void
  closeOthers: (rootId: string) => void
  closeAll: () => void
  reorder: (ids: string[]) => void
  /** Which file's diff the tab draws. Null draws the tab's own empty state. */
  selectPath: (rootId: string, path: string | null) => void
  /** Both at once: the file to show, and the tab to show it in. What a row in
   * the Explorer's `Changes` list does. */
  openPath: (rootId: string, path: string) => void
}

export const useChanges = create<ChangesState>((set, get) => ({
  byRoot: {},
  loading: [],
  openIds: [],
  selectedId: null,
  selectedPath: {},

  async refresh(root) {
    if (!get().loading.includes(root.id)) {
      set((state) => ({ loading: [...state.loading, root.id] }))
    }

    const changes = await window.desktop
      .gitChanges(root.folderId, root.worktreeId)
      .catch(() => [] as GitChange[])

    set((state) => ({
      loading: state.loading.filter((id) => id !== root.id),
      // Dropped if the root left the workspace while this was in flight, the
      // same way `useGitStatus` drops one.
      byRoot: fileRoots().some(({ id }) => id === root.id)
        ? { ...state.byRoot, [root.id]: changes }
        : state.byRoot,
      selectedPath: keepSelected(state.selectedPath, root.id, changes),
    }))
  },

  open(rootId) {
    get().select(rootId)
  },

  select(rootId) {
    const { openIds } = get()
    set({
      openIds: openIds.includes(rootId) ? openIds : [...openIds, rootId],
      selectedId: rootId,
    })

    // The pane, or the tab would be selected with nothing drawing it — the same
    // move a worktree chat makes, and for the same reason: this pane is not a
    // section, so nothing else shows it.
    useStudio.getState().showPane("changes")

    /*
     * And the workbench works in this checkout.
     *
     * A tab in the strip is scoped to its root (`rootOf` in `lib/panels.ts`), so
     * selecting one has to move the context to that root or the tab would be
     * selected and out of scope in the same breath. `useFiles.reveal` and
     * `useWorktreeChats.select` do this for their own tabs already.
     */
    const worktree = useWorktrees
      .getState()
      .worktrees.find((entry) => entry.id === rootId)
    if (worktree) {
      useProjects.getState().setActive(worktree.folderId, worktree.id)
      return
    }
    // Not a checkout, so the root is the project folder itself.
    if (useStudio.getState().folders.some((folder) => folder.id === rootId)) {
      useProjects.getState().setActive(rootId, null)
    }
  },

  close(rootId) {
    const openIds = get().openIds.filter((entry) => entry !== rootId)
    set({
      openIds,
      selectedId:
        get().selectedId === rootId
          ? (openIds.at(-1) ?? null)
          : get().selectedId,
    })
  },

  closeOthers(rootId) {
    set({ openIds: [rootId], selectedId: rootId })
  },

  closeAll() {
    set({ openIds: [], selectedId: null })
  },

  reorder(ids) {
    // Only ids already open are kept, so a stale list can shuffle the tabs but
    // never conjure or drop one.
    const open = new Set(get().openIds)
    set({ openIds: ids.filter((id) => open.has(id)) })
  },

  selectPath(rootId, path) {
    set((state) => ({
      selectedPath: { ...state.selectedPath, [rootId]: path },
    }))
  },

  openPath(rootId, path) {
    // The path first: `open` puts the pane on screen, and a pane that drew its
    // "nothing selected" notice for a frame before the diff arrived would
    // flicker on every row clicked.
    get().selectPath(rootId, path)
    get().open(rootId)
  },
}))

/**
 * A checkout removed takes its tab with it.
 *
 * The pane can say "that checkout has gone" and does, for the frame between the
 * two — but a tab left in the strip for a branch that no longer exists is one
 * nobody can act on and everybody has to close. `useGitStatus` prunes its own
 * answers off the same two subscriptions, and for a related reason.
 */
function follow() {
  const kept = new Set(fileRoots().map((root) => root.id))
  const { openIds } = useChanges.getState()
  if (openIds.every((id) => kept.has(id))) return

  const open = openIds.filter((id) => kept.has(id))
  useChanges.setState((state) => ({
    openIds: open,
    selectedId:
      state.selectedId && kept.has(state.selectedId)
        ? state.selectedId
        : (open.at(-1) ?? null),
  }))
}

useStudio.subscribe((studio, previous) => {
  if (studio.folders !== previous.folders) follow()
})

useWorktrees.subscribe((state, previous) => {
  if (state.worktrees !== previous.worktrees) follow()
})

/**
 * One root's selection, dropped when the file it names is no longer a change.
 *
 * Its own function because it is the part of `refresh` worth reading twice: a
 * commit made in the dock's shell empties the list, and a selection left
 * pointing into it is a diff of a file with nothing left to diff.
 */
export function keepSelected(
  selected: Record<string, string | null>,
  rootId: string,
  changes: GitChange[]
): Record<string, string | null> {
  const path = selected[rootId]
  if (!path || changes.some((change) => change.path === path)) return selected
  return { ...selected, [rootId]: null }
}

/**
 * Keeps one root's list of changes up to date, for as long as something is
 * drawing it.
 *
 * A hook rather than an effect in the list, because the list is not the only
 * thing that needs the answer: the Explorer's `Changes` **tab** carries the
 * count, so it has to be read while the tree is the tab on screen. One root —
 * the checkout being worked in — so this is one `git status` and one
 * `git diff --numstat` behind the same debounce the colours already pay for.
 *
 * It watches nothing of its own. `useGitStatus` is already debounced behind the
 * watchers and already reads `.git`, so its answer for this root changing
 * identity is the one honest signal that something here moved — a commit in the
 * dock's shell included. A second set of timers over the same events would be
 * two lists that disagree.
 *
 * Named fields rather than a `FileRoot`, because `shownRootOf` builds a fresh
 * record on every render of the panel: an effect that depended on the object
 * would run `git diff` on every keystroke somewhere else.
 */
export function useWatchChanges(
  root: { id: string; folderId: string; worktreeId: string | null } | null
) {
  const refresh = useChanges((state) => state.refresh)
  const status = useGitStatus((state) =>
    root ? state.byRoot[root.id] : undefined
  )

  const id = root?.id ?? null
  const folderId = root?.folderId ?? null
  const worktreeId = root?.worktreeId ?? null

  useEffect(() => {
    if (id === null || folderId === null) return
    void refresh({ id, folderId, worktreeId })
  }, [refresh, id, folderId, worktreeId, status])
}
