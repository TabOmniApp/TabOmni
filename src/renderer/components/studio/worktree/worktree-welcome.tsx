import { FolderGit2, GitBranch, Layers } from "lucide-react"

import { useStudio } from "@/lib/store"
import { useWorktrees } from "@/lib/worktree/store"

/**
 * What a chat in a fresh worktree opens on: where this checkout came from.
 *
 * A conversation with nothing in it yet has a whole pane and one sentence to
 * put in it, and in a worktree there is something worth saying instead — which
 * branch you are on, and what it was cut from. Somebody who has three
 * checkouts of one project open needs that before they type anything, because
 * the alternative is asking an agent to change the wrong one.
 *
 * It says **nothing was copied**, on purpose. That is the whole point of
 * `git worktree` over duplicating a directory: one object store, one clone, a
 * second working tree. A line claiming N files had been copied would be
 * describing a different tool.
 */
export function WorktreeWelcome({ worktreeId }: { worktreeId: string }) {
  const worktree = useWorktrees((state) =>
    state.worktrees.find((entry) => entry.id === worktreeId)
  )
  const folders = useStudio((state) => state.folders)

  // Between the worktree being removed and its chats closing. The chat is
  // still readable — the conversation is on disk — so this says nothing rather
  // than claiming a checkout that has gone.
  if (!worktree) return null

  const project =
    folders.find((folder) => folder.id === worktree.folderId)?.name ??
    "this project"

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
