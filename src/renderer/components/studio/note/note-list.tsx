import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type ReactNode,
} from "react"
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
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
  CopyPlus,
  FileText,
  Folder,
  FolderPlus,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"

import type { NoteFolder, NoteRecord } from "@shared/api"
import { useNotes } from "@/lib/note/store"
import {
  buildTree,
  deleteImpact,
  isDescendant,
  type TreeNode,
} from "@/lib/tree"
import { IconButton } from "../icon-button"
import { PanelHeader } from "../panel-header"
import { RenameDialog } from "../db/rename-dialog"
import { SideRow } from "../side-row"

/** What the context menu was opened on — a note, a folder row, or the empty
 * area of the list itself. */
type MenuTarget =
  | { kind: "note"; note: NoteRecord }
  | { kind: "folder"; folder: NoteFolder }
  | { kind: "root" }

type PendingDelete =
  { kind: "note"; note: NoteRecord } | { kind: "folder"; folder: NoteFolder }

/** What's being dragged, for a folder or note row dropped onto a folder (or
 * the root drop zone) to reparent it. */
type DragItem = { kind: "note" | "folder"; id: string }

/**
 * The Notes sidebar: folders and notes, arranged the way the API panel's
 * requests are.
 *
 * Deliberately the same shape as `request-list.tsx` — the same tree, the same
 * right-click menu, the same drag onto a folder — because they are the same
 * gesture in two panels, and a studio where each sidebar files things its own
 * way is four things to learn instead of one.
 */
