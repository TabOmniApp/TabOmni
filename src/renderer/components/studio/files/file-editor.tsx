import { lazy, Suspense } from "react"

/**
 * The file editor, fetched the first time a file is opened.
 *
 * Monaco is around four megabytes of grammars and workers — worth it for the
 * panel whose whole job is editing source, and not worth adding to the launch
 * of a studio somebody opened to read a note. `lazy` is what splits it out; the
 * Notes panel loads Excalidraw the same way and for the same reason.
 */
const MonacoFileEditor = lazy(() => import("./monaco-editor"))

export function FileEditor(props: {
  path: string
  initialText: string
  onChange: (text: string) => void
  onSave: () => void
}) {
  return (
    <Suspense
      fallback={
        // Deliberately bare. The chunk is on local disk and lands in a frame or
        // two; a spinner would be a flash of something that says less than the
        // empty box it replaces.
        <div className="h-full w-full" />
      }
    >
      <MonacoFileEditor {...props} />
    </Suspense>
  )
}
