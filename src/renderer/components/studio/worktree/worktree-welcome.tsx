import { FolderGit2, GitBranch, Layers, TriangleAlert } from "lucide-react"

import type { ChatPlace } from "@shared/api"
import { useStudio } from "@/lib/store"
import { useWorktrees } from "@/lib/worktree/store"

/**
 * What a chat with nothing in it yet opens on: where this chat actually is.
 *
 * A conversation with nothing in it has a whole pane and one sentence to put in
 * it, and there is something worth saying instead — which directory the turn
 * will run in. Somebody who has three checkouts of one project open needs that
 * before they type anything, because the alternative is asking an agent to
 * change the wrong one.
 *
 * Two shapes, because the two places are not the same promise. In a checkout it
 * says **nothing was copied**, on purpose: that is the whole point of
 * `git worktree` over duplicating a directory, and a line claiming N files had
 * been copied would be describing a different tool. In a project's own working
 * tree it says the opposite of the reassurance — this is the branch you have
 * checked out, and an edit here is an edit to your work — since that is the one
 * fact that changes how the next sentence should be phrased.
 */
export function WorktreeWelcome({ place }: { place: ChatPlace | null }) {
  const worktrees = useWorktrees((state) => state.worktrees)
  const folders = useStudio((state) => state.folders)

  // Between the checkout being removed and its chats closing. The chat is
  // still readable — the conversation is on disk — so this says nothing rather
  // than claiming a directory that has gone.
  if (!place) return null

  const project =
    folders.find((folder) => folder.id === place.folderId)?.name ??
    "this project"

  if (place.worktreeId === null) {
    const path = folders.find((folder) => folder.id === place.folderId)?.path

    return (
      <div className="space-y-3">
        <div className="rounded-lg bg-muted px-4 py-3 text-sm">
          You are in <span className="font-medium">{project}</span> itself — the
          working tree you have checked out
        </div>

        <dl className="space-y-2 text-xs text-muted-foreground">
          {/* First, because it is the difference between this chat and every
              other one in the app: there is no branch to throw away. */}
          <Line Icon={TriangleAlert}>
            Edits here change the files you are working in. Use{" "}
            <span className="font-medium">Plan</span> or{" "}
            <span className="font-medium">Ask</span> in the toolbar below if you
            would rather be asked first.
          </Line>

          <Line Icon={GitBranch}>
            Make a worktree from this project&rsquo;s <code>+</code> for work
            that should happen on a branch of its own
          </Line>

          {path && (
            <Line Icon={FolderGit2}>
              <span className="font-mono break-all">{path}</span>
            </Line>
          )}
        </dl>
      </div>
    )
  }

  const worktree = worktrees.find((entry) => entry.id === place.worktreeId)
  if (!worktree) return null

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-muted px-4 py-3 text-sm">
        You are in a checkout of <span className="font-medium">{project}</span>{" "}
        on <code className="font-mono">{worktree.branch}</code>
      </div>

      <dl className="space-y-2 text-xs text-muted-foreground">
        <Line Icon={GitBranch}>
          Branched <code className="font-mono">{worktree.branch}</code>
          {worktree.from ? (
            <>
              {" from "}
              <code className="font-mono">{worktree.from}</code>
            </>
          ) : null}
        </Line>

        <Line Icon={Layers}>
          Shares this project&rsquo;s history — nothing was copied
        </Line>

        {/* The path last and in full: it is the least interesting thing here
            until the moment somebody needs to reach it from a terminal. */}
        <Line Icon={FolderGit2}>
          <span className="font-mono break-all">{worktree.path}</span>
        </Line>
      </dl>
    </div>
  )
}

function Line({
  Icon,
  children,
}: {
  Icon: typeof GitBranch
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}
