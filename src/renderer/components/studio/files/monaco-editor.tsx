import { useEffect, useRef } from "react"
import { useTheme } from "next-themes"

import { modelFor } from "@/lib/files/monaco"
import {
  closeFile,
  openFile,
  pendingReveal,
  syncFile,
} from "@/lib/files/typescript"
import { editorTheme, monaco, monoFont } from "@/lib/monaco"

/**
 * One open file, in Monaco.
 *
 * The default export, and imported nowhere but the `lazy` in `file-editor.tsx`:
 * that is what keeps Monaco's grammars out of the bundle the studio launches
 * with.
 *
 * Uncontrolled. The buffer belongs to Monaco and the store is told what was
 * typed, not the other way round — a controlled editor would rewrite the model
 * on every keystroke and take the undo history, the cursor and the folded
 * regions with it. Safe because nothing but the user writes an open file's text:
 * the Explorer's Refresh deliberately skips files with unsaved edits.
 */
export default function MonacoFileEditor({
  path,
  initialText,
  onChange,
  onSave,
}: {
  path: string
  /** The text as it stood when the tab was read. Monaco owns it from here. */
  initialText: string
  onChange: (text: string) => void
  onSave: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  // Through refs so the editor is built once: a fresh `onChange` identity from
  // the parent's render must never tear down a buffer being typed into.
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
  }, [onChange, onSave])

  const initialRef = useRef({ path, initialText, isDark })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const initial = initialRef.current
    const model = modelFor(initial.path, initial.initialText)

    const editor = monaco.editor.create(host, {
      model,
      // Set at construction as well as in the effect below, so the first paint
      // is not a white editor in a dark studio.
      theme: editorTheme(initial.isDark),
      fontFamily: monoFont(),
      fontSize: 13,
      lineHeight: 1.6,
      // The pane sits in a resizable panel and is hidden by a class rather
      // than unmounted, so its box changes size under an editor that is not
      // being looked at. `automaticLayout` is a ResizeObserver, which is the
      // only thing that catches that.
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      smoothScrolling: true,
      padding: { top: 8, bottom: 8 },
      // Monaco's own context menu, deliberately: it carries the commands this
      // editor actually has — go to definition, change all occurrences,
      // format — and the studio has nothing to add to a menu about text.
      contextmenu: true,
    })

    // What the TypeScript server is told. Sent for every file rather than only
    // for the ones it can answer about: which languages it serves is its own
    // business, and a `.md` it is handed is a message it ignores.
    openFile(initial.path, initial.initialText)

    const changed = editor.onDidChangeModelContent(() => {
      const text = editor.getValue()
      onChangeRef.current(text)
      // The server reads the editor, not the disk — a hover over a symbol
      // typed a moment ago has to be about the text on screen.
      syncFile(initial.path, text)
    })

    // A tab opened by go-to-definition names where it was going; the editor
    // that lands on it is this one, a frame or two later.
    const target = pendingReveal.get(initial.path)
    if (target) {
      pendingReveal.delete(initial.path)
      editor.setPosition({ lineNumber: target.line, column: target.column })
      editor.revealPositionInCenter({
        lineNumber: target.line,
        column: target.column,
      })
      editor.focus()
    }

    // Monaco claims the key from the page, which is what stops Chromium's own
    // "save page" dialog from appearing over the studio.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current()
    })

    return () => {
      changed.dispose()
      closeFile(initial.path)
      editor.dispose()
      // The model goes with the tab. Kept alive across a hidden tab (the pane
      // stays mounted) but not across a closed one, where it would be a copy
      // of a file nobody is looking at, held for the rest of the run.
      model.dispose()
    }
  }, [])

  // Global rather than per instance — Monaco has one theme for every editor on
  // the page, and there is only ever one visible here anyway.
  useEffect(() => {
    monaco.editor.setTheme(editorTheme(isDark))
  }, [isDark])

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />
}
