import { lazy, Suspense } from "react"

export type ResponseBodyProps = {
  value: string
  contentType: string
}

/** The response viewer, behind the boundary that keeps the editing stack lazy —
 * see `lib/editor.ts`. */
const ResponseBodyCodeMirror = lazy(() => import("./response-body-codemirror"))

export function ResponseBody(props: ResponseBodyProps) {
  return (
    <Suspense fallback={<div className="h-full" />}>
      <ResponseBodyCodeMirror {...props} />
    </Suspense>
  )
}
