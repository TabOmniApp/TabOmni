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
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  GitBranch,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
  X,
  XCircle,
} from "lucide-react"

import type { TerminalSession } from "@/lib/terminal/store"
import { SESSION_TYPES, sessionLabel } from "@/lib/terminal/catalog"
import { activeSessionOf, useTerminal } from "@/lib/terminal/store"
import { useStudio } from "@/lib/store"
import type { WorkspaceFolder } from "@shared/api"
import { RenameDialog } from "../db/rename-dialog"
import { IconButton } from "../icon-button"
import { PanelHeader } from "../panel-header"
import { SideRow } from "../side-row"
import { NewTerminalDialog } from "./new-terminal-dialog"

/** Where a session falls among others of the same kind, in list order — the
 * ordinal `sessionLabel` numbers a second "Claude Code" with. */
function ordinalOf(list: TerminalSession[], target: TerminalSession): number {
  let count = 0
  for (const session of list) {
    if (
      session.kind === target.kind &&
      session.installing === target.installing
    ) {
      count += 1
    }
    if (session.id === target.id) break
  }
  return count
}

/** What a session's row shows: its own name once renamed, the generated
 * label otherwise. */
function labelOf(list: TerminalSession[], session: TerminalSession): string {
  return (
    session.name ??
    sessionLabel(session.kind, session.installing, ordinalOf(list, session))
  )
}

/** How many of these are actually running — what "2 sessions" ought to mean
 * anywhere the closed rows are also in the list. */
function liveCount(list: TerminalSession[]): number {
  return list.filter((session) => !session.closed).length
}

/** What the right-click menu is about, since a folder heading and a session row
 * answer to the same menu root. */
type MenuTarget =
  | { kind: "session"; session: TerminalSession }
  | { kind: "folder"; folder: WorkspaceFolder }

/**
 * The workspace's folders, and under each the sessions open in it.
 *
 * The folders live here rather than in a menu above the rail because this is
 * the only panel that works in one: a session is a pty in a folder's own
 * directory, and everything else the studio holds — the databases, the saved
 * requests, the captures — belongs to the workspace as a whole. Adding and
 * removing a folder therefore sits beside the thing it changes. The File
 * menu's Add folder still reaches the same dialog, which is what a rail with
 * this section hidden falls back to.
 *
 * Every folder is listed whether or not it has a session, so the list says what
 * the workspace is pointed at rather than only what is running. The branch sits
 * on the folder's own row: one line in the window header could not say which of
 * three repositories it meant.
 *
 * A folder folds away, and stays folded while the rail is showing another
 * panel — the workspace someone actually has open runs to a handful of folders
 * and rather more sessions, and only one of them is being worked in at a time.
 * What is never hidden is the folder itself: this is the list that says what
 * the workspace is pointed at.
 *
 * Closed sessions stay listed, dimmed and marked, below the running ones. This
 * is the only place they appear — they are not tabs — and it is what makes
 * closing a `claude` tab reversible: the conversation was never the studio's to
 * delete, and the row is the handle back onto it. Clicking one runs it again;
 * `Forget` is the way to be rid of it.
 */
