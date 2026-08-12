/**
 * Picks a Monaco language id from a response's `Content-Type`.
 *
 * XML gets its own grammar rather than being highlighted as HTML — Monaco
 * ships one, which is the compromise this made when the editors were
 * CodeMirror and a second parser was a dependency rather than a string. A type
 * nobody here recognises is `plaintext`, which is Monaco's own name for no
 * highlighting rather than a wrong guess.
 */
export function languageIdForContentType(contentType: string): string {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? ""

  if (type.includes("json")) return "json"
  if (type === "text/html" || type.includes("xhtml")) return "html"
  if (type.includes("xml") || type.endsWith("+xml") || type.includes("svg")) {
    return "xml"
  }
  if (type.includes("javascript") || type.includes("ecmascript")) {
    return "javascript"
  }
  if (type.includes("css")) return "css"
  if (type.includes("markdown")) return "markdown"
  return "plaintext"
}
