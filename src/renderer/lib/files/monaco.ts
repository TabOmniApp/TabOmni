import {
  language as htmlGrammar,
  conf as htmlConf,
} from "monaco-editor/languages/definitions/html/html"
import { language as jsGrammar } from "monaco-editor/languages/definitions/javascript/javascript"
import { language as tsGrammar } from "monaco-editor/languages/definitions/typescript/typescript"

import { monaco } from "@/lib/monaco"

import { vueFrom, withJsx } from "./grammars"
import { nameOf } from "./paths"
import { registerTypeScriptProviders } from "./typescript"

/**
 * Monaco, set up for the Explorer.
 *
 * What the whole studio shares — the workers, the font, the panel options — is
 * in `lib/monaco.ts`; this is the half only a file editor wants. The other
 * panels edit fields, where a language is a grammar and nothing more. This one
 * edits the user's own source files, so it carries the things that only make
 * sense against a real repository: JSX and Vue grammars Monaco does not ship,
 * a TypeScript worker held to syntax errors, and hover and go-to-definition
 * answered by a `tsserver` in the main process.
 */

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
 * How many editors are holding each path's model.
 *
 * There can be more than one: a file open in the text editor is the same buffer
 * as the right-hand side of its diff, and the `Changes` tab can be showing
 * that diff while the file has a tab of its own. Sharing the model is the point —
 * one buffer, one undo history, ⌘S from either — but it means neither editor may
 * dispose it on the way out, and the first one to try took the buffer out from
 * under the other.
 */
const holders = new Map<string, number>()

/**
 * A model per path, reused across mounts and across editors.
 *
 * Keyed by the file's own URI, which is what makes the editor's "go to
 * definition"-shaped features address the file the tree is showing. Reused
 * because a tab hidden behind another one keeps its model alive, and creating a
 * second for the same URI is the one thing Monaco throws over.
 *
 * Every caller must `releaseModel` when it is done with it.
 */
export function modelFor(
  filePath: string,
  text: string
): monaco.editor.ITextModel {
  const uri = monaco.Uri.file(filePath)
  const model =
    monaco.editor.getModel(uri) ??
    monaco.editor.createModel(text, languageIdFor(filePath), uri)

  holders.set(filePath, (holders.get(filePath) ?? 0) + 1)
  return model
}

/**
 * Lets go of a path's model, disposing it once nothing holds it.
 *
 * The model goes with the last editor that was showing the file — kept alive
 * across a hidden tab, since the pane stays mounted, and not across a closed
 * one, where it would be a copy of a file nobody is looking at held for the rest
 * of the run.
 */
export function releaseModel(filePath: string): void {
  const held = (holders.get(filePath) ?? 0) - 1
  if (held > 0) {
    holders.set(filePath, held)
    return
  }

  holders.delete(filePath)
  monaco.editor.getModel(monaco.Uri.file(filePath))?.dispose()
}
