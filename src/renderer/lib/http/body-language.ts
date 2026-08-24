import { json } from "@codemirror/lang-json"
import { RangeSetBuilder, type Extension } from "@codemirror/state"
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view"

import { languageExtension, languageNamed } from "@/lib/editor-languages"
import { languageIdForContentType } from "@/lib/language"

/**
 * A request body is a template, not a document.
 *
 * `{{token}}` is substituted on the way out (see `substitute` in
 * `http/store.ts`), so what is on screen is JSON-shaped rather than JSON. Under
 * Monaco that was a problem to be worked around: its JSON *language service*
 * marked every variable as a syntax error and had no per-model switch — on for
 * every JSON model in the window or none of them — so a body got a hand-written
 * Monarch grammar of its own, `http-body`, with deliberately no service behind
 * it. That cost the real JSON grammar and bought back the variables.
 *
 * Neither half of that trade exists here. A CodeMirror language is a parser and
 * nothing else; linting is a separate extension nobody adds to this editor. So a
 * body is highlighted by **the real JSON parser**, and the variables are a
 * decoration over the top of it — which is what they are, and is why they now
 * show up in an XML body and a form body too rather than only in JSON.
 */

/** Matches what `substitute` replaces, so what is highlighted is exactly what
 * will be filled in. */
const VARIABLE = /\{\{\s*[\w.-]+\s*\}\}/g

const variableMark = Decoration.mark({ class: "cm-templateVariable" })

/** Only what is on screen. A body is small, but this is the same pass a large
 * one would take, and scanning the viewport is what makes it not matter. */
function variablesIn(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>()

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)
    for (const match of text.matchAll(VARIABLE)) {
      if (match.index === undefined) continue
      builder.add(
        from + match.index,
        from + match.index + match[0].length,
        variableMark
      )
    }
  }

  return builder.finish()
}

/** `{{baseUrl}}`, marked wherever it appears in a body. */
export const templateVariables: Extension = [
  ViewPlugin.fromClass(
    class {
      decorations = Decoration.none

      constructor(view: EditorView) {
        this.decorations = variablesIn(view)
      }

      update(update: ViewUpdate) {
        if (!update.docChanged && !update.viewportChanged) return
        this.decorations = variablesIn(update.view)
      }
    },
    { decorations: (plugin) => plugin.decorations }
  ),
  EditorView.baseTheme({
    ".cm-templateVariable": {
      // A variable is a hole in the document rather than a token of it, so it is
      // drawn as a chip: the colour alone read as one more kind of string.
      borderRadius: "3px",
      padding: "0 1px",
      backgroundColor: "color-mix(in oklch, var(--primary) 18%, transparent)",
      color: "var(--primary)",
    },
  }),
]

/**
 * The language a body of a given `Content-Type` is shown in, plus the variable
 * decorations that go over any of them.
 *
 * JSON is imported directly rather than resolved through the registry: it is the
 * overwhelming majority of bodies, and one static import is a parser that is
 * already there when the editor first paints instead of one that arrives a frame
 * later.
 */
export async function bodyLanguage(contentType: string): Promise<Extension> {
  const id = languageIdForContentType(contentType)
  if (id === "json") return [json(), templateVariables]

  return [await languageExtension(languageNamed(id)), templateVariables]
}
