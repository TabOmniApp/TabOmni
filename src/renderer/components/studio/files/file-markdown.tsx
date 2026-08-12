import { MarkdownView } from "../markdown-view"
import "./file-markdown.css"

/**
 * A `.md` file as the document it is.
 *
 * The same renderer the chat transcript uses, in a column rather than a bubble:
 * a measure the eye can track back along, and the type scale a heading in a
 * document wants — `markdown-view.css` is deliberately flat, because `##` in a
 * chat message means "next section" rather than "twice as large", and in a
 * README it means exactly that.
 *
 * Read-only, and no second copy of the text: this draws `docs[path]`, the same
 * buffer the editor writes into, so switching back to it and typing and
 * switching here again shows what was typed rather than what is on disk.
 */
export function FileMarkdown({ text }: { text: string }) {
  return (
    <div className="h-full overflow-auto">
      <MarkdownView
        source={text}
        className="markdown-document mx-auto max-w-2xl px-8 py-6 text-[0.9375rem]"
      />
    </div>
  )
}
