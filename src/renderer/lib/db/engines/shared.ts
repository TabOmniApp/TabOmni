import type { ColumnDraft, NewColumnDraft, TableDraft } from "./types"

/**
 * A fresh row for the "create table" dialog's column list — a placeholder,
 * not a suggestion, hence the deliberately generic `text` type.
 */
export function newColumn(): ColumnDraft {
  return {
    id: crypto.randomUUID(),
    name: "",
    type: "text",
    nullable: true,
    primaryKey: false,
    default: "",
  }
}

/**
 * Why a table draft cannot be turned into SQL yet, or null when it can.
 *
 * Every engine would reject most of this too, but its errors arrive one at a
 * time after a round trip — by which point a half-formed table may already
 * exist. The check itself has nothing engine-specific in it: a blank name or
 * a column listed twice is wrong the same way in Postgres and MySQL.
 */
export function draftError(draft: TableDraft): string | null {
  if (!draft.name.trim()) return "Give the table a name."

  // A row left entirely blank is just an unused slot in the form; one with a
  // type but no name is a column the user started and did not finish.
  const started = draft.columns.filter(
    (column) => column.name.trim() || column.type.trim()
  )
  const named = started.filter((column) => column.name.trim())
  if (named.length === 0) return "Add at least one column."

  const unnamed = started.findIndex((column) => !column.name.trim())
  if (unnamed !== -1) return `Column ${unnamed + 1} has no name.`

  const untyped = named.find((column) => !column.type.trim())
  if (untyped) return `Column “${untyped.name}” has no type.`

  const seen = new Set<string>()
  for (const column of named) {
    const key = column.name.trim().toLowerCase()
    if (seen.has(key)) return `Column “${column.name}” is listed twice.`
    seen.add(key)
  }

  return null
}

export function newColumnDraft(): NewColumnDraft {
  return { name: "", type: "text", nullable: true, default: "" }
}

export function newColumnError(column: NewColumnDraft): string | null {
  if (!column.name.trim()) return "Give the column a name."
  if (!column.type.trim()) return "Give the column a type."
  return null
}
