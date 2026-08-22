import { useState } from "react"
import {
  ChevronRight,
  GitBranch,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { useProjects } from "@/lib/projects"
import { useStudio } from "@/lib/store"
import { IconButton } from "../icon-button"
import { SideRow } from "../side-row"
import { useShells } from "@/lib/shell/store"
import { useWorktrees, worktreesOf } from "@/lib/worktree/store"
import { useWorktreeChats } from "@/lib/worktree-chat/store"
import { NewWorktreeDialog } from "../worktree/new-worktree-dialog"

/**
 * The workspace's projects, and the `git worktree` checkouts under each.
 *
 * One of the four sections the left column stacks — see `WorkspaceSidebar` for
 * why the other three are beside it rather than behind tabs on the right. It
 * carries no `Search` row and no settings button any more: those belong to the
 * column, not to this section, and a row that lived in whichever section
 * happened to be first was a row in the wrong place.
 *
 * There was a **task** layer over this — a task was a name and a set of members
 * taken from any panel, listed here with a dashboard behind `Home` — and it is
 * gone, deleted rather than hidden. What is left is the thing the column was
 * always navigating: projects and their branches.
 */
export function ProjectsSection() {
  const collapsed = useProjects((state) => state.collapsed)
  const toggleFolder = useProjects((state) => state.toggleFolder)

  const folders = useStudio((state) => state.folders)

  /** The New worktree dialog, held here rather than in `ProjectRow` — a dialog
   * owned by a row goes when the row re-renders under it. */
  const [addingWorktree, setAddingWorktree] = useState<{
    folderId: string
    name: string
  } | null>(null)

  return (
    <nav
      aria-label="Projects"
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {folders.length === 0 && (
          <p className="px-3 py-1 text-xs leading-relaxed text-muted-foreground">
            No folders yet. Add one from Explorer and it will show up here.
          </p>
        )}

        {folders.map((folder) => {
          const shut = collapsed.includes(folder.id)
          return (
            <div key={folder.id}>
              <ProjectRow
                name={folder.name}
                shut={shut}
                onToggle={() => {
                  toggleFolder(folder.id)
                  // And the dock's shell follows: a project row is the one
                  // place this app says "this project", so a terminal that
                  // stayed in the last one would be a `pwd` nobody asked for.
                  // It does not open the dock — see `showFor`.
                  useShells.getState().showFor(folder.id)
                  // So does Explorer: this row is the app saying "this
                  // project", and the tree draws the one project being worked
                  // in. Its own working tree, since that is the row clicked.
                  useProjects.getState().setActive(folder.id, null)
                }}
                onNewWorktree={() =>
                  setAddingWorktree({ folderId: folder.id, name: folder.name })
                }
              />
              {!shut && <ProjectWorktrees folderId={folder.id} />}
            </div>
          )
        })}
      </div>

      {addingWorktree && (
        <NewWorktreeDialog
          folderId={addingWorktree.folderId}
          folderName={addingWorktree.name}
          onClose={() => setAddingWorktree(null)}
          // Straight into a chat in it, which is the only reason to have made
          // one: a checkout nobody is working in is a directory.
          onCreated={(id) => void useWorktreeChats.getState().openWorktree(id)}
        />
      )}
    </nav>
  )
}

/**
 * One project: the folder's name, and a `+` that makes a worktree of it.
 *
 * The `+` is Conductor's, and it belongs on the row rather than in a header
 * above the list: it acts on *this* project. A chat is not offered here — a
 * chat happens *in* a checkout, so it is the worktree rows below that start
 * one.
 */
function ProjectRow({
  name,
  shut,
  onToggle,
  onNewWorktree,
}: {
  name: string
  shut: boolean
  onToggle: () => void
  onNewWorktree: () => void
}) {
  return (
    <div className="group/project relative flex items-center">
      <SideRow onClick={onToggle} title={name} className="font-medium">
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            !shut && "rotate-90"
          )}
        />
        <span className="min-w-0 flex-1 truncate text-left">{name}</span>
      </SideRow>

      {/*
        Over the row rather than in it: a row is a button, and a button inside a
        button is neither valid markup nor clickable. Shown on hover, like the ✕
        on a tab — a column of projects each wearing a permanent `+` is a column
        of plus signs.
      */}
      <IconButton
        label={`New worktree in ${name}`}
        onClick={onNewWorktree}
        className="absolute right-1 size-5 opacity-0 transition-opacity group-hover/project:opacity-100 focus-visible:opacity-100"
      >
        <Plus className="size-3" />
      </IconButton>
    </div>
  )
}

/**
 * One project's worktrees: the checkouts `git worktree` has made of it.
 *
 * The row is the **branch**, because that is what a worktree is for — the
 * directory it lives in is this app's own bookkeeping (`worktreePath` in
 * `main/store.ts`) and is not something to make anybody read. It is the row's
 * tooltip, for when it is.
 *
 * There is no row for the project's own checkout: that is the project row above,
 * and a "main" entry under it would be the same thing listed twice at two
 * depths.
 */
function ProjectWorktrees({ folderId }: { folderId: string }) {
  const worktrees = useWorktrees((state) => state.worktrees)
  const remove = useWorktrees((state) => state.remove)
  const chats = useWorktreeChats((state) => state.chats)
  const selectedId = useWorktreeChats((state) => state.selectedId)
  const openWorktree = useWorktreeChats((state) => state.openWorktree)
  const create = useWorktreeChats((state) => state.create)

  const own = worktreesOf(worktrees, folderId)
  if (own.length === 0) return null

  const shownWorktree = chats.find((chat) => chat.id === selectedId)?.worktreeId

  return (
    <>
      {own.map((worktree) => {
        const count = chats.filter(
          (chat) => chat.worktreeId === worktree.id
        ).length

        return (
          <ContextMenu key={worktree.id}>
            <ContextMenuTrigger
              render={
                <SideRow
                  indent={1}
                  active={shownWorktree === worktree.id}
                  title={worktree.path}
                  // A worktree is somewhere to work, and working in it here
                  // means talking to an agent — so the row opens its chat, and
                  // starts one when it has none. Nothing else would be a
                  // sensible thing to do with a directory.
                  onClick={() => {
                    void openWorktree(worktree.id)
                    // The shell too, in this checkout rather than the project's
                    // own: a chat here edits this branch, and a terminal beside
                    // it pointed somewhere else would be a trap.
                    useShells.getState().showFor(worktree.folderId, worktree.id)
                    // And Explorer, for the same reason: the files on screen
                    // beside a chat that is editing this branch have to be this
                    // branch's files.
                    useProjects
                      .getState()
                      .setActive(worktree.folderId, worktree.id)
                  }}
                >
                  <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-left font-mono text-[0.7rem]">
                    {worktree.branch}
                  </span>
                  {count > 1 && (
                    <span className="shrink-0 text-[0.65rem] text-muted-foreground tabular-nums">
                      {count}
                    </span>
                  )}
                </SideRow>
              }
            />
            <ContextMenuContent className="w-52">
              <ContextMenuItem onClick={() => void create(worktree.id)}>
                <MessageSquare className="text-muted-foreground" />
                New chat here
              </ContextMenuItem>
              <ContextMenuSeparator />
              {/* The branch is kept — the commits are the work. Only the
                  checkout goes, and its chats with it: they are conversations
                  about a directory that will not exist. */}
              <ContextMenuItem
                variant="destructive"
                onClick={() => void remove(worktree.id)}
              >
                <Trash2 />
                Remove worktree
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </>
  )
}
