import { lazy, Suspense } from "react"

export type BodyEditorProps = {
  value: string
  /** Decides the highlighting — the request's own `Content-Type`. */
  contentType: string
  onChange: (value: string) => void
  /** Shown on an empty buffer. Defaults to a JSON example — the common case
   * everywhere but the one caller writing something other than a body. */
  placeholder?: string
}

/** The request body's editor, behind the boundary that keeps the editing stack
 * lazy — see `lib/editor.ts`. */
const BodyEditorCodeMirror = lazy(() => import("./body-editor-codemirror"))

export function BodyEditor(props: BodyEditorProps) {
  return (
    <Suspense fallback={<div className="h-full" />}>
      <BodyEditorCodeMirror {...props} />
    </Suspense>
  )
}
