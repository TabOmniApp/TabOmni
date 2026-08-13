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
  BookOpen,
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
  SquareTerminal,
  Trash2,
} from "lucide-react"

import type { FileEntry, WorkspaceFolder } from "@shared/api"
import { isDirty, useFiles, viewOf } from "@/lib/files/store"
import {
  gitStateOf,
  GIT_LABELS,
  GIT_LETTERS,
  GIT_TONES,
  useGitStatus,
} from "@/lib/files/git-status"
import { iconFor } from "@/lib/files/icons"
import {
  isImage,
  VIEWER_LABELS,
  viewersFor,
  type Viewer,
} from "@/lib/files/viewers"
import { parentOf } from "@/lib/files/paths"
import { useStudio } from "@/lib/store"
import { useTerminal } from "@/lib/terminal/store"
import { RenameDialog } from "../db/rename-dialog"
import { IconButton } from "../icon-button"
import { PanelHeader } from "../panel-header"
import { RenameRow, useMenuFocusHandoff } from "../rename-row"
import { SideRow } from "../side-row"
import { ConversationsList } from "./conversations-list"
import { SessionsList } from "./sessions-list"

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
 * What is expanded is watched, and nothing else is — one non-recursive watcher
 * per open directory, closed again when the row is folded (`main/watch.ts`). A
 * watcher over a whole repository would be a `node_modules` of file handles and
 * a rebuild of the tree on every `npm install`; this costs a handle per row
 * somebody is looking at. Refresh is still in the header, for the filesystems
 * `fs.watch` is quiet on. What is never silently overwritten either way is an
 * edit: only the files with nothing unsaved in them are re-read.
 *
 * The rows are coloured by what git says about them — new, modified, ignored —
 * from one `git status` per folder (`lib/files/git-status.ts`). A tracked file
 * with no changes is the ordinary row and has no colour of its own.
 *
 * **The folders are this panel's, and only this panel's.** Adding, renaming and
 * removing one used to live in the Terminal sidebar as well, which drew the
 * same folder list a second time to hang the same three actions off it — so a
 * workspace of three folders with one session running redrew this sidebar over
 * there with a single extra row in it, and "where do I remove a folder" had two
 * answers. This is the list that says what the workspace is pointed at, so it
 * is the one that changes it. The File menu opens the same Add folder dialog,
 * which is what a rail with this section hidden falls back to.
 *
 * `New session here…` on a folder is the other half of that move: with the
 * Terminal sidebar no longer listing folders that have nothing running, this is
 * where the first session in one is started — and it is the flow anyway, since
 * what somebody wants a terminal in is generally the repository they are
 * reading. The cwd is the folder's own directory, so the item is on the folder
 * heading rather than on the directory rows under it, which `terminalCreate`
 * has no way to run in.
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
  const [trashing, setTrashing] = useState<FileEntry | null>(null)
  const menuFocus = useMenuFocusHandoff()
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
            // Both halves of what a row shows: what is on disk, and what git
            // says about it. One button, since "this is out of date" is one
            // thought.
            onClick={() => {
              void refresh()
              void useGitStatus.getState().refreshAll()
            }}
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

        {/* An empty workspace draws an empty list and no notice: Add folder is
            in the header directly above it, and a panel that announces its own
            emptiness announces it again every time the section is opened. */}
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
                    className="flex w-full items-start gap-1.5 px-2 pt-2 pb-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground"
                  >
                    <Chevron className="size-3.5 shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col items-start">
                      <span className="w-full truncate text-left">
                        {folder.name}
                      </span>
                      {/* The one place a folder's branch is always shown — the
                          Terminal sidebar repeats it on the headings it draws,
                          beside the sessions being worked in, and has none to
                          draw in a single-folder workspace. On its own line
                          rather than beside the name: a branch is as long as
                          somebody's ticket title, and sharing the row meant a
                          heading that was all branch and no folder. */}
                      {branches[folder.id] && (
                        <span className="flex w-full items-center gap-1 tracking-normal normal-case opacity-70">
                          <GitBranch className="size-2.5 shrink-0" />
                          <span className="truncate">
                            {branches[folder.id]}
                          </span>
                        </span>
                      )}
                    </span>
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

        {/* Under the tree rather than inside it: the tree is the directory tree,
            and neither a session nor a conversation is a file in any folder.
            Sessions first because they are running now and the conversations are
            a history; Conversations starts folded, so the panel is still the
            files first. */}
        <SessionsList />
        <ConversationsList />

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
          {/* Its own group rather than down with Copy path: opening a terminal
              in the repository being read is a first-class thing to do with a
              folder, not a footnote to it. */}
          <ContextMenuItem
            onClick={() =>
              useTerminal.getState().openPicker(menuTarget.folder.id)
            }
          >
            <SquareTerminal />
            New session here…
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
        <ContextMenuContent
          className="w-52"
          // Rename hands focus to the field it opens — see `useMenuFocusHandoff`.
          finalFocus={menuFocus.finalFocus}
        >
          {/* Only where there is a choice to make — an SVG and a `.md` are the
              files the studio can honestly draw two ways; offering the menu on
              a `.ts` would be offering the same thing twice. */}
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
          <ContextMenuItem
            onClick={() => {
              menuFocus.handOff()
              useFiles.getState().beginRename(menuTarget.entry.path)
            }}
          >
            <Pencil />
            Rename
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
            {/*
              Both consequences, because this is now the only place a folder is
              removed from: the tabs are this panel's own, and the sessions are
              killed by the terminal store's subscription to the folder list. The
              Terminal sidebar's dialog used to be the one that mentioned them.
              And the folder is the user's own — a dialog that left that in doubt
              would be asking them to gamble a repository on it.
            */}
            <AlertDialogDescription>
              “{removingFolder?.name}” is removed from the workspace, along with
              any tabs open on files inside it and any terminal sessions running
              in it. The folder itself —{" "}
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
          <ViewerIcon viewer={viewer} />
          {VIEWER_LABELS[viewer]}
        </ContextMenuRadioItem>
      ))}
    </ContextMenuRadioGroup>
  )
}

