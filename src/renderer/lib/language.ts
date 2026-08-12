import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import type { Extension } from "@codemirror/state"

import { extname } from "./runtime/tree"

/** Picks a CodeMirror language mode from a file path. */
export function languageFor(path: string): Extension {
  switch (extname(path)) {
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true })
    case "tsx":
      return javascript({ typescript: true, jsx: true })
    case "jsx":
      return javascript({ jsx: true })
    case "js":
    case "mjs":
    case "cjs":
      return javascript()
    case "json":
      return json()
    case "css":
      return css()
    case "html":
    case "htm":
      return html()
    case "md":
    case "mdx":
      return markdown()
    default:
      return []
  }
}

/**
 * Picks a mode from a response's `Content-Type`.
 *
 * XML is highlighted by the HTML mode: the two are close enough for tags,
 * attributes and strings to come out right, and it saves carrying a second
 * parser for the rarer of the two. A type nobody here parses gets no
 * highlighting rather than a wrong guess.
 */
export function languageForContentType(contentType: string): Extension {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? ""

  if (type.includes("json")) return json()
  if (type === "text/html" || type.includes("xhtml")) return html()
  if (type.includes("xml") || type.endsWith("+xml") || type.includes("svg")) {
    return html()
  }
  if (type.includes("javascript") || type.includes("ecmascript")) {
    return javascript()
  }
  if (type.includes("css")) return css()
  if (type.includes("markdown")) return markdown()
  return []
}
