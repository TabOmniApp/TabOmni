import { useEffect, useRef } from "react"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { bracketMatching, indentOnInput } from "@codemirror/language"
import { Compartment, EditorState } from "@codemirror/state"
import { oneDark } from "@codemirror/theme-one-dark"
import { EditorView, keymap, placeholder } from "@codemirror/view"
import { useTheme } from "next-themes"

import { sharedEditorExtensions } from "@/lib/editor-chrome"
import { languageForContentType } from "@/lib/language"

const language = new Compartment()
const theme = new Compartment()

/**
 * The request body, as an editor rather than a textarea.
 *
 * Unlike the file editor this one is controlled: the Format button rewrites
 * the body from outside, and a buffer that owned itself would ignore it. The
 * echo guard is what keeps that from turning into a loop.
 */
export function BodyEditor({
  value,
  contentType,
  onChange,
  placeholder: placeholderText = '{ "name": "Ada" }',
}: {
  value: string
  /** Decides the highlighting — the request's own `Content-Type`. */
  contentType: string
  onChange: (value: string) => void
  /** Shown on an empty buffer. Defaults to a JSON example — the common case
   * everywhere but the one caller writing something other than a body. */
  placeholder?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const initialRef = useRef({ value, contentType, placeholderText })
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
          ...sharedEditorExtensions,
          history(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          placeholder(initial.placeholderText),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          language.of(languageForContentType(initial.contentType)),
          theme.of([]),
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

  // Only when the two have actually diverged — on every keystroke `value` is
  // what this editor just reported, and rewriting it would move the cursor.
  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    rewritingRef.current = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    })
    rewritingRef.current = false
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: language.reconfigure(languageForContentType(contentType)),
    })
  }, [contentType])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: theme.reconfigure(isDark ? oneDark : []),
    })
  }, [isDark])

  return <div ref={hostRef} className="h-full overflow-hidden" />
}
