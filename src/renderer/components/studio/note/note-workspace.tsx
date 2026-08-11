import { useCallback } from "react"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { NotebookPen } from "lucide-react"
import { cn } from "@/lib/utils"

import type { NoteRecord } from "@shared/api"
import { useNotes } from "@/lib/note/store"
import { SECTION_ACCENT } from "../activity-bar"
import { LoadedBlockEditor } from "./block-editor"

/**
 * One note, edited as rich text and stored as markdown.
 *
 * The editor itself is `MarkdownEditor`, shared with the templates dialog —
 * a template is the same markdown in a different file, and two editors would
 * be two block menus to keep in step.
 */
export function NoteWorkspace() {
  const notes = useNotes((state) => state.notes)
  const openIds = useNotes((state) => state.openIds)
  const selectedId = useNotes((state) => state.selectedId)

  const open = openIds.flatMap((id) => {
    const note = notes.find((candidate) => candidate.id === id)
    return note ? [note] : []
  })
  const activeId =
    selectedId && openIds.includes(selectedId) ? selectedId : null

  return (
    <div className="relative h-full">
      {/*
        An editor per open tab, hidden rather than unmounted — the way the
        Terminal panel stacks its sessions.

        Crepe takes its text once, at construction, so a pane that mounted one
        editor and swapped the note under it would be rebuilding ProseMirror on
        every tab click: back to a spinner, the caret at the top of the
        document, the scroll position gone and nothing left to undo. The text
        itself was never the cost — `loadBody` has it cached — the editing
        state was.
      */}
      {open.map((note) => (
        <div
          key={note.id}
          className={cn(
            "absolute inset-0",
            note.id !== activeId && "invisible"
          )}
        >
          <NotePane note={note} visible={note.id === activeId} />
        </div>
      ))}

      {activeId === null && (
        <Empty className="absolute inset-0 size-full border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon" style={{ color: SECTION_ACCENT.note }}>
              <NotebookPen />
            </EmptyMedia>
            <EmptyTitle>No note selected</EmptyTitle>
            <EmptyDescription>
              Pick one from the list on the left, or create one.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}

function NotePane({ note, visible }: { note: NoteRecord; visible: boolean }) {
  const loadBody = useNotes((state) => state.loadBody)
  const setBody = useNotes((state) => state.setBody)
  const adoptBlocks = useNotes((state) => state.adoptBlocks)

  const write = useCallback(
    (body: string) => setBody(note.id, body),
    [note.id, setBody]
  )
  const adopt = useCallback(
    (body: string) => adoptBlocks(note.id, body),
    [note.id, adoptBlocks]
  )

  return (
    <LoadedBlockEditor
      documentId={note.id}
      load={loadBody}
      onChange={write}
      onAdopt={adopt}
      visible={visible}
    />
  )
}
