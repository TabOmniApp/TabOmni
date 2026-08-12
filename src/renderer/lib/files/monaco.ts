import * as monaco from "monaco-editor"
import cssWorker from "monaco-editor/languages/features/css/css.worker?worker"
import editorWorker from "monaco-editor/editor/editor.worker?worker"
import htmlWorker from "monaco-editor/languages/features/html/html.worker?worker"
import jsonWorker from "monaco-editor/languages/features/json/json.worker?worker"
import tsWorker from "monaco-editor/languages/features/typescript/ts.worker?worker"
import {
  language as htmlGrammar,
  conf as htmlConf,
} from "monaco-editor/languages/definitions/html/html"
import { language as jsGrammar } from "monaco-editor/languages/definitions/javascript/javascript"
import { language as tsGrammar } from "monaco-editor/languages/definitions/typescript/typescript"

import { vueFrom, withJsx } from "./grammars"
import { nameOf } from "./paths"
import { registerTypeScriptProviders } from "./typescript"

/**
 * Monaco, set up for the Explorer.
 *
 * The one place in the studio that is not CodeMirror. The rest of the app
 * edits fields — a SQL statement, a request body, a response — where
 * CodeMirror's size is the point; this panel edits the user's own source files,
 * where what is wanted is the editor they already know, with its own find
 * widget, multi-cursor, minimap, bracket colouring and command palette. Two
 * editing stacks is a real cost, and it buys exactly one thing: files feel like
 * files.
 *
 * Imported only from the lazy chunk in `files/monaco-editor.tsx`, so the ~4 MB
 * of language grammars is fetched the first time somebody opens a file and
 * never in a run that stays in the other panels — the same bargain the Notes
 * panel makes with Excalidraw.
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
 * Syntax errors, but no type errors.
 *
 * Monaco's TypeScript worker knows only the file in front of it: no tsconfig,
 * no `node_modules`, no other file in the repository. Left on, it reports every
 * import in a real project as a module it cannot find and every symbol from one
 * as `any`, which is a screen of red squiggles that are all wrong. Syntax
 * validation needs none of that context and is right every time, so it stays.
 */
monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
})
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
})

/*
 * JSX, in the two grammars that need it.
 *
 * `.tsx` and `.jsx` already resolve to these two languages — what they lacked
 * was any rule about a tag, so markup tokenized as arithmetic. Registered as a
 * *factory* rather than through `setMonarchTokensProvider` because that is how
 * Monaco registers its own, and registering a factory replaces the one already
 * there: setting a provider directly would win only until Monaco's lazy loader
 * resolved and overwrote it, which happens the first time a file is opened —
 * a race that would show as highlighting that works until it does not.
 *
 * The rules go to the languages rather than to `.tsx` and `.jsx` alone, since
 * Monaco has no separate id for those the way VS Code does and the TypeScript
 * worker is bound to these two ids. A plain `.ts` file is unaffected in
 * practice: the first JSX rule reads `Foo<Bar>` as generics, which is what it
 * is everywhere outside a tag.
 */
monaco.languages.registerTokensProviderFactory("typescript", {
  create: () => withJsx(tsGrammar),
})
monaco.languages.registerTokensProviderFactory("javascript", {
  create: () => withJsx(jsGrammar),
})

/*
 * Vue, which Monaco does not ship at all.
 *
 * A single-file component tokenizes as HTML with its script and style blocks
 * embedded, so it is registered as its own language with HTML's grammar and
 * HTML's bracket/comment configuration behind it — plus the one state that
 * reads `<script lang="ts">`, which is how Vue 3 spells what HTML spells
 * `type`. Highlighting only: the HTML *language service* is deliberately not
 * attached, since it would mark every `v-if`, `:prop` and `@click` in the
 * template as something it did not expect.
 */
monaco.languages.register({
  id: "vue",
  extensions: [".vue"],
  aliases: ["Vue", "vue"],
  mimetypes: ["text/x-vue"],
})
monaco.languages.setLanguageConfiguration("vue", htmlConf)
monaco.languages.setMonarchTokensProvider("vue", vueFrom(htmlGrammar))

/*
 * JSX is syntax, not an option, as far as the worker is concerned.
 *
 * TypeScript's parser turns JSX on from the file extension, but the worker
 * still checks what it parsed against these — and with syntax validation on
 * (see above), a `.tsx` file under the defaults reports its own tags as
 * errors. `Preserve` rather than a transform: nothing here emits, and the
 * question being asked of the worker is only whether the file parses.
 */
monaco.typescript.typescriptDefaults.setCompilerOptions({
  ...monaco.typescript.typescriptDefaults.getCompilerOptions(),
  jsx: monaco.typescript.JsxEmit.Preserve,
  allowJs: true,
  allowNonTsExtensions: true,
})
monaco.typescript.javascriptDefaults.setCompilerOptions({
  ...monaco.typescript.javascriptDefaults.getCompilerOptions(),
  jsx: monaco.typescript.JsxEmit.Preserve,
  allowJs: true,
  allowNonTsExtensions: true,
})

/**
 * Which language a file is in, asked of Monaco's own registry rather than a
 * table kept here.
 *
 * It ships the extension and filename lists for every grammar it has — around
 * eighty of them, `Dockerfile` and `.gitignore` included — and a second list in
 * this repository could only ever be a worse copy that also has to be kept in
 * step with it.
 */
export function languageIdFor(filePath: string): string {
  const name = nameOf(filePath).toLowerCase()
  // From the last dot, and never from a leading one: `.gitignore` is a name
  // Monaco matches whole, not an extension called `gitignore`.
  const dot = name.lastIndexOf(".")
  const suffix = dot > 0 ? name.slice(dot) : ""

  for (const language of monaco.languages.getLanguages()) {
    if (language.filenames?.some((entry) => entry.toLowerCase() === name)) {
      return language.id
    }
    if (
      suffix &&
      language.extensions?.some((entry) => entry.toLowerCase() === suffix)
    ) {
      return language.id
    }
  }
  return "plaintext"
}

/*
 * Hover and go-to-definition, answered by a TypeScript server in the main
 * process rather than by the worker above.
 *
 * Registered here, at the bottom, because it is the last thing Monaco needs to
 * be told and because the module it calls into imports this one back — for
 * `monaco` itself, and for the editors it moves. Anything higher in the file
 * would run before the languages it registers against exist.
 */
registerTypeScriptProviders()

/**
 * A model per path, reused across mounts.
 *
 * Keyed by the file's own URI, which is what makes the editor's "go to
 * definition"-shaped features address the file the tree is showing. Reused
 * because a tab hidden behind another one keeps its model alive, and creating a
 * second for the same URI is the one thing Monaco throws over.
 */
export function modelFor(
  filePath: string,
  text: string
): monaco.editor.ITextModel {
  const uri = monaco.Uri.file(filePath)
  return (
    monaco.editor.getModel(uri) ??
    monaco.editor.createModel(text, languageIdFor(filePath), uri)
  )
}

export { monaco }
