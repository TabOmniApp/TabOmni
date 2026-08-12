import { useEffect, useRef } from "react"
import { useTheme } from "next-themes"

import { languageIdForContentType } from "@/lib/language"
import { editorTheme, monaco, panelEditorOptions } from "@/lib/monaco"

import type { ResponseBodyProps } from "./response-body"

/**
 * A read-only editor, for showing what came back.
 *
 * Not the file editor: that one owns its buffer for as long as a file stays
 * open, which is the opposite of what a response wants — every send replaces
 * the text outright. What it keeps is the editor's chrome, its folding and
 * its search, which is most of why a response is worth putting in an editor
 * rather than a `<pre>`.
 */
export default function ResponseBodyMonaco({
  value,
  contentType,
}: ResponseBodyProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const initialRef = useRef({ value, contentType, isDark })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const initial = initialRef.current
    const model = monaco.editor.createModel(
      initial.value,
      languageIdForContentType(initial.contentType)
    )

    const editor = monaco.editor.create(host, {
      model,
      ...panelEditorOptions(initial.isDark),
      // Selectable and searchable, but not typeable: there is nowhere for an
      // edit to go.
      readOnly: true,
      // The cursor is what makes the find widget's matches navigable, so it
      // stays — but a blinking caret in a pane nobody can type into reads as a
      // bug.
      cursorBlinking: "solid",
      renderLineHighlight: "none",
    })
    editorRef.current = editor

    return () => {
      editor.dispose()
      model.dispose()
      editorRef.current = null
    }
  }, [])

  // Every response replaces the document, and may well be a different type
  // from the last one. The model is reused rather than replaced: a model per
  // response would leak one for every send in the run.
  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) return
    monaco.editor.setModelLanguage(model, languageIdForContentType(contentType))
    if (model.getValue() === value) return
    // `setValue` rather than an edit: there is no undo history worth keeping in
    // a viewer, and it is the cheaper of the two on a large body.
    model.setValue(value)
    editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 })
  }, [value, contentType])

  useEffect(() => {
    monaco.editor.setTheme(editorTheme(isDark))
  }, [isDark])

  return <div ref={hostRef} className="h-full overflow-hidden" />
}
