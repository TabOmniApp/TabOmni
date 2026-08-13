import { useState } from "react"
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
  Pencil,
  Plus,
  RotateCw,
  Trash2,
  X,
  XCircle,
} from "lucide-react"

import { SESSION_TYPES, sessionLabel } from "@/lib/terminal/catalog"
import {
  activeSessionOf,
  useTerminal,
  type TerminalSession,
} from "@/lib/terminal/store"
import { closeTab, fillPane } from "@/lib/panels"
import { useStudio } from "@/lib/store"
import { PREFIX } from "@/lib/tabs"
import { RenameRow, useMenuFocusHandoff } from "../rename-row"
import { IconButton } from "../icon-button"
import { SideRow } from "../side-row"

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

/**
 * The sessions running in the workspace, under the folder each one runs in.
 *
 * **This is the Terminal panel's sidebar, and the Terminal panel no longer has
 * one.** A session is a pty in a folder's directory, and the folders are
 * Explorer's — so a rail button of its own meant a second sidebar whose top half
 * was a copy of this one's folder list. What was actually per-session is this:
 * a handful of rows. They sit under the tree, beside the conversations, and the
 * pane a session draws in has no sidebar of its own — `showPane` leaves this one
 * showing, which is where the row that was clicked is.
 *
 * Expanded by default, unlike Conversations: these are live processes, and a
 * session on screen with nothing in the sidebar selecting it is how a session
 * gets forgotten about. With nothing running the section is its own header and
 * no more — deliberately no notice, since `+` is right there and a panel that
 * announces its own emptiness announces it every time.
 *
 * A folder heading appears only when the workspace has more than one folder, and
 * carries no branch: the tree above says which branch a folder is on, once, and
 * this is a list of sessions rather than a second list of folders. Nothing folds
 * per folder any more — the section itself folds, and folding one folder inside
 * a box that scrolls was a third level of hiding for a list of a few rows.
 *
 * Closed sessions stay listed, dimmed and marked, below the running ones. This
 * is the only place they appear — they are not tabs — and it is what makes
 * closing a `claude` tab reversible. Explorer's Conversations list covers the
 * *conversation*; this row is the session as this app had it, with its name and
 * its kind. Clicking one runs it again; `Forget` is the way to be rid of it.
 */
