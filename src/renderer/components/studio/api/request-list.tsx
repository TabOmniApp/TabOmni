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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  ChevronDown,
  ChevronRight,
  Copy,
  CopyPlus,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react"

import type { HttpFolder, HttpRequestRecord } from "@shared/api"
import {
  buildFolderTree,
  folderDeleteImpact,
  isDescendant,
  type FolderTreeNode,
} from "@/lib/http/folders"
import {
  resolveUrl,
  SETTINGS_TAB_ID,
  useApi,
  variablesFrom,
} from "@/lib/http/store"
import { useStudio } from "@/lib/store"
import { IconButton } from "../icon-button"
import { PanelHeader } from "../panel-header"
import { RenameDialog } from "../db/rename-dialog"
import { SideRow } from "../side-row"
import { ApiImportDialog } from "./api-import-dialog"

/** A method's colour, so a list of them can be read down the left edge. */
export const METHOD_TONES: Record<string, string> = {
  GET: "text-emerald-600 dark:text-emerald-400",
  POST: "text-blue-600 dark:text-blue-400",
  PUT: "text-amber-600 dark:text-amber-400",
  PATCH: "text-violet-600 dark:text-violet-400",
  DELETE: "text-destructive",
  HEAD: "text-muted-foreground",
  OPTIONS: "text-muted-foreground",
}

/** What the context menu was opened on — the tree, a folder row, or the
 * empty area of the list itself. */
type MenuTarget =
  | { kind: "request"; request: HttpRequestRecord }
  | { kind: "folder"; folder: HttpFolder }
  | { kind: "root" }

type PendingDelete =
  | { kind: "request"; request: HttpRequestRecord }
  | { kind: "folder"; folder: HttpFolder }

/** What's being dragged, for a folder or request row dropped onto a folder
 * (or the root drop zone) to reparent it. */
type DragItem = { kind: "request" | "folder"; id: string }

