import { useEffect, useRef } from "react"
import { useTheme } from "next-themes"

import type { DbEngine } from "@shared/api"

import { clearSqlSchema, setSqlSchema } from "@/lib/db/sql-completion"
import { editorTheme, monaco, panelEditorOptions } from "@/lib/monaco"

import type { SqlEditorProps } from "./sql-editor"

/** Monaco ships a grammar per dialect, so the console highlights what it is
 * actually connected to rather than generic SQL. */
const DIALECTS: Record<DbEngine, string> = {
  postgres: "pgsql",
  mysql: "mysql",
}

/**
 * The SQL console's editor.
 *
 * Uncontrolled, like the Explorer's: the buffer belongs to Monaco and the store
 * is told what was typed. Safe because a console tab is keyed by its own id, so
 * switching tabs mounts a new editor rather than rewriting this one's document
 * — which would take the undo history and the cursor with it.
 */
export default function SqlEditorMonaco({
  value,
  onChange,
  onRun,
  onSelectionChange,
  completions,
  engine,
}: SqlEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  // The editor outlives every render, so callbacks are read through refs rather
  // than baked into the listeners of one particular render.
  const handlers = useRef({ onChange, onRun, onSelectionChange })
  useEffect(() => {
    handlers.current = { onChange, onRun, onSelectionChange }
  }, [onChange, onRun, onSelectionChange])

  const initialRef = useRef({ value, engine, isDark })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const initial = initialRef.current
    // No URI of its own: Monaco mints one per model, and that is what the
    // completion provider keys this console's schema by. Naming it after the
    // tab would only invite two consoles to agree on a name.
    const model = monaco.editor.createModel(
      initial.value,
      DIALECTS[initial.engine]
    )
    modelRef.current = model

    const editor = monaco.editor.create(host, {
      model,
      ...panelEditorOptions(initial.isDark),
      // The one piece of the file editor's chrome a console wants back: a
      // statement is read line by line and the active line is the one being run.
      renderLineHighlight: "line",
      // Every suggestion this editor has is a table, a column or a keyword —
      // all of them from the provider. Monaco's own word-based suggestions
      // would add whatever is typed in the API panel's editors alongside them.
      wordBasedSuggestions: "off",
      tabSize: 2,
    })

    /** The selected text, or "" when nothing is. Multiple cursors' selections
     * are joined by newlines so they run as the script they look like. */
    const reportSelection = () => {
      const selected = (editor.getSelections() ?? [])
        .filter((selection) => !selection.isEmpty())
        .map((selection) => model.getValueInRange(selection))
        .join("\n")
      handlers.current.onSelectionChange(selected)
    }

    const changed = editor.onDidChangeModelContent(() => {
      handlers.current.onChange(editor.getValue())
      // An edit can shrink or drop the selection without moving it, so a
      // content change has to report it too.
      reportSelection()
    })
    const moved = editor.onDidChangeCursorSelection(reportSelection)

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handlers.current.onRun()
    })

    return () => {
      changed.dispose()
      moved.dispose()
      clearSqlSchema(model.uri.toString())
      editor.dispose()
      model.dispose()
      modelRef.current = null
    }
  }, [])

  // Completion follows the live schema, so it is republished whenever the
  // tables change rather than fixed when the console opens.
  useEffect(() => {
    const model = modelRef.current
    if (!model) return
    setSqlSchema(model.uri.toString(), completions)
  }, [completions])

  useEffect(() => {
    const model = modelRef.current
    if (!model) return
    monaco.editor.setModelLanguage(model, DIALECTS[engine])
  }, [engine])

  // Global rather than per instance — Monaco has one theme for every editor on
  // the page.
  useEffect(() => {
    monaco.editor.setTheme(editorTheme(isDark))
  }, [isDark])

  return <div ref={hostRef} className="h-full overflow-hidden" />
}
