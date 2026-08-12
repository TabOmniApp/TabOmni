import { useEffect, useRef } from "react"
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete"
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands"
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language"
import { MySQL, PostgreSQL, sql, type SQLDialect } from "@codemirror/lang-sql"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { Compartment, EditorState } from "@codemirror/state"
import { oneDark } from "@codemirror/theme-one-dark"
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view"
import { useTheme } from "next-themes"

import type { DbEngine } from "@shared/api"

const DIALECTS: Record<DbEngine, SQLDialect> = {
  postgres: PostgreSQL,
  mysql: MySQL,
}

const dialect = new Compartment()
const theme = new Compartment()

const layout = EditorView.theme({
  "&": { height: "100%", fontSize: "13px" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    lineHeight: "1.6",
  },
  ".cm-content": { paddingBlock: "0.5rem" },
  ".cm-gutters": { border: "none", background: "transparent" },
  "&.cm-focused": { outline: "none" },
})

/** The selected text, or "" when nothing is. Multiple cursors' selections are
 * joined by newlines so they run as the script they look like. */
function selectedText(state: EditorState) {
  return state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to))
    .join("\n")
}

type SqlEditorProps = {
  value: string
  onChange: (value: string) => void
  /** Bound to Mod-Enter, the shortcut every SQL console uses. */
  onRun: () => void
  /** Fires with the selected text, or "" when the selection is empty — what
   * lets the console run a highlighted statement instead of the whole tab. */
  onSelectionChange: (selected: string) => void
  /** Table and column names to complete, keyed by table name. */
  completions: Record<string, string[]>
  /** Which SQL dialect to highlight and complete against. */
  engine: DbEngine
}

export function SqlEditor({
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

  // The editor outlives every render, so callbacks are read through refs rather
  // than baked into the extensions of one particular render.
  const handlers = useRef({ onChange, onRun, onSelectionChange })
  useEffect(() => {
    handlers.current = { onChange, onRun, onSelectionChange }
  }, [onChange, onRun, onSelectionChange])

  const initialRef = useRef(value)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          foldGutter(),
          history(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          // Selecting a column name marks every other use of it, which is how
          // you check a long query without reading it line by line.
          highlightSelectionMatches(),
          // Alt-drag for a column of cursors down a SELECT list.
          rectangularSelection(),
          crosshairCursor(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          keymap.of([
            {
              key: "Mod-Enter",
              preventDefault: true,
              run: () => {
                handlers.current.onRun()
                return true
              },
            },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            ...searchKeymap,
            ...foldKeymap,
            // Last, so Tab still falls through to the completion and snippet
            // bindings above before it means "indent".
            indentWithTab,
          ]),
          dialect.of([]),
          theme.of([]),
          layout,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              handlers.current.onChange(update.state.doc.toString())
            }
            // An edit can shrink or drop the selection without moving it, so
            // both kinds of update have to be reported.
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

  // Completion follows the live schema, so the dialect is reconfigured whenever
  // the tables change — or the connected database's engine does — rather than
  // fixed when the console opens.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: dialect.reconfigure(
        sql({
          dialect: DIALECTS[engine],
          schema: completions,
          upperCaseKeywords: false,
        })
      ),
    })
  }, [completions, engine])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: theme.reconfigure(resolvedTheme === "dark" ? oneDark : []),
    })
  }, [resolvedTheme])

  return <div ref={hostRef} className="h-full overflow-hidden" />
}
