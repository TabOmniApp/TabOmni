import type { NoteBlock } from "../shared/api"
import { noteFileNameOf } from "../shared/note-files"

/**
 * Reading a note's document in the main process.
 *
 * The renderer has its own walks over the same blocks in `lib/note/blocks.ts`,
 * and neither side may import the other's — so these two are the parse and the
 * one walk the preview server needs, and nothing else. Keeping them apart is
 * cheaper than the alternative it would take to share them: the renderer's file
 * is about editing a document (cloning drawings for a duplicate, adopting the
 * fences an older build wrote), and none of that has a meaning here.
 */

/** The blocks in a note's file, or none for a file that is empty, half-written
 * or not an array. A preview is a read; it reports and shows an empty note
 * rather than refusing to answer. */
export function parseNote(text: string): NoteBlock[] {
  if (!text.trim()) return []
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? (parsed as NoteBlock[]) : []
  } catch {
    console.error("Could not read the note's blocks")
    return []
  }
}

/** Every file of the workspace's own the document points at, each once. The
 * same question as `drawingIdsIn`, asked of the pictures. */
export function noteFileNamesIn(blocks: NoteBlock[]): string[] {
  const names: string[] = []

  const walk = (nodes: NoteBlock[]): void => {
    for (const node of nodes) {
      const name = noteFileNameOf(node.props?.url)
      if (name && !names.includes(name)) names.push(name)
      if (node.children) walk(node.children)
    }
  }

  walk(blocks)
  return names
}

/**
 * The same document with every `note-file://` URL replaced by what `resolved`
 * holds for it.
 *
 * Why the substitution happens here rather than in `note-html.ts`: that file
 * renders one block at a time and would have to carry the pictures through every
 * case to reach the two that hold a URL, and its scheme list is the security
 * boundary — a URL arriving there should already be one a browser can follow. So
 * the document is resolved first, and what the renderer sees is a `data:` URL
 * like any other.
 *
 * A name with nothing resolved for it is left alone, which is a URL in a scheme
 * `safeUrl` refuses: a picture whose file has gone renders as the "missing" line
 * for a file the page cannot reach, rather than a broken image.
 */
export function withNoteFileUrls(
  blocks: NoteBlock[],
  resolved: ReadonlyMap<string, string>
): NoteBlock[] {
  return blocks.map((block) => {
    const children = block.children
      ? withNoteFileUrls(block.children, resolved)
      : block.children

    const url = resolved.get(noteFileNameOf(block.props?.url) ?? "")
    if (!url) {
      return children === block.children ? block : { ...block, children }
    }
    return {
      ...block,
      props: { ...block.props, url },
      ...(children ? { children } : {}),
    }
  })
}

/** Every drawing the document points at, in the order they appear and each
 * once — a note can hold the same drawing twice, and the file behind it is
 * read by id. */
export function drawingIdsIn(blocks: NoteBlock[]): string[] {
  const ids: string[] = []

  const walk = (nodes: NoteBlock[]): void => {
    for (const node of nodes) {
      if (node.type === "drawing") {
        const id = node.props?.drawingId
        const trimmed = typeof id === "string" ? id.trim() : ""
        if (trimmed && !ids.includes(trimmed)) ids.push(trimmed)
      }
      if (node.children) walk(node.children)
    }
  }

  walk(blocks)
  return ids
}

/**
 * A note's document as markdown, for a reader that wants the words rather than
 * the editor's model — which so far means the MCP server: an agent handed
 * BlockNote's JSON would spend a turn parsing what it was given.
 *
 * Deliberately one-way and lossy, and not the inverse of the renderer's
 * `from-markdown.ts`: a drawing, a picture and a video are named rather than
 * carried, because nothing on this path can render them. That is also why
 * nothing writes a note back through here — `createNote` in `ipc.ts` stores
 * plain markdown and lets the editor convert it on first open, the same way a
 * note written by an older build is converted.
 */