export function RequestList() {
  // Only the AI import needs this: it reads a repository's source, and there
  // is nothing for it to read until the workspace has one. Named apart from
  // the `folders` below, which are this panel's own groups of requests.
  const workspaceFolders = useStudio((state) => state.folders)
  const requests = useApi((state) => state.requests)
  const selectedId = useApi((state) => state.selectedId)
  const refresh = useApi((state) => state.refresh)
  const create = useApi((state) => state.create)
  const select = useApi((state) => state.select)
  const update = useApi((state) => state.update)
  const remove = useApi((state) => state.remove)
  const duplicate = useApi((state) => state.duplicate)

  const folders = useApi((state) => state.folders)
  const createFolder = useApi((state) => state.createFolder)
  const renameFolder = useApi((state) => state.renameFolder)
  const removeFolder = useApi((state) => state.removeFolder)
  const moveFolder = useApi((state) => state.moveFolder)
  const moveRequestToFolder = useApi((state) => state.moveRequestToFolder)

  const environments = useApi((state) => state.environments)
  const activeEnvironmentId = useApi((state) => state.activeEnvironmentId)
  const selectEnvironment = useApi((state) => state.selectEnvironment)

  const [query, setQuery] = useState("")
  /** `undefined` when closed; otherwise the folder id to import into, or
   * `null` for the top level. */
  const [importTarget, setImportTarget] = useState<string | null | undefined>(
    undefined
  )
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null)
  const [renaming, setRenaming] = useState<HttpRequestRecord | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<HttpFolder | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [dropFolderId, setDropFolderId] = useState<string | null>(null)
  const [dropRoot, setDropRoot] = useState(false)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const variables = useMemo(
    () => variablesFrom(environments, activeEnvironmentId),
    [environments, activeEnvironmentId]
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return requests
    return requests.filter(
      (request) =>
        request.name.toLowerCase().includes(needle) ||
        request.url.toLowerCase().includes(needle)
    )
  }, [requests, query])

  const tree = useMemo(
    () => buildFolderTree(folders, filtered),
    [folders, filtered]
  )
  const hasAnything = requests.length > 0 || folders.length > 0
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

  /**
   * One handler for the whole tree rather than one per row: a row's own
   * `onContextMenu` would have to call `stopPropagation` to keep a click on
   * it from also being read as a click on the empty area below, and that
   * would stop the event from ever reaching the trigger that opens the menu
   * in the first place. Reading `event.target` here instead — same as the
   * grid's `onCellContextMenu` — needs nothing stopped.
   */
  function onListContextMenu(event: React.MouseEvent) {
    const target = event.target as HTMLElement
    const requestEl = target.closest<HTMLElement>("[data-request-id]")
    if (requestEl) {
      const request = requests.find(
        (candidate) => candidate.id === requestEl.dataset.requestId
      )
      if (request) {
        setMenuTarget({ kind: "request", request })
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

  /** A folder can't be dropped into itself or its own subtree. A request has
   * no subtree to worry about, so it can move into any folder. */
  function canDropOnFolder(folderId: string): boolean {
    if (!dragItem) return false
    if (dragItem.kind === "folder") {
      return !isDescendant(folderId, dragItem.id, folders)
    }
    return true
  }

  function onRowDragStart(item: DragItem) {
    return (event: DragEvent) => {
      // A folder's own `<li>` nests its children's — dragging one of them
      // would otherwise bubble into the parent folder's `onDragStart` too,
      // overwriting `dragItem` with the parent instead of what was actually
      // grabbed.
      event.stopPropagation()
      setDragItem(item)
      // Something has to be on the transfer for a drag to start at all in
      // Chromium, the same reason tab-strip.tsx sets it.
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
        else moveRequestToFolder(dragItem.id, folderId)
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
      else moveRequestToFolder(dragItem.id, null)
    }
    endDrag()
  }

  function renderNodes(nodes: FolderTreeNode[], depth: number): ReactNode {
    return nodes.map((node) => {
      if (node.type === "request") {
        const request = node.request
        return (
          <li
            key={request.id}
            data-request-id={request.id}
            draggable
            onDragStart={onRowDragStart({ kind: "request", id: request.id })}
            onDragEnd={endDrag}
          >
            <SideRow
              indent={depth}
              active={request.id === selectedId}
              title={`${request.method} ${request.url}`}
              onClick={() => select(request.id)}
            >
              <span
                className={cn(
                  "w-10 shrink-0 font-mono text-[0.6rem] font-semibold",
                  METHOD_TONES[request.method] ?? "text-muted-foreground"
                )}
              >
                {request.method}
              </span>
              <span className="truncate">{request.name}</span>
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
            active={folder.id === selectedId}
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
      ? folderDeleteImpact(pendingDelete.folder.id, folders, requests)
      : null

  return (
    <ContextMenu>
      <div className="flex h-full flex-col">
        <PanelHeader title="API">
          <Select
            items={environments.map((environment) => ({
              value: environment.id,
              label: environment.name,
            }))}
            value={activeEnvironmentId}
            onValueChange={(value) =>
              selectEnvironment(value ? String(value) : null)
            }
          >
            <SelectTrigger
              size="sm"
              aria-label="Environment"
              disabled={environments.length === 0}
              className="h-6 w-24 min-w-0 px-1.5 text-[0.7rem]"
            >
              <SelectValue placeholder="No environment" />
            </SelectTrigger>
            <SelectContent
              align="end"
              alignItemWithTrigger={false}
              className="w-auto min-w-(--anchor-width)"
            >
              {environments.map((environment) => (
                <SelectItem key={environment.id} value={environment.id}>
                  {environment.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <IconButton
            label="API settings"
            onClick={() => select(SETTINGS_TAB_ID)}
          >
            <Settings2 />
          </IconButton>

          <IconButton label="New request" onClick={() => void create()}>
            <Plus />
          </IconButton>

          <IconButton
            label="AI import"
            disabled={workspaceFolders.length === 0}
            onClick={() => setImportTarget(null)}
          >
            <Sparkles />
          </IconButton>
        </PanelHeader>

        {hasAnything && (
          <div className="shrink-0 border-b px-2 py-1.5">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter requests…"
              aria-label="Filter requests"
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
                    <Send />
                  </EmptyMedia>
                  <EmptyTitle>No requests</EmptyTitle>
                  <EmptyDescription className="text-xs">
                    Add one to call the app you are building — a path like{" "}
                    <code className="font-mono">/api/users</code> goes to its
                    dev server.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : showNoMatch ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No requests match “{query.trim()}”.
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
            title="Rename request"
            label="Request name"
            currentName={renaming.name}
            onRename={async (name) => {
              update(renaming.id, { name: name.trim() })
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
                  : pendingDelete?.request.name}
                ”?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {folderDeleteInfo &&
                (folderDeleteInfo.requestCount > 0 ||
                  folderDeleteInfo.folderCount > 0)
                  ? `This deletes ${folderDeleteInfo.requestCount} request${folderDeleteInfo.requestCount === 1 ? "" : "s"}${
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
                  } else if (pendingDelete?.kind === "request") {
                    remove(pendingDelete.request.id)
                  }
                  setPendingDelete(null)
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {importTarget !== undefined && (
          <ApiImportDialog
            initialFolderId={importTarget}
            onClose={() => setImportTarget(undefined)}
          />
        )}
      </div>

      {menuTarget && (
        <ContextMenuContent className="w-48">
          {menuTarget.kind === "request" && (
            <>
              <ContextMenuItem onClick={() => setRenaming(menuTarget.request)}>
                <Pencil />
                Rename…
              </ContextMenuItem>
              <ContextMenuItem onClick={() => duplicate(menuTarget.request.id)}>
                <CopyPlus />
                Duplicate
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() =>
                  void navigator.clipboard.writeText(
                    resolveUrl(menuTarget.request.url, variables).url
                  )
                }
              >
                <Copy />
                Copy URL
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() =>
                  setPendingDelete({
                    kind: "request",
                    request: menuTarget.request,
                  })
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
                New request
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => createFolder(menuTarget.folder.id)}
              >
                <FolderPlus />
                New folder
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => setImportTarget(menuTarget.folder.id)}
              >
                <Sparkles />
                AI import…
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => setRenamingFolder(menuTarget.folder)}
              >
                <Pencil />
                Rename…
              </ContextMenuItem>
              <ContextMenuItem onClick={() => select(menuTarget.folder.id)}>
                <Settings2 />
                Settings
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
                New request
              </ContextMenuItem>
              <ContextMenuItem onClick={() => createFolder(null)}>
                <FolderPlus />
                New folder
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setImportTarget(null)}>
                <Sparkles />
                AI import…
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
}
