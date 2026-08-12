/*
 * Vite's `?worker` imports, which hand back a constructor rather than a URL.
 *
 * Declared here rather than by switching the renderer project on to
 * `vite/client`: the only thing this project needs from those types is this one
 * suffix, and the ambient `*.css` / `*.svg` modules that would come with them
 * are a wider claim than the two files already declaring what they import (see
 * `excalidraw.d.ts`).
 *
 * No imports in this file, deliberately: an ambient module declaration is only
 * global in a `.d.ts` that is not itself a module.
 */
declare module "*?worker" {
  const WorkerConstructor: new () => Worker
  export default WorkerConstructor
}

/*
 * Monaco's own Monarch grammars, which its `exports` map publishes without
 * types — only the `register.d.ts` beside each one is declared, and that is the
 * registration rather than the grammar. `src/renderer/lib/files/grammars.ts`
 * imports two of them to extend rather than to reimplement; this says what they
 * hand back.
 */
declare module "monaco-editor/languages/definitions/typescript/typescript" {
  import type { languages } from "monaco-editor"
  export const conf: languages.LanguageConfiguration
  export const language: languages.IMonarchLanguage
}

declare module "monaco-editor/languages/definitions/javascript/javascript" {
  import type { languages } from "monaco-editor"
  export const conf: languages.LanguageConfiguration
  export const language: languages.IMonarchLanguage
}

declare module "monaco-editor/languages/definitions/html/html" {
  import type { languages } from "monaco-editor"
  export const conf: languages.LanguageConfiguration
  export const language: languages.IMonarchLanguage
}
