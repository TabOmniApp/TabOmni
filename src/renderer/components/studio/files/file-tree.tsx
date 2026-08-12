import { useState } from "react"
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
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  FileCode,
  Image,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Pencil,
  RotateCw,
  Trash2,
} from "lucide-react"

import type { FileEntry, WorkspaceFolder } from "@shared/api"
import { isDirty, useFiles, viewOf } from "@/lib/files/store"
import { iconFor } from "@/lib/files/icons"
import {
  isImage,
  VIEWER_LABELS,
  viewersFor,
  type Viewer,
} from "@/lib/files/viewers"
import { parentOf } from "@/lib/files/paths"
import { useStudio } from "@/lib/store"
import { RenameDialog } from "../db/rename-dialog"
import { IconButton } from "../icon-button"
import { PanelHeader } from "../panel-header"
import { SideRow } from "../side-row"

/** What the right-click menu is about: a row in the tree, or the workspace
 * folder heading above one. */
type MenuTarget =
  | { kind: "entry"; entry: FileEntry }
  | { kind: "root"; folder: WorkspaceFolder }

/** A pending "name this" dialog: a new file or folder inside `dir`. */
type Creating = { dir: string; kind: "file" | "directory" }

function failureOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/**
 * The workspace's folders, as directories.
 *
 * The other sidebars list records this app owns — a request, a note, a captured
 * mail — and can therefore file them however they like. This one lists what is
 * actually on disk, so its shape is not the studio's to choose: the tree is the
 * directory tree, and a folder is read one level at a time, as it is opened. A
 * repository holds far more files than anybody wants listed, and the ones under
 * a folded directory are ones nobody has asked about.
 *
 * Nothing watches the disk. A `claude` session writing a file in the Terminal
 * panel does not move a row here until Refresh is pressed — a deliberate line:
 * a watcher over a whole repository is a `node_modules` of file handles and a
 * rebuild of the tree on every `npm install`, and the panel would spend its
 * time reacting to churn nobody is looking at. What is never silently
 * overwritten is an edit: Refresh re-reads only the files with nothing unsaved
 * in them.
 *
 * Adding and removing a workspace folder lives here as well as in the Terminal
 * sidebar. Both panels are about the folders — one runs sessions in them, this
 * one opens what is inside them — and neither is the obvious single home for
 * "point the studio at another directory", so the same dialog is reachable
 * from both, and from the File menu.
 */
