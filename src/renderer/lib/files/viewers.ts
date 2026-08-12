import { nameOf } from "./paths"

/**
 * How a file can be shown, and which way it is shown by default.
 *
 * Most files have one honest answer — a `.ts` is text, a `.png` is a picture —
 * and for those this decides nothing the extension had not already decided. Two
 * are genuinely more than one thing. An SVG is a picture, and also a text file
 * people open to change a `fill` or a `viewBox`. A `.md` is the source somebody
 * edits, and also a document somebody reads. Both get both, and the tree's
 * right-click menu is where the second one is.
 */
export type Viewer = "image" | "text" | "markdown"

/**
 * What the studio will draw as a picture.
 *
 * The same list the main process will hand back bytes for (`IMAGE_MIME_TYPES`
 * in `main/ipc.ts`), because a viewer offered for a type that comes back as
 * `application/octet-stream` is an empty box with no explanation. Deliberately
 * not every format a browser can decode: `.ico` and `.avif` render, but nobody
 * opens a workspace to look at one, and each entry here is a row in a menu.
 */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
])

/** The extension, lowercased, without its dot — `""` for a name that has none,
 * and for a dotfile, whose leading dot is part of the name. */
function extensionOf(filePath: string): string {
  const name = nameOf(filePath).toLowerCase()
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1) : ""
}

export function isImage(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(filePath))
}

/**
 * What the studio will render as a document.
 *
 * Just the two spellings of markdown, and deliberately not `.mdx`: that is
 * markdown with JSX in it, and a commonmark parser reads a component tag as
 * either nothing or a stray paragraph — a preview that quietly drops half the
 * file is worse than no preview offered.
 */
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"])

export function isMarkdown(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(filePath))
}

/**
 * Every way this file can be shown, best first.
 *
 * The order is the menu's order and the first entry is the default, so there is
 * one list rather than a list and a separate rule about it. A length of one
 * means the tree draws no "open with" group at all: a menu whose only choice is
 * the thing already on screen is a menu that teaches nothing.
 */
export function viewersFor(filePath: string): Viewer[] {
  if (isImage(filePath)) {
    // An SVG is a picture first — that is what somebody double-clicking one
    // wants to see — and text when they say so.
    return extensionOf(filePath) === "svg" ? ["image", "text"] : ["image"]
  }

  // A `.md` opens in the editor, not the preview. The Explorer is where a
  // project's files are worked on, and a README clicked from a tree of source
  // is more often on the way to being changed than being read — so the
  // rendered view is the one asked for rather than the one arrived at.
  if (isMarkdown(filePath)) return ["text", "markdown"]

  return ["text"]
}

export function defaultViewer(filePath: string): Viewer {
  return viewersFor(filePath)[0]!
}

export const VIEWER_LABELS: Record<Viewer, string> = {
  image: "Image preview",
  text: "Text editor",
  markdown: "Markdown preview",
}
