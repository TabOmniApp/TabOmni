import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWorktrees } from "@/lib/worktree/store"

/**
 * Adding a `git worktree` to a project.
 *
 * Two fields, because `git worktree add -b <branch> <path> <from>` has exactly
 * two things a person decides — the path is this app's (see `worktreePath` in
 * `main/store.ts`), and it is deliberately not offered: a checkout somewhere of
 * the user's choosing is a directory the studio would then be responsible for
 * finding again.
 *
 * `from` defaults to `HEAD` rather than `main`. A worktree is nearly always cut
 * from what is checked out right now, and a repository whose trunk is called
 * something else should not have to correct a guess.
 */
export function NewWorktreeDialog({
  folderId,
  folderName,
  onClose,
  onCreated,
}: {
  folderId: string
  folderName: string
  onClose: () => void
  /** The new worktree's id, so the caller can open it straight away. */
  onCreated: (id: string) => void
}) {
  const create = useWorktrees((state) => state.create)

  const [branch, setBranch] = useState("")
  const [from, setFrom] = useState("HEAD")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!branch.trim() || busy) return

    setBusy(true)
    setError(null)
    const failure = await create(folderId, branch, from.trim() || "HEAD")
    setBusy(false)

    if (failure) {
      // git's own stderr — "fatal: a branch named 'x' already exists" says more
      // than a sentence written here could.
      setError(failure)
      return
    }

    const made = useWorktrees.getState().worktrees.at(-1)
    if (made) onCreated(made.id)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New worktree</DialogTitle>
          <DialogDescription>
            A second checkout of {folderName} on a branch of its own, so work
            here does not touch what is checked out in the project itself.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="worktree-branch">Branch</Label>
            <Input
              id="worktree-branch"
              autoFocus
              value={branch}
              placeholder="fix-orders"
              onChange={(event) => setBranch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit()
              }}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="worktree-from">Cut from</Label>
            <Input
              id="worktree-from"
              value={from}
              placeholder="HEAD"
              onChange={(event) => setFrom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit()
              }}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Anything git accepts — <code className="font-mono">HEAD</code>,{" "}
              <code className="font-mono">main</code>,{" "}
              <code className="font-mono">origin/main</code>.
            </p>
          </div>

          {error && (
            <p className="font-mono text-xs whitespace-pre-wrap text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!branch.trim() || busy}
          >
            {busy ? "Adding…" : "Add worktree"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
