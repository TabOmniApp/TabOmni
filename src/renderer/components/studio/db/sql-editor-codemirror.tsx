import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, highlightActiveLine, keymap } from "@codemirror/view"
import { useTheme } from "next-themes"

import { sqlLanguage } from "@/lib/db/sql-completion"
import { editorTheme, languageConf, panelChrome, themeConf } from "@/lib/editor"

import type { SqlEditorProps } from "./sql-editor"

/**
 * The SQL console's editor.
 *
 * Uncontrolled, like the Explorer's: the buffer belongs to the editor and the
 * store is told what was typed. Safe because a console tab is keyed by its own
 * id, so switching tabs mounts a new editor rather than rewriting this one's
 * document — which would take the undo history and the cursor with it.
 *
 * The completion popover is switched on here rather than in `panelChrome`,
 * because this is the only field editor in the studio with something to
 * complete against. Monaco had it the other way round: suggestions were on by
 * default and every editor in the app turned the word-based ones off, since a
 * list of words already on screen is not a suggestion.
 */
export default function SqlEditorCodeMirror({
  value,
  onChange,
  onRun,
  onSelectionChange,
  completions,
  engine,
}: SqlEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  // The editor outlives every render, so callbacks are read through refs rather
  // than baked into the listeners of one particular render.
  const handlers = useRef({ onChange, onRun, onSelectionChange })
  useEffect(() => {
    handlers.current = { onChange, onRun, onSelectionChange }
  }, [onChange, onRun, onSelectionChange])

  const initialRef = useRef({ value, engine, completions, isDark })

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
          languageConf.of(sqlLanguage(initial.engine, initial.completions)),
          // The one piece of the file editor's chrome a console wants back: a
          // statement is read line by line and the active line is the one about
          // to be run.
          highlightActiveLine(),
          keymap.of([
            {
              key: "Mod-Enter",
              preventDefault: true,
              run: () => {
                handlers.current.onRun()
                return true
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              handlers.current.onChange(update.state.doc.toString())
            }
            // An edit can shrink or drop the selection without moving it, so a
            // content change has to report it too.
            if (update.docChanged || update.selectionSet) {
              handlers.current.onSelectionChange(selectedText(update.state))
            }
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

  // Completion follows the live schema and the connected engine, so both are
  // republished whenever they change rather than fixed when the console opens.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: languageConf.reconfigure(sqlLanguage(engine, completions)),
    })
  }, [engine, completions])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeConf.reconfigure(editorTheme(isDark)),
    })
  }, [isDark])

  return <div ref={hostRef} className="h-full overflow-hidden" />
}

/** The selected text, or "" when nothing is. Multiple cursors' selections are
 * joined by newlines so they run as the script they look like. */
function selectedText(state: EditorState): string {
  return state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to))
    .join("\n")
}
