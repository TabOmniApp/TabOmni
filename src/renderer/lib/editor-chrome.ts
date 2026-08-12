import {
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
} from "@codemirror/language"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import type { Extension } from "@codemirror/state"
import {
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
} from "@codemirror/view"

/**
 * How a CodeMirror instance sits in the studio: full height, the app's own
 * mono font, no gutter chrome of its own.
 *
 * Shared by the file editor and the API panel's response viewer so the two
 * cannot drift into looking like different applications.
 */
export const editorLayout = EditorView.theme({
  "&": { height: "100%", fontSize: "13px" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    lineHeight: "1.6",
  },
  ".cm-content": { paddingBlock: "0.75rem" },
  ".cm-gutters": { border: "none", background: "transparent" },
  "&.cm-focused": { outline: "none" },
})

/**
 * What every CodeMirror in the studio has, editable or not: numbered lines,
 * folding, find, and wrapping. The editing half — history, brackets, a
 * keymap that types — is added by whoever needs it.
 */
export const sharedEditorExtensions: Extension[] = [
  lineNumbers(),
  foldGutter(),
  drawSelection(),
  highlightSelectionMatches(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  keymap.of([...searchKeymap, ...foldKeymap]),
  EditorView.lineWrapping,
  editorLayout,
]
