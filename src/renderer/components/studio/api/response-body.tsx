import { useEffect, useRef } from "react"
import { Compartment, EditorState } from "@codemirror/state"
import { oneDark } from "@codemirror/theme-one-dark"
import { EditorView } from "@codemirror/view"
import { useTheme } from "next-themes"

import { sharedEditorExtensions } from "@/lib/editor-chrome"
import { languageForContentType } from "@/lib/language"

const language = new Compartment()
const theme = new Compartment()

/**
 * A read-only CodeMirror, for showing what came back.
 *
 * Not the file editor: that one owns its buffer for as long as a file stays
 * open, which is the opposite of what a response wants — every send replaces
 * the text outright. What it keeps is the editor's chrome, its folding and
 * its search, which is most of why a response is worth putting in an editor
 * rather than a `<pre>`.
 */
export function ResponseBody({
  value,
  contentType,
}: {
  value: string
  contentType: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const initialRef = useRef({ value, contentType })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const initial = initialRef.current
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          ...sharedEditorExtensions,
          // Selectable and searchable, but not typeable: there is nowhere for
          // an edit to go.
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          language.of(languageForContentType(initial.contentType)),
          theme.of([]),
        ],
      }),
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // Every response replaces the document, and may well be a different type
  // from the last one.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      effects: language.reconfigure(languageForContentType(contentType)),
      selection: { anchor: 0 },
      scrollIntoView: true,
    })
  }, [value, contentType])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: theme.reconfigure(isDark ? oneDark : []),
    })
  }, [isDark])

  return <div ref={hostRef} className="h-full overflow-hidden" />
}
