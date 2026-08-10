import { useCallback } from "react"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { NotebookPen } from "lucide-react"

import type { NoteRecord } from "@shared/api"
import { useNotes } from "@/lib/note/store"
import { SECTION_ACCENT } from "../activity-bar"
import { LoadedMarkdownEditor } from "./markdown-editor"

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

  const note =
    selectedId && openIds.includes(selectedId)
      ? notes.find((candidate) => candidate.id === selectedId)
      : undefined

  if (!note) {
    return (
      <Empty className="size-full border-0">
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
    )
  }

  return <NotePane note={note} />
}

function NotePane({ note }: { note: NoteRecord }) {
  const loadBody = useNotes((state) => state.loadBody)
  const setBody = useNotes((state) => state.setBody)

  const write = useCallback(
    (markdown: string) => setBody(note.id, markdown),
    [note.id, setBody]
  )

  return (
    <LoadedMarkdownEditor
      documentId={note.id}
      load={loadBody}
      onChange={write}
    />
  )
}
