import type { NoteBlock } from "../shared/api"

/**
 * A note, rendered to HTML in the main process.
 *
 * This is the whole reason the preview is server-rendered: the page a browser
 * — or something reading pages rather than looking at them — receives is
 * finished HTML, with no script needed to put the words on it. BlockNote's own
 * `blocksToHTMLLossy` was the obvious alternative and is not one: it is a
 * method on an editor, an editor is ProseMirror, and ProseMirror is a DOM. That
 * would have meant the renderer rendering every preview and pushing it here,
 * so a note could only be previewed while its window was open and while that
 * note was the one being looked at.
 *
 * What is written here instead is a walk over the same block model, emitting
 * plain semantic HTML — `<h2>`, `<ul>`, `<table>`, `<pre>` — rather than
 * BlockNote's own class-laden markup. That is the better output for this
 * anyway: the page is read, not edited, and semantic HTML is what a reader
 * with no stylesheet gets the structure from.
 *
 * Everything reaching this file came off disk, so nothing is trusted: text is
 * escaped, a URL is checked against a scheme list before it becomes an `href`,
 * and a colspan is an integer or it is not there at all. A note is the user's
 * own text — but this is a page served over a socket, and the one rule of a
 * page served over a socket is that the document does not get to write the
 * markup.
 */

/** The heading levels HTML has. A note written by a schema with more (or a
 * file edited by hand) is clamped rather than refused. */
const MAX_HEADING = 6

/**
 * What a URL in a note may point at.
 *
 * `data:` is on the list because an image pasted into a note arrives as one —
 * BlockNote inlines it rather than writing a file — so leaving it off would
 * blank exactly the images that are certainly the user's own. `javascript:`
 * and every other scheme are refused: the page is opened in the user's real
 * browser, where a link is a link.
 */
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "data:"])

/** The pictures the note's drawings were last exported as, by drawing id. Read
 * before rendering starts, because this walk is synchronous and a drawing is a
 * file. */
export type Drawings = ReadonlyMap<string, string>

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** A URL fit to put in an `href` or `src`, or null. Parsed rather than
 * pattern-matched: `java\nscript:` is not a scheme to a parser. */
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  try {
    const url = new URL(value, "http://127.0.0.1")
    if (!SAFE_SCHEMES.has(url.protocol)) return null
  } catch {
    return null
  }
  return escapeHtml(value)
}

function propString(block: NoteBlock, name: string): string {
  const value = block.props?.[name]
  return typeof value === "string" ? value : ""
}

/** A prop that has to become a number in the markup — a span, a width. Anything
 * else is dropped rather than guessed at. */
function propInt(block: NoteBlock, name: string): number | null {
  const value = block.props?.[name]
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const whole = Math.trunc(value)
  return whole > 0 ? whole : null
}

/**
 * The text of one inline run, wrapped in whatever its styles say.
 *
 * The order is fixed rather than taken from the object's own key order, so the
 * same run always produces the same markup — `<strong><em>` and `<em><strong>`
 * read identically in a browser and differently in a diff.
 */
const STYLE_TAGS: [string, string][] = [
  ["bold", "strong"],
  ["italic", "em"],
  ["underline", "u"],
  ["strike", "s"],
  ["code", "code"],
]

/**
 * The colours BlockNote's own menu offers, and the only ones this page paints.
 *
 * A colour reaches the page as a **name**, never as the value behind it: the
 * page declares both renderings of each name in its stylesheet and a run gets
 * `var(--hl-yellow-text)`, so a yellow heading is the studio's yellow in light
 * and the studio's other yellow in dark — the same two values BlockNote itself
 * uses, kept in step by the browser rather than by this walk.
 *
 * That is also what makes it safe. Nothing out of the file is ever spent as a
 * CSS value; a name that is not on this list is dropped, which is the whole of
 * the validation.
 *
 * The cost is a colour picked outside the menu — the studio's own `oklch(…)`
 * turns up on table cells this way — which goes. Those are bound to the theme
 * they were picked in, and there is no honest way to show a colour chosen
 * against the editor's dark surface on a page that follows the reader's.
 */
const HIGHLIGHTS = new Set([
  "gray",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
])

/**
 * The `style` for whatever of the two colours are set, or "".
 *
 * Takes the bag rather than the block, because the same two names are a run's
 * styles, a block's props and a table cell's props — three places, one rule.
 */
