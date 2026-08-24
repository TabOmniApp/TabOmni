import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, placeholder as placeholderExt } from "@codemirror/view"
import { useTheme } from "next-themes"

import { editorTheme, languageConf, panelChrome, themeConf } from "@/lib/editor"
import { bodyLanguage } from "@/lib/http/body-language"

import type { BodyEditorProps } from "./body-editor"

/**
 * The request body, as an editor rather than a textarea.
 *
 * Unlike the file editor this one is controlled: the Format button rewrites the
 * body from outside, and a buffer that owned itself would ignore it. The echo
 * guard is what keeps that from turning into a loop.
 */
export default function BodyEditorCodeMirror({
  value,
  contentType,
  onChange,
  placeholder = '{ "name": "Ada" }',
}: BodyEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
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

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          ...panelChrome(),
          themeConf.of(editorTheme(initial.isDark)),
          languageConf.of([]),
          placeholderExt(initial.placeholder),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || rewritingRef.current) return
            onChangeRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // The language, and again whenever the request's own `Content-Type` changes.
  // A promise because a parser is a dynamic import; the guard is for a pane
  // unmounted while one was in flight.
  useEffect(() => {
    let alive = true
    void bodyLanguage(contentType).then((language) => {
      if (!alive) return
      viewRef.current?.dispatch({
        effects: languageConf.reconfigure(language),
      })
    })
    return () => {
      alive = false
    }
  }, [contentType])

  // Only when the two have actually diverged — on every keystroke `value` is
  // what this editor just reported, and rewriting it would move the cursor.
  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return

    rewritingRef.current = true
    // A change rather than a new state, which would throw away the undo stack —
    // Format is something the user should be able to take back.
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    })
    rewritingRef.current = false
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeConf.reconfigure(editorTheme(isDark)),
    })
  }, [isDark])

  return <div ref={hostRef} className="h-full overflow-hidden" />
}
