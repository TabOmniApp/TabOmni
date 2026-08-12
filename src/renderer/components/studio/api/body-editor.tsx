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

/** The request body's editor, behind the boundary that keeps Monaco lazy —
 * see `lib/monaco.ts`. */
const BodyEditorMonaco = lazy(() => import("./body-editor-monaco"))

export function BodyEditor(props: BodyEditorProps) {
  return (
    <Suspense fallback={<div className="h-full" />}>
      <BodyEditorMonaco {...props} />
    </Suspense>
  )
}
