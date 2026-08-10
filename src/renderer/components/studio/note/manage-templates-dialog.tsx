import { useCallback, useEffect, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { LayoutTemplate, Plus, Trash2 } from "lucide-react"

import type { NoteTemplate } from "@shared/api"
import { useNoteTemplates } from "@/lib/note/templates"
import { IconButton } from "../icon-button"
import { LoadedMarkdownEditor } from "./markdown-editor"

/**
 * Where templates are added, edited and deleted.
 *
 * A dialog of its own rather than a branch of the notes tree, because a
 * template is not a note: it has no folder, no tab and no place in the strip,
 * and putting it in the sidebar would mean every list of notes remembering to
 * leave it out. What it *is* is the same markdown, so the pane on the right is
 * the same `MarkdownEditor` the note pane uses — block menu, tables, drawings
 * and all.
 *
 * Nothing here is confirmed or applied: a name typed on the right is the
 * template's name, and the text is written 400ms after the typing stops, the
 * way a note's is. `flush` on the way out is what covers the last keystrokes
 * before the dialog unmounts.
 */
export function ManageTemplatesDialog({
  initialTemplateId = null,
  onClose,
}: {
  /** Opened on this template — what "Save as template" hands over, so the
   * template just made is the one on screen and ready to be renamed. */
  initialTemplateId?: string | null
  onClose: () => void
}) {
  const templates = useNoteTemplates((state) => state.templates)
  const refresh = useNoteTemplates((state) => state.refresh)
  const create = useNoteTemplates((state) => state.create)
  const rename = useNoteTemplates((state) => state.rename)
  const remove = useNoteTemplates((state) => state.remove)
  const loadBody = useNoteTemplates((state) => state.loadBody)
  const setBody = useNoteTemplates((state) => state.setBody)
  const flush = useNoteTemplates((state) => state.flush)

  const [selectedId, setSelectedId] = useState<string | null>(initialTemplateId)
  const [pendingDelete, setPendingDelete] = useState<NoteTemplate | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Falls back to the first template whenever the selected one is not there —
  // before the first read has landed, and again the moment after a delete.
  // Derived rather than corrected in an effect, so there is no render in
  // between showing an empty pane over a list that has templates in it.
  const selected =
    templates.find((one) => one.id === selectedId) ?? templates[0] ?? null

  // Keyed off the template actually on screen rather than `selectedId`, which
  // is null until something is picked while the pane already shows the first.
  const openId = selected?.id ?? null
  const write = useCallback(
    (markdown: string) => {
      if (openId) setBody(openId, markdown)
    },
    [openId, setBody]
  )

  function close() {
    // Before the editor unmounts: whatever it last handed over is still
    // sitting in the debounce, and so is a name typed a moment ago.
    flush()
    onClose()
  }

  async function addTemplate() {
    const template = await create()
    setSelectedId(template.id)
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <DialogContent className="flex h-[80vh] w-[80vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="text-sm">Note templates</DialogTitle>
          <DialogDescription className="text-xs">
            The text a new note can start from. Edited here the way a note is,
            and saved as you type.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-56 shrink-0 flex-col border-r">
            <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
              <span className="text-[0.7rem] font-medium tracking-wider text-muted-foreground uppercase">
                Templates
              </span>
              <IconButton
                label="New template"
                onClick={() => void addTemplate()}
              >
                <Plus />
              </IconButton>
            </div>

            <ul className="min-h-0 flex-1 overflow-auto py-1">
              {templates.map((template) => (
                <li key={template.id} className="group/row">
                  <div
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                      template.id === openId
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(template.id)}
                      className="min-w-0 flex-1 truncate text-left"
                      title={template.name}
                    >
                      {template.name}
                    </button>
                    <span className="shrink-0 opacity-0 group-hover/row:opacity-100">
                      <IconButton
                        label={`Delete ${template.name}`}
                        onClick={() => setPendingDelete(template)}
                      >
                        <Trash2 />
                      </IconButton>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {selected ? (
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="grid shrink-0 gap-2 border-b px-4 py-3 sm:grid-cols-2">
                <Input
                  value={selected.name}
                  onChange={(event) =>
                    rename(
                      selected.id,
                      event.target.value,
                      selected.description
                    )
                  }
                  placeholder="Template name"
                  aria-label="Template name"
                  className="h-7 text-xs md:text-xs"
                />
                <Input
                  value={selected.description}
                  onChange={(event) =>
                    rename(selected.id, selected.name, event.target.value)
                  }
                  placeholder="What it is for (optional)"
                  aria-label="Template description"
                  className="h-7 text-xs md:text-xs"
                />
              </div>

              <div className="min-h-0 flex-1">
                <LoadedMarkdownEditor
                  documentId={selected.id}
                  load={loadBody}
                  onChange={write}
                />
              </div>
            </div>
          ) : (
            <Empty className="flex-1 border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LayoutTemplate />
                </EmptyMedia>
                <EmptyTitle>No templates</EmptyTitle>
                <EmptyDescription className="text-xs">
                  A template is the text a note starts from — the headings a
                  meeting always needs, the fields a bug report is useless
                  without.
                </EmptyDescription>
              </EmptyHeader>
              <Button size="sm" onClick={() => void addTemplate()}>
                <Plus />
                New template
              </Button>
            </Empty>
          )}
        </div>

        <AlertDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete “{pendingDelete?.name}”?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Notes already made from it are not affected. This can’t be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  if (pendingDelete) void remove(pendingDelete.id)
                  setPendingDelete(null)
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
