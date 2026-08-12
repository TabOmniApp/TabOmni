import type { SqlResult } from "./runner"

/** A result set as CSV. Quotes containing a comma, quote, or newline are
 * escaped by doubling, per RFC 4180. */
export function toCsv(result: SqlResult): string {
  const header = result.fields.map((field) => escape(field.name)).join(",")
  const rows = result.rows.map((row) =>
    row.map((value) => escape(stringify(value))).join(",")
  )
  return [header, ...rows].join("\r\n")
}

/** Builds and clicks a throwaway download link — the standard way to save a
 * client-generated file with no server round trip. */
export function downloadCsv(result: SqlResult, filename: string): void {
  const blob = new Blob([toCsv(result)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) {
    return (
      "\\x" +
      Array.from(value)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
    )
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function escape(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
