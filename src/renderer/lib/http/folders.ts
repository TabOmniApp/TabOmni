import type { HttpFolder, HttpRequestRecord } from "@shared/api"
import { buildTree, deleteImpact, type TreeNode } from "../tree"
import { joinQuery, splitQuery, substitute } from "./query"

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

/** A folder's own ancestors, root-first, ending with the folder itself. */
function folderChain(
  folderId: string | null,
  folders: HttpFolder[]
): HttpFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const chain: HttpFolder[] = []
  const seen = new Set<string>()
  let current = folderId
  while (current && !seen.has(current)) {
    seen.add(current)
    const folder = byId.get(current)
    if (!folder) break
    chain.push(folder)
    current = folder.parentId
  }
  return chain.reverse()
}

/**
 * The headers a request actually sends: every ancestor folder's own,
 * outermost first, then the request's — so a request's header always wins
 * over an inherited one of the same name, and a deeper folder wins over a
 * shallower one. Mirrors the substitution `enabledHeaders` (store.ts) does
 * for a request with no folder at all.
 */
export function resolveHeaders(
  request: HttpRequestRecord,
  folders: HttpFolder[],
  variables: Record<string, string>
): { name: string; value: string }[] {
  const chain = folderChain(request.folderId, folders)
  const all = [...chain.flatMap((folder) => folder.headers), ...request.headers]
  const byName = new Map<string, { name: string; value: string }>()
  for (const header of all) {
    if (!header.enabled || header.name.trim() === "") continue
    const name = substitute(header.name.trim(), variables)
    byName.set(name.toLowerCase(), {
      name,
      value: substitute(header.value, variables),
    })
  }
  return [...byName.values()]
}

/**
 * A request's URL with its ancestor folders' default params filled in —
 * only for a name the request's own query string doesn't already have, so a
 * request always wins over an inherited default.
 */
export function withFolderParams(
  url: string,
  folderId: string | null,
  folders: HttpFolder[]
): string {
  const defaults = folderChain(folderId, folders)
    .flatMap((folder) => folder.params)
    .filter((param) => param.enabled && param.name.trim() !== "")
  if (defaults.length === 0) return url

  const { base, params, hash } = splitQuery(url)
  const present = new Set(params.map((param) => param.name))
  const extra = defaults
    .filter((param) => !present.has(param.name.trim()))
    .map((param) => ({ name: param.name.trim(), value: param.value }))
  if (extra.length === 0) return url

  return joinQuery(base, [...params, ...extra], hash)
}
