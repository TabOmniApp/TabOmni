import { DRAWING_LANGUAGE, type NoteBlock } from "@shared/api"
import { noteFileNameOf, noteFileUrl } from "@shared/note-files"

/**
 * A note's document, as it is on disk.
 *
 * A note used to be markdown and is now BlockNote's own block model, written to
 * `notes/<id>.json`. What that bought is a document the editor does not have to
 * translate on every keystroke — BlockNote's markdown export is lossy by its own
 * documentation, so a note kept as markdown would have been serialised through a
 * converter that quietly drops what it has no block for, while the note was
 * being typed into. What it cost is a file no longer readable in another
 * editor, which is the trade `docs/design.md` records.
 *
 * `NoteBlock` itself moved to `shared/api.ts` when the preview server started
 * rendering the same document in the main process — it is the shape of a file
 * both sides read now, not this side's own idea. Re-exported here because
 * every walk over it still lives in this file, and its callers ask this file
 * for the type.
 */
export type { NoteBlock }

/** The block a drawing lives in. Here rather than beside its React component,
 * so that the walks below — and the store that calls them — do not have to
 * reach into the component layer for a string. */
export const DRAWING_BLOCK = "drawing"

/** A note that has never been opened has no file; an empty document is what the
 * editor should start on rather than a parse error. */
export function parseBody(text: string): NoteBlock[] {
  if (!text.trim()) return []
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? (parsed as NoteBlock[]) : []
  } catch {
    // A note is a file on disk and a half-written one is not a crash. Losing
    // the text would be worse than any alternative here, so this is the one
    // place that reports rather than swallowing.
    console.error("Could not read the note's blocks")
    return []
  }
}

export function serializeBody(blocks: NoteBlock[]): string {
  return JSON.stringify(blocks)
}

/** Every drawing a document refers to, in the order they appear. */
export function drawingIdsIn(blocks: NoteBlock[]): string[] {
  const ids: string[] = []
  walk(blocks, (block) => {
    const id = drawingIdOf(block)
    if (id && !ids.includes(id)) ids.push(id)
  })
  return ids
}

/**
 * Rewrites every drawing id in a document, keeping the blocks themselves.
 *
 * What duplicating a note needs: without it the copy and the original share
 * scenes, so editing one changes the other and deleting either takes the
 * other's drawings with it.
 */
export function mapDrawingIds(
  blocks: NoteBlock[],
  replace: (id: string) => string
): NoteBlock[] {
  return blocks.map((block) => {
    const id = drawingIdOf(block)
    const children = block.children
      ? mapDrawingIds(block.children, replace)
      : block.children

    if (!id) return children === block.children ? block : { ...block, children }
    return {
      ...block,
      props: { ...block.props, drawingId: replace(id) },
      ...(children ? { children } : {}),
    }
  })
}

/**
 * Turns the fences a markdown note carried its drawings in into drawing blocks.
 *
 * The one thing the migration cannot leave to BlockNote's markdown parser: it
 * knows nothing of this app's blocks, so a ```drawing fence arrives as a code
 * block whose text is an id — which would read as a code block full of a UUID
 * and, worse, would have that id's scene deleted along with the note without
 * anything ever pointing at it.
 */
export function adoptDrawingFences(blocks: NoteBlock[]): NoteBlock[] {
  return blocks.map((block) => {
    const children = block.children
      ? adoptDrawingFences(block.children)
      : block.children

    const id = fencedDrawingId(block)
    if (id) {
      return {
        ...(block.id ? { id: block.id } : {}),
        type: DRAWING_BLOCK,
        props: { drawingId: id },
      }
    }

    return children === block.children ? block : { ...block, children }
  })
}

/** Every file of the workspace's own the document points at — the pictures
 * dropped into it, each once. The same question `drawingIdsIn` asks. */
export function noteFileNamesIn(blocks: NoteBlock[]): string[] {
  const names: string[] = []
  walk(blocks, (block) => {
    const name = noteFileNameOf(block.props?.url)
    if (name && !names.includes(name)) names.push(name)
  })
  return names
}

/**
 * Rewrites the name in every note file URL, keeping the blocks themselves —
 * `mapDrawingIds` for the pictures, and what duplicating a note needs for the
 * same reason.
 */
export function mapNoteFileNames(
  blocks: NoteBlock[],
  replace: (fileName: string) => string
): NoteBlock[] {
  return blocks.map((block) => {
    const name = noteFileNameOf(block.props?.url)
    const children = block.children
      ? mapNoteFileNames(block.children, replace)
      : block.children

    if (!name) {
      return children === block.children ? block : { ...block, children }
    }
    return {
      ...block,
      props: { ...block.props, url: noteFileUrl(replace(name)) },
      ...(children ? { children } : {}),
    }
  })
}

/** The id a drawing block carries, or null for any other block. */
function drawingIdOf(block: NoteBlock): string | null {
  if (block.type !== DRAWING_BLOCK) return null
  const id = block.props?.drawingId
  return typeof id === "string" && id.trim() ? id.trim() : null
}

/**
 * The id inside a code block that used to be a drawing fence.
 *
 * BlockNote parses a fence into a `codeBlock` whose `language` is what followed
 * the backticks and whose text is the one line between them — so this is the
 * same two things `drawingIdsIn` read out of the markdown, read out of the
 * block instead.
 */
function fencedDrawingId(block: NoteBlock): string | null {
  if (block.type !== "codeBlock") return null
  if (block.props?.language !== DRAWING_LANGUAGE) return null

  const text = textOf(block.content).trim()
  return text || null
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((item: unknown) => {
      if (typeof item === "string") return item
      const text = (item as { text?: unknown } | null)?.text
      return typeof text === "string" ? text : ""
    })
    .join("")
}

function walk(blocks: NoteBlock[], visit: (block: NoteBlock) => void): void {
  for (const block of blocks) {
    visit(block)
    if (block.children) walk(block.children, visit)
  }
}