export function FileTree({ onAddFolder }: { onAddFolder: () => void }) {
  const folders = useStudio((state) => state.folders)
  const branches = useStudio((state) => state.branches)
  const renameFolder = useStudio((state) => state.renameFolder)
  const removeFolder = useStudio((state) => state.removeFolder)

  const expanded = useFiles((state) => state.expanded)
  const toggle = useFiles((state) => state.toggle)
  const refresh = useFiles((state) => state.refresh)
  const collapseAll = useFiles((state) => state.collapseAll)

  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null)
  const [creating, setCreating] = useState<Creating | null>(null)
  const [renaming, setRenaming] = useState<FileEntry | null>(null)
  const [trashing, setTrashing] = useState<FileEntry | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<WorkspaceFolder | null>(
    null
  )
  const [removingFolder, setRemovingFolder] = useState<WorkspaceFolder | null>(
    null
  )

  /** The directory a header button acts in: whatever is selected in the tree,
   * falling back to the first folder — with no folders there is nothing to
   * create in and the buttons are off. */
  const target = useFiles((state) =>
    state.selectedId ? parentOf(state.selectedId) : null
  )
  const defaultDir = target ?? folders[0]?.path ?? null

  return (
    <ContextMenu>
      <div className="flex h-full flex-col">
        <PanelHeader title="Explorer">
          <IconButton
            label="New file"
            disabled={defaultDir === null}
            onClick={() => {
              if (defaultDir) setCreating({ dir: defaultDir, kind: "file" })
            }}
          >
            <FilePlus />
          </IconButton>
          <IconButton
            label="Refresh"
            disabled={folders.length === 0}
            onClick={() => void refresh()}
          >
            <RotateCw />
          </IconButton>
          <IconButton
            label="Collapse all"
            disabled={expanded.length === 0}
            onClick={collapseAll}
          >
            <ChevronDown />
          </IconButton>
          <IconButton label="Add folder" onClick={onAddFolder}>
            <FolderPlus />
          </IconButton>
        </PanelHeader>

        {/* An empty workspace draws an empty list and no notice, the way the
            Terminal sidebar does: Add folder is in the header directly above
            it. */}
        {/* One trigger over the whole tree, rather than one per row: the rows
            are a recursive component, and a trigger inside a trigger inside a
            trigger is a menu nobody can predict the target of. Each row says
            what it is instead, on the way past. */}
        <ContextMenuTrigger
          render={
            <div
              className="min-h-0 flex-1 overflow-auto pb-3"
              onContextMenu={(event) => {
                // Only the empty space below the last row: a row of its own
                // has already set the target by the time this is reached.
                if (event.target === event.currentTarget) setMenuTarget(null)
              }}
            />
          }
        >
          {folders.map((folder) => {
            const open = expanded.includes(folder.path)
            const Chevron = open ? ChevronDown : ChevronRight

            return (
              <section key={folder.id}>
                <h2>
                  <button
                    type="button"
                    title={folder.path}
                    aria-expanded={open}
                    onClick={() => toggle(folder.path)}
                    onContextMenu={() =>
                      setMenuTarget({ kind: "root", folder })
                    }
                    className="flex w-full items-center gap-1.5 px-2 pt-2 pb-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground"
                  >
                    <Chevron className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {folder.name}
                    </span>
                    {/* The same branch the Terminal sidebar shows against the
                        same folder: this is the other list of the workspace's
                        folders, and one of them saying which branch is checked
                        out while the other did not would be the more confusing
                        of the two options. */}
                    {branches[folder.id] && (
                      <span className="flex min-w-0 shrink items-center gap-1 normal-case">
                        <GitBranch className="size-2.5 shrink-0" />
                        <span className="truncate">{branches[folder.id]}</span>
                      </span>
                    )}
                  </button>
                </h2>

                {open && (
                  <Directory
                    dir={folder.path}
                    depth={1}
                    onMenu={(entry) => setMenuTarget({ kind: "entry", entry })}
                  />
                )}
              </section>
            )
          })}
        </ContextMenuTrigger>

        {creating && (
          <RenameDialog
            title={creating.kind === "file" ? "New file" : "New folder"}
            description={
              <>
                Inside <code className="font-mono">{creating.dir}</code>.
              </>
            }
            label={creating.kind === "file" ? "File name" : "Folder name"}
            currentName=""
            submitLabel="Create"
            pendingLabel="Creating…"
            onRename={async (name) => {
              const { create, createFolder } = useFiles.getState()
              try {
                if (creating.kind === "file") await create(creating.dir, name)
                else await createFolder(creating.dir, name)
                return null
              } catch (error) {
                return failureOf(error, "Could not create that.")
              }
            }}
            onClose={() => setCreating(null)}
          />
        )}

        {renaming && (
          <RenameDialog
            title={
              renaming.kind === "directory" ? "Rename folder" : "Rename file"
            }
            // The one place in the studio where a rename does touch the disk,
            // which is worth saying beside the field: the workspace folder
            // rename right next to it in this same tree does not.
            description={
              <>
                Renames it on disk, in{" "}
                <code className="font-mono">{parentOf(renaming.path)}</code>.
              </>
            }
            label="Name"
            currentName={renaming.name}
            onRename={async (name) => {
              try {
                await useFiles.getState().rename(renaming.path, name)
                return null
              } catch (error) {
                return failureOf(error, "Could not rename that.")
              }
            }}
            onClose={() => setRenaming(null)}
          />
        )}

        {renamingFolder && (
          <RenameDialog
            title="Rename folder"
            description={
              <>
                Only what the studio calls it. The directory —{" "}
                <code className="font-mono">{renamingFolder.path}</code> — keeps
                its own name.
              </>
            }
            label="Folder name"
            currentName={renamingFolder.name}
            onRename={async (name) => {
              try {
                await renameFolder(renamingFolder.id, name)
                return null
              } catch (error) {
                return failureOf(error, "Could not rename that folder.")
              }
            }}
            onClose={() => setRenamingFolder(null)}
          />
        )}
      </div>

      {/* The empty space under the tree is about the workspace rather than
          about any file in it, so it offers the one thing that is. */}
      {menuTarget === null && (
        <ContextMenuContent className="w-52">
          <ContextMenuItem onClick={onAddFolder}>
            <FolderPlus />
            Add folder…
          </ContextMenuItem>
        </ContextMenuContent>
      )}

      {menuTarget?.kind === "root" && (
        <ContextMenuContent className="w-52">
          <ContextMenuItem
            onClick={() =>
              setCreating({ dir: menuTarget.folder.path, kind: "file" })
            }
          >
            <FilePlus />
            New file…
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() =>
              setCreating({ dir: menuTarget.folder.path, kind: "directory" })
            }
          >
            <FolderPlus />
            New folder…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() =>
              void useFiles.getState().read(menuTarget.folder.path)
            }
          >
            <RotateCw />
            Refresh
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() =>
              void navigator.clipboard.writeText(menuTarget.folder.path)
            }
          >
            <Copy />
            Copy path
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() =>
              void window.desktop.revealPath(menuTarget.folder.path)
            }
          >
            <ExternalLink />
            Reveal in file manager
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setRenamingFolder(menuTarget.folder)}>
            <Pencil />
            Rename…
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onClick={() => setRemovingFolder(menuTarget.folder)}
          >
            <Trash2 />
            Remove folder…
          </ContextMenuItem>
        </ContextMenuContent>
      )}

      {menuTarget?.kind === "entry" && (
        <ContextMenuContent className="w-52">
          {/* Only where there is a choice to make. An SVG is the one file the
              studio can honestly draw two ways; offering a picture-or-text
              menu on a `.ts` would be offering the same thing twice. */}
          {menuTarget.entry.kind === "file" &&
            viewersFor(menuTarget.entry.path).length > 1 && (
              <>
                <ContextMenuGroup>
                  {/* Base UI throws for a label outside the group it names. */}
                  <ContextMenuLabel>Open with</ContextMenuLabel>
                  <OpenWith path={menuTarget.entry.path} />
                </ContextMenuGroup>
                <ContextMenuSeparator />
              </>
            )}
          {menuTarget.entry.kind === "directory" && (
            <>
              <ContextMenuItem
                onClick={() =>
                  setCreating({ dir: menuTarget.entry.path, kind: "file" })
                }
              >
                <FilePlus />
                New file…
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() =>
                  setCreating({ dir: menuTarget.entry.path, kind: "directory" })
                }
              >
                <FolderPlus />
                New folder…
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem
            onClick={() =>
              void navigator.clipboard.writeText(menuTarget.entry.path)
            }
          >
            <Copy />
            Copy path
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() =>
              void window.desktop.revealPath(menuTarget.entry.path)
            }
          >
            <ExternalLink />
            Reveal in file manager
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setRenaming(menuTarget.entry)}>
            <Pencil />
            Rename…
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onClick={() => setTrashing(menuTarget.entry)}
          >
            <Trash2 />
            Move to trash…
          </ContextMenuItem>
        </ContextMenuContent>
      )}

      <AlertDialog
        open={trashing !== null}
        onOpenChange={(next) => {
          if (!next) setTrashing(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Move “{trashing?.name}” to the trash?
            </AlertDialogTitle>
            {/* Says where it goes rather than "this cannot be undone", because
                it can: the OS trash is the undo, which is the whole reason
                this is not an `unlink`. */}
            <AlertDialogDescription>
              {trashing?.kind === "directory"
                ? "The folder and everything in it goes to the system trash, and any tabs open on those files close."
                : "It goes to the system trash, and its tab closes."}{" "}
              You can put it back from there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (trashing) {
                  void useFiles
                    .getState()
                    .trash(trashing.path)
                    .catch((error: unknown) => {
                      console.error("Could not move that to the trash", error)
                    })
                }
                setTrashing(null)
              }}
            >
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={removingFolder !== null}
        onOpenChange={(next) => {
          if (!next) setRemovingFolder(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this folder?</AlertDialogTitle>
            <AlertDialogDescription>
              “{removingFolder?.name}” is removed from the workspace, along with
              any tabs open on files inside it. The folder itself —{" "}
              <code className="font-mono">{removingFolder?.path}</code> — is
              left exactly as it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removingFolder) void removeFolder(removingFolder.id)
                setRemovingFolder(null)
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ContextMenu>
  )
}

/**
 * The viewers a file can be opened with, as a radio group.
 *
 * Its own component so the current choice is read from the store rather than
 * captured when the menu opened: picking one leaves the menu on screen for the
 * blink before it closes, and a stale tick in that moment reads as a click that
 * did not land.
 */
function OpenWith({ path }: { path: string }) {
  const current = useFiles((state) => viewOf(state, path))

  return (
    <ContextMenuRadioGroup
      value={current}
      onValueChange={(value) => {
        void useFiles.getState().setView(path, value as Viewer)
        // Opened as well as switched: the menu is reachable from a row that is
        // not the one on screen, and choosing a viewer for it plainly means
        // "show me this".
        void useFiles.getState().open(path)
      }}
    >
      {viewersFor(path).map((viewer) => (
        <ContextMenuRadioItem key={viewer} value={viewer}>
          {viewer === "image" ? (
            <Image className="text-muted-foreground" />
          ) : (
            <FileCode className="text-muted-foreground" />
          )}
          {VIEWER_LABELS[viewer]}
        </ContextMenuRadioItem>
      ))}
    </ContextMenuRadioGroup>
  )
}

/**
 * One directory's rows, and the open directories under it.
 *
 * Recursive rather than a flattened list because the shape it draws is
 * recursive and nothing here needs the flat one: the tree has no keyboard
 * navigation across rows, and every row's indent is its own depth.
 */
function Directory({
  dir,
  depth,
  onMenu,
}: {
  dir: string
  depth: number
  onMenu: (entry: FileEntry) => void
}) {
  const entries = useFiles((state) => state.entries[dir])
  const error = useFiles((state) => state.errors[dir])
  const loading = useFiles((state) => state.loading.includes(dir))

  if (error) {
    return (
      <p
        style={{ paddingLeft: `${depth * 0.75 + 0.75}rem` }}
        className="py-1 pr-2 text-xs text-destructive"
      >
        {error}
      </p>
    )
  }

  // Nothing at all until the first listing lands, rather than a row that says
  // so: a directory on a local disk is read faster than a placeholder can be
  // read, and one that flickers past is worse than none.
  if (entries === undefined) {
    if (!loading) return null
    return (
      <p
        style={{ paddingLeft: `${depth * 0.75 + 0.75}rem` }}
        className="py-1 pr-2 text-xs text-muted-foreground/70"
      >
        Reading…
      </p>
    )
  }

  if (entries.length === 0) {
    return (
      <p
        style={{ paddingLeft: `${depth * 0.75 + 0.75}rem` }}
        className="py-1 pr-2 text-xs text-muted-foreground/70"
      >
        Empty
      </p>
    )
  }

  return (
    <ul>
      {entries.map((entry) => (
        <Row key={entry.path} entry={entry} depth={depth} onMenu={onMenu} />
      ))}
    </ul>
  )
}

function Row({
  entry,
  depth,
  onMenu,
}: {
  entry: FileEntry
  depth: number
  onMenu: (entry: FileEntry) => void
}) {
  const open = useFiles((state) => state.expanded.includes(entry.path))
  const active = useFiles((state) => state.selectedId === entry.path)
  // Marked on the row as well as on the tab: the tree is where somebody looks
  // to find the file they were editing, and a strip with fifteen tabs in it is
  // not.
  const dirty = useFiles((state) => isDirty(state.docs[entry.path]))

  const directory = entry.kind === "directory"
  const Icon = directory
    ? open
      ? FolderOpen
      : Folder
    : isImage(entry.path)
      ? Image
      : File
  // A vendored file-type icon where there is one, and the Lucide glyph above
  // otherwise — so a coloured icon reads as "a kind of file the studio knows"
  // rather than as decoration. Folders keep the glyph either way: they are the
  // tree's structure, and forty coloured folder icons would compete with the
  // files they hold.
  const iconUrl = directory ? null : iconFor(entry.path)
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <li>
      <SideRow
        active={active}
        indent={depth}
        title={entry.path}
        onClick={() =>
          directory
            ? useFiles.getState().toggle(entry.path)
            : void useFiles.getState().open(entry.path)
        }
        onContextMenu={() => onMenu(entry)}
      >
        {/* A file has no chevron but keeps its width, so names line up down a
            mixed listing rather than stepping in and out. */}
        {directory ? (
          <Chevron className="size-3.5 shrink-0" />
        ) : (
          <span aria-hidden className="size-3.5 shrink-0" />
        )}
        {iconUrl ? (
          <img src={iconUrl} alt="" aria-hidden className="size-3.5 shrink-0" />
        ) : (
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("truncate", dirty && "italic")}>{entry.name}</span>
        {dirty && (
          <span
            aria-label="Unsaved changes"
            className="ml-auto size-1.5 shrink-0 rounded-full bg-foreground/60"
          />
        )}
      </SideRow>

      {directory && open && (
        <Directory dir={entry.path} depth={depth + 1} onMenu={onMenu} />
      )}
    </li>
  )
}
