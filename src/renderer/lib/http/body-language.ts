import { monaco } from "@/lib/monaco"
import { languageIdForContentType } from "@/lib/language"

/**
 * A request body is a template, not a document.
 *
 * `{{token}}` is substituted on the way out (see `substitute` in
 * `http/store.ts`), so what is on screen is JSON-shaped rather than JSON — and
 * Monaco's JSON language service, handed it, marks every variable as a syntax
 * error. That service has no per-model switch: validation is on for every JSON
 * model in the window or none of them, and the Explorer's own `.json` files
 * want it on.
 *
 * So a body written as JSON gets its own language instead, with a Monarch
 * grammar and deliberately no service behind it — the same bargain `files/
 * monaco.ts` makes for Vue. It costs the squiggles on genuinely malformed JSON
 * and buys back the variables, which are highlighted as variables here rather
 * than left as the plain text CodeMirror showed.
 */
const BODY_LANGUAGE = "http-body"

/** Matches what `substitute` replaces, so what is highlighted is exactly what
 * will be filled in. */
const VARIABLE = /\{\{\s*[\w.-]+\s*\}\}/

monaco.languages.register({ id: BODY_LANGUAGE })

monaco.languages.setLanguageConfiguration(BODY_LANGUAGE, {
  brackets: [
    ["{", "}"],
    ["[", "]"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: '"', close: '"', notIn: ["string"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: '"', close: '"' },
  ],
})

monaco.languages.setMonarchTokensProvider(BODY_LANGUAGE, {
  defaultToken: "",
  tokenizer: {
    root: [
      [VARIABLE, "variable"],
      // A key is a string the tokenizer has already seen a colon after, which
      // is the one piece of structure worth colouring differently — it is what
      // makes a body skimmable.
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, "type"],
      [/"(?:[^"\\]|\\.)*"/, "string"],
      [/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/, "number"],
      [/\b(?:true|false|null)\b/, "keyword"],
      [/[{}[\],:]/, "delimiter"],
    ],
  },
})

/**
 * Which language the body editor shows a given `Content-Type` in.
 *
 * Everything but JSON is Monaco's own — an XML or HTML body carrying a variable
 * has no service to be confused by one, and the post-response script is real
 * JavaScript that is never substituted.
 */
export function languageIdForBody(contentType: string): string {
  const id = languageIdForContentType(contentType)
  return id === "json" ? BODY_LANGUAGE : id
}
