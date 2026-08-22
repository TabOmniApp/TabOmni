import { useEffect, useRef } from "react"
import { useTheme } from "next-themes"

import { languageIdFor, modelFor, releaseModel } from "@/lib/files/monaco"
import { editorTheme, monaco, monoFont } from "@/lib/monaco"

/**
 * One file against its committed self, in Monaco's diff editor.
 *
 * The default export, imported nowhere but the `lazy` in `file-diff.tsx` — the
 * same bargain `monaco-editor.tsx` makes, and the same reason: Monaco's grammars
 * are not in the bundle the studio launches with.
 *
 * **Both sides are read-only, and that is the point of `Diff | Edit`.** A diff
 * is a thing to read: two columns, one of them a commit, with the caret jumping
 * between versions of the same line. Typing into it was possible for a while —
 * the right-hand side is the real file — and what it bought was an editor whose
 * left half silently refused every keystroke and whose right half accepted them,
 * in a pane nobody had opened to type in. Editing is the `Edit` half of the
 * toggle in the header above, which is one click and the same buffer.
 *
 * **The right-hand side is still the file**, not a copy of it: it takes the same
 * path-keyed model the text editor uses (`modelFor`), which is what makes the
 * diff show the edits that have not been saved yet rather than what is on disk,
 * and what makes switching to `Edit` keep the buffer and its undo history. The
 * left-hand side is a throwaway model holding what `HEAD` has, disposed with
 * this editor — it belongs to no path, and a second model for the same URI is
 * the one thing Monaco throws over.
 *
 * ⌘S still saves, because the model can be dirty from the other view and the
 * key is muscle memory rather than a property of the editor it was pressed in.
 *
 * `original` is not in the deps of the effect that builds the pair: a re-read of
 * `HEAD` must not rebuild an editor somebody is reading, so the committed side
 * is set separately when it arrives.
 */
export default function MonacoFileDiff({
  path,
  initialText,
  sideBySide,
  whitespace,
  original,
  onChange,
  onSave,
}: {
  path: string
  /** The working tree's text as the tab read it, or its unsaved edits if the
   * editor already holds them — the model is shared with that view. */
  initialText: string
  /** The toolbar's two, from `useSettings`. Applied with `updateOptions` rather
   * than by rebuilding, so a click does not cost the scroll position. */
  sideBySide: boolean
  whitespace: boolean
  /** What `HEAD` has, or null for a file it does not have — a new file, whose
   * diff is the whole of it added. */
  original: string | null
  onChange: (text: string) => void
  onSave: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
  }, [onChange, onSave])

  const initialRef = useRef({
    path,
    initialText,
    isDark,
    sideBySide,
    whitespace,
  })
  /** The pair, for the options that can be changed under it. */
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  /** The committed side, kept so it can be written into when it arrives without
   * rebuilding anything. */
  const originalRef = useRef<monaco.editor.ITextModel | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const initial = initialRef.current
    const modified = modelFor(initial.path, initial.initialText)
    const committed = monaco.editor.createModel(
      "",
      languageIdFor(initial.path)
      // No URI: this is the content of a commit rather than of a file, and
      // giving it the file's own would collide with the model above.
    )
    originalRef.current = committed

    const editor = monaco.editor.createDiffEditor(host, {
      theme: editorTheme(initial.isDark),
      fontFamily: monoFont(),
      fontSize: 13,
      lineHeight: 1.6,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderSideBySide: initial.sideBySide,
      // Monaco second-guesses `renderSideBySide` by falling back to the inline
      // view below a width threshold, which is the right default for a setting
      // nobody set and the wrong behaviour for a button somebody just pressed:
      // the two columns are what they asked for, narrow pane and all.
      useInlineViewWhenSpaceIsLimited: false,
      renderWhitespace: initial.whitespace ? "all" : "selection",
      // Both sides. The left is a commit and there is nothing to write it back
      // to; the right is the file, and reading a diff is not editing it — the
      // `Edit` half of the toggle above is.
      originalEditable: false,
      readOnly: true,
      smoothScrolling: true,
      padding: { top: 8, bottom: 8 },
      contextmenu: true,
      // A file where every line moved is a file whose diff is the file, and
      // folding it away is what makes the handful of real changes findable.
      hideUnchangedRegions: { enabled: true },
    })
    editor.setModel({ original: committed, modified })
    editorRef.current = editor

    // Nothing can be typed here, but the model is shared: the `Edit` view of
    // the same file writes into it, and a `.md` preview reads what the store
    // was told. Kept so that whichever view is mounted keeps the store honest.
    const changed = modified.onDidChangeContent(() => {
      onChangeRef.current(modified.getValue())
    })

    // Still bound, read-only or not: the file can be dirty from the `Edit`
    // view, and ⌘S is muscle memory rather than a property of the pane it was
    // pressed in. On the modified editor rather than on the pair — the pair has
    // no commands of its own, and ⌘S typed on the left would otherwise reach
    // Chromium's own "save page".
    editor
      .getModifiedEditor()
      .addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSaveRef.current()
      })

    return () => {
      changed.dispose()
      originalRef.current = null
      editorRef.current = null
      editor.dispose()
      committed.dispose()
      // The file's own model is let go rather than disposed: the text editor may
      // be holding the same one. `releaseModel` disposes it when the last holder
      // does this — see `modelFor`.
      releaseModel(initial.path)
    }
  }, [])

  // Set rather than passed at construction, since it is read over IPC and often
  // arrives a frame or two after the editor is on screen.
  useEffect(() => {
    originalRef.current?.setValue(original ?? "")
  }, [original])

  useEffect(() => {
    editorRef.current?.updateOptions({
      renderSideBySide: sideBySide,
      renderWhitespace: whitespace ? "all" : "selection",
    })
  }, [sideBySide, whitespace])

  useEffect(() => {
    monaco.editor.setTheme(editorTheme(isDark))
  }, [isDark])

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />
}
