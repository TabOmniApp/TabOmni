import { useState, type ReactNode } from "react"
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

/**
 * Renames something that has a name and an `alter` behind it — a table, a
 * column — from wherever the rename was asked for.
 *
 * Mount it only while renaming (`{renaming && <RenameDialog …>}`): the current
 * name seeds the field once, on mount, rather than being kept in sync with a
 * value the user is in the middle of editing.
 *
 * Also the "name this new thing" dialog, with `currentName=""` and its own
 * verb: asking for a name and asking for a different name are the same field,
 * the same validation and the same way of reporting that the name is taken —
 * see the Explorer's New file. Only the button says which one it is.
 */
export function RenameDialog({
  title,
  description,
  label,
  currentName,
  submitLabel = "Rename",
  pendingLabel = "Renaming…",
  onRename,
  onClose,
}: {
  title: string
  /** For a rename whose reach is not obvious — a workspace folder's name is
   * the studio's own label and not the directory on disk, and the dialog is
   * where that has to be said. */
  description?: ReactNode
  /** The accessible name for the field, e.g. "Table name". */
  label: string
  currentName: string
  /** What the confirm button says, and what it says while it is working. */
  submitLabel?: string
  pendingLabel?: string
  /** Resolves to an error message on failure, which is shown in the dialog so
   * the name can be fixed instead of retyped. */
  onRename: (name: string) => Promise<string | null>
  onClose: () => void
}) {
  const [name, setName] = useState(currentName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !name.trim() || name === currentName) return
    setBusy(true)
    setError(null)
    const failure = await onRename(name)
    setBusy(false)
    if (failure) setError(failure)
    else onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            spellCheck={false}
            aria-label={label}
            className="font-mono"
          />
          {error && (
            <p className="font-mono text-xs whitespace-pre-wrap text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? pendingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
