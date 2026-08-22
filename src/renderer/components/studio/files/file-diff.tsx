import { lazy, Suspense, useEffect, useState } from "react"

import { useSettings } from "@/lib/settings"

/**
 * A file's diff against `HEAD`, fetched the first time one is opened.
 *
 * Split the way `file-editor.tsx` is split, and for the same reason — Monaco is
 * around four megabytes and does not belong in the launch bundle. The committed
 * side is read here, outside the `lazy`, so the IPC round trip and the chunk
 * load happen at once rather than one after the other.
 */
const MonacoFileDiff = lazy(() => import("./monaco-diff"))

export function FileDiff({
  path,
  initialText,
  onChange,
  onSave,
}: {
  path: string
  initialText: string
  onChange: (text: string) => void
  onSave: () => void
}) {
  const original = useHeadText(path)

  // Read here rather than handed down from the pane: they are the diff's own two
  // and nothing above it has any use for them.
  const sideBySide = useSettings((state) => state.diffSideBySide)
  const whitespace = useSettings((state) => state.diffWhitespace)

  return (
    <Suspense fallback={<div className="h-full w-full" />}>
      <MonacoFileDiff
        // The path is the identity here as it is for the editor: a renamed file
        // is a fresh diff rather than one against a commit's copy of a name that
        // has moved.
        key={path}
        path={path}
        initialText={initialText}
        sideBySide={sideBySide}
        whitespace={whitespace}
        original={original}
        onChange={onChange}
        onSave={onSave}
      />
    </Suspense>
  )
}

/**
 * What `HEAD` has of this file — null for a file it does not have, which is both
 * a new file and a directory that is not a repository.
 *
 * Not in the files store, unlike the working text: nothing else in the studio
 * asks for it, it cannot be edited, and it is invalidated by a commit rather
 * than by anything the store already watches for. A tab kept open across one is
 * re-read by being remounted, which is what a `key` on the path gives for free.
 *
 * Nothing resets this when `path` changes, and nothing has to: the pane keys
 * this component by the path, so a different file is a different mount starting
 * from null. Clearing it here as well would be a second render on every open for
 * a state that was already right.
 */
function useHeadText(path: string): string | null {
  const [original, setOriginal] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    void window.desktop
      .fileAtHead(path)
      .then((text) => {
        if (alive) setOriginal(text)
      })
      .catch(() => {
        // A path outside the workspace's roots, or a git that could not be run.
        // Both mean there is nothing to compare against, which the empty left
        // side already says.
        if (alive) setOriginal(null)
      })

    return () => {
      alive = false
    }
  }, [path])

  return original
}
