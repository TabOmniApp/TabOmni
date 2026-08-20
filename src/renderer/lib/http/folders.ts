import type { HttpFolder, HttpRequestRecord } from "@shared/api"
import { buildTree, deleteImpact, type TreeNode } from "../tree"

export { descendantFolderIds, flattenFolders, isDescendant } from "../tree"

/** One entry in the request list's tree — a folder with its own children, or
 * a request sitting directly under whatever this node's parent is. */
export type FolderTreeNode = TreeNode<HttpFolder, HttpRequestRecord>

/** The tree the sidebar renders. */
export function buildFolderTree(
  folders: HttpFolder[],
  requests: HttpRequestRecord[]
): FolderTreeNode[] {
  return buildTree(folders, requests)
}

/** What deleting a folder would take with it, for the confirmation dialog. */
export function folderDeleteImpact(
  id: string,
  folders: HttpFolder[],
  requests: HttpRequestRecord[]
): { folderCount: number; requestCount: number } {
  const { folderCount, itemCount } = deleteImpact(id, folders, requests)
  return { folderCount, requestCount: itemCount }
}

/*
 * Resolving a request — its ancestors' headers and params, its `{{variables}}`
 * — moved to `@shared/http-request` when the MCP server started sending the
 * workspace's saved requests from the main process. Re-exported here because
 * this is still where the API panel asks how a folder affects a request; what
 * stays above is the part that is genuinely the panel's, the tree and the
 * delete count.
 */
export { resolveHeaders, withFolderParams } from "@shared/http-request"
