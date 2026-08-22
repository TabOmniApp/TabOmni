import type { WorkspaceFolder, WorktreeRecord } from "@shared/api"

import { useProjects } from "../projects"
import { useStudio } from "../store"
import { useWorktrees } from "../worktree/store"
import { isInside } from "./paths"

/**
 * A directory the Explorer draws a tree under: a workspace folder, or one of
 * the `git worktree` checkouts made of it.
 *
 * The checkouts are roots rather than rows inside their project because they
 * are not inside it — they live under `~/.tabomni/workspace/worktrees/`, so
 * that removing them all leaves a project's own directory untouched. A tree
 * that showed them where they are would show them nowhere near the project
 * they belong to, so the tree files them under it and this is the record that
 * says which is which.
 *
 * `id` is `worktreeId ?? folderId`, the same key the dock's shells use for a
 * place, and for the same reason: a checkout and the project it was cut from
 * are two directories with two branches and two sets of uncommitted work, and
 * everything keyed by "where" has to tell them apart.
 */
export type FileRoot = {
  id: string
  folderId: string
  /** Null for the folder itself. */
  worktreeId: string | null
  path: string
  /** The folder's name, or the checkout's branch — what the row says. */
  label: string
}

/**
 * Every root, folders first and each folder's checkouts after it.
 *
 * Pure, and the order is the tree's: a checkout is a copy of a project, so it
 * reads under the project rather than beside it. Tested in `test/file-roots.ts`.
 */
export function fileRootsOf(
  folders: WorkspaceFolder[],
  worktrees: WorktreeRecord[]
): FileRoot[] {
  return folders.flatMap((folder) => [
    {
      id: folder.id,
      folderId: folder.id,
      worktreeId: null,
      path: folder.path,
      label: folder.name,
    },
    ...worktrees
      .filter((worktree) => worktree.folderId === folder.id)
      .map((worktree) => ({
        id: worktree.id,
        folderId: worktree.folderId,
        worktreeId: worktree.id,
        path: worktree.path,
        label: worktree.branch,
      })),
  ])
}

/**
 * Which root a path is in, or null for one in none of them.
 *
 * The longest match wins, the way `serverFor` in `main/tsserver.ts` picks a
 * tsserver: a folder pointed at a directory that already holds another folder
 * is a workspace somebody is allowed to have, and the inner one is the better
 * answer for a file inside it.
 */
export function rootOfPath(
  roots: FileRoot[],
  filePath: string
): FileRoot | null {
  let best: FileRoot | null = null
  for (const root of roots) {
    if (!isInside(root.path, filePath)) continue
    if (best === null || root.path.length > best.path.length) best = root
  }
  return best
}

/**
 * The one root the Explorer draws: the project being worked in, in the checkout
 * it was left in.
 *
 * Deliberately one, and deliberately not `fileRootsOf` above.
 *
 * Every project at once was what this used to be, and every *checkout* at once
 * was the attempt before that — which is three copies of one repository stacked
 * in one column, each with its own `src/` and its own `package.json`. The
 * question somebody has open is not "which copies exist" but "the files of the
 * thing I am working on", and the thing they are working on is the row they
 * clicked in the left column. The same choice the dock's Terminal makes: one
 * shell for the place you are in, not one per place there is.
 *
 * Falls back rather than drawing nothing: the first project when none has been
 * clicked yet or the remembered one has left the workspace, and a project's own
 * working tree when the checkout it was left in has been removed. Null only for
 * a workspace with no folders at all, which is the empty tree.
 *
 * `fileRootsOf` is still every root there is, and that is the right list for
 * everything that is not the tree: what may be read, which tabs survive, which
 * checkout a path belongs to. Switching project or branch must not close the
 * tabs of the one being left.
 */
export function shownRootOf(
  folders: WorkspaceFolder[],
  worktrees: WorktreeRecord[],
  checkout: Record<string, string>,
  activeFolderId: string | null
): FileRoot | null {
  const folder =
    folders.find((candidate) => candidate.id === activeFolderId) ?? folders[0]
  if (folder === undefined) return null

  // Checked against the list rather than trusted: a checkout removed while the
  // app was shut leaves an id behind, and the project is the right answer for
  // it rather than an empty tree.
  const chosen = worktrees.find(
    (worktree) =>
      worktree.id === checkout[folder.id] && worktree.folderId === folder.id
  )

  return chosen
    ? {
        id: chosen.id,
        folderId: folder.id,
        worktreeId: chosen.id,
        path: chosen.path,
        label: chosen.branch,
      }
    : {
        id: folder.id,
        folderId: folder.id,
        worktreeId: null,
        path: folder.path,
        label: folder.name,
      }
}

/** The roots as the two stores currently hold them — for the callers that are
 * not rendering and so have nothing to subscribe with. */
export function fileRoots(): FileRoot[] {
  return fileRootsOf(
    useStudio.getState().folders,
    useWorktrees.getState().worktrees
  )
}

/** What the tree is drawing right now, read through the stores. */
export function shownRoot(): FileRoot | null {
  const { checkout, activeFolderId } = useProjects.getState()
  return shownRootOf(
    useStudio.getState().folders,
    useWorktrees.getState().worktrees,
    checkout,
    activeFolderId
  )
}

/** The root a path is in, read through the stores. */
export function rootOf(filePath: string): FileRoot | null {
  return rootOfPath(fileRoots(), filePath)
}
