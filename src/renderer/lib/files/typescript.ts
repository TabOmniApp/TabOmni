import type { TsHover } from "@shared/api"

import { monaco } from "@/lib/monaco"

import { useFiles } from "./store"

/**
 * What the editor asks the TypeScript server, and what it does with the answer.
 *
 * Monaco's own worker stays on for what it is good at — colouring, folding,
 * bracket matching, syntax errors in the file in front of it — and these two
 * providers take over the two questions it cannot answer, because they are
 * questions about a project: what is this symbol, and where does it come from.
 * The server behind them is a real `tsserver` in the main process; see
 * `main/tsserver.ts` for why it is that rather than a language server.
 *
 * Registered against `typescript` and `javascript`, which is every extension
 * those two languages claim — `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`,
 * `.mjs`, `.cjs`.
 */

const LANGUAGES = ["typescript", "javascript"]

/** How long typing settles before the server is told what changed. Short
 * enough that a hover a moment after a keystroke is about the text on screen,
 * long enough that a held key is not a message per character. */
const SYNC_DELAY_MS = 250

/** One timer per file, so two open editors do not cancel each other's sync. */
const pendingSync = new Map<string, ReturnType<typeof setTimeout>>()

/** Tells the server a file is being edited, and hands it the text once the
 * typing stops. */
export function syncFile(filePath: string, text: string): void {
  const existing = pendingSync.get(filePath)
  if (existing !== undefined) clearTimeout(existing)

  pendingSync.set(
    filePath,
    setTimeout(() => {
      pendingSync.delete(filePath)
      void window.desktop.tsChange(filePath, text).catch(() => {
        // A server that is not running is a hover that says nothing, which is
        // what the editor did before any of this existed. Not worth a notice.
      })
    }, SYNC_DELAY_MS)
  )
}

export function openFile(filePath: string, text: string): void {
  void window.desktop.tsOpen(filePath, text).catch(() => {})
}

export function closeFile(filePath: string): void {
  const existing = pendingSync.get(filePath)
  if (existing !== undefined) clearTimeout(existing)
  pendingSync.delete(filePath)
  void window.desktop.tsClose(filePath).catch(() => {})
}

/**
 * The tooltip, assembled from the three things tsserver hands back.
 *
 * The signature goes in a fenced block so Monaco highlights it as TypeScript —
 * that is what makes a hover read as a declaration rather than as a sentence —
 * and the tags become a list under the documentation. `isTrusted` is
 * deliberately not set: this is markdown from a package's own doc comments, and
 * command links in a tooltip are not something a doc comment should be able to
 * ask for.
 */
function tooltipOf(hover: TsHover): monaco.IMarkdownString[] {
  const parts: monaco.IMarkdownString[] = [
    { value: ["```typescript", hover.signature, "```"].join("\n") },
  ]

  if (hover.documentation) parts.push({ value: hover.documentation })

  if (hover.tags.length > 0) {
    parts.push({
      value: hover.tags
        .map((tag) => `*@${tag.name}* ${tag.text}`.trim())
        .join("\n\n"),
    })
  }

  return parts
}

/**
 * Wires both providers, and the opener that go-to-definition needs.
 *
 * Called once, from the module that owns Monaco — the providers are global to
 * the editor and not per instance.
 */
export function registerTypeScriptProviders(): void {
  for (const language of LANGUAGES) {
    monaco.languages.registerHoverProvider(language, {
      async provideHover(model, position) {
        const hover = await window.desktop
          .tsHover(pathOf(model), position.lineNumber, position.column)
          .catch(() => null)
        if (!hover) return null

        return { contents: tooltipOf(hover) }
      },
    })

    monaco.languages.registerDefinitionProvider(language, {
      async provideDefinition(model, position) {
        const definitions = await window.desktop
          .tsDefinition(pathOf(model), position.lineNumber, position.column)
          .catch(() => [])

        return definitions.map((definition) => ({
          uri: monaco.Uri.file(definition.path),
          range: {
            startLineNumber: definition.line,
            startColumn: definition.column,
            endLineNumber: definition.line,
            endColumn: definition.column,
          },
        }))
      },
    })
  }

  /*
   * What happens when a definition is in another file.
   *
   * Monaco's standalone editor has no notion of opening one: given a target in
   * a model it is not attached to, it does nothing at all — which is how
   * go-to-definition looks like a broken key rather than a missing feature.
   * This is the hook it offers instead, and the studio answers it the only way
   * that makes sense here: open the file as a tab, the same as clicking it in
   * the tree, and reveal it there.
   *
   * The position is handed on for the editor that is about to mount; see
   * `pendingReveal` in `files/monaco-editor.tsx`.
   */
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      const filePath = resource.fsPath
      if (!filePath) return false

      revealAt(
        filePath,
        selectionOrPosition && "lineNumber" in selectionOrPosition
          ? selectionOrPosition.lineNumber
          : (selectionOrPosition?.startLineNumber ?? 1),
        selectionOrPosition && "column" in selectionOrPosition
          ? selectionOrPosition.column
          : (selectionOrPosition?.startColumn ?? 1)
      )
      // Handled — including for a file that turns out not to be readable,
      // where the tab opens onto the reason rather than nothing happening.
      return true
    },
  })
}

/**
 * Where a definition landed, for the editor that has not mounted yet.
 *
 * A tab opened by go-to-definition builds its editor a frame or two later, so
 * the position cannot be applied to it here. It is left here instead, and the
 * editor takes it on mount.
 */
export const pendingReveal = new Map<string, { line: number; column: number }>()

function revealAt(filePath: string, line: number, column: number) {
  const files = useFiles.getState()

  // Already the file on screen: the editor is mounted, so it can be moved
  // directly rather than through a tab that is already open.
  const editor = monaco.editor
    .getEditors()
    .find((candidate) => candidate.getModel()?.uri.fsPath === filePath)

  if (editor) {
    editor.revealPositionInCenter({ lineNumber: line, column })
    editor.setPosition({ lineNumber: line, column })
    editor.focus()
    files.select(filePath)
    return
  }

  pendingReveal.set(filePath, { line, column })
  void files.open(filePath)
  // The tree follows, so a file arrived at this way is also somewhere the user
  // can see it sits.
  void files.reveal(filePath)
}

/** The absolute path a model stands for. Models here are always created from
 * `Uri.file`, so this is the path the tree and the strip use. */
function pathOf(model: monaco.editor.ITextModel): string {
  return model.uri.fsPath
}
