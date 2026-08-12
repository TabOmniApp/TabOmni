import { lazy, Suspense } from "react"

export type ResponseBodyProps = {
  value: string
  contentType: string
}

/** The response viewer, behind the boundary that keeps Monaco lazy — see
 * `lib/monaco.ts`. */
const ResponseBodyMonaco = lazy(() => import("./response-body-monaco"))

export function ResponseBody(props: ResponseBodyProps) {
  return (
    <Suspense fallback={<div className="h-full" />}>
      <ResponseBodyMonaco {...props} />
    </Suspense>
  )
}
