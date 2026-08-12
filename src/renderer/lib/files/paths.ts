/**
 * Absolute paths, as the renderer has to handle them.
 *
 * `lib/runtime/tree.ts` splits on `/` and is right to: the paths it is about are
 * the ones this app made up. These are the operating system's, handed over by
 * the main process exactly as `node:path` produced them — which on Windows
 * means `C:\project\src\main.ts`, backslashes and all. A renderer that assumed
 * one separator would put the whole tree under a single row named
 * `C:\project\src\main.ts` there, and quietly: nothing would throw.
 *
 * So everything here accepts both separators, and nothing here builds a path —
 * joining a directory to a name happens in the main process, which knows which
 * separator this machine uses. See `main/files.ts`.
 */

/** Where the last separator falls, whichever separator it is. */
function lastSeparator(target: string): number {
  return Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\"))
}

/** The last segment: `src/main.ts` → `main.ts`. */
export function nameOf(target: string): string {
  const index = lastSeparator(target)
  return index === -1 ? target : target.slice(index + 1)
}

/**
 * The directory holding it: `/a/b/c.ts` → `/a/b`.
 *
 * A path with no separator left in it is its own parent rather than `""` —
 * the callers are asking "where would a sibling of this go", and an empty
 * answer sends a new file to the process's working directory.
 */
export function parentOf(target: string): string {
  const index = lastSeparator(target)
  if (index === -1) return target
  // A path directly under the root keeps the root's own separator, so
  // `/a.txt` gives `/` rather than `""`.
  return index === 0 ? target.slice(0, 1) : target.slice(0, index)
}

/**
 * Whether `target` is `root` itself or sits under it.
 *
 * The renderer's own copy of the question `insideAny` answers in the main
 * process, and deliberately not a substitute for it: this one decides which
 * tabs a removed folder takes with it, that one decides what the app is allowed
 * to read. A check in the renderer is a convenience; the one that matters is
 * the one on the other side of the IPC boundary.
 */
export function isInside(root: string, target: string): boolean {
  if (target === root) return true
  const last = root.slice(-1)
  const prefix = last === "/" || last === "\\" ? root : root + separatorOf(root)
  return target.startsWith(prefix)
}

/** The separator a path is already written with, defaulting to `/` for one
 * that has none. */
function separatorOf(target: string): string {
  return target.includes("\\") && !target.includes("/") ? "\\" : "/"
}

/**
 * `target` with the part of it that was `from` replaced by `to` — what a rename
 * does to every path filed under the thing renamed.
 *
 * Paths are identities in this panel, so renaming a directory is not an edit to
 * one record: it is a new name for the open tab, the expanded row and the
 * cached listing of everything inside it.
 */
export function movedPath(target: string, from: string, to: string): string {
  return isInside(from, target) ? to + target.slice(from.length) : target
}
