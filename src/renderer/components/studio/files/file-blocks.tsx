import { useCallback, useState } from "react"

import {
  blocksJsonOf,
  serializeBlockFile,
  splitFrontmatter,
  withFrontmatter,
} from "@/lib/files/block-doc"
import { isNote } from "@/lib/files/viewers"
import type { NoteBlock } from "@/lib/note/blocks"
import { blocksFromMarkdown } from "@/lib/note/from-markdown"
import { BlockEditor, type Editor } from "../note/block-editor"

/**
 * A `.note` or a `.md`, in the Notes panel's own block editor.
 *
 * The same `BlockEditor` the Notes panel mounts, so there is one prose editor in
 * the studio and one slash menu to keep in step — what differs is where the
 * document lives and what it is written back as. A note in the Notes panel is a
 * record under `~/.tabomni` that the notes store writes as it is typed; these
 * are files in one of the workspace's folders, so they go through the files
 * store like every other tab: typing marks it dirty, ⌘S and the header's Save
 * write it, and closing the tab flushes it. That is the Explorer's bargain
 * rather than the Notes panel's, and it is the right one here — the file is in
 * somebody's repository, beside their source, and a rich-text pane that wrote to
 * it on every keystroke would be committing to their working tree while they
 * thought.
 *
 * **The two files are not the same bargain, though, and the difference is worth
 * knowing before choosing this over the text editor.** A `.note` holds the
 * editor's own block document, so what is saved is exactly what was on screen. A
 * `.md` holds markdown, and BlockNote's markdown export is lossy by its own
 * documentation — children of blocks that are not list items are un-nested,
 * some styles are dropped — and it prints the *whole* file from the document, so
 * the first save reflows every line whether or not it was edited. Nothing is
 * written until there is an edit, and the text editor stays the default for a
 * `.md`, which is what keeps this a choice rather than a surprise. Frontmatter
 * is carried around the editor untouched; `lib/files/block-doc.ts` says why.
 *
 * Drawings and dropped pictures are off for a `.md` for the same reason — see
 * `workspaceFiles` on `BlockEditor`.
 */
export function FileBlocks({
  path,
  text,
  onChange,
  visible,
}: {
  path: string
  text: string
  onChange: (text: string) => void
  visible: boolean
}) {
  const note = isNote(path)

  /*
   * What the editor starts on, read once.
   *
   * State with an initialiser rather than anything derived from `text`, which
   * changes on every keystroke — it is what this editor just wrote. Parsing it
   * per render would be a parse of the whole document per character, and the
   * editor takes its content at construction anyway. The pane keys this
   * component by path, so a different file starts a fresh read.
   *
   * The frontmatter is kept here beside the blocks because it is the half the
   * editor never sees, and every save has to put it back.
   */
  const [initial] = useState(() => read(path, text))

  const write = useCallback(
    (blocks: NoteBlock[], editor: Editor) => {
      if (note) {
        onChange(serializeBlockFile(blocks))
        return
      }

      // Asked of the editor rather than of the blocks it just handed over: the
      // document is its own schema's, and printing it is the one thing only the
      // editor can do. With no argument it prints all of it, which is what a
      // file is.
      const markdown = editor.blocksToMarkdownLossy()
      // Exactly one trailing newline, like every other file in a repository —
      // the exporter's own output ends wherever the last block did.
      onChange(withFrontmatter(initial.frontmatter, `${markdown.trimEnd()}\n`))
    },
    [note, onChange, initial.frontmatter]
  )

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Said out loud, because the alternative is a file that looks as though
          it lost its first six lines. The strip is the pane's own failure line
          in shape and weight — it is the same kind of thing: something about
          this file the editor cannot show. */}
      {initial.frontmatter !== "" && (
        <p className="shrink-0 border-b px-3 py-1.5 text-xs text-muted-foreground">
          Frontmatter is kept exactly as it is and not shown here. Open the text
          editor to change it.
        </p>
      )}

      <div className="min-h-0 flex-1">
        <BlockEditor
          key={path}
          initial={initial.blocks}
          onChange={write}
          visible={visible}
          workspaceFiles={note}
        />
      </div>
    </div>
  )
}

/** One file's text as blocks, plus whatever was held back from the editor. */
function read(
  path: string,
  text: string
): { blocks: NoteBlock[]; frontmatter: string } {
  if (!isNote(path)) {
    const { frontmatter, body } = splitFrontmatter(text)
    // Without the fences: a `.md` is written back as markdown, and a drawing
    // block has none — see `blocksFromMarkdown`.
    return {
      frontmatter,
      blocks: blocksFromMarkdown(body, { drawings: false }),
    }
  }

  if (!text.trim()) return { blocks: [], frontmatter: "" }
  // A `.note` that is not the JSON this app writes is read as markdown rather
  // than as an empty document — `blocksJsonOf` says why.
  const blocks = blocksJsonOf(text) ?? blocksFromMarkdown(text)
  return { blocks, frontmatter: "" }
}
