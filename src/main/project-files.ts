import path from "node:path"

/**
 * What counts as a project's files.
 *
 * Its own module so that answering "is this file part of the project" does not
 * pull in `store.ts`, and with it a class that talks to the OS keychain. It was
 * split out when more than one thing walked a project's tree and they had to
 * agree about which files exist.
 */

/**
 * Directory trees never walked when reading a project back: dependency and VCS
 * directories, and the build output of the common toolchains.
 *
 * The list grew with imported projects. A scaffolded template has a handful of
 * files; a real repository has a `node_modules`, a `dist`, a `.next` and a
 * `.git` that together outnumber its sources by a hundred to one, and none of
 * them are what the user came to edit.
 */
export const SKIPPED_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "coverage",
  ".venv",
  "__pycache__",
  "target",
  "vendor",
])

/**
 * Ceilings on what a project's tree may be.
 *
 * A scaffolded project comes nowhere near these; an imported monorepo can, and
 * a tree that never finishes walking is worse than one that is honestly cut
 * short. `MAX_ENTRIES` is reported to the user rather than silently applied.
 */
export const MAX_ENTRIES = 20_000
export const MAX_DEPTH = 24

/** Above this, a file is not opened in the editor. */
const MAX_EDITABLE_BYTES = 1024 * 1024

/**
 * Extensions never opened as text. Reading one as UTF-8 would replace bytes
 * that do not decode, and saving it back would then write that damage to the
 * user's own file — which for an imported project is their repository.
 */
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".ico",
  ".icns",
  ".tiff",
  ".psd",
  ".pdf",
  ".zip",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".jar",
  ".war",
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
  ".bin",
  ".wasm",
  ".node",
  ".class",
  ".pyc",
  ".sqlite",
  ".sqlite3",
  ".db",
  ".pack",
  ".idx",
  ".keystore",
  ".p12",
  ".lockb",
])

/** Whether the editor may open a file at all. */
export function isEditable(relPath: string, size: number): boolean {
  if (size > MAX_EDITABLE_BYTES) return false
  return !BINARY_EXTENSIONS.has(path.extname(relPath).toLowerCase())
}

/** A filesystem path as the studio writes them, with `/` on every platform. */
export function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/")
}