export function noteMarkdown(blocks: NoteBlock[]): string {
  const lines: string[] = []
  render(blocks, lines, "")
  // Collapses the runs of blank lines that nesting leaves behind.
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function render(blocks: NoteBlock[], lines: string[], indent: string): void {
  let number = 0

  for (const block of blocks) {
    // Numbering restarts wherever the list does, so two lists separated by a
    // paragraph do not carry on counting from each other.
    if (block.type === "numberedListItem") number += 1
    else number = 0

    const text = inlineText(block.content)

    switch (block.type) {
      case "heading": {
        const level = Number(block.props?.level ?? 1)
        lines.push("", `${"#".repeat(Math.min(6, Math.max(1, level)))} ${text}`)
        break
      }
      case "bulletListItem":
        lines.push(`${indent}- ${text}`)
        break
      case "numberedListItem":
        lines.push(`${indent}${number}. ${text}`)
        break
      case "checkListItem":
        lines.push(`${indent}- [${block.props?.checked ? "x" : " "}] ${text}`)
        break
      // A toggle's summary is a plain line: markdown has no fold, and the
      // children below it are what the toggle was hiding.
      case "toggleListItem":
        lines.push(`${indent}- ${text}`)
        break
      case "codeBlock": {
        const language =
          typeof block.props?.language === "string" ? block.props.language : ""
        lines.push("", `\`\`\`${language}`, text, "```")
        break
      }
      case "quote":
        lines.push("", `> ${text}`)
        break
      case "divider":
        lines.push("", "---")
        break
      case "table":
        lines.push("", ...tableRows(block))
        break
      case "drawing":
        lines.push("", `[drawing ${block.props?.drawingId ?? ""}]`)
        break
      case "image":
      case "video":
      case "audio":
      case "file":
        lines.push("", attachment(block))
        break
      default:
        if (text) lines.push("", text)
    }

    if (block.children?.length) {
      // Two spaces per level, which is what a nested list needs and what
      // anything else under a block can live with.
      render(block.children, lines, `${indent}  `)
    }
  }
}

/** One attachment named rather than embedded: its caption or its type, and the
 * URL it points at — `note-file://…` for one of the workspace's own. */
function attachment(block: NoteBlock): string {
  const caption =
    typeof block.props?.caption === "string" && block.props.caption.trim()
      ? block.props.caption.trim()
      : (block.props?.name ?? block.type ?? "file")
  const url = typeof block.props?.url === "string" ? block.props.url : ""
  return `[${String(caption)}](${url})`
}

/** A table as a pipe table, header row and all. BlockNote keeps the header as
 * the first row rather than as a kind of its own. */
function tableRows(block: NoteBlock): string[] {
  const content = block.content as
    { rows?: { cells?: unknown[] }[] } | undefined
  const rows = content?.rows ?? []
  if (rows.length === 0) return []

  const cells = (row: { cells?: unknown[] }): string[] =>
    (row.cells ?? []).map((cell) => {
      // A cell is either inline content or, since BlockNote 0.15, a cell object
      // with its own content and props.
      const inner =
        cell && typeof cell === "object" && "content" in cell
          ? (cell as { content?: unknown }).content
          : cell
      return inlineText(inner).replaceAll("|", "\\|")
    })

  const header = cells(rows[0]!)
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.slice(1).map((row) => `| ${cells(row).join(" | ")} |`),
  ]
}

/** The words of a block's inline content, links included as `[text](href)`. */
function inlineText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  return content
    .map((raw: unknown) => {
      if (typeof raw === "string") return raw
      if (typeof raw !== "object" || raw === null) return ""
      const item = raw as Record<string, unknown>

      if (item.type === "link") {
        const href = typeof item.href === "string" ? item.href : ""
        return `[${inlineText(item.content)}](${href})`
      }
      if (typeof item.text === "string") return item.text
      return inlineText(item.content)
    })
    .join("")
}
