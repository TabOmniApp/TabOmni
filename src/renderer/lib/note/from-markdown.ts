import { BlockNoteEditor } from "@blocknote/core"

import type { NoteBody } from "@shared/api"
import { adoptDrawingFences, parseBody, type NoteBlock } from "./blocks"

/**
 * Reading a note an older build wrote.
 *
 * Notes were markdown until BlockNote replaced Milkdown, and the ones already
 * on disk are converted the first time they are opened rather than in a pass
 * over the whole directory at startup — a migration that has to be right about
 * every note before the user has opened any of them is a migration that fails
 * loudly at the worst moment.
 *
 * The parser is BlockNote's own, which means an editor: `tryParseMarkdownToBlocks`
 * is a method rather than a function, and there is no lighter way in. One is
 * built here on first use and kept — it is never mounted and never shown, and
 * the alternative is a second editor per note being converted.
 */
let parser: BlockNoteEditor | null = null

/**
 * The blocks a markdown note becomes.
 *
 * The default schema, not the notes panel's: a fence is a code block to any
 * parser, and `adoptDrawingFences` is what turns the drawing ones back into
 * drawing blocks afterwards. Keeping the drawing block out of here is what
 * keeps this file — and so the store — clear of the component layer.
 */
export function blocksFromMarkdown(markdown: string): NoteBlock[] {
  parser ??= BlockNoteEditor.create()
  return adoptDrawingFences(
    parser.tryParseMarkdownToBlocks(markdown) as NoteBlock[]
  )
}

/** Whichever of the two formats came back, as blocks. */
export function blocksOf(body: NoteBody): NoteBlock[] {
  return body.format === "markdown"
    ? blocksFromMarkdown(body.text)
    : parseBody(body.text)
}
