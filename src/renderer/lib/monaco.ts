import * as monaco from "monaco-editor"
import cssWorker from "monaco-editor/languages/features/css/css.worker?worker"
import editorWorker from "monaco-editor/editor/editor.worker?worker"
import htmlWorker from "monaco-editor/languages/features/html/html.worker?worker"
import jsonWorker from "monaco-editor/languages/features/json/json.worker?worker"
import tsWorker from "monaco-editor/languages/features/typescript/ts.worker?worker"

/**
 * Monaco, as the studio's one editing stack.
 *
 * Everything here is what any editor in the app needs — the workers, the font,
 * the theme, and the options a panel-sized editor is built with. What a
 * particular editor knows about a language lives with that panel: the
 * Explorer's grammars and TypeScript wiring in `files/monaco.ts`, the SQL
 * console's schema completion in `db/sql-completion.ts`.
 *
 * Imported only from lazily-loaded chunks, which is what keeps Monaco's ~4 MB
 * of grammars out of the bundle the studio launches with — the same bargain the
 * Notes panel makes with Excalidraw. Every editor in the studio is behind a
 * `lazy` for that reason, not just the Explorer's.
 */

/**
 * Monaco's workers, as modules this app's own bundle carries.
 *
 * The default `MonacoEnvironment` builds a worker URL against a CDN, which in a
 * desktop app is a network round trip for something already on disk — and one
 * that simply fails offline, leaving files with no highlighting and no
 * diagnostics for reasons nothing on screen would explain. Vite's `?worker`
 * emits each of these as a chunk beside the renderer, so they load from the
 * `app://` origin the window is already on.
 */
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case "json":
        return new jsonWorker()
      case "css":
      case "scss":
      case "less":
        return new cssWorker()
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker()
      case "typescript":
      case "javascript":
        return new tsWorker()
      default:
        return new editorWorker()
    }
  },
}

/*
 * Syntax errors, but no type errors — wherever JavaScript or TypeScript is
 * shown.
 *
 * Monaco's TypeScript worker knows only the file in front of it: no tsconfig,
 * no `node_modules`, no other file in the repository. Left on, it reports every
 * import in a real project as a module it cannot find and every symbol from one
 * as `any`, which is a screen of red squiggles that are all wrong. Syntax
 * validation needs none of that context and is right every time, so it stays.
 *
 * Studio-wide rather than the Explorer's alone: the API panel's post-response
 * script is written against globals the sandbox provides at run time and no
 * declaration here describes, so semantic validation has exactly as little to
 * go on there.
 */
monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
})
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
})

/** The studio's own mono stack, which is a CSS variable Monaco cannot read —
 * it wants a font string, so the variable is resolved once here. */
export function monoFont(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-mono")
    .trim()
  return value ? `${value}, ui-monospace, monospace` : "ui-monospace, monospace"
}

/** Monaco ships one dark theme and one light one, and names them. */
export function editorTheme(isDark: boolean): string {
  return isDark ? "vs-dark" : "vs"
}

/**
 * How an editor that is a *field* sits in the studio: a SQL statement, a
 * request body, a response.
 *
 * Deliberately not what the Explorer's file editor gets. That one is a place
 * you read and navigate a file, so it keeps the minimap, the whitespace marks
 * and Monaco's own context menu; these are panes a few lines tall inside a form,
 * where all of that is chrome competing with the text. What they keep is the
 * half that earns its space at any size — numbered lines, folding, the find
 * widget and wrapping — which is exactly what the shared CodeMirror chrome
 * these replaced carried.
 */
export function panelEditorOptions(
  isDark: boolean
): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    theme: editorTheme(isDark),
    fontFamily: monoFont(),
    fontSize: 13,
    lineHeight: 1.6,
    // These panes are resized by a drag handle and hidden by a class rather
    // than unmounted, so the box changes size under an editor that is not being
    // looked at. `automaticLayout` is a ResizeObserver, which is the only thing
    // that catches that.
    automaticLayout: true,
    minimap: { enabled: false },
    // A field is read top to bottom; there is no long file to keep your place
    // in, and both of these would eat width or height that the text wants.
    stickyScroll: { enabled: false },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    scrollBeyondLastLine: false,
    wordWrap: "on",
    folding: true,
    smoothScrolling: true,
    padding: { top: 12, bottom: 12 },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    // The studio's own menus are what a right-click means everywhere else in
    // these panels; the file editor is the one place Monaco's has more to offer.
    contextmenu: false,
  }
}

export { monaco }
