import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { useTheme } from "next-themes"

import {
  loadDrawing,
  saveDrawing,
  type DrawingScene,
} from "@/lib/note/drawings"

/**
 * Excalidraw itself, kept out of the studio's own bundle.
 *
 * It is around a megabyte of editor, and the overwhelming majority of sessions
 * never open a drawing. `React.lazy` is what makes the import a chunk of its
 * own; the spinner below is the second or two of loading it the first time.
 */
const Excalidraw = lazy(async () => {
  const module = await import("@excalidraw/excalidraw")
  // Excalidraw resolves its own fonts against this. Left unset it reaches
  // esm.sh, which is a desktop app going to the network for a file it ships —
  // see the `excalidraw-fonts` plugin in `vite.config.ts` for what serves it.
  window.EXCALIDRAW_ASSET_PATH = "./excalidraw/"
  return { default: module.Excalidraw }
})

/** Loaded once, so a second drawing opens without the CSS flashing in. */
let stylesLoaded: Promise<unknown> | null = null
function loadStyles(): Promise<unknown> {
  stylesLoaded ??= import("@excalidraw/excalidraw/index.css")
  return stylesLoaded
}

type ExcalidrawApi = {
  getSceneElements: () => readonly unknown[]
  getAppState: () => Record<string, unknown>
  getFiles: () => Record<string, unknown>
}

/**
 * The drawing editor: Excalidraw's own canvas and its full toolbar — freehand,
 * shapes, arrows, text, and images dropped or pasted in — over the note.
 *
 * A dialog rather than a canvas embedded in the note itself. Excalidraw claims
 * the wheel for zoom, so a canvas in the middle of a scrolling document is
 * something the page cannot be scrolled past; and a drawing wants the room,
 * which a column of prose does not have.
 */
export function DrawingEditor({
  drawingId,
  onClose,
}: {
  drawingId: string
  onClose: () => void
}) {
  const { resolvedTheme } = useTheme()
  const [initial, setInitial] = useState<DrawingScene | null>(null)
  const [saving, setSaving] = useState(false)
  const api = useRef<ExcalidrawApi | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([loadDrawing(drawingId), loadStyles()]).then(([scene]) => {
      if (!cancelled) setInitial(scene)
    })
    return () => {
      cancelled = true
    }
  }, [drawingId])

  async function save() {
    const editor = api.current
    if (!editor || saving) return
    setSaving(true)

    // `collaborators` is a Map of who else is on the canvas — nobody here, and
    // not JSON: it would serialise to `{}` and be read back as a plain object
    // where Excalidraw expects a Map.
    const appState = { ...editor.getAppState() }
    delete appState.collaborators

    await saveDrawing(drawingId, {
      type: "excalidraw",
      version: 2,
      source: "tabula",
      elements: [...editor.getSceneElements()],
      appState,
      files: editor.getFiles(),
    })
    setSaving(false)
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      {/* Far larger than the dialog's own default: this is a canvas, and one
          sized like a form would be a worse place to draw than a sheet of
          paper. */}
      <DialogContent className="flex h-[88vh] w-[92vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="text-sm">Drawing</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1">
          {initial === null ? (
            <div className="grid h-full place-items-center">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="grid h-full place-items-center">
                  <Spinner className="size-4 text-muted-foreground" />
                </div>
              }
            >
              <Excalidraw
                excalidrawAPI={(instance: unknown) => {
                  api.current = instance as ExcalidrawApi
                }}
                initialData={{
                  elements: initial.elements as never,
                  appState: {
                    ...initial.appState,
                    // Never restored from the scene: it is this app's setting,
                    // and a drawing saved in dark mode should not force the
                    // canvas dark for someone working in the light theme.
                    theme: resolvedTheme === "light" ? "light" : "dark",
                  } as never,
                  files: initial.files as never,
                  scrollToContent: true,
                }}
                // The canvas follows the studio's theme like everything else.
                theme={resolvedTheme === "light" ? "light" : "dark"}
                // Excalidraw's own name is not this app's, and there is nothing
                // behind these two here: the scene is a file in the workspace.
                UIOptions={{
                  canvasActions: { loadScene: false, saveToActiveFile: false },
                }}
              />
            </Suspense>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t px-4 py-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
