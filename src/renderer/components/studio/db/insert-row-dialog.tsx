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
import { cn } from "@/lib/utils"

import { dateInputKind, fromDateInput } from "@/lib/db/date-input"
import type { Column } from "@/lib/db/engines"

/**
 * The new row, as a form rather than as a draft line at the foot of the grid.
 *
 * The trailing line could only ever offer the columns the grid was showing, in
 * cells one line tall and as wide as whatever the column had been sized to —
 * a hidden column had no field at all, and a long value was typed through a
 * slot a few characters wide. A dialog gets one labelled field per column of
 * the table, whether or not the grid is drawing it.
 *
 * Values are typed as text and left to the engine to coerce, the way an edited
 * cell already is — except a temporal column, which gets the same native
 * picker the grid's own cells do rather than asking anyone to remember the
 * engine's literal format. A field left blank is *not set* rather than an
 * empty string, so the column's default (or NULL) applies — which is the only
 * way to insert a row that relies on one.
 */
export function InsertRowDialog({
  columns,
  isEditableType,
  onSubmit,
  onClose,
}: {
  columns: Column[]
  /** Engine-specific: a type this cannot be typed into is shown, disabled,
   * rather than hidden — the row is still insertable without it. */
  isEditableType: (type: string) => boolean
  /** Resolves to an error message on failure, null when the row landed. */
  onSubmit: (values: Record<string, string>) => Promise<string | null>
  onClose: () => void
}) {
  const fieldId = useId()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setFailure(null)
    // A picked date leaves the input in the shape `<input type>` uses; the
    // engines want their own literal. Nothing here is an instant — a new row
    // has no stored value to have come from a zone — so none is attached.
    const values = Object.fromEntries(
      Object.entries(draft)
        .filter(([, value]) => value.length > 0)
        .map(([name, value]) => {
          const kind = dateInputKind(byName.get(name)?.type ?? "")
          return [name, kind ? fromDateInput(value, kind, false) : value]
        })
    )
    const error = await onSubmit(values)
    setBusy(false)

    if (error) setFailure(error)
    else onClose()
  }

  const byName = new Map(columns.map((column) => [column.name, column]))

  const first = columns.find(
    (column) =>
      column.generatedExpression === null && isEditableType(column.type)
  )

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      {/* A column rather than the default grid, for the same reason the New
          table dialog is one: the fields are the only part that scrolls. */}
      <DialogContent className="flex max-h-[90svh] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 p-4 pb-0">
          <DialogTitle>New row</DialogTitle>
          <DialogDescription>
            A field left blank takes the column&apos;s default, or NULL.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
            {columns.map((column) => {
              const generated = column.generatedExpression !== null
              const editable = isEditableType(column.type)
              const picker =
                generated || !editable ? null : dateInputKind(column.type)
              const id = `${fieldId}-${column.name}`
              return (
                <div key={column.name}>
                  <div className="flex items-baseline gap-2">
                    <Label htmlFor={id} className="font-mono text-xs">
                      {column.name}
                    </Label>
                    <span className="truncate font-mono text-[0.65rem] text-muted-foreground">
                      {column.type}
                      {column.primaryKey && " · pk"}
                      {!column.nullable && !generated && " · not null"}
                    </span>
                  </div>
                  <Input
                    id={id}
                    autoFocus={column === first}
                    {...(picker
                      ? // Seconds rather than the minutes the inputs step in
                        // by default, so a timestamp column can be given them.
                        {
                          type: picker,
                          step: picker === "date" ? undefined : 1,
                        }
                      : {})}
                    value={draft[column.name] ?? ""}
                    disabled={busy || generated || !editable}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [column.name]: event.target.value,
                      }))
                    }
                    placeholder={
                      generated
                        ? "generated"
                        : !editable
                          ? "not editable here"
                          : column.default
                            ? column.default
                            : column.nullable
                              ? "NULL"
                              : ""
                    }
                    spellCheck={false}
                    className={cn(
                      "mt-1.5 font-mono text-xs md:text-xs",
                      // See the note in `result-grid.tsx`'s DateEditor: the
                      // native picker follows `color-scheme`, which the app
                      // sets nowhere else.
                      picker && "dark:[color-scheme:dark]"
                    )}
                  />
                </div>
              )
            })}
          </div>

          {failure && (
            <p className="shrink-0 px-4 text-xs whitespace-pre-wrap text-destructive">
              {failure}
            </p>
          )}

          <DialogFooter className="shrink-0 p-4">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Inserting…" : "Insert row"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