function tint(source: Record<string, unknown> | undefined): string {
  if (!source) return ""

  const named = (key: string): string | null => {
    const value = source[key]
    return typeof value === "string" && HIGHLIGHTS.has(value) ? value : null
  }

  const text = named("textColor")
  const background = named("backgroundColor")
  if (!text && !background) return ""

  const declarations = [
    text ? `color:var(--hl-${text}-text)` : "",
    background ? `background-color:var(--hl-${background}-bg)` : "",
  ]
    .filter(Boolean)
    .join(";")

  return ` class="tint" style="${declarations}"`
}

function renderStyledText(item: Record<string, unknown>): string {
  const text = typeof item.text === "string" ? item.text : ""
  if (!text) return ""

  const styles = (item.styles ?? {}) as Record<string, unknown>
  let html = escapeHtml(text)
  for (const [style, tag] of STYLE_TAGS) {
    if (styles[style]) html = `<${tag}>${html}</${tag}>`
  }

  // Outside the emphasis tags rather than inside: a colour is the run's, and a
  // run that is bold *and* yellow should not have to be two spans deep.
  const colour = tint(styles)
  return colour ? `<span${colour}>${html}</span>` : html
}

/** A block's inline content: styled runs, links, and whatever an inline content
 * type this build does not know contributes text-wise. */
function renderInline(content: unknown): string {
  if (typeof content === "string") return escapeHtml(content)
  if (!Array.isArray(content)) return ""

  return content
    .map((raw: unknown) => {
      if (typeof raw === "string") return escapeHtml(raw)
      if (typeof raw !== "object" || raw === null) return ""
      const item = raw as Record<string, unknown>

      if (item.type === "link") {
        const inner = renderInline(item.content)
        const href = safeUrl(item.href)
        // A link whose href was refused keeps its words: dropping the run
        // would take a sentence's text out with a URL nobody can see anyway.
        if (!href) return inner
        return `<a href="${href}" rel="noreferrer">${inner}</a>`
      }

      return renderStyledText(item)
    })
    .join("")
}

/** The plain text of a block's content, for the places markup cannot go — an
 * `alt`, a code block's body. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((raw: unknown) => {
      if (typeof raw === "string") return raw
      if (typeof raw !== "object" || raw === null) return ""
      const item = raw as Record<string, unknown>
      if (typeof item.text === "string") return item.text
      return textOf(item.content)
    })
    .join("")
}

/** Which list a block belongs in, or null for anything that is not a list
 * item. The three that share a tag still differ in the class, because a
 * checklist reads as one. */
function listOf(
  block: NoteBlock
): { tag: "ul" | "ol"; className: string } | null {
  switch (block.type) {
    case "bulletListItem":
      return { tag: "ul", className: "bullets" }
    case "numberedListItem":
      return { tag: "ol", className: "numbers" }
    case "checkListItem":
      return { tag: "ul", className: "checks" }
    case "toggleListItem":
      return { tag: "ul", className: "toggles" }
    default:
      return null
  }
}

/**
 * A run of blocks.
 *
 * List items arrive as siblings — the document has no list node, only items
 * that happen to follow one another — so consecutive items of the same kind
 * are gathered into one `<ul>` or `<ol>` here. Without it a five-item list is
 * five one-item lists, which is a paragraph of bullets with gaps in a browser
 * and five lists to anything reading the structure.
 */
function renderBlocks(blocks: NoteBlock[], drawings: Drawings): string {
  const html: string[] = []

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]
    if (!block) continue

    const list = listOf(block)
    if (!list) {
      html.push(renderBlock(block, drawings))
      continue
    }

    const items: NoteBlock[] = []
    for (let scan = index; scan < blocks.length; scan++) {
      const candidate = blocks[scan]
      const next = candidate ? listOf(candidate) : null
      if (!candidate || next?.tag !== list.tag) break
      if (next.className !== list.className) break
      items.push(candidate)
      index = scan
    }

    const first = items[0]
    const start = first ? propInt(first, "start") : null
    const startAttr =
      list.tag === "ol" && start && start !== 1 ? ` start="${start}"` : ""
    html.push(
      `<${list.tag} class="${list.className}"${startAttr}>` +
        items.map((item) => renderListItem(item, drawings)).join("") +
        `</${list.tag}>`
    )
  }

  return html.join("\n")
}

/** An item, with anything nested under it inside its own `<li>` — which is
 * where a nested list belongs, and the one place children are not un-nested. */
