import { useEffect, useRef } from "react"
import { useTheme } from "next-themes"

import { languageIdForBody } from "@/lib/http/body-language"
import { editorTheme, monaco, panelEditorOptions } from "@/lib/monaco"

import type { BodyEditorProps } from "./body-editor"

/**
 * The request body, as an editor rather than a textarea.
 *
 * Unlike the file editor this one is controlled: the Format button rewrites
 * the body from outside, and a buffer that owned itself would ignore it. The
 * echo guard is what keeps that from turning into a loop.
 */
export default function BodyEditorMonaco({
  value,
  contentType,
  onChange,
  placeholder = '{ "name": "Ada" }',
}: BodyEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const initialRef = useRef({ value, contentType, placeholder, isDark })
  /** Set while this component writes the buffer, so its own write is not
   * reported back as if the user had typed it. */
  const rewritingRef = useRef(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const initial = initialRef.current
    const model = monaco.editor.createModel(
      initial.value,
      languageIdForBody(initial.contentType)
    )

    const editor = monaco.editor.create(host, {
      model,
      ...panelEditorOptions(initial.isDark),
      placeholder: initial.placeholder,
      // A body is written, not discovered: there is no schema behind it and
      // nothing to complete against, so the widget would only ever offer words
      // already on screen — and it would open on every keystroke to do it.
      quickSuggestions: false,
      wordBasedSuggestions: "off",
      tabSize: 2,
    })
    editorRef.current = editor

    const changed = editor.onDidChangeModelContent(() => {
      if (rewritingRef.current) return
      onChangeRef.current(editor.getValue())
    })

    return () => {
      changed.dispose()
      editor.dispose()
      model.dispose()
      editorRef.current = null
    }
  }, [])

  // Only when the two have actually diverged — on every keystroke `value` is
  // what this editor just reported, and rewriting it would move the cursor.
  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model || model.getValue() === value) return
    rewritingRef.current = true
    // An edit rather than `setValue`, which would throw away the undo stack —
    // Format is a change the user should be able to take back.
    editor.executeEdits("external", [
      { range: model.getFullModelRange(), text: value },
    ])
    editor.pushUndoStop()
    rewritingRef.current = false
  }, [value])

  useEffect(() => {
    const model = editorRef.current?.getModel()
    if (!model) return
    monaco.editor.setModelLanguage(model, languageIdForBody(contentType))
  }, [contentType])

  useEffect(() => {
    monaco.editor.setTheme(editorTheme(isDark))
  }, [isDark])

  return <div ref={hostRef} className="h-full overflow-hidden" />
}
