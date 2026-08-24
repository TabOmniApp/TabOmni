/**
 * The four kinds of thing the workbench opens: a file, a table, a request, a
 * note.
 *
 * **Not four ways into a panel any more.** These were the activity rail's icons,
 * then the right-hand panel's tabs, and now three of the four lists are sections
 * of the left column (`WorkspaceSidebar`) while the Explorer's is the right-hand
 * panel on its own. What survives both moves is the *kind*: a tab in the strip,
 * a hue, an icon and a label belong to one of these four whatever is listing it,
 * which is why the type outlived every bar that was named after it.
 *
 * `Pane` in `lib/store.ts` is this plus `worktree` — a project's chat is
 * opened from the left column and draws in a pane with no list of its own.
 * The two were one union while every pane had a way in of its own; then one did
 * not, so the subset is spelled out and the compiler finds what assumed
 * otherwise.
 */
export type Section = "files" | "database" | "api" | "note"

/** Every kind, in the app's own order — see `SECTIONS` in
 * `components/studio/section-marks.tsx`, which is this list with a label, an
 * icon and a hue against each id. */
export const SECTION_IDS: Section[] = ["files", "database", "api", "note"]

export function isSection(value: string): value is Section {
  return (SECTION_IDS as string[]).includes(value)
}
