import { useEffect, useState } from "react"

import { useStudio } from "../store"

/**
 * A project image's bytes, for an `<img>` tag.
 *
 * The renderer's origin is not `file://`, and Chromium will not load a
 * `file://` subresource from any other origin — so a path into the user's
 * repository cannot be a `src`, and the bytes have to come through
 * `readProjectImage`. Shared by the mockup editor and the preview, which
 * display the same pictures either side of the Edit button.
 *
 * Re-read whenever the path changes, which for a spec is rare: images are
 * added and removed, not edited in place.
 */
export function useProjectImage(src: string): {
  dataUrl: string | null
  error: string | null
} {
  const projectId = useStudio((state) => state.projectId)
  const [state, setState] = useState<{
    /** The path the rest of this state is about, so a change to it can be
     * noticed during the render rather than a frame later — an effect would
     * paint one frame of the previous image under the new pins. */
    src: string
    dataUrl: string | null
    error: string | null
  }>({ src, dataUrl: null, error: null })

  if (state.src !== src) setState({ src, dataUrl: null, error: null })

  useEffect(() => {
    if (!projectId || !src) return
    let alive = true

    window.desktop
      .readProjectImage(projectId, src)
      .then((dataUrl) => {
        if (alive) setState({ src, dataUrl, error: null })
      })
      .catch((error: unknown) => {
        if (!alive) return
        setState({
          src,
          dataUrl: null,
          error: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      alive = false
    }
  }, [projectId, src])

  return { dataUrl: state.dataUrl, error: state.error }
}
