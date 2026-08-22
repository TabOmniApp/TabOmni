import { create } from "zustand"

import type { WorktreeRecord } from "@shared/api"

/**
 * The worktrees of the workspace's folders.
 *
 * A worktree is a second checkout of a project on a branch of its own, made by
 * `git worktree` — so two agents can work on one repository without standing on
 * each other's files, index and branch. It is the primitive Conductor is built
 * on, and using git's own rather than copying a directory is what makes it cheap:
 * one object store, one clone, however many checkouts.
 *
 * Thin on purpose. Everything real happens in `main/git.ts`; this holds the list
 * and the last error a dialog has to show.
 */
type WorktreeState = {
  worktrees: WorktreeRecord[]
  loading: boolean
  /**
   * Whether the list has been read at least once.
   *
   * The Explorer prunes what it holds against the roots it is allowed to read,
   * and a checkout's files are only inside one of those once this is true — so
   * a tab restored into a worktree before the first read would be closed on the
   * way in. True even when the read failed: an unreadable list is an answer,
   * and a tree that waits forever for one is worse than a tree with no
   * checkouts in it.
   */
  loaded: boolean

  refresh: () => Promise<void>
  /**
   * Adds one, and resolves to the error git gave when it refused.
   *
   * Resolves rather than throws because the common failures are answers: a
   * branch name already taken, a `from` that is not a commit. The caller is a
   * dialog and has somewhere to put them.
   */
  create: (
    folderId: string,
    branch: string,
    from: string
  ) => Promise<string | null>
  remove: (id: string) => Promise<void>
}

export const useWorktrees = create<WorktreeState>((set, get) => ({
  worktrees: [],
  loading: false,
  loaded: false,

  async refresh() {
    set({ loading: true })
    try {
      set({
        worktrees: await window.desktop.listWorktrees(),
        loading: false,
        loaded: true,
      })
    } catch (error) {
      console.error("Could not read the worktrees", error)
      set({ loading: false, loaded: true })
    }
  },

  async create(folderId, branch, from) {
    const result = await window.desktop
      .createWorktree(folderId, branch.trim(), from)
      .catch((error: unknown) => ({
        error: error instanceof Error ? error.message : String(error),
      }))

    if ("error" in result) return result.error

    set({ worktrees: [...get().worktrees, result.worktree] })
    return null
  },

  async remove(id) {
    await window.desktop.removeWorktree(id).catch((error: unknown) => {
      console.error("Could not remove the worktree", error)
    })
    // Dropped from the list either way: `listWorktrees` in main reconciles
    // against git on every read, so a record it could not remove is gone from
    // the next one anyway.
    set({ worktrees: get().worktrees.filter((entry) => entry.id !== id) })
  },
}))

/** One folder's worktrees, oldest first — the order they were made, which is
 * the order somebody remembers making them in. */
export function worktreesOf(
  worktrees: WorktreeRecord[],
  folderId: string
): WorktreeRecord[] {
  return worktrees.filter((entry) => entry.folderId === folderId)
}
