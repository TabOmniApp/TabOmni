import { useId, useState } from "react"
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
import { FolderOpen } from "lucide-react"

import * as repo from "@/lib/db/projects"
import { useStudio } from "@/lib/store"

/** The folder's own name, as a starting point for the project name. */
function basename(target: string): string {
  return (
    target
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .pop() ?? target
  )
}

/**
 * Adds a folder that already exists on this machine as a project.
 *
 * The folder is opened where it is, not copied: edits made to it elsewhere are
 * edits to their repository, and their git sees them. That is stated in the
 * dialog because it is the one thing about this that could surprise someone.
 */
export function ImportProjectDialog({ onClose }: { onClose: () => void }) {
  const importProject = useStudio((state) => state.importProject)

  const nameId = useId()
  const pathId = useId()

  const [path, setPath] = useState("")
  const [name, setName] = useState("")

  async function browse() {
    const chosen = await repo.pickDirectory()
    if (chosen) {
      setPath(chosen)
      setName((current) => current || basename(chosen))
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!path) return

    void importProject({ path, name: name.trim() || basename(path) })
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import a project</DialogTitle>
          <DialogDescription>
            The folder is opened where it is. Files in it stay in that folder —
            nothing is copied, and deleting the project later leaves it
            untouched.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor={pathId} className="text-xs font-medium">
              Folder
            </Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                id={pathId}
                value={path}
                onChange={(event) => {
                  const next = event.target.value
                  setPath(next)
                  setName((current) => current || basename(next))
                }}
                placeholder="~/code/my-app"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void browse()}
              >
                <FolderOpen data-icon="inline-start" />
                Browse
              </Button>
            </div>
          </div>

          <div>
            <Label htmlFor={nameId} className="text-xs font-medium">
              Name
            </Label>
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1.5"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!path}>
              Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
