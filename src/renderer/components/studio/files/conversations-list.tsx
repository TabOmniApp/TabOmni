import { useCallback, useEffect, useState } from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronRight, Play, RotateCw } from "lucide-react"

import type { TranscriptSessionSummary, WorkspaceFolder } from "@shared/api"
import {
  relativeTime,
  useConversations,
  type OpenConversation,
} from "@/lib/terminal/conversations"
import { useStudio } from "@/lib/store"
import { IconButton } from "../icon-button"
import { SideRow } from "../side-row"

/** One folder's conversations, or why there are none to show yet. */
type Listing =
  | { kind: "loading" }
  | { kind: "ready"; sessions: TranscriptSessionSummary[] }
  | { kind: "error" }

/**
 * Every `claude` conversation the workspace's folders have on disk, under the
 * tree they belong to.
 *
 * **The CLI writes its conversations to a file, so this can show ones the studio
 * never started.** A `claude` run from Terminal.app in the same directory
 * appends to the same `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, and
 * `claudeListSessions` reads that directory — the one `--resume` itself reads.
 * That is the whole reason this list is worth having: it is the agent history of
 * a repository rather than the history of this app's use of it, which is
 * something no editor's own chat panel can offer.
 *
 * It used to be reachable only from inside a running session — start a session,
 * switch to Chat, open the Past sessions drawer — so the way back to a
 * conversation ran through starting a new one. Here it is a list beside the
 * files, and clicking a row reads it without starting anything at all.
 *
 * Read when the section is opened rather than on mount: this is a `readdir` plus
 * the head of every transcript in it, per folder, and a sidebar that paid for it
 * on every launch would be paying for a list most sessions never expand. Refresh
 * is the header button, the way the tree's own is.
 */
export function ConversationsList() {
  const folders = useStudio((state) => state.folders)
  const open = useConversations((state) => state.open)
  const activeId = useConversations((state) => state.activeId)
  const onScreen = useConversations((state) => state.onScreen)
  const read = useConversations((state) => state.read)
  const resume = useConversations((state) => state.resume)

  const [expanded, setExpanded] = useState(false)
  const [listings, setListings] = useState<Record<string, Listing>>({})
  const [menuTarget, setMenuTarget] = useState<OpenConversation | null>(null)

  /**
   * Asks each folder for its conversations.
   *
   * Every write here is inside a settled promise, deliberately: a folder with no
   * entry yet already draws as `loading`, so there is nothing for a synchronous
   * "mark them all pending" to say, and this is also called from the effect
   * below — where a synchronous `setState` is a cascading render.
   */
  const load = useCallback((own: WorkspaceFolder[]) => {
    for (const folder of own) {
      void window.desktop.claudeListSessions(folder.id).then(
        (sessions) =>
          setListings((current) => ({
            ...current,
            [folder.id]: { kind: "ready", sessions },
          })),
        // A folder whose `~/.claude/projects` directory cannot be read is not a
        // failure of the panel: its own row says so and the others still list.
        () =>
          setListings((current) => ({
            ...current,
            [folder.id]: { kind: "error" },
          }))
      )
    }
  }, [])

  // Read when the section is open, and again for a folder added while it is —
  // an empty listing for a folder nobody has asked about is the state this
  // avoids paying for on launch.
  useEffect(() => {
    if (!expanded) return
    load(folders)
  }, [expanded, folders, load])

  const Chevron = expanded ? ChevronDown : ChevronRight
  /** A heading per folder is only worth drawing when there is more than one to
   * tell apart — the same rule the Sessions list above groups by. */
  const grouped = folders.length > 1

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
              <span className="truncate">Conversations</span>
            </button>
          </h2>

          {expanded && (
            <IconButton
              label="Refresh conversations"
              // Cleared first, so a re-read says it is happening: a list that
              // sits there for a beat and then changes under you is one you
              // cannot tell from a list that did not refresh at all.
              onClick={() => {
                setListings({})
                load(folders)
              }}
              className="mr-1 shrink-0"
            >
              <RotateCw />
            </IconButton>
          )}
        </div>

        {/* Its own scrolling box rather than growing the sidebar: a repository
            worked in for months has hundreds of these, and the tree above is
            what the panel is mostly for. */}
        {expanded && (
          // One trigger over the whole list rather than one per row, the way the
          // tree above does it: each row sets what the menu is about on the way
          // past.
          <ContextMenuTrigger
            render={<div className="max-h-64 overflow-auto pb-2" />}
          >
            {folders.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground/70">
                No folders yet.
              </p>
            )}

            {folders.map((folder) => {
              const listing = listings[folder.id] ?? { kind: "loading" }

              return (
                <div key={folder.id}>
                  {grouped && (
                    <h3 className="px-2 pt-1.5 pb-0.5 pl-6 text-[0.65rem] font-medium tracking-wide text-muted-foreground/80 uppercase">
                      {folder.name}
                    </h3>
                  )}

                  {listing.kind === "loading" && (
                    <p className="px-2 py-1 pl-6 text-xs text-muted-foreground/70">
                      Reading…
                    </p>
                  )}

                  {listing.kind === "error" && (
                    <p className="px-2 py-1 pl-6 text-xs text-muted-foreground/70">
                      Could not read this folder&apos;s conversations.
                    </p>
                  )}

                  {listing.kind === "ready" &&
                    listing.sessions.length === 0 && (
                      <p className="px-2 py-1 pl-6 text-xs text-muted-foreground/70">
                        No conversations yet.
                      </p>
                    )}

                  {listing.kind === "ready" &&
                    listing.sessions.map((session) => {
                      const conversation: OpenConversation = {
                        id: session.id,
                        folderId: folder.id,
                        title: session.title,
                      }
                      const isOpen = open.some(
                        (entry) => entry.id === session.id
                      )

                      return (
                        <SideRow
                          key={session.id}
                          active={onScreen && activeId === session.id}
                          indent={grouped ? 1 : 0}
                          title={`${session.title}\nclaude --resume ${session.id}`}
                          onClick={() => read(conversation)}
                          onContextMenu={() => setMenuTarget(conversation)}
                          className="h-auto min-h-6 py-1"
                        >
                          <span className="flex min-w-0 flex-1 flex-col items-start">
                            <span
                              className={cn(
                                "w-full truncate text-left",
                                // An open tab's row, marked the way the tree
                                // marks a file that is open: the list is long
                                // and finding your way back to what you were
                                // reading should not need a second look.
                                isOpen && "text-foreground"
                              )}
                            >
                              {session.title}
                            </span>
                            <span className="text-[0.65rem] text-muted-foreground/70">
                              {relativeTime(session.updatedAt)}
                            </span>
                          </span>
                        </SideRow>
                      )
                    })}
                </div>
              )
            })}
          </ContextMenuTrigger>
        )}
      </section>

      {menuTarget && (
        <ContextMenuContent className="w-52">
          <ContextMenuItem onClick={() => read(menuTarget)}>
            <ChevronRight />
            Open
          </ContextMenuItem>
          {/* Reading is a click; this is the one that starts a process, so it
              says what it does rather than being the same word twice. */}
          <ContextMenuItem
            onClick={() => {
              read(menuTarget)
              resume(menuTarget.id)
            }}
          >
            <Play />
            Resume in a session
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
}