export function TerminalSidebar({ onAddFolder }: { onAddFolder: () => void }) {
  const folders = useStudio((state) => state.folders)
  const branches = useStudio((state) => state.branches)
  const renameFolder = useStudio((state) => state.renameFolder)
  const removeFolder = useStudio((state) => state.removeFolder)

  const sessions = useTerminal((state) => state.sessions)
  const activeId = useTerminal((state) => state.activeId)
  const collapsed = useTerminal((state) => state.collapsed)
  const toggleFolder = useTerminal((state) => state.toggleFolder)
  const select = useTerminal((state) => state.select)
  const close = useTerminal((state) => state.close)
  const closeOthers = useTerminal((state) => state.closeOthers)
  const closeAll = useTerminal((state) => state.closeAll)
  const restart = useTerminal((state) => state.restart)
  const forget = useTerminal((state) => state.forget)
  const rename = useTerminal((state) => state.rename)

  /** The folder a new session should default to, or null for "wherever the
   * active session is". Distinct from `picking === null`, which is closed. */
  const [picking, setPicking] = useState<{ folderId: string | null } | null>(
    null
  )
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null)
  const [renaming, setRenaming] = useState<TerminalSession | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<WorkspaceFolder | null>(
    null
  )
  const [removing, setRemoving] = useState<WorkspaceFolder | null>(null)

  const active = activeSessionOf(sessions, activeId)

  return (
    <ContextMenu>
      <div className="flex h-full flex-col">
        <PanelHeader title="Terminal">
          {/* A pty's cwd is a folder's directory, so with none there is
              nothing for the picker to start a session in. */}
          <IconButton
            label="New session"
            disabled={folders.length === 0}
            onClick={() => setPicking({ folderId: active?.folderId ?? null })}
          >
            <Plus />
          </IconButton>
          <IconButton label="Add folder" onClick={onAddFolder}>
            <FolderPlus />
          </IconButton>
        </PanelHeader>

        {/* An empty workspace draws an empty list, and deliberately no notice
            saying so: the header's Add folder is right above it, and a panel
            that spells out its own emptiness says it every time you open the
            section, long after it has been read once. */}
        <div className="min-h-0 flex-1 space-y-2 overflow-auto pb-3">
          {folders.map((folder) => {
            const own = sessions.filter(
              (session) => session.folderId === folder.id
            )
            const open = !collapsed.includes(folder.id)
            const Chevron = open ? ChevronDown : ChevronRight

            return (
              <section key={folder.id}>
                <h2>
                  <ContextMenuTrigger
                    render={
                      <button
                        type="button"
                        title={folder.path}
                        aria-expanded={open}
                        onClick={() => toggleFolder(folder.id)}
                        onContextMenu={() =>
                          setMenuTarget({ kind: "folder", folder })
                        }
                        className={cn(
                          "flex w-full items-center gap-1.5 px-2 pt-2 pb-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground",
                          // Folded over the session on screen: the row that
                          // would normally be marked is not there to mark.
                          !open &&
                            own.some((session) => session.id === active?.id) &&
                            "text-foreground"
                        )}
                      />
                    }
                  >
                    <Chevron className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {folder.name}
                    </span>
                    {branches[folder.id] && (
                      <span className="flex min-w-0 shrink items-center gap-1 normal-case">
                        <GitBranch className="size-2.5 shrink-0" />
                        <span className="truncate">{branches[folder.id]}</span>
                      </span>
                    )}
                    {/* Only while it is shut, and only then: a fold that hid
                        a running session with no sign of it is how a session
                        gets forgotten about. Closed rows are left out — the
                        count is what is running under here, not what is
                        listed. */}
                    {!open && liveCount(own) > 0 && (
                      <span className="shrink-0 tabular-nums">
                        {liveCount(own)}
                      </span>
                    )}
                  </ContextMenuTrigger>
                </h2>

                {!open ? null : own.length === 0 ? (
                  <p className="px-2 py-1 pl-6 text-xs text-muted-foreground/70">
                    No sessions
                  </p>
                ) : (
                  <ContextMenuTrigger render={<ul className="pt-1" />}>
                    {own.map((session) => {
                      const { icon: Icon } = SESSION_TYPES[session.kind]
                      const label = labelOf(own, session)

                      return (
                        <li key={session.id} className="group relative">
                          {/* The close control sits over the row rather than
                              inside it: a button within a button is neither
                              valid markup nor reachable by keyboard. */}
                          <SideRow
                            active={
                              !session.closed && session.id === active?.id
                            }
                            indent={1}
                            // A closed row has no pane to select — clicking it
                            // is asking for it back, which is the same act as
                            // restarting a running one.
                            onClick={() =>
                              session.closed
                                ? restart(session.id)
                                : select(session.id)
                            }
                            onContextMenu={() =>
                              setMenuTarget({ kind: "session", session })
                            }
                            className={cn(
                              "pr-7",
                              session.closed && "opacity-55"
                            )}
                          >
                            <Icon className="size-3.5 shrink-0" />
                            <span className="truncate">{label}</span>
                            {(session.closed || session.exited) && (
                              <span className="shrink-0 text-[0.65rem] text-muted-foreground">
                                {session.closed ? "closed" : "ended"}
                              </span>
                            )}
                          </SideRow>
                          {/* Always "take this row out of where it is": off the
                              screen while it is running, off the list once it
                              already is. */}
                          <button
                            type="button"
                            aria-label={
                              session.closed
                                ? `Forget ${label}`
                                : `Close ${label}`
                            }
                            onClick={() =>
                              session.closed
                                ? forget(session.id)
                                : close(session.id)
                            }
                            className="absolute inset-y-0 right-1 my-auto inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100"
                          >
                            <X className="size-3" />
                          </button>
                        </li>
                      )
                    })}
                  </ContextMenuTrigger>
                )}
              </section>
            )
          })}
        </div>

        {picking && (
          <NewTerminalDialog
            preferredFolderId={picking.folderId}
            onClose={() => setPicking(null)}
          />
        )}

        {renaming && (
          <RenameDialog
            title="Rename session"
            label="Session name"
            currentName={labelOf(
              sessions.filter(
                (session) => session.folderId === renaming.folderId
              ),
              renaming
            )}
            onRename={async (name) => {
              rename(renaming.id, name)
              return null
            }}
            onClose={() => setRenaming(null)}
          />
        )}

        {renamingFolder && (
          <RenameDialog
            title="Rename folder"
            // The one rename in the studio that does not touch the thing it
            // names: the manifest records an absolute path, and the name
            // beside it is the studio's own label. Saying so here is cheaper
            // than a user finding out from Finder.
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
                return error instanceof Error
                  ? error.message
                  : "Could not rename that folder."
              }
            }}
            onClose={() => setRenamingFolder(null)}
          />
        )}
      </div>

      {menuTarget?.kind === "folder" && (
        <ContextMenuContent className="w-48">
          <ContextMenuItem
            onClick={() => setPicking({ folderId: menuTarget.folder.id })}
          >
            <Plus />
            New session here…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setRenamingFolder(menuTarget.folder)}>
            <Pencil />
            Rename…
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onClick={() => setRemoving(menuTarget.folder)}
          >
            <Trash2 />
            Remove folder…
          </ContextMenuItem>
        </ContextMenuContent>
      )}

      {menuTarget?.kind === "session" && menuTarget.session.closed && (
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={() => restart(menuTarget.session.id)}>
            <RotateCw />
            Reopen
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setRenaming(menuTarget.session)}>
            <Pencil />
            Rename…
          </ContextMenuItem>
          <ContextMenuSeparator />
          {/*
            "Forget", not "Delete": for a `claude` row what goes is this app's
            handle onto the conversation, while the transcript stays where the
            CLI wrote it. A menu item promising to delete it would be lying
            about a file the studio does not own.
          */}
          <ContextMenuItem
            variant="destructive"
            onClick={() => forget(menuTarget.session.id)}
          >
            <Trash2 />
            Forget
          </ContextMenuItem>
        </ContextMenuContent>
      )}

      {menuTarget?.kind === "session" && !menuTarget.session.closed && (
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={() => setRenaming(menuTarget.session)}>
            <Pencil />
            Rename…
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              select(menuTarget.session.id)
              restart(menuTarget.session.id)
            }}
          >
            <RotateCw />
            Restart
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => close(menuTarget.session.id)}>
            <X />
            Close
          </ContextMenuItem>
          <ContextMenuItem
            disabled={liveCount(sessions) <= 1}
            onClick={() => closeOthers(menuTarget.session.id)}
          >
            <XCircle />
            Close others
          </ContextMenuItem>
          <ContextMenuItem onClick={() => closeAll()}>
            <XCircle />
            Close all
          </ContextMenuItem>
        </ContextMenuContent>
      )}

      <AlertDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) setRemoving(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this folder?</AlertDialogTitle>
            {/*
              The folder is the user's own, and this dialog must not claim
              otherwise: what goes is the studio's record of where it is, along
              with the sessions open against it.
            */}
            <AlertDialogDescription>
              “{removing?.name}” is removed from the workspace, along with any
              sessions open in it. The folder itself —{" "}
              <code className="font-mono">{removing?.path}</code> — is left
              exactly as it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removing) void removeFolder(removing.id)
                setRemoving(null)
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
