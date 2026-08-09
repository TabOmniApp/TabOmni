/**
 * The sidebar's folders.
 *
 * The API panel keeps its folders as records in `folders.json`, with a
 * `parentId` on each. A spec's folder is not that and must not become that: a
 * spec is a file in the repository, so its folder is a real directory, and the
 * tree below is *derived* from the paths rather than stored beside them. A
 * second opinion about where a spec lives is a second thing to keep in step
 * with `git mv`.
 *
 * One consequence is worth stating plainly: git does not track an empty
 * directory. A folder made here exists on this machine and is real, but until
 * a spec is put in it, it is not something a teammate will see — which is why
 * `empty` is passed in separately rather than being something this can work
 * out from the files.
 */

export type SpecNode =
  | {
      kind: "folder"
      /** Project-relative, no trailing slash: `docs/specs/auth`. */
      path: string
      /** What the row shows — several segments when a chain was compacted. */
      label: string
      children: SpecNode[]
    }
  | { kind: "spec"; path: string }

type Folder = {
  path: string
  label: string
  folders: Map<string, Folder>
  specs: string[]
}

function folder(path: string, label: string): Folder {
  return { path, label, folders: new Map(), specs: [] }
}

function dirOf(path: string): string {
  const cut = path.lastIndexOf("/")
  return cut === -1 ? "" : path.slice(0, cut)
}

/**
 * The folders a set of paths implies, as a tree, with the specs in them.
 *
 * One row per directory, nested — the same shape the API panel's folders take.
 * An earlier version compacted a chain of folders holding nothing but one more
 * folder into a single row, so `docs` containing only `specs` read as
 * `docs/specs`. It saved a line and cost far more than that: the folder that
 * was swallowed had no row of its own, so it could not be renamed, deleted or
 * dropped onto, and the row that remained was labelled with both names while
 * acting on only the inner one. A row is a directory.
 */
export function buildSpecTree(
  specs: string[],
  empty: string[] = []
): SpecNode[] {
  const root = folder("", "")

  const reach = (dir: string): Folder => {
    let node = root
    if (dir === "") return node
    let walked = ""
    for (const segment of dir.split("/")) {
      walked = walked ? `${walked}/${segment}` : segment
      let next = node.folders.get(segment)
      if (!next) {
        next = folder(walked, segment)
        node.folders.set(segment, next)
      }
      node = next
    }
    return node
  }

  for (const dir of empty) reach(dir)
  for (const spec of [...specs].sort((a, b) => a.localeCompare(b))) {
    reach(dirOf(spec)).specs.push(spec)
  }

  return childrenOf(root)
}

function childrenOf(node: Folder): SpecNode[] {
  const folders = [...node.folders.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((child): SpecNode => ({
      kind: "folder",
      path: child.path,
      label: child.label,
      children: childrenOf(child),
    }))

  // Folders above specs, each group alphabetical, the way a file tree reads.
  return [
    ...folders,
    ...node.specs.map((path): SpecNode => ({ kind: "spec", path })),
  ]
}

/** Every folder path in a tree, for restoring what was collapsed. */
export function folderPaths(nodes: SpecNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "folder" ? [node.path, ...folderPaths(node.children)] : []
  )
}

/**
 * Whether `path` is inside `dir`.
 *
 * The trailing slash is the whole point: `docs/spec` is not inside
 * `docs/specs`, and a folder rename that thought otherwise would drag another
 * folder's specs along with it.
 */
export function isInside(path: string, dir: string): boolean {
  return dir === "" || path.startsWith(`${dir}/`)
}

/** The same path with one enclosing folder renamed. */
export function movedInto(path: string, from: string, to: string): string {
  if (from === to || !isInside(path, from)) return path
  return from === "" ? `${to}/${path}` : `${to}${path.slice(from.length)}`
}

/**
 * Whether a dragged row may be dropped on a folder.
 *
 * A folder cannot go into itself or into anything under it: on disk that is a
 * rename of a directory into its own child, which is a move whose destination
 * travels with the source. A spec has no subtree to worry about, so the only
 * drop worth refusing is the one back into the folder it already sits in —
 * which would otherwise be a rename onto its own path.
 */
export function canMoveInto(
  item: { kind: "spec" | "folder"; path: string },
  dir: string
): boolean {
  if (item.kind === "folder") {
    return dir !== item.path && !isInside(dir, item.path)
  }
  const cut = item.path.lastIndexOf("/")
  return (cut === -1 ? "" : item.path.slice(0, cut)) !== dir
}
