import type { DbEngine } from "@shared/api"
import { dateInputKind } from "./date-input"
import type { Column, ForeignKey } from "./engines"

/**
 * The NocoDB-style widget a column's cell should render as, inferred from
 * what SQL already exposes — there is no metadata layer to declare this
 * explicitly, so it is derived fresh from the column (and, for
 * `foreign-key`, the matching constraint) every time.
 */
export type FieldKind =
  "generated" | "boolean" | "select" | "foreign-key" | "date" | "text"

/**
 * A column is only ever `foreign-key` when it is the *sole* column of some
 * constraint — a composite FK doesn't map onto one cell, and reassigning
 * half of a two-column key from a single picker has no safe UX. Composite
 * FKs still show up in the Structure tab unaffected.
 */
export function findSoleColumnForeignKey(
  column: Column,
  foreignKeys: ForeignKey[]
): ForeignKey | undefined {
  return foreignKeys.find(
    (fk) => fk.columns.length === 1 && fk.columns[0] === column.name
  )
}

const PREFERRED_LABEL_NAMES = ["name", "title", "label", "email", "username"]

/** Column types treated as "text-like" for `pickLabelColumn`'s fallback —
 * numeric/date/binary/json columns make poor row labels. */
function isTextish(type: string): boolean {
  if (typeof type !== "string") return false
  const normalized = type.trim().toLowerCase()
  return (
    normalized.includes("char") ||
    normalized.includes("text") ||
    normalized === "uuid" ||
    normalized.startsWith("enum(")
  )
}

/**
 * Which column to show as a foreign-key's human label, for a table that has
 * no metadata layer to declare one explicitly: prefer an obviously-named
 * column (`name`, `title`, …), else the first text-like non-key column, else
 * fall back to the key column itself.
 */
export function pickLabelColumn(
  columns: Column[],
  keyColumns: Column[]
): Column {
  const keyNames = new Set(keyColumns.map((column) => column.name))
  const candidates = columns.filter((column) => !keyNames.has(column.name))

  for (const name of PREFERRED_LABEL_NAMES) {
    const hit = candidates.find((column) => column.name.toLowerCase() === name)
    if (hit) return hit
  }
  const textish = candidates.find((column) => isTextish(column.type))
  if (textish) return textish
  return keyColumns[0] ?? columns[0]!
}

function isBooleanType(type: string, engine: DbEngine): boolean {
  if (typeof type !== "string") return false
  const normalized = type.trim().toLowerCase()
  return engine === "postgres"
    ? normalized === "boolean" || normalized === "bool"
    : normalized === "tinyint(1)"
}

/**
 * Priority, most to least specific: a generated column is read-only no
 * matter what its type or constraints look like otherwise; boolean is the
 * narrowest, least ambiguous signal after that; a native enum beats a
 * foreign key when a column happens to be both (rare — an enum-typed column
 * referencing an enum-typed key) since a closed label set is more useful
 * than a searchable row picker; and a key wins over `date` for the same
 * reason — a picker of real rows says more than a calendar over the one
 * timestamp that happens to be a key.
 */
export function inferFieldKind(
  column: Column,
  foreignKey: ForeignKey | undefined,
  engine: DbEngine
): FieldKind {
  if (column.generatedExpression !== null) return "generated"
  if (isBooleanType(column.type, engine)) return "boolean"
  if (column.enumValues && column.enumValues.length > 0) return "select"
  if (foreignKey) return "foreign-key"
  if (dateInputKind(column.type)) return "date"
  return "text"
}

/** A handful of theme-aware background/foreground pairs for enum pills —
 * enough spread that adjacent values in a short enum rarely collide. */
const ENUM_PALETTE: { bg: string; fg: string }[] = [
  { bg: "bg-red-500/15", fg: "text-red-700 dark:text-red-400" },
  { bg: "bg-orange-500/15", fg: "text-orange-700 dark:text-orange-400" },
  { bg: "bg-amber-500/15", fg: "text-amber-700 dark:text-amber-400" },
  { bg: "bg-lime-500/15", fg: "text-lime-700 dark:text-lime-400" },
  { bg: "bg-emerald-500/15", fg: "text-emerald-700 dark:text-emerald-400" },
  { bg: "bg-cyan-500/15", fg: "text-cyan-700 dark:text-cyan-400" },
  { bg: "bg-blue-500/15", fg: "text-blue-700 dark:text-blue-400" },
  { bg: "bg-violet-500/15", fg: "text-violet-700 dark:text-violet-400" },
  { bg: "bg-fuchsia-500/15", fg: "text-fuchsia-700 dark:text-fuchsia-400" },
  { bg: "bg-pink-500/15", fg: "text-pink-700 dark:text-pink-400" },
]

/**
 * A deterministic color for an enum label — hashed off the label text
 * itself, not its position in `enumValues`, so the same label reads as the
 * same color across different enum types, and stays stable if an enum's
 * declared member order is ever changed.
 */
export function colorForEnumLabel(label: string): { bg: string; fg: string } {
  let hash = 0
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0
  }
  return ENUM_PALETTE[hash % ENUM_PALETTE.length]!
}
