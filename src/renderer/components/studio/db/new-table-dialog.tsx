import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"

import { getAdapter, type ColumnDraft } from "@/lib/db/engines"
import { useExplorer } from "@/lib/db/explorer-store"
import { IconButton } from "../icon-button"

export function NewTableDialog({ onClose }: { onClose: () => void }) {
  const engine = useExplorer((state) => state.engine)
  const defaultSchema = useExplorer((state) => state.defaultSchema)
  const createTable = useExplorer((state) => state.createTable)

  // Only rendered while a database is open (see `database-tree.tsx`).
  const adapter = getAdapter(engine!)

  const nameId = useId()

  const [draft, setDraft] = useState(() => adapter.initialDraft(defaultSchema))
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const invalid = adapter.draftError(draft)
  const sql = invalid ? null : adapter.createTableSql(draft)

  function patchColumn(index: number, patch: Partial<ColumnDraft>) {
    setDraft((current) => ({
      ...current,
      columns: current.columns.map((column, at) =>
        at === index ? { ...column, ...patch } : column
      ),
    }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || invalid) return

    setBusy(true)
    setFailure(null)
    const error = await createTable(draft)
    setBusy(false)

    if (error) setFailure(error)
    else onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      {/*
        Laid out as a column rather than the default grid: the column list in
        the middle is the only part that scrolls, so the heading and the footer
        have to stay put. Padding moves onto the sections for the same reason.
      */}
      <DialogContent className="flex max-h-[90svh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 p-4 pb-0">
          <DialogTitle>New table</DialogTitle>
          <DialogDescription>
            Runs a <code className="font-mono">create table</code> against this
            database.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-4 pt-4">
            <Label htmlFor={nameId} className="text-xs font-medium">
              Name
            </Label>
            <Input
              id={nameId}
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="todos"
              autoFocus
              spellCheck={false}
              className="mt-1.5 font-mono"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="pb-1.5 font-medium">
                    Column
                  </th>
                  <th scope="col" className="pb-1.5 pl-2 font-medium">
                    Type
                  </th>
                  <th scope="col" className="pb-1.5 pl-2 font-medium">
                    Default
                  </th>
                  <th
                    scope="col"
                    className="px-2 pb-1.5 text-center font-medium"
                  >
                    Null
                  </th>
                  <th
                    scope="col"
                    className="px-2 pb-1.5 text-center font-medium"
                  >
                    PK
                  </th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {draft.columns.map((column, index) => (
                  <tr key={column.id}>
                    <td className="py-0.5">
                      <Field
                        value={column.name}
                        onChange={(name) => patchColumn(index, { name })}
                        placeholder="title"
                        label={`Name of column ${index + 1}`}
                      />
                    </td>
                    <td className="py-0.5 pl-2">
                      <Select
                        value={column.type}
                        onValueChange={(type) =>
                          patchColumn(index, { type: type ?? "" })
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={`Type of column ${index + 1}`}
                          className="h-7 w-full font-mono text-xs"
                        >
                          <SelectValue placeholder="type" />
                        </SelectTrigger>
                        <SelectContent>
                          {adapter.columnTypes.map((type) => (
                            <SelectItem
                              key={type}
                              value={type}
                              className="font-mono text-xs"
                            >
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-0.5 pl-2">
                      <Field
                        value={column.default}
                        onChange={(value) =>
                          patchColumn(index, { default: value })
                        }
                        placeholder="—"
                        label={`Default for column ${index + 1}`}
                      />
                    </td>
                    <td className="px-2 text-center">
                      <Checkbox
                        checked={column.nullable}
                        onCheckedChange={(nullable) =>
                          patchColumn(index, { nullable })
                        }
                        aria-label={`Column ${index + 1} is nullable`}
                      />
                    </td>
                    <td className="px-2 text-center">
                      <Checkbox
                        checked={column.primaryKey}
                        onCheckedChange={(primaryKey) =>
                          patchColumn(index, {
                            primaryKey,
                            // A key column cannot be null, so ticking PK while
                            // "Null" stayed ticked would show a contradiction.
                            nullable: primaryKey ? false : column.nullable,
                          })
                        }
                        aria-label={`Column ${index + 1} is part of the primary key`}
                      />
                    </td>
                    <td className="text-right">
                      <IconButton
                        label={`Remove column ${index + 1}`}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            columns: current.columns.filter(
                              (_, at) => at !== index
                            ),
                          }))
                        }
                        className="hover:text-destructive"
                      >
                        <Trash2 />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="mt-2"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  columns: [...current.columns, adapter.newColumn()],
                }))
              }
            >
              <Plus data-icon="inline-start" />
              Add column
            </Button>

            <p className="mt-4 text-[0.65rem] text-muted-foreground">
              A default is an expression, not a literal:{" "}
              <code className="font-mono">now()</code> calls the function, and a
              string needs its own quotes —{" "}
              <code className="font-mono">&apos;pending&apos;</code>.
            </p>

            {/* Shown before it runs, because this is also the fastest way to
              learn what the form is doing. */}
            <h3 className="mt-4 text-[0.7rem] font-medium tracking-wider text-muted-foreground uppercase">
              SQL
            </h3>
            <pre className="mt-1.5 overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs">
              {sql ?? invalid}
            </pre>

            {failure && (
              <pre className="mt-3 font-mono text-xs whitespace-pre-wrap text-destructive">
                {failure}
              </pre>
            )}
          </div>

          {/* `m-0` cancels the negative margins the footer uses to sit flush
              inside a padded dialog — this one carries no padding of its own. */}
          <DialogFooter className="m-0 shrink-0">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || invalid !== null}>
              {busy ? "Creating…" : "Create table"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
}) {
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={label}
      spellCheck={false}
      className="h-7 font-mono text-xs"
    />
  )
}