function renderListItem(block: NoteBlock, drawings: Drawings): string {
  const checked =
    block.type === "checkListItem" ? block.props?.checked === true : null
  const box =
    checked === null
      ? ""
      : `<input type="checkbox" disabled${checked ? " checked" : ""}> `

  const children = block.children?.length
    ? renderBlocks(block.children, drawings)
    : ""
  return `<li${tint(block.props)}>${box}${renderInline(
    block.content
  )}${children}</li>`
}

/**
 * One block.
 *
 * Children of anything that is not a list item are rendered after it rather
 * than inside it — the same un-nesting BlockNote's own HTML export does, and
 * for the same reason: HTML has no "paragraph with paragraphs under it".
 */
function renderBlock(block: NoteBlock, drawings: Drawings): string {
  const self = renderBlockSelf(block, drawings)
  if (!block.children?.length) return self
  return `${self}\n<div class="nested">${renderBlocks(block.children, drawings)}</div>`
}

function renderBlockSelf(block: NoteBlock, drawings: Drawings): string {
  switch (block.type) {
    case "heading": {
      const level = Math.min(
        Math.max(propInt(block, "level") ?? 1, 1),
        MAX_HEADING
      )
      return `<h${level}${tint(block.props)}>${renderInline(
        block.content
      )}</h${level}>`
    }

    case "quote":
      return `<blockquote${tint(block.props)}>${renderInline(
        block.content
      )}</blockquote>`

    case "divider":
      return "<hr>"

    case "codeBlock": {
      // The language becomes a class name, so it is spent as one: a highlighter
      // reads `language-ts`, and anything that is not a plain identifier is not
      // a language.
      const language = propString(block, "language")
      const className = /^[a-z0-9+#_-]{1,24}$/i.test(language)
        ? ` class="language-${language}"`
        : ""
      return `<pre><code${className}>${escapeHtml(textOf(block.content))}</code></pre>`
    }

    case "table":
      return renderTable(block)

    case "image":
      return renderImage(block)

    case "video":
      return renderMedia(block, "video")

    case "audio":
      return renderMedia(block, "audio")

    case "file":
      return renderFile(block)

    case "drawing":
      return renderDrawing(block, drawings)

    case "paragraph":
      return `<p${tint(block.props)}>${renderInline(block.content)}</p>`

    default: {
      // A block this build has no case for — one a later version of the studio
      // wrote, or a custom one. Its words are still the note's words, so they
      // are shown; the type rides along in an attribute for whoever is looking
      // at why it came out plain.
      const inline = renderInline(block.content)
      if (!inline) return ""
      const type = escapeHtml(block.type ?? "block")
      return `<p data-block-type="${type}">${inline}</p>`
    }
  }
}

function renderTable(block: NoteBlock): string {
  const content = block.content as
    | {
        rows?: { cells?: unknown }[]
        headerRows?: number
        columnWidths?: unknown
      }
    | undefined
  const rows = Array.isArray(content?.rows) ? content.rows : []
  if (rows.length === 0) return ""

  const headerRows =
    typeof content?.headerRows === "number"
      ? Math.max(0, content.headerRows)
      : 0

  const rendered = rows.map((row, index) => {
    const cells = Array.isArray(row.cells) ? row.cells : []
    const tag = index < headerRows ? "th" : "td"
    const html = cells
      .map((raw: unknown) => {
        // Two shapes, both of them BlockNote's: a cell is either the object
        // with props or the inline content on its own.
        const cell =
          typeof raw === "object" && raw !== null && "type" in raw
            ? (raw as { content?: unknown; props?: Record<string, unknown> })
            : { content: raw, props: undefined }

        const span = (name: string): string => {
          const value = cell.props?.[name]
          return typeof value === "number" && value > 1
            ? ` ${name}="${Math.trunc(value)}"`
            : ""
        }

        return `<${tag}${span("colspan")}${span("rowspan")}${tint(
          cell.props
        )}>${renderInline(cell.content)}</${tag}>`
      })
      .join("")
    return `<tr>${html}</tr>`
  })

  const head =
    headerRows > 0
      ? `<thead>${rendered.slice(0, headerRows).join("")}</thead>`
      : ""
  const body = `<tbody>${rendered.slice(headerRows).join("")}</tbody>`
  const { colgroup, style } = columns(content?.columnWidths)
  // Wrapped, because a table with eight columns in a note is wider than the
  // measure the page is set to and has to scroll in its own box rather than
  // taking the page sideways with it.
  return `<div class="scroller"><table${
    colgroup ? ` class="sized"` : ""
  }${style}>${colgroup}${head}${body}</table></div>`
}

/**
 * The table's own column widths, as the `<colgroup>` the editor keeps them in.
 *
 * A width in a note is a real decision — the two narrow columns at the left of
 * a spec table are what make the wide one at the right readable — so it travels
 * with the table rather than being left for the browser to guess at from the
 * content, which is what dropping the colgroup meant.
 *
 * `table-layout: fixed` comes with it (the `sized` class), because that is what
 * makes a width a width: under the automatic layout a browser treats one as a
 * suggestion and stretches it to fit the content, which is the same table the
 * colgroup was there to prevent. It is the layout the editor itself uses.
 *
 * The two widths are spent differently. With every column sized, the table is
 * exactly as wide as they add up to and sits at the left — the editor's own
 * `width: auto`, and a four-column table does not get stretched across a page
 * far wider than the pane it was built in. With any column unsized, the table
 * fills the measure and the sized ones keep their pixels while the rest share
 * what is left, which is the arrangement that mixed table was drawn in.
 *
 * Nothing here can carry a value out of the file: a width is a finite positive
 * number rounded to an integer, or the column is left for the layout to size.
 */
function columns(widths: unknown): { colgroup: string; style: string } {
  if (!Array.isArray(widths)) return { colgroup: "", style: "" }

  const sizes = widths.map((width: unknown) =>
    typeof width === "number" && Number.isFinite(width) && width > 0
      ? Math.round(width)
      : null
  )
  if (!sizes.some((size) => size !== null)) return { colgroup: "", style: "" }

  const colgroup = `<colgroup>${sizes
    .map((size) => (size === null ? "<col>" : `<col style="width:${size}px">`))
    .join("")}</colgroup>`

  const total = sizes.reduce((sum: number, size) => sum + (size ?? 0), 0)
  const style = sizes.every((size) => size !== null)
    ? ` style="width:${total}px"`
    : ""

  return { colgroup, style }
}

function renderImage(block: NoteBlock): string {
  const src = safeUrl(block.props?.url)
  const caption = propString(block, "caption")
  const name = propString(block, "name")
  if (!src)
    return caption ? `<p class="missing">${escapeHtml(caption)}</p>` : ""

  const width = propInt(block, "previewWidth")
  const figcaption = caption
    ? `<figcaption>${escapeHtml(caption)}</figcaption>`
    : ""
  return (
    `<figure><img src="${src}" alt="${escapeHtml(caption || name)}"` +
    `${width ? ` width="${width}"` : ""}>${figcaption}</figure>`
  )
}

/**
 * A video or an audio clip, as the control the browser already has.
 *
 * A player rather than the link this used to be, because the note is being read
 * here: a clip explaining a bug is the note's content in the way a screenshot
 * is, and "open this in a new tab" is a worse answer than a play button. What
 * makes it possible is the file being served on a URL of its own
 * (`preview.ts`'s file route) — a `data:` URL cannot be seeked within, so this
 * is the one thing on the page that is not inlined.
 *
 * `preload="metadata"` and no `autoplay`: a note with three clips in it should
 * cost three headers rather than three downloads, and nothing on a page someone
 * opened to read should start making noise. A block the editor was told not to
 * preview, and one whose file cannot be reached, both fall back to what
 * `renderFile` does — the name, as a link or as the note saying it is gone.
 */
function renderMedia(block: NoteBlock, tag: "video" | "audio"): string {
  const src = safeUrl(block.props?.url)
  if (!src || block.props?.showPreview === false) return renderFile(block)

  const caption = propString(block, "caption")
  const figcaption = caption
    ? `<figcaption>${escapeHtml(caption)}</figcaption>`
    : ""
  return (
    `<figure class="media"><${tag} controls preload="metadata" src="${src}">` +
    `</${tag}>${figcaption}</figure>`
  )
}

/** An attachment: a link rather than a control, since a browser has nothing to
 * play a `.zip` with. The file is wherever the note said it was, and a preview
 * page that cannot reach it says what it was rather than showing a control that
 * does nothing. */
function renderFile(block: NoteBlock): string {
  const href = safeUrl(block.props?.url)
  const label =
    propString(block, "name") || propString(block, "caption") || block.type
  if (!href) return `<p class="missing">${escapeHtml(label ?? "")}</p>`
  return `<p class="file"><a href="${href}" rel="noreferrer">${escapeHtml(
    label ?? ""
  )}</a></p>`
}

/**
 * A drawing, as the picture the studio last exported for it.
 *
 * The SVG is inlined rather than linked so the page is one request and one
 * file — which is what makes it something that can be saved, mailed, or handed
 * to a reader that follows no links. A drawing with no export yet says so
 * instead of leaving a gap: it is a scene this app has not opened since the
 * export was added, and a blank space would read as a note with nothing there.
 */
function renderDrawing(block: NoteBlock, drawings: Drawings): string {
  const id = propString(block, "drawingId")
  const svg = id ? drawings.get(id) : undefined
  if (svg) return `<figure class="drawing">${svg}</figure>`
  return `<figure class="drawing"><p class="missing">Drawing — open the note in TabOmni once to export it</p></figure>`
}

/** The note itself, as the `<article>` a page wraps around. */
export function renderNote(blocks: NoteBlock[], drawings: Drawings): string {
  return renderBlocks(blocks, drawings)
}

/**
 * The page around it.
 *
 * One stylesheet, inline, because a preview is one file: nothing to fetch, no
 * second request to fail, and a page that can be saved out of the browser and
 * still look like itself. It follows the browser's own light/dark rather than
 * the studio's toggle — this page is not in the studio, and there is nobody to
 * ask.
 *
 * The script at the bottom is the only script, and the page is complete
 * without it: it polls this same URL with `HEAD` and reloads when the ETag
 * changes, which is what makes a preview left open beside the editor keep up
 * with the typing. Anything reading rather than rendering the page — which is
 * the other half of what this is for — gets the whole note without running it.
 */
export function page(title: string, version: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="version" content="${escapeHtml(version)}">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; --ink: #18181b; --dim: #71717a; --line: #e4e4e7; --sunk: #f4f4f5; --paper: #ffffff; --link: #4338ca; }
/* BlockNote's own palette, both renderings of it, so a colour picked in the
   editor is that colour here and still legible on whichever surface the
   reader's browser paints. Only names reach the markup — see \`tint\`. */
:root {
  --hl-gray-text: #9b9a97; --hl-gray-bg: #ebeced;
  --hl-brown-text: #64473a; --hl-brown-bg: #e9e5e3;
  --hl-red-text: #e03e3e; --hl-red-bg: #fbe4e4;
  --hl-orange-text: #d9730d; --hl-orange-bg: #f6e9d9;
  /* Darker than BlockNote's own #dfab01, which is a yellow chosen to sit on the
     editor's dark surface and all but disappears on this page's white one. */
  --hl-yellow-text: #b08a01; --hl-yellow-bg: #fbf3db;
  --hl-green-text: #4d6461; --hl-green-bg: #ddedea;
  --hl-blue-text: #0b6e99; --hl-blue-bg: #ddebf1;
  --hl-purple-text: #6940a5; --hl-purple-bg: #eae4f2;
  --hl-pink-text: #ad1a72; --hl-pink-bg: #f4dfeb;
}
@media (prefers-color-scheme: dark) {
  /* The paper is the studio's own dark \`--background\`, #1e1e1e, so a note read
     in a browser beside the studio is on the same dark rather than a deeper
     one; \`--sunk\` and \`--line\` step up from it instead of down, since a code
     block darker than the page would be a hole in it. */
  :root { --ink: #e4e4e7; --dim: #a1a1aa; --line: #3a3a3a; --sunk: #292929; --paper: #1e1e1e; --link: #a5b4fc; }
  :root {
    --hl-gray-text: #bebdb8; --hl-gray-bg: #9b9a97;
    --hl-brown-text: #8e6552; --hl-brown-bg: #64473a;
    --hl-red-text: #ec4040; --hl-red-bg: #be3434;
    --hl-orange-text: #e3790d; --hl-orange-bg: #b7600a;
    --hl-yellow-text: #dfab01; --hl-yellow-bg: #b58b00;
    --hl-green-text: #6b8b87; --hl-green-bg: #4d6461;
    --hl-blue-text: #0e87bc; --hl-blue-bg: #0b6e99;
    --hl-purple-text: #8552d7; --hl-purple-bg: #6940a5;
    --hl-pink-text: #da208f; --hl-pink-bg: #ad1a72;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
/* A note holds URLs, ids and paths — one unbroken string longer than the
   measure — and a page that cannot break one is a page scrolling sideways with
   its own text off the edge. \`anywhere\` rather than \`break-word\`: it counts
   towards a table cell's min-content width too, which is what stops one long
   link from making the whole table wider than the screen. Not on \`pre\`, which
   scrolls instead: a line break invented inside code is a lie about the code. */
p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, figcaption, a { overflow-wrap: anywhere; }
main { max-width: 76rem; margin: 0 auto; padding: 3rem 1.5rem 6rem; }
header { margin-bottom: 2.5rem; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 2rem 0 0.75rem; }
header h1 { margin: 0 0 0.35rem; font-size: 1.9rem; }
header p { margin: 0; color: var(--dim); font-size: 0.85rem; }
p { margin: 0.75rem 0; }
a { color: var(--link); }
hr { border: 0; border-top: 1px solid var(--line); margin: 2rem 0; }
blockquote { margin: 1rem 0; padding: 0.25rem 0 0.25rem 1rem; border-left: 3px solid var(--line); color: var(--dim); }
code { background: var(--sunk); border-radius: 0.25rem; padding: 0.125em 0.375em; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.875em; }
pre { background: var(--sunk); border: 1px solid var(--line); border-radius: 0.5rem; padding: 1rem; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 0.85rem; }
ul, ol { padding-left: 1.35rem; }
ul.checks { list-style: none; padding-left: 0.25rem; }
li { margin: 0.2rem 0; }
.nested { margin-left: 1.35rem; }
.scroller { overflow-x: auto; margin: 1.25rem 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
/* Only a table whose note carries column widths — see \`columns\`. Fixed layout
   on a table with no widths at all would divide it into equal columns, which is
   worse than what the content itself suggests. */
table.sized { table-layout: fixed; }
th, td { border: 1px solid var(--line); padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
thead th { background: var(--sunk); }
figure { margin: 1.5rem 0; }
figure img, figure svg { max-width: 100%; height: auto; }
/* A player is a control rather than a picture, so it takes the measure it is
   given instead of its own intrinsic size — a phone clip would otherwise be
   drawn 320px wide in the middle of the page. The video's own box is dark
   whatever the theme, because that is what letterboxing looks like. */
.media video { width: 100%; max-height: 32rem; background: #000; border-radius: 0.5rem; }
.media audio { width: 100%; }
figcaption { color: var(--dim); font-size: 0.85rem; margin-top: 0.4rem; }
.drawing { border: 1px solid var(--line); border-radius: 0.5rem; padding: 0.75rem; background: #ffffff; }
.missing { color: var(--dim); font-size: 0.85rem; text-align: center; margin: 0; }
.markdown { white-space: pre-wrap; overflow-wrap: anywhere; }
/* A run the note gave a colour to. The radius is for the background: a
   highlight with square ends reads as a table cell rather than a marker. */
.tint { border-radius: 0.2em; }
.index { list-style: none; padding: 0; }
.index li { margin: 0.4rem 0; }
.index .where { color: var(--dim); font-size: 0.8rem; }
</style>
</head>
<body>
<main>
${body}
</main>
<script>
// The page is already whole; this only keeps it in step with the note being
// typed into. A failed poll is the studio having quit — stop asking.
(function () {
  var tag = document.querySelector("meta[name=version]")
  if (!tag) return
  var seen = tag.content
  setInterval(function () {
    fetch(location.href, { method: "HEAD", cache: "no-store" })
      .then(function (response) {
        var now = (response.headers.get("etag") || "").replace(/"/g, "")
        if (response.ok && now && now !== seen) location.reload()
      })
      .catch(function () {})
  }, 2000)
})()
</script>
</body>
</html>
`
}

/**
 * A note an older build left as markdown.
 *
 * Shown as itself rather than rendered. Turning markdown into blocks needs
 * BlockNote's parser, which needs the editor, which is the renderer — and the
 * conversion happens the first time the note is opened in the studio anyway,
 * so this is what a note nobody has opened since the migration looks like.
 * Markdown in a `<pre>` is still the whole note, in an order a reader can
 * follow.
 */
export function renderMarkdown(text: string): string {
  return `<pre class="markdown">${escapeHtml(text)}</pre>`
}
