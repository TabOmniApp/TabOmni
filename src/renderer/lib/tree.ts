/**
 * The tree two sidebars draw: folders that nest, and items filed under them.
 *
 * The API panel had all of this to itself until the Notes panel wanted the same
 * shape — the same nesting, the same cycle guard on a drag, the same "what does
 * deleting this take with it". Copying it would have been the third time this
 * codebase learned that lesson (see `SideRow` and `PanelHeader`), so it is
 * generic over the two records instead: a folder is anything with a `parentId`,
 * an item anything with a `folderId`, and each panel keeps its own types.
 *
 * Nothing here touches the DOM or a store, which is what lets `test/tree.ts`
 * ask about it without a renderer.
 */

/** A node that nests: it names the folder it sits in, or null at the top. */
export type TreeFolder = { id: string; parentId: string | null }

/** A leaf filed under one of those folders, or null at the top. */
export type TreeItem = { id: string; folderId: string | null }

export type TreeNode<F extends TreeFolder, I extends TreeItem> =
  | { type: "folder"; folder: F; children: TreeNode<F, I>[] }
  | { type: "item"; item: I }

/**
 * Groups folders and items by parent, folders first.
 *
 * Order within a group is left as given — creation order, the same as each
 * panel's flat list before it had folders at all — rather than resorted
 * alphabetically, so adding a folder never reshuffles a collection somebody
 * has already arranged.
 */
export function buildTree<F extends TreeFolder, I extends TreeItem>(
  folders: F[],
  items: I[]
): TreeNode<F, I>[] {
  function childrenOf(parentId: string | null): TreeNode<F, I>[] {
    const childFolders: TreeNode<F, I>[] = folders
      .filter((folder) => (folder.parentId ?? null) === parentId)
      .map((folder) => ({
        type: "folder",
        folder,
        children: childrenOf(folder.id),
      }))
    const childItems: TreeNode<F, I>[] = items
      .filter((item) => (item.folderId ?? null) === parentId)
      .map((item) => ({ type: "item", item }))
    return [...childFolders, ...childItems]
  }
  return childrenOf(null)
}

/** Every folder, paired with how deep it sits — for a flat picker where
 * indentation stands in for nesting, a folder always listed before its own
 * children. */
export function flattenFolders<F extends TreeFolder>(
  folders: F[]
): { folder: F; depth: number }[] {
  const out: { folder: F; depth: number }[] = []
  function walk(parentId: string | null, depth: number) {
    for (const folder of folders.filter(
      (candidate) => (candidate.parentId ?? null) === parentId
    )) {
      out.push({ folder, depth })
      walk(folder.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** `id` itself, plus every folder nested under it at any depth. */
export function descendantFolderIds(
  id: string,
  folders: TreeFolder[]
): Set<string> {
  const result = new Set<string>([id])
  let added = true
  while (added) {
    added = false
    for (const folder of folders) {
      if (
        folder.parentId &&
        result.has(folder.parentId) &&
        !result.has(folder.id)
      ) {
        result.add(folder.id)
        added = true
      }
    }
  }
  return result
}

/** Whether `nodeId` is `ancestorId` itself, or nested anywhere under it — the
 * cycle guard for a drag-and-drop reparent: a folder can't be dropped into
 * its own subtree. */
export function isDescendant(
  nodeId: string,
  ancestorId: string,
  folders: TreeFolder[]
): boolean {
  return descendantFolderIds(ancestorId, folders).has(nodeId)
}

/** What deleting a folder would take with it, for the confirmation dialog. */
export function deleteImpact(
  id: string,
  folders: TreeFolder[],
  items: TreeItem[]
): { folderCount: number; itemCount: number } {
  const ids = descendantFolderIds(id, folders)
  return {
    folderCount: ids.size - 1,
    itemCount: items.filter((item) => ids.has(item.folderId ?? "")).length,
  }
}
