import { useState } from "react"
import {
  ChevronRight,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Plus,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { shownRootOf } from "@/lib/files/roots"
import { useProjects } from "@/lib/projects"
import { useStudio } from "@/lib/store"
import { useWorktrees } from "@/lib/worktree/store"
import { useWorktreeChats } from "@/lib/worktree-chat/store"
import { IconButton } from "../icon-button"
import { NewWorktreeDialog } from "../worktree/new-worktree-dialog"

/**
 * Where the workbench is working, said in the title bar: `project › branch`.
 *
 * Conductor's own crumb, and the reason it earns the bar it used to be left
 * deliberately empty of. That emptiness had a reason — the workspace holds
 * several folders, each on a branch of its own, so a single line here could only
 * ever be about one of them — and what changed is that there *is* one of them
 * now: `activeFolderId` + `checkout` on `lib/projects.ts`, moved by clicking a
 * row in the left column, and everything on screen already follows it (the
 * Explorer's root, the dock's shell, the chat that opens). A window whose whole
 * right-hand side is about one checkout should be able to say which.
 *
 * **Labels, not pickers.** The way to another project or another branch is the
 * column on the left, which is on screen and is a list; turning these into two
 * dropdowns would be a second way to do the one thing that column exists for.
 * So this reads, and the `…` beside it carries only what has nowhere else to be.
 *
 * It resolves through `shownRootOf` — the same call the Explorer's own root bar
 * makes — so the crumb and the tree can never disagree about which checkout is
 * on screen, including the fallbacks for a project picked before its worktrees
 * were read.
 */
export function ProjectCrumbs() {
  const folders = useStudio((state) => state.folders)
  const branches = useStudio((state) => state.branches)
  const worktrees = useWorktrees((state) => state.worktrees)
  const checkout = useProjects((state) => state.checkout)
  const activeFolderId = useProjects((state) => state.activeFolderId)

  const shown = shownRootOf(folders, worktrees, checkout, activeFolderId)
  const folder = folders.find((entry) => entry.id === shown?.folderId) ?? null

  /** The New worktree dialog, held here rather than in the menu that offers it:
   * a dropdown unmounts on the click that chose the item. */
  const [addingWorktree, setAddingWorktree] = useState(false)

  // Nothing pointed at yet, and nothing to say about it. No placeholder either:
  // an empty workspace is told so by the panel it would add a folder from, and
  // a crumb reading "no project" is a line of chrome saying nothing twice.
  if (folder === null || shown === null) return null

  const branch = shown.worktreeId ? shown.label : branches[folder.id]

  return (
    <div className="no-drag flex min-w-0 items-center gap-1 pl-1">
      {/* The project's initial, standing in for Conductor's repository avatar:
          this app has no icon to fetch for a directory on somebody's disk, and a
          letter is the honest generic version of one. */}
      <span
        aria-hidden
        className="grid size-4 shrink-0 place-items-center rounded bg-muted text-[0.6rem] font-semibold text-muted-foreground uppercase"
      >
        {folder.name.slice(0, 1)}
      </span>

      <span className="truncate text-xs font-medium" title={folder.name}>
        {folder.name}
      </span>

      {branch && (
        <>
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          <span
            className="truncate font-mono text-[0.7rem] text-muted-foreground"
            title={shown.path}
          >
            {branch}
          </span>
        </>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton
              label={`Actions for ${folder.name}`}
              // Below, because this button's top edge is near the top of the
              // window and a tooltip with nowhere to go is what once made the
              // title bar's own button unclickable — see `ui/tooltip.tsx`.
              side="bottom"
              className="size-5 shrink-0"
            >
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          }
        />
        {/*
          Only what has nowhere else to be. Renaming a project and dropping it
          are in the Explorer's own root menu, beside the tree that lists what is
          in it; switching checkout is the left column and the Explorer's
          checkout picker. What is left is the two things about the directory
          itself, and the one action that makes a *new* branch to work in.
        */}
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            onClick={() => void navigator.clipboard.writeText(shown.path)}
          >
            <Copy className="text-muted-foreground" />
            Copy path
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void window.desktop.revealPath(shown.path)}
          >
            <ExternalLink className="text-muted-foreground" />
            Reveal in file manager
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAddingWorktree(true)}>
            <Plus className="text-muted-foreground" />
            New worktree…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {addingWorktree && (
        <NewWorktreeDialog
          folderId={folder.id}
          folderName={folder.name}
          onClose={() => setAddingWorktree(false)}
          // Into it, and into a chat in it, which is what the worktree rows in
          // the left column do: a checkout nobody is working in is a directory.
          onCreated={(id) => {
            useProjects.getState().setActive(folder.id, id)
            void useWorktreeChats.getState().openWorktree(id)
          }}
        />
      )}
    </div>
  )
}
