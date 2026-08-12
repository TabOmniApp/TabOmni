import type { languages } from "monaco-editor"

/**
 * The two grammars Monaco does not ship the way this studio needs them: JSX,
 * and Vue.
 *
 * Standalone Monaco highlights with Monarch rather than with the TextMate
 * grammars VS Code itself uses, and the two are not the same set. `.tsx` and
 * `.jsx` are registered — they tokenize as TypeScript and JavaScript — but the
 * grammar behind them has no notion of a tag, so `<Button variant="ghost">`
 * comes out as a chain of operators and identifiers. `.vue` is not registered
 * at all, and falls to plain text.
 *
 * Both are handled by extending what is already there rather than by writing a
 * language: the JSX rules are added in front of the stock TypeScript and
 * JavaScript rules, and Vue is HTML's own grammar with one state added for
 * `<script lang="ts">`. A grammar of our own would be a second, worse copy of a
 * language Monaco already knows.
 */

/**
 * A Monarch tokenizer, as this file reads and rebuilds it.
 *
 * Monaco's own `IMonarchLanguage` types the tokenizer as
 * `{ [state: string]: IMonarchLanguageRule[] }`, and a rule as a union wide
 * enough that the tuples below — `[regex, action]`, `[regex, action, next]` —
 * only fit it after a widening the compiler will not do on its own. Named here
 * so the cast happens once, at the boundary, rather than at every rule.
 */
type Rule = languages.IMonarchLanguageRule
type Rules = Record<string, Rule[]>

/**
 * The tag rules, added in front of a JavaScript-family grammar.
 *
 * The hard part of JSX in a tokenizer is that `<` is three things — less-than,
 * a type argument, and a tag — and Monarch matches a regex at a position with
 * no idea what an expression is. The rule this leans on is that **`<` directly
 * after an identifier is generics, and `<` after anything else is a tag**:
 * `Array<string>` and `useState<number>()` have no space, while JSX is always
 * preceded by a `(`, a `return`, an `=>`, a `{`, or another tag. That is why
 * the first rule below consumes the identifier and the `<` together — it takes
 * the ambiguous case off the table before the tag rule can see it.
 *
 * It is a heuristic and it can be wrong: `1<x` reads as a tag, and a generic
 * component (`<Select<Option> …>`) reads as a tag with a stray `<` in it.
 * Both are rarer than the two cases it gets right, and being wrong here colours
 * a line oddly rather than breaking anything.
 */
const JSX_RULES: Rule[] = [
  // Generics, taken before the tag rule below can mistake them for one.
  [/([A-Za-z_$][\w$]*)(<)/, ["identifier", "delimiter.angle"]],

  // A fragment, which has no name and so no tag state to enter.
  [/<>|<\/>/, "delimiter.angle"],

  // A component, by the convention every JSX runtime enforces: capitalised is
  // a value in scope, lowercase is an element the runtime knows. Coloured
  // apart for the same reason VS Code colours them apart.
  [/<\/?[A-Z][\w$.]*/, { token: "type.identifier", next: "@jsxTag" }],
  [/<\/?[a-z][\w.-]*/, { token: "tag", next: "@jsxTag" }],
]

/** Inside `<… >`: attributes, and the braces that hold an expression. */
const JSX_TAG_STATE: Rule[] = [
  [/\s+/, ""],
  [/\/?>/, { token: "delimiter.angle", next: "@pop" }],
  [/=/, "delimiter"],
  [/"([^"]*)"/, "attribute.value"],
  [/'([^']*)'/, "attribute.value"],
  // `{` opens an expression, which is ordinary JavaScript again.
  [/\{/, { token: "delimiter.bracket", next: "@jsxExpression" }],
  [/[A-Za-z_$][\w$\-:.]*/, "attribute.name"],
]

/**
 * An expression inside a tag — `onClick={() => …}`, `style={{ gap: 4 }}`.
 *
 * `include: "@root"` is the whole point: an expression in a tag is the language
 * itself, not a dialect of it. The nested `{` rule ahead of the include is what
 * keeps `{{ … }}` balanced — without it the first `}` would close the
 * attribute and leave the tokenizer a brace behind for the rest of the file.
 */
const JSX_EXPRESSION_STATE: Rule[] = [
  [/\}/, { token: "delimiter.bracket", next: "@pop" }],
  [/\{/, { token: "delimiter.bracket", next: "@jsxExpression" }],
  { include: "@root" },
]

/** A JavaScript-family grammar that also knows tags. */
export function withJsx(
  base: languages.IMonarchLanguage
): languages.IMonarchLanguage {
  const tokenizer = base.tokenizer as Rules

  return {
    ...base,
    tokenizer: {
      ...tokenizer,
      // In front of the stock rules rather than behind them: Monarch takes the
      // first rule that matches, and `<` is claimed by the operator rule.
      root: [...JSX_RULES, ...(tokenizer.root ?? [])],
      jsxTag: JSX_TAG_STATE,
      jsxExpression: JSX_EXPRESSION_STATE,
    },
  }
}

/**
 * HTML's grammar, taught about `<script lang="ts">`.
 *
 * A single-file component is an HTML document as far as tokenizing goes —
 * template, script and style, with the last two embedded — and HTML's own
 * grammar already switches the embedded mode on a `type` attribute. Vue spells
 * that attribute `lang`, so this adds the same three states for it, and maps
 * `ts` to the TypeScript mode by the mime type it registered itself under.
 *
 * `<style lang="scss">` is left as CSS: SCSS is a superset, so the selectors,
 * properties and strings all come out right and only its own extensions are
 * missed, which is a poorer trade to chase than the script block was.
 */
export function vueFrom(
  html: languages.IMonarchLanguage
): languages.IMonarchLanguage {
  const tokenizer = html.tokenizer as Rules
  const script = tokenizer.script ?? []

  /** What both `lang` states fall back on: the closing tag, whitespace, and a
   * `>` that arrived before any value did. */
  const untilScriptEnds: Rule[] = [
    [
      />/,
      {
        token: "delimiter",
        next: "@scriptEmbedded",
        nextEmbedded: "text/javascript",
      },
    ],
    [/[ \t\r\n]+/, ""],
    [/<\/script\s*>/, { token: "@rematch", next: "@pop" }],
  ]

  const embedded = (mime: string) => ({
    token: "attribute.value",
    switchTo: `@scriptWithCustomType.${mime}`,
  })

  return {
    ...html,
    tokenizer: {
      ...tokenizer,
      script: [[/lang/, "attribute.name", "@vueScriptAfterLang"], ...script],
      vueScriptAfterLang: [
        [/=/, "delimiter", "@vueScriptAfterLangEquals"],
        ...untilScriptEnds,
      ],
      vueScriptAfterLangEquals: [
        [/"(ts|typescript)"/, embedded("text/typescript")],
        [/'(ts|typescript)'/, embedded("text/typescript")],
        [/"([^"]*)"/, embedded("text/javascript")],
        [/'([^']*)'/, embedded("text/javascript")],
        ...untilScriptEnds,
      ],
    },
  }
}
