import type { NoteBlock } from "../shared/api"
import { noteFileNameOf } from "../shared/note-files"

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

/** Every file of the workspace's own the document points at, each once. The
 * same question as `drawingIdsIn`, asked of the pictures. */
export function noteFileNamesIn(blocks: NoteBlock[]): string[] {
  const names: string[] = []

  const walk = (nodes: NoteBlock[]): void => {
    for (const node of nodes) {
      const name = noteFileNameOf(node.props?.url)
      if (name && !names.includes(name)) names.push(name)
      if (node.children) walk(node.children)
    }
  }

  walk(blocks)
  return names
}

/**
 * The same document with every `note-file://` URL replaced by what `resolved`
 * holds for it.
 *
 * Why the substitution happens here rather than in `note-html.ts`: that file
 * renders one block at a time and would have to carry the pictures through every
 * case to reach the two that hold a URL, and its scheme list is the security
 * boundary — a URL arriving there should already be one a browser can follow. So
 * the document is resolved first, and what the renderer sees is a `data:` URL
 * like any other.
 *
 * A name with nothing resolved for it is left alone, which is a URL in a scheme
 * `safeUrl` refuses: a picture whose file has gone renders as the "missing" line
 * for a file the page cannot reach, rather than a broken image.
 */
export function withNoteFileUrls(
  blocks: NoteBlock[],
  resolved: ReadonlyMap<string, string>
): NoteBlock[] {
  return blocks.map((block) => {
    const children = block.children
      ? withNoteFileUrls(block.children, resolved)
      : block.children

    const url = resolved.get(noteFileNameOf(block.props?.url) ?? "")
    if (!url) {
      return children === block.children ? block : { ...block, children }
    }
    return {
      ...block,
      props: { ...block.props, url },
      ...(children ? { children } : {}),
    }
  })
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
