import { useEffect, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  ChevronDown,
  ChevronRight,
  Copy,
  CopyPlus,
  FileText,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react"

import { useStudio } from "@/lib/store"
import { specName, SPEC_SUFFIX } from "@/lib/spec/schema"
import { draftOf, isDirty, useSpecs } from "@/lib/spec/store"
import { buildSpecTree, canMoveInto, type SpecNode } from "@/lib/spec/tree"
import { dirname } from "@/lib/runtime/tree"
import { IconButton } from "../icon-button"
import { PanelHeader } from "../panel-header"
import { SideRow } from "../side-row"

/** The folder holding a folder, or "" for one at the repository root. */
function parentOf(dir: string): string {
  const cut = dir.lastIndexOf("/")
  return cut === -1 ? "" : dir.slice(0, cut)
}

/** Where a first spec goes when the project has none to copy a location from. */
const DEFAULT_DIR = "docs/specs"

/**
 * The project's specs, grouped by the directory they sit in.
 *
 * The list is the file tree filtered rather than a registry of its own: a spec
 * is a file in the repository, so one dropped in by a teammate's pull request
 * has to appear here without this panel having been told about it.
 */
export function SpecList() {
  const projectId = useStudio((state) => state.projectId)
  const paths = useSpecs((state) => state.paths)
  const selectedPath = useSpecs((state) => state.selectedPath)
  const drafts = useSpecs((state) => state.drafts)
  const open = useSpecs((state) => state.open)
  const refresh = useSpecs((state) => state.refresh)
  const rename = useSpecs((state) => state.rename)
  const duplicate = useSpecs((state) => state.duplicate)
  const remove = useSpecs((state) => state.remove)
  const emptyFolders = useSpecs((state) => state.emptyFolders)
  const createFolder = useSpecs((state) => state.createFolder)
  const renameFolder = useSpecs((state) => state.renameFolder)
  const removeFolder = useSpecs((state) => state.removeFolder)

  /** Where `New spec` will put it — the folder that was right-clicked, or the
   * panel's own default when the button in the header was used. */
  const [creating, setCreating] = useState<string | null>(null)
  /**
   * What the right-click menu is about — a spec, a folder, or neither.
   *
   * One piece of state rather than two, because the menu is one menu: which
   * items it offers follows from the kind, and two flags could both be set.
   */
  const [menu, setMenu] = useState<{
    kind: "spec" | "folder"
    path: string
  } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null)
  const [newFolderIn, setNewFolderIn] = useState<string | null>(null)
  /** What is being dragged, and the folder it is currently over. */
  const [dragging, setDragging] = useState<{
    kind: "spec" | "folder"
    path: string
  } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [dropRoot, setDropRoot] = useState(false)
  /** Folders the user has closed. Collapsed rather than expanded is remembered
   * because a tree opens fully expanded and most stay that way. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [refreshing, setRefreshing] = useState(false)

  // The first load: the store fills itself when the project changes, but the
  // panel can also be opened on a project that was already there.
  useEffect(() => {
    if (projectId && paths.length === 0) void refresh()
    // Only when the project changes — a project with genuinely no specs must
    // not re-walk its tree on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  /**
   * One handler for the whole list rather than one per row.
   *
   * Both would fire — a row's own handler, then the container's as the event
   * bubbles — and the container's would run second and win. That is exactly
   * what left every item in the menu disabled: the row set the path, and the
   * list cleared it again before the menu opened. Reading `event.target` here
   * instead is what `request-list.tsx` does, and it needs nothing stopped or
   * ordered.
   */
  function onListContextMenu(event: React.MouseEvent) {
    const row = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-spec-path], [data-folder-path]"
    )
    const spec = row?.dataset.specPath
    const folder = row?.dataset.folderPath
    // A right-click that misses every row is about the list rather than about
    // anything in it, and the menu's items grey out for it.
    if (spec) setMenu({ kind: "spec", path: spec })
    else if (folder) setMenu({ kind: "folder", path: folder })
    else setMenu(null)
  }

  function endDrag() {
    setDragging(null)
    setDropTarget(null)
    setDropRoot(false)
  }

  function canDropOn(dir: string): boolean {
    return dragging !== null && canMoveInto(dragging, dir)
  }

  function drop(dir: string) {
    if (!dragging || !canDropOn(dir)) return endDrag()

    if (dragging.kind === "folder") {
      const name = dragging.path.slice(dragging.path.lastIndexOf("/") + 1)
      void renameFolder(dragging.path, dir ? `${dir}/${name}` : name)
    } else {
      void rename(dragging.path, dir, specName(dragging.path))
    }
    endDrag()
  }

  function onRowDragStart(item: { kind: "spec" | "folder"; path: string }) {
    return (event: React.DragEvent) => {
      // A folder's rows nest its children's, so without this a child's drag
      // would bubble into the parent's handler and replace what was grabbed.
      event.stopPropagation()
      setDragging(item)
      // Something has to be on the transfer for a drag to start at all in
      // Chromium, the same reason `tab-strip.tsx` sets it.
      event.dataTransfer.setData("text/plain", item.path)
      event.dataTransfer.effectAllowed = "move"
    }
  }

  function onFolderDragOver(dir: string) {
    return (event: React.DragEvent) => {
      if (!canDropOn(dir)) return
      event.preventDefault()
      event.stopPropagation()
      setDropTarget(dir)
    }
  }

  function toggle(path: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  /** One row per node, folders first, drawn depth by depth. */
  function renderNodes(nodes: SpecNode[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      if (node.kind === "spec") {
        return (
          // The path is carried by this wrapper rather than by the row itself:
          // `SideRow` takes a fixed list of props and forwards nothing else, so
          // a `data-` attribute put on it never reaches the DOM — and
          // TypeScript does not catch that, because a JSX attribute with a
          // hyphen in its name is exempt from prop checking.
          <div
            key={node.path}
            data-spec-path={node.path}
            draggable
            onDragStart={onRowDragStart({ kind: "spec", path: node.path })}
            onDragEnd={endDrag}
          >
            <SideRow
              active={node.path === selectedPath}
              indent={depth}
              title={node.path}
              onClick={() => open(node.path)}
            >
              <FileText className="size-3.5 shrink-0" />
              <span className="truncate">{specName(node.path)}</span>
              {isDirty(draftOf(drafts, node.path)) && (
                <span
                  aria-label="Unsaved changes"
                  className="ml-auto size-1.5 shrink-0 rounded-full bg-foreground/50"
                />
              )}
            </SideRow>
          </div>
        )
      }

      const shut = collapsed.has(node.path)
      return (
        <div key={node.path}>
          <div
            data-folder-path={node.path}
            draggable
            onDragStart={onRowDragStart({ kind: "folder", path: node.path })}
            onDragEnd={endDrag}
            onDragOver={onFolderDragOver(node.path)}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDropTarget(null)
              }
            }}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              drop(node.path)
            }}
            className={cn(
              "rounded-md",
              dropTarget === node.path && "bg-accent/60 ring-1 ring-primary"
            )}
          >
            <SideRow
              indent={depth}
              title={node.path}
              onClick={() => toggle(node.path)}
            >
              {shut ? (
                <ChevronRight className="size-3.5 shrink-0" />
              ) : (
                <ChevronDown className="size-3.5 shrink-0" />
              )}
              <Folder className="size-3.5 shrink-0" />
              <span className="truncate">{node.label}</span>
            </SideRow>
          </div>
          {!shut && renderNodes(node.children, depth + 1)}
        </div>
      )
    })
  }

  const tree = buildSpecTree(paths, emptyFolders)

  /** Beside whatever specs the project already has, so a repository that has
   * settled on a location keeps using it. */
  const defaultDir = paths[0] ? dirname(paths[0]) : DEFAULT_DIR

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Specs">
        <IconButton
          label="Reload specs"
          disabled={!projectId || refreshing}
          onClick={() => {
            setRefreshing(true)
            void refresh().finally(() => setRefreshing(false))
          }}
        >
          <RefreshCw />
        </IconButton>
        <IconButton
          label="New folder"
          disabled={!projectId}
          onClick={() => setNewFolderIn("")}
        >
          <FolderPlus />
        </IconButton>
        <IconButton
          label="New spec"
          disabled={!projectId}
          onClick={() => setCreating(defaultDir)}
        >
          <Plus />
        </IconButton>
      </PanelHeader>

      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              className="min-h-0 flex-1 overflow-y-auto py-1"
              onContextMenu={onListContextMenu}
            />
          }
        >
          {paths.length === 0 ? (
            <div className="p-3">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileText />
                  </EmptyMedia>
                  <EmptyTitle>No specs yet</EmptyTitle>
                  <EmptyDescription>
                    A spec is a <code className="font-mono">{SPEC_SUFFIX}</code>{" "}
                    file in this repository, committed beside the code it
                    describes.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          ) : (
            renderNodes(tree, 0)
          )}

          {dragging && (
            <div
              onDragOver={(event) => {
                if (!canDropOn("")) return
                event.preventDefault()
                setDropRoot(true)
              }}
              onDragLeave={() => setDropRoot(false)}
              onDrop={(event) => {
                event.preventDefault()
                drop("")
              }}
              className={cn(
                "m-2 rounded-md border border-dashed p-2 text-center text-[0.65rem] text-muted-foreground",
                dropRoot && "border-primary bg-accent/40 text-foreground"
              )}
            >
              Drop here to move to the top level
            </div>
          )}
        </ContextMenuTrigger>

        <ContextMenuContent>
          {/* Three targets, not two: a right-click on the empty part of the
              list is about the list itself, and offering the spec menu with
              everything greyed out says only that nothing can be done. */}
          {menu === null && (
            <>
              <ContextMenuItem onClick={() => setCreating(defaultDir)}>
                <Plus />
                New spec…
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setNewFolderIn("")}>
                <FolderPlus />
                New folder…
              </ContextMenuItem>
            </>
          )}

          {menu?.kind === "folder" && (
            <>
              <ContextMenuItem onClick={() => setCreating(menu.path)}>
                <Plus />
                New spec here…
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setNewFolderIn(menu.path)}>
                <FolderPlus />
                New folder inside…
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setRenamingFolder(menu.path)}>
                <Pencil />
                Rename folder…
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() => setDeletingFolder(menu.path)}
              >
                <Trash2 />
                Delete folder
              </ContextMenuItem>
            </>
          )}

          {menu?.kind === "spec" && (
            <>
              <ContextMenuItem onClick={() => setRenaming(menu.path)}>
                <Pencil />
                Rename or move…
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setDuplicating(menu.path)}>
                <CopyPlus />
                Duplicate…
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => void navigator.clipboard.writeText(menu.path)}
              >
                <Copy />
                Copy path
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() => setDeleting(menu.path)}
              >
                <Trash2 />
                Delete
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {newFolderIn !== null && (
        <NameDialog
          title="New folder"
          action="Create"
          suffix=""
          dir={newFolderIn}
          initial=""
          onClose={() => setNewFolderIn(null)}
          onSubmit={(name) =>
            createFolder(newFolderIn ? `${newFolderIn}/${name}` : name)
          }
        />
      )}

      {renamingFolder && (
        <NameDialog
          title="Rename folder"
          action="Rename"
          suffix=""
          dir={parentOf(renamingFolder)}
          initial={renamingFolder.slice(renamingFolder.lastIndexOf("/") + 1)}
          onClose={() => setRenamingFolder(null)}
          onSubmit={(name) => {
            const parent = parentOf(renamingFolder)
            return renameFolder(
              renamingFolder,
              parent ? `${parent}/${name}` : name
            )
          }}
        />
      )}

      <AlertDialog
        open={deletingFolder !== null}
        onOpenChange={(next) => !next && setDeletingFolder(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this folder?</AlertDialogTitle>
            <AlertDialogDescription>
              <code className="font-mono">{deletingFolder}</code> and everything
              in it — every spec and every screenshot — is deleted from the
              repository. If it has been committed, git still has it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deletingFolder) void removeFolder(deletingFolder)
                setDeletingFolder(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {renaming && (
        <NameDialog
          title="Rename spec"
          action="Rename"
          dir={dirname(renaming)}
          movable
          initial={specName(renaming)}
          onClose={() => setRenaming(null)}
          onSubmit={(name, dir) => rename(renaming, dir, name)}
        />
      )}

      {duplicating && (
        <NameDialog
          title="Duplicate spec"
          action="Duplicate"
          dir={dirname(duplicating)}
          movable
          initial={`${specName(duplicating)} copy`}
          onClose={() => setDuplicating(null)}
          onSubmit={(name, dir) => duplicate(duplicating, dir, name)}
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this spec?</AlertDialogTitle>
            {/* Its screenshots go with it: they live in a folder named after
                the spec and are of no use to anything else. Both are in the
                repository, so git is the way back. */}
            <AlertDialogDescription>
              <code className="font-mono">{deleting}</code> and its screenshots
              are deleted from the repository. If it has been committed, git
              still has it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) void remove(deleting)
                setDeleting(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {creating !== null && (
        <NewSpecDialog dir={creating} onClose={() => setCreating(null)} />
      )}
    </div>
  )
}

function NewSpecDialog({ dir, onClose }: { dir: string; onClose: () => void }) {
  const create = useSpecs((state) => state.create)
  const [name, setName] = useState("")
  const [folder, setFolder] = useState(dir)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const trimmed = name.trim()

  async function submit() {
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await create(folder.trim(), trimmed)
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>New spec</DialogTitle>
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">Folder</span>
            <Input
              value={folder}
              placeholder={DEFAULT_DIR}
              onChange={(event) => setFolder(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">Name</span>
            <Input
              autoFocus
              value={name}
              placeholder="FR_008"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit()
              }}
            />
          </label>
          <p className="font-mono text-[0.65rem] break-all text-muted-foreground">
            {folder.trim() ? `${folder.trim().replace(/\/+$/, "")}/` : ""}
            {trimmed || "…"}
            {SPEC_SUFFIX}
          </p>
          {error && (
            <p className="font-mono text-xs text-destructive">{error}</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!trimmed || busy} onClick={() => void submit()}>
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Asking for a name — for a rename, and for a duplicate.
 *
 * One component for both because the question is the same one and so is the
 * way it can fail: a name that is already taken. The caller's `onSubmit` is
 * what differs, and it is the thing that reports that.
 */
function NameDialog({
  title,
  action,
  dir,
  movable = false,
  suffix = SPEC_SUFFIX,
  initial,
  onClose,
  onSubmit,
}: {
  title: string
  action: string
  /** The folder the result lands in. Editable when `movable`, which is what
   * makes renaming a spec and moving it to another folder one operation. */
  dir: string
  movable?: boolean
  /** `.spec.json` when naming a spec, nothing when naming a folder. */
  suffix?: string
  initial: string
  onClose: () => void
  onSubmit: (name: string, dir: string) => Promise<void>
}) {
  const [name, setName] = useState(initial)
  const [folder, setFolder] = useState(dir)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const trimmed = name.trim()

  async function submit() {
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed, folder.trim())
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{title}</DialogTitle>
        <div className="space-y-3">
          {movable && (
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">Folder</span>
              <Input
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
              />
            </label>
          )}
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit()
            }}
          />
          <p className="font-mono text-[0.65rem] break-all text-muted-foreground">
            {folder.trim() ? `${folder.trim().replace(/\/+$/, "")}/` : ""}
            {trimmed || "…"}
            {suffix}
          </p>
          {error && (
            <p className="font-mono text-xs text-destructive">{error}</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!trimmed || busy} onClick={() => void submit()}>
            {action}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
