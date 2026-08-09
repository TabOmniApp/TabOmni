import type { HttpFolder, HttpRequestRecord } from "@shared/api"
import { joinQuery, splitQuery, substitute } from "./query"

/** One entry in the request list's tree — a folder with its own children, or
 * a request sitting directly under whatever this node's parent is. */
export type FolderTreeNode =
  | { type: "folder"; folder: HttpFolder; children: FolderTreeNode[] }
  | { type: "request"; request: HttpRequestRecord }

/**
 * Groups folders and requests by parent, folders first — the tree the
 * sidebar renders. Order within a group is left as given (creation order,
 * same as the flat list before folders existed) rather than resorted
 * alphabetically, so adding folders never reshuffles a collection someone
 * already arranged.
 */
export function buildFolderTree(
  folders: HttpFolder[],
  requests: HttpRequestRecord[]
): FolderTreeNode[] {
  function childrenOf(parentId: string | null): FolderTreeNode[] {
    const childFolders: FolderTreeNode[] = folders
      .filter((folder) => (folder.parentId ?? null) === parentId)
      .map((folder) => ({
        type: "folder",
        folder,
        children: childrenOf(folder.id),
      }))
    const childRequests: FolderTreeNode[] = requests
      .filter((request) => (request.folderId ?? null) === parentId)
      .map((request) => ({ type: "request", request }))
    return [...childFolders, ...childRequests]
  }
  return childrenOf(null)
}

/** Every folder, paired with how deep it sits — for a flat picker where
 * indentation stands in for nesting, a folder always listed before its own
 * children. */
export function flattenFolders(
  folders: HttpFolder[]
): { folder: HttpFolder; depth: number }[] {
  const out: { folder: HttpFolder; depth: number }[] = []
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
  folders: HttpFolder[]
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
  folders: HttpFolder[]
): boolean {
  return descendantFolderIds(ancestorId, folders).has(nodeId)
}

/** What deleting a folder would take with it, for the confirmation dialog. */
export function folderDeleteImpact(
  id: string,
  folders: HttpFolder[],
  requests: HttpRequestRecord[]
): { folderCount: number; requestCount: number } {
  const ids = descendantFolderIds(id, folders)
  return {
    folderCount: ids.size - 1,
    requestCount: requests.filter((request) => ids.has(request.folderId ?? ""))
      .length,
  }
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