export function NoteList() {
  const notes = useNotes((state) => state.notes)
  const folders = useNotes((state) => state.folders)
  const selectedId = useNotes((state) => state.selectedId)
  const refresh = useNotes((state) => state.refresh)
  const create = useNotes((state) => state.create)
  const rename = useNotes((state) => state.rename)
  const duplicate = useNotes((state) => state.duplicate)
  const remove = useNotes((state) => state.remove)
  const select = useNotes((state) => state.select)
  const moveToFolder = useNotes((state) => state.moveToFolder)
  const createFolder = useNotes((state) => state.createFolder)
  const renameFolder = useNotes((state) => state.renameFolder)
  const removeFolder = useNotes((state) => state.removeFolder)
  const moveFolder = useNotes((state) => state.moveFolder)

  const [query, setQuery] = useState("")
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null)
  const [renaming, setRenaming] = useState<NoteRecord | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<NoteFolder | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [dropFolderId, setDropFolderId] = useState<string | null>(null)
  const [dropRoot, setDropRoot] = useState(false)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return notes
    return notes.filter((note) => note.name.toLowerCase().includes(needle))
  }, [notes, query])

  const tree = useMemo(() => buildTree(folders, filtered), [folders, filtered])
  const hasAnything = notes.length > 0 || folders.length > 0
  const showNoMatch =
    query.trim() !== "" && filtered.length === 0 && folders.length === 0

  function toggleCollapsed(id: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** One handler for the whole tree rather than one per row — see the same
   * reasoning in `request-list.tsx`: a row's own `onContextMenu` would have to
   * stop the event, and that would stop it reaching the trigger too. */
  function onListContextMenu(event: React.MouseEvent) {
    const target = event.target as HTMLElement
    const noteEl = target.closest<HTMLElement>("[data-note-id]")
    if (noteEl) {
      const note = notes.find(
        (candidate) => candidate.id === noteEl.dataset.noteId
      )
      if (note) {
        setMenuTarget({ kind: "note", note })
        return
      }
    }
    const folderEl = target.closest<HTMLElement>("[data-folder-id]")
    if (folderEl) {
      const folder = folders.find(
        (candidate) => candidate.id === folderEl.dataset.folderId
      )
      if (folder) {
        setMenuTarget({ kind: "folder", folder })
        return
      }
    }
    setMenuTarget({ kind: "root" })
  }

  function endDrag() {
    setDragItem(null)
    setDropFolderId(null)
    setDropRoot(false)
  }

  /** A folder can't be dropped into itself or its own subtree. A note has no
   * subtree to worry about, so it can move into any folder. */
  function canDropOnFolder(folderId: string): boolean {
    if (!dragItem) return false
    if (dragItem.kind === "folder") {
      return !isDescendant(folderId, dragItem.id, folders)
    }
    return true
  }

  function onRowDragStart(item: DragItem) {
    return (event: DragEvent) => {
      // A folder's own `<li>` nests its children's — without this, dragging a
      // child would bubble into the parent's handler and overwrite what was
      // actually grabbed.
      event.stopPropagation()
      setDragItem(item)
      // Something has to be on the transfer for a drag to start at all in
      // Chromium, the same reason `tab-strip.tsx` sets it.
      event.dataTransfer.setData("text/plain", item.id)
      event.dataTransfer.effectAllowed = "move"
    }
  }

  function onFolderDragOver(folderId: string) {
    return (event: DragEvent) => {
      if (!canDropOnFolder(folderId)) return
      event.preventDefault()
      event.stopPropagation()
      setDropFolderId(folderId)
    }
  }

  function onFolderDrop(folderId: string) {
    return (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (dragItem && canDropOnFolder(folderId)) {
        if (dragItem.kind === "folder") moveFolder(dragItem.id, folderId)
        else moveToFolder(dragItem.id, folderId)
      }
      endDrag()
    }
  }

  function onRootDragOver(event: DragEvent) {
    if (!dragItem) return
    event.preventDefault()
    setDropRoot(true)
  }

  function onRootDrop(event: DragEvent) {
    event.preventDefault()
    if (dragItem) {
      if (dragItem.kind === "folder") moveFolder(dragItem.id, null)
      else moveToFolder(dragItem.id, null)
    }
    endDrag()
  }

  function renderNodes(
    nodes: TreeNode<NoteFolder, NoteRecord>[],
    depth: number
  ): ReactNode {
    return nodes.map((node) => {
      if (node.type === "item") {
        const note = node.item
        return (
          <li
            key={note.id}
            data-note-id={note.id}
            draggable
            onDragStart={onRowDragStart({ kind: "note", id: note.id })}
            onDragEnd={endDrag}
          >
            <SideRow
              indent={depth}
              active={note.id === selectedId}
              title={note.name}
              onClick={() => select(note.id)}
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{note.name}</span>
            </SideRow>
          </li>
        )
      }

      const folder = node.folder
      const isCollapsed = collapsed.has(folder.id)
      return (
        <li
          key={folder.id}
          data-folder-id={folder.id}
          draggable
          onDragStart={onRowDragStart({ kind: "folder", id: folder.id })}
          onDragEnd={endDrag}
          onDragOver={onFolderDragOver(folder.id)}
          onDragLeave={() =>
            setDropFolderId((current) =>
              current === folder.id ? null : current
            )
          }
          onDrop={onFolderDrop(folder.id)}
        >
          <SideRow
            indent={depth}
            onClick={() => toggleCollapsed(folder.id)}
            className={cn(
              dropFolderId === folder.id &&
                canDropOnFolder(folder.id) &&
                "ring-1 ring-primary ring-inset"
            )}
          >
            {isCollapsed ? (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{folder.name}</span>
            {node.children.length > 0 && (
              <span className="ml-auto shrink-0 text-[0.65rem] text-muted-foreground tabular-nums">
                {node.children.length}
              </span>
            )}
          </SideRow>
          {!isCollapsed && node.children.length > 0 && (
            <ul>{renderNodes(node.children, depth + 1)}</ul>
          )}
        </li>
      )
    })
  }

  const folderDeleteInfo =
    pendingDelete?.kind === "folder"
      ? deleteImpact(pendingDelete.folder.id, folders, notes)
      : null

  return (
    <ContextMenu>
      <div className="flex h-full flex-col">
        <PanelHeader title="Notes">
          <IconButton label="New note" onClick={() => void create()}>
            <Plus />
          </IconButton>
          <IconButton label="New folder" onClick={() => createFolder(null)}>
            <FolderPlus />
          </IconButton>
        </PanelHeader>

        {hasAnything && (
          <div className="shrink-0 border-b px-2 py-1.5">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter notes…"
              aria-label="Filter notes"
              spellCheck={false}
              className="h-7 border-transparent bg-muted/60 text-xs md:text-xs"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto py-1">
          <ContextMenuTrigger
            render={
              <div
                className="flex min-h-full flex-col"
                onContextMenu={onListContextMenu}
              />
            }
          >
            {!hasAnything ? (
              <Empty className="p-4">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <NotebookPen />
                  </EmptyMedia>
                  <EmptyTitle>No notes</EmptyTitle>
                  <EmptyDescription className="text-xs">
                    Somewhere to keep what the work needs written down — a
                    payload that took an hour to get right, the shape of a
                    schema, what the next step was.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : showNoMatch ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No notes match “{query.trim()}”.
              </p>
            ) : (
              <ul>{renderNodes(tree, 0)}</ul>
            )}

            {dragItem && (
              <div
                onDragOver={onRootDragOver}
                onDragLeave={() => setDropRoot(false)}
                onDrop={onRootDrop}
                className={cn(
                  "m-2 mt-auto rounded-md border border-dashed p-2 text-center text-[0.65rem] text-muted-foreground",
                  dropRoot && "border-primary bg-accent/40 text-foreground"
                )}
              >
                Drop here to move to the top level
              </div>
            )}
          </ContextMenuTrigger>
        </div>

        {renaming && (
          <RenameDialog
            title="Rename note"
            label="Note name"
            currentName={renaming.name}
            onRename={async (name) => {
              rename(renaming.id, name.trim())
              return null
            }}
            onClose={() => setRenaming(null)}
          />
        )}

        {renamingFolder && (
          <RenameDialog
            title="Rename folder"
            label="Folder name"
            currentName={renamingFolder.name}
            onRename={async (name) => {
              renameFolder(renamingFolder.id, name.trim())
              return null
            }}
            onClose={() => setRenamingFolder(null)}
          />
        )}

        <AlertDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete “
                {pendingDelete?.kind === "folder"
                  ? pendingDelete.folder.name
                  : pendingDelete?.note.name}
                ”?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {folderDeleteInfo &&
                (folderDeleteInfo.itemCount > 0 ||
                  folderDeleteInfo.folderCount > 0)
                  ? `This deletes ${folderDeleteInfo.itemCount} note${folderDeleteInfo.itemCount === 1 ? "" : "s"}${
                      folderDeleteInfo.folderCount > 0
                        ? ` and ${folderDeleteInfo.folderCount} subfolder${folderDeleteInfo.folderCount === 1 ? "" : "s"}`
                        : ""
                    } inside it. This can't be undone.`
                  : "This can't be undone."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  if (pendingDelete?.kind === "folder") {
                    removeFolder(pendingDelete.folder.id)
                  } else if (pendingDelete?.kind === "note") {
                    remove(pendingDelete.note.id)
                  }
                  setPendingDelete(null)
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {menuTarget && (
        <ContextMenuContent className="w-48">
          {menuTarget.kind === "note" && (
            <>
              <ContextMenuItem onClick={() => setRenaming(menuTarget.note)}>
                <Pencil />
                Rename…
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => void duplicate(menuTarget.note.id)}
              >
                <CopyPlus />
                Duplicate
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() =>
                  setPendingDelete({ kind: "note", note: menuTarget.note })
                }
              >
                <Trash2 />
                Delete
              </ContextMenuItem>
            </>
          )}

          {menuTarget.kind === "folder" && (
            <>
              <ContextMenuItem
                onClick={() => void create(menuTarget.folder.id)}
              >
                <Plus />
                New note
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => createFolder(menuTarget.folder.id)}
              >
                <FolderPlus />
                New folder
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => setRenamingFolder(menuTarget.folder)}
              >
                <Pencil />
                Rename…
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() =>
                  setPendingDelete({
                    kind: "folder",
                    folder: menuTarget.folder,
                  })
                }
              >
                <Trash2 />
                Delete
              </ContextMenuItem>
            </>
          )}

          {menuTarget.kind === "root" && (
            <>
              <ContextMenuItem onClick={() => void create(null)}>
                <Plus />
                New note
              </ContextMenuItem>
              <ContextMenuItem onClick={() => createFolder(null)}>
                <FolderPlus />
                New folder
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
}
