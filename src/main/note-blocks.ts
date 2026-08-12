import type { NoteBlock } from "../shared/api"

/**
 * Reading a note's document in the main process.
 *
 * The renderer has its own walks over the same blocks in `lib/note/blocks.ts`,
 * and neither side may import the other's — so these two are the parse and the
 * one walk the preview server needs, and nothing else. Keeping them apart is
 * cheaper than the alternative it would take to share them: the renderer's file
 * is about editing a document (cloning drawings for a duplicate, adopting the
 * fences an older build wrote), and none of that has a meaning here.
 */

/** The blocks in a note's file, or none for a file that is empty, half-written
 * or not an array. A preview is a read; it reports and shows an empty note
 * rather than refusing to answer. */
export function parseNote(text: string): NoteBlock[] {
  if (!text.trim()) return []
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? (parsed as NoteBlock[]) : []
  } catch {
    console.error("Could not read the note's blocks")
    return []
  }
}

/** Every drawing the document points at, in the order they appear and each
 * once — a note can hold the same drawing twice, and the file behind it is
 * read by id. */
export function drawingIdsIn(blocks: NoteBlock[]): string[] {
  const ids: string[] = []

  const walk = (nodes: NoteBlock[]): void => {
    for (const node of nodes) {
      if (node.type === "drawing") {
        const id = node.props?.drawingId
        const trimmed = typeof id === "string" ? id.trim() : ""
        if (trimmed && !ids.includes(trimmed)) ids.push(trimmed)
      }
      if (node.children) walk(node.children)
    }
  }

  walk(blocks)
  return ids
}
