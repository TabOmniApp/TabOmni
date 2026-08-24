import {
  ChevronRight,
  Copy,
  ExternalLink,
  MessageSquare,
  MoreHorizontal,
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
import { useWorktreeChats } from "@/lib/worktree-chat/store"
import { IconButton } from "../icon-button"

/**
 * Where the workbench is working, said in the title bar: `project › branch`.
 *
 * Conductor's own crumb, and the reason it earns the bar it used to be left
 * deliberately empty of. That emptiness had a reason — the workspace holds
 * several folders, each on a branch of its own, so a single line here could only
 * ever be about one of them — and what changed is that there *is* one of them
 * now: `activeFolderId` on `lib/projects.ts`, moved by clicking a row in the
 * left column, and everything on screen already follows it (the Explorer's
 * root, the dock's shell, the chat that opens). A window whose whole right-hand
 * side is about one project should be able to say which.
 *
 * **Labels, not pickers.** The way to another project or another branch is the
 * column on the left, which is on screen and is a list; turning these into two
 * dropdowns would be a second way to do the one thing that column exists for.
 * So this reads, and the `…` beside it carries only what has nowhere else to be.
 *
 * It resolves through `shownRootOf` — the same call the Explorer's own tree
 * makes — so the crumb and the tree can never disagree about which project is
 * on screen, the fallbacks included.
 */
export function ProjectCrumbs() {
  const folders = useStudio((state) => state.folders)
  const branches = useStudio((state) => state.branches)
  const activeFolderId = useProjects((state) => state.activeFolderId)

  const shown = shownRootOf(folders, activeFolderId)
  const folder = folders.find((entry) => entry.id === shown?.folderId) ?? null

  // Nothing pointed at yet, and nothing to say about it. No placeholder either:
  // an empty workspace is told so by the panel it would add a folder from, and
  // a crumb reading "no project" is a line of chrome saying nothing twice.
  if (folder === null || shown === null) return null

  const branch = branches[folder.id]

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
          are in the Explorer's own root menu, beside the tree that lists what
          is in it; switching project is the left column. What is left is the
          two things about the directory itself, and a chat in it.
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
          {/* In whatever the crumb is currently saying, since that is the
              directory the rest of the window is already about. */}
          <DropdownMenuItem
            onClick={() =>
              void useWorktreeChats.getState().create({ folderId: folder.id })
            }
          >
            <MessageSquare className="text-muted-foreground" />
            New chat here
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
