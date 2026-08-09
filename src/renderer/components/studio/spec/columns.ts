import type { SpecItem } from "@/lib/spec/schema"

/**
 * The item table's columns, and the order a spec reads them in.
 *
 * Its own module because the table is drawn twice — as inputs when the spec is
 * being written, as text when it is being read — and a column added to one view
 * but not the other is a field that exists only while editing.
 *
 * The width is the editing view's; the preview lets its own content decide.
 */
export const COLUMNS: [key: keyof SpecItem, label: string, width: string][] = [
  ["itemName", "Item name", "w-44"],
  ["control", "Control", "w-28"],
  ["api", "API", "w-28"],
  ["constraints", "Constraints", "w-48"],
  ["description", "Description", "w-72"],
]
