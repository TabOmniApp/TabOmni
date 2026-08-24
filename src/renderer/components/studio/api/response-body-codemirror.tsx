import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { useTheme } from "next-themes"

import {
  editorTheme,
  languageConf,
  panelChrome,
  readOnly,
  themeConf,
} from "@/lib/editor"
import { languageExtension, languageNamed } from "@/lib/editor-languages"
import { languageIdForContentType } from "@/lib/language"

import type { ResponseBodyProps } from "./response-body"

/**
 * A read-only editor, for showing what came back.
 *
 * Not the file editor: that one owns its buffer for as long as a file stays
 * open, which is the opposite of what a response wants — every send replaces
 * the text outright. What it keeps is the editor's chrome, its folding and its
 * search, which is most of why a response is worth putting in an editor rather
 * than a `<pre>`.
 */
export default function ResponseBodyCodeMirror({
  value,
  contentType,
}: ResponseBodyProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const initialRef = useRef({ value, isDark })

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
          // Selectable, foldable and searchable, but not typeable: there is
          // nowhere for an edit to go.
          ...readOnly(),
          themeConf.of(editorTheme(initial.isDark)),
          languageConf.of([]),
        ],
      }),
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // Every response replaces the document, and may well be a different type from
  // the last one. The view is reused rather than rebuilt: a view per response
  // would cost the scroll position, the folds and a DOM teardown for every send.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    let alive = true
    void languageExtension(
      languageNamed(languageIdForContentType(contentType))
    ).then((language) => {
      if (!alive) return
      view.dispatch({ effects: languageConf.reconfigure(language) })
    })

    if (view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        // Back to the top, which is where a new response is read from. The
        // scroll effect rather than a DOM write, so it survives the measure pass
        // that follows the change.
        effects: EditorView.scrollIntoView(0, { y: "start" }),
      })
    }

    return () => {
      alive = false
    }
  }, [value, contentType])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeConf.reconfigure(editorTheme(isDark)),
    })
  }, [isDark])

  return <div ref={hostRef} className="h-full overflow-hidden" />
}