export function SessionsList() {
  const folders = useStudio((state) => state.folders)

  const sessions = useTerminal((state) => state.sessions)
  const activeId = useTerminal((state) => state.activeId)
  const select = useTerminal((state) => state.select)
  const closeOthers = useTerminal((state) => state.closeOthers)
  const closeAllSessions = useTerminal((state) => state.closeAll)
  const restart = useTerminal((state) => state.restart)
  const forget = useTerminal((state) => state.forget)
  const rename = useTerminal((state) => state.rename)
  const openPicker = useTerminal((state) => state.openPicker)

  /*
   * The strip's close rather than the store's own, for the same reason a tab's
   * ✕ uses it: closing the last session leaves the pane with nothing to show,
   * and what it goes to next is a question about the whole strip — a table or a
   * note may well still be open in it.
   *
   * "Close others" and "Close all" below stay the session list's own: this
   * section is that list, and they mean the sessions rather than the workbench's
   * tabs. `fillPane` is what keeps the pane honest afterwards.
   */
  const close = (id: string) => closeTab(PREFIX.terminal + id)
  const closeAll = () => {
    closeAllSessions()
    fillPane()
  }

  const [expanded, setExpanded] = useState(true)
  const [menuTarget, setMenuTarget] = useState<TerminalSession | null>(null)
  const [renaming, setRenaming] = useState<TerminalSession | null>(null)
  const menuFocus = useMenuFocusHandoff()

  const active = activeSessionOf(sessions, activeId)
  const grouped = folders.length > 1
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <ContextMenu>
      <section className="shrink-0 border-t">
        <div className="flex items-center">
          <h2 className="min-w-0 flex-1">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground"
            >
              <Chevron className="size-3.5 shrink-0" />
              <span className="truncate">Sessions</span>
              {/* Folded over something that is running: the row that would
                  normally be marked is not there to mark. */}
              {!expanded && liveCount(sessions) > 0 && (
                <span className="ml-auto shrink-0 tabular-nums">
                  {liveCount(sessions)}
                </span>
              )}
            </button>
          </h2>

          {/* A pty's cwd is a folder's directory, so with none there is nothing
              for the picker to start a session in. */}
          <IconButton
            label="New session"
            disabled={folders.length === 0}
            onClick={() => openPicker(active?.folderId ?? null)}
            className="mr-1 shrink-0"
          >
            <Plus />
          </IconButton>
        </div>

        {expanded && (
          <ContextMenuTrigger
            render={<div className="max-h-64 overflow-auto pb-2" />}
          >
            {folders.map((folder) => {
              const own = sessions.filter(
                (session) => session.folderId === folder.id
              )
              // A folder with nothing running in it is a row in the tree above,
              // not one of these: what this list would draw for it is a heading
              // and the word "none".
              if (own.length === 0) return null

              return (
                <div key={folder.id}>
                  {grouped && (
                    <h3
                      title={folder.path}
                      className="px-2 pt-1.5 pb-0.5 pl-6 text-[0.65rem] font-medium tracking-wide text-muted-foreground/80 uppercase"
                    >
                      {folder.name}
                    </h3>
                  )}

                  <ul>
                    {own.map((session) => {
                      const { icon: Icon } = SESSION_TYPES[session.kind]
                      const label = labelOf(own, session)

                      return (
                        <li key={session.id} className="group relative">
                          {renaming?.id === session.id ? (
                            <RenameRow
                              name={label}
                              indent={grouped ? 1 : 0}
                              label="Session name"
                              lead={<Icon className="size-3.5 shrink-0" />}
                              onRename={async (name) => {
                                rename(session.id, name)
                                setRenaming(null)
                                return null
                              }}
                              onCancel={() => setRenaming(null)}
                            />
                          ) : (
                            <>
                              {/* The close control sits over the row rather than
                              inside it: a button within a button is neither
                              valid markup nor reachable by keyboard. */}
                              <SideRow
                                active={
                                  !session.closed && session.id === active?.id
                                }
                                indent={grouped ? 1 : 0}
                                // A closed row has no pane to select — clicking it
                                // is asking for it back, which is the same act as
                                // restarting a running one.
                                onClick={() =>
                                  session.closed
                                    ? restart(session.id)
                                    : select(session.id)
                                }
                                onContextMenu={() => setMenuTarget(session)}
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
                            </>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </ContextMenuTrigger>
        )}
      </section>

      {menuTarget?.closed && (
        <ContextMenuContent
          className="w-48"
          // Rename hands focus to the field it opens — see `useMenuFocusHandoff`.
          finalFocus={menuFocus.finalFocus}
        >
          <ContextMenuItem onClick={() => restart(menuTarget.id)}>
            <RotateCw />
            Reopen
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              menuFocus.handOff()
              setRenaming(menuTarget)
            }}
          >
            <Pencil />
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          {/*
            "Forget", not "Delete": for a `claude` row what goes is this app's
            handle onto the conversation, while the transcript stays where the
            CLI wrote it — and stays listed under Conversations, below. A menu
            item promising to delete it would be lying about a file the studio
            does not own.
          */}
          <ContextMenuItem
            variant="destructive"
            onClick={() => forget(menuTarget.id)}
          >
            <Trash2 />
            Forget
          </ContextMenuItem>
        </ContextMenuContent>
      )}

      {menuTarget && !menuTarget.closed && (
        <ContextMenuContent
          className="w-48"
          // Rename hands focus to the field it opens — see `useMenuFocusHandoff`.
          finalFocus={menuFocus.finalFocus}
        >
          <ContextMenuItem
            onClick={() => {
              menuFocus.handOff()
              setRenaming(menuTarget)
            }}
          >
            <Pencil />
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              select(menuTarget.id)
              restart(menuTarget.id)
            }}
          >
            <RotateCw />
            Restart
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => close(menuTarget.id)}>
            <X />
            Close
          </ContextMenuItem>
          <ContextMenuItem
            disabled={liveCount(sessions) <= 1}
            onClick={() => closeOthers(menuTarget.id)}
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
    </ContextMenu>
  )
}