function ViewerIcon({ viewer }: { viewer: Viewer }) {
  const Icon =
    viewer === "image" ? Image : viewer === "markdown" ? BookOpen : FileCode
  return <Icon className="text-muted-foreground" />
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
  const renaming = useFiles((state) => state.renaming === entry.path)
  // Marked on the row as well as on the tab: the tree is where somebody looks
  // to find the file they were editing, and a strip with fifteen tabs in it is
  // not.
  const dirty = useFiles((state) => isDirty(state.docs[entry.path]))
  // A string or null rather than the store's own record, so a row re-renders
  // when *its* file's state changes and not when any file's does.
  const git = useGitStatus((state) => gitStateOf(state, entry.path))

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

  /* The row's own left-hand side, drawn the same whether the right of it is the
     name or a field being typed into — so the field opens exactly where the name
     was rather than a few pixels off it. */
  const lead = (
    <>
      {/* A file has no chevron but keeps its width, so names line up down a
          mixed listing rather than stepping in and out. */}
      {directory ? (
        <Chevron className="size-3.5 shrink-0" />
      ) : (
        <span aria-hidden className="size-3.5 shrink-0" />
      )}
      {iconUrl ? (
        <img
          src={iconUrl}
          alt=""
          aria-hidden
          // The icon recedes with the name for an ignored row: a full-colour
          // TypeScript logo beside a greyed `dist/bundle.ts` would be the
          // brightest thing in the subtree it is meant to play down.
          className={cn("size-3.5 shrink-0", git === "ignored" && "opacity-40")}
        />
      ) : (
        <Icon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground",
            git === "ignored" && "opacity-60"
          )}
        />
      )}
    </>
  )

  if (renaming) {
    return (
      <li>
        <RenameRow
          name={entry.name}
          indent={depth}
          // A directory's dot is part of its name; a file's is its extension.
          selection={directory ? "all" : "stem"}
          label={directory ? "Folder name" : "File name"}
          lead={lead}
          onRename={async (name) => {
            try {
              await useFiles.getState().rename(entry.path, name)
              useFiles.getState().endRename()
              return null
            } catch (error) {
              return failureOf(error, "Could not rename that.")
            }
          }}
          onCancel={() => useFiles.getState().endRename()}
        />
        {directory && open && (
          <Directory dir={entry.path} depth={depth + 1} onMenu={onMenu} />
        )}
      </li>
    )
  }

  return (
    <li>
      <SideRow
        active={active}
        indent={depth}
        // The state in words as well as in colour: the hover line is the only
        // thing that says what a green name means to somebody who has not
        // learnt the palette, or who cannot see it.
        title={git ? `${entry.path} — ${GIT_LABELS[git]}` : entry.path}
        onClick={() =>
          directory
            ? useFiles.getState().toggle(entry.path)
            : void useFiles.getState().open(entry.path)
        }
        onContextMenu={() => onMenu(entry)}
      >
        {lead}
        <span
          className={cn(
            "truncate",
            dirty && "italic",
            // Git's colour, and only where git has something to say — a
            // tracked file with no changes is the ordinary row and stays the
            // sidebar's own foreground.
            git && GIT_TONES[git]
          )}
        >
          {entry.name}
        </span>
        {(dirty || (git && GIT_LETTERS[git])) && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
            {dirty && (
              <span
                aria-label="Unsaved changes"
                className="size-1.5 rounded-full bg-foreground/60"
              />
            )}
            {/* Git's own letter, at the end of the row the way every editor
                draws it. `aria-hidden` because the row's hover line already
                says the state in words, and a bare "M" read out is worse than
                nothing. */}
            {git && GIT_LETTERS[git] && (
              <span
                aria-hidden
                className={cn("text-[0.7rem] leading-none", GIT_TONES[git])}
              >
                {GIT_LETTERS[git]}
              </span>
            )}
          </span>
        )}
      </SideRow>

      {directory && open && (
        <Directory dir={entry.path} depth={depth + 1} onMenu={onMenu} />
      )}
    </li>
  )
}
