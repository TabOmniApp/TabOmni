import { lazy, Suspense } from "react"

import type { DbEngine } from "@shared/api"

export type SqlEditorProps = {
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

/**
 * The console's editor, behind the boundary that keeps Monaco lazy.
 *
 * Every editor in the studio is loaded this way — see `lib/monaco.ts`. The
 * fallback is an empty box rather than a spinner: the chunk is read from disk
 * on the `app://` origin, so what it covers is a parse, not a download, and
 * anything more would flash.
 */
const SqlEditorMonaco = lazy(() => import("./sql-editor-monaco"))

export function SqlEditor(props: SqlEditorProps) {
  return (
    <Suspense fallback={<div className="h-full" />}>
      <SqlEditorMonaco {...props} />
    </Suspense>
  )
}
