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
 *
 * **Laid out like the block editor, because it is the same file.** A `.md` has
 * three views and two of them set the text as a document — this one and the
 * Markdown editor — so switching between them must not move the text. The
 * measure is `--prose-measure`, the token both read (`styles/globals.css`), and
 * the side padding is the proportional-with-a-ceiling one from
 * `note/note-editor.css`: on a wide pane the centring decides the margin and
 * the two are identical, and on a pane 500px across they narrow together
 * instead of one of them keeping a gutter it cannot afford.
 *
 * It used to be `max-w-2xl` with `px-8` inside it, which made the column 38rem
 * against the editor's 60 — a document with half the pane empty on either side,
 * and a visible jump every time the view was switched.
 */
export function FileMarkdown({ text }: { text: string }) {
  return (
    // Padding on the scrolling box and the measure inside it, which is the
    // editor's own arrangement: padding on the centred column instead would
    // come out of the measure rather than out of the margin.
    <div className="h-full overflow-auto px-[clamp(2rem,4%,3.5rem)] pt-6 pb-16">
      <MarkdownView
        source={text}
        className="markdown-document mx-auto max-w-[var(--prose-measure)] text-[0.9375rem]"
      />
    </div>
  )
}
