/**
 * The note preview: the page a browser is actually served, fetched over a real
 * socket from a real server.
 *
 * The rendering is checked through `NotePreview` rather than by calling
 * `renderNote` on a document made up here, because the failures worth catching
 * are in the seams between the two. A note is a file on disk that this app
 * both writes and — now — reads back from another process; the page is served
 * to whoever holds a URL; and the two things standing between those are the
 * token in the path and the escaping in the markup. Each of those is a check
 * below, and none of them exists if the server is skipped.
 */

import type {
  NoteBlock,
  NoteBody,
  NoteFolder,
  NoteRecord,
} from "../src/shared/api"
import { NotePreview } from "../src/main/preview"
import { check, finish, section } from "./harness"

function noteRecord(
  id: string,
  name: string,
  folderId: string | null = null
): NoteRecord {
  return {
    id,
    name,
    folderId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  }
}

const NOTE_ID = "11111111-1111-4111-8111-111111111111"
const EMPTY_ID = "22222222-2222-4222-8222-222222222222"
const LEGACY_ID = "33333333-3333-4333-8333-333333333333"
const DRAWING_ID = "44444444-4444-4444-8444-444444444444"

/** A document with one of everything the page has a case for. */
const BLOCKS: NoteBlock[] = [
  {
    type: "heading",
    props: { level: 2 },
    content: [
      { type: "text", text: "Endpoints", styles: { textColor: "yellow" } },
    ],
  },
  {
    type: "paragraph",
    props: { backgroundColor: "blue" },
    content: [{ type: "text", text: "on a blue block", styles: {} }],
  },
  // A colour picked outside BlockNote's own menu — the studio writes these onto
  // table cells. It is bound to the theme it was picked in, so it is dropped.
  {
    type: "paragraph",
    props: { backgroundColor: "oklch(0.27 0.016 285)" },
    content: [{ type: "text", text: "custom colour", styles: {} }],
  },
  {
    type: "paragraph",
    content: [
      { type: "text", text: "Send ", styles: { bold: true, italic: true } },
      // On its own, never alongside the run above: TipTap's code mark declares
      // `excludes: "_"`, so the editor cannot put a second style on a run that
      // has this one. The walk still nests whatever it is handed — a file can
      // be edited by hand — but this is the shape a note actually holds.
      { type: "text", text: "POST", styles: { code: true } },
      { type: "text", text: " to ", styles: {} },
      {
        type: "link",
        href: "https://example.test/hook",
        content: [{ type: "text", text: "the hook", styles: {} }],
      },
    ],
  },
  {
    type: "bulletListItem",
    content: [{ type: "text", text: "first", styles: {} }],
    children: [
      {
        type: "bulletListItem",
        content: [{ type: "text", text: "nested", styles: {} }],
      },
    ],
  },
  {
    type: "bulletListItem",
    content: [{ type: "text", text: "second", styles: {} }],
  },
  {
    type: "codeBlock",
    props: { language: "ts" },
    content: [{ type: "text", text: "const a = 1 < 2", styles: {} }],
  },
  {
    type: "table",
    content: {
      type: "tableContent",
      headerRows: 1,
      // One column the note sized and one it left alone, which is the shape a
      // spec table actually has.
      columnWidths: [62, null],
      rows: [
        {
          cells: [
            {
              type: "tableCell",
              props: {},
              content: [{ type: "text", text: "Name", styles: {} }],
            },
          ],
        },
        {
          cells: [
            {
              type: "tableCell",
              props: { colspan: 2 },
              content: [{ type: "text", text: "member", styles: {} }],
            },
          ],
        },
      ],
    },
  },
  { type: "drawing", props: { drawingId: DRAWING_ID } },
  // The one block whose text must not become markup: a note is the user's own
  // writing, and someone writing about HTML writes tags.
  {
    type: "paragraph",
    content: [{ type: "text", text: "<script>alert(1)</script>", styles: {} }],
  },
  // A link this page will not follow. The words stay; the href goes.
  {
    type: "paragraph",
    content: [
      {
        type: "link",
        href: "javascript:alert(1)",
        content: [{ type: "text", text: "do not click", styles: {} }],
      },
    ],
  },
]

const notes: NoteRecord[] = [
  noteRecord(NOTE_ID, "API notes", "folder-1"),
  noteRecord(EMPTY_ID, "Empty"),
  noteRecord(LEGACY_ID, "Older note"),
]

const folders: NoteFolder[] = [
  {
    id: "folder-1",
    name: "Specs",
    parentId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
]

const bodies: Record<string, NoteBody> = {
  [NOTE_ID]: { format: "blocks", text: JSON.stringify(BLOCKS) },
  [EMPTY_ID]: { format: "blocks", text: "" },
  [LEGACY_ID]: { format: "markdown", text: "# Older\n\nStill markdown." },
}

const preview = new NotePreview({
  notes: async () => notes,
  folders: async () => folders,
  body: async (id) => bodies[id] ?? { format: "blocks", text: "" },
  drawingSvg: async (id) =>
    id === DRAWING_ID
      ? '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
      : "",
})

async function main() {
  const url = await preview.urlOf(NOTE_ID)
  const base = new URL(url)

  section("the link")
  check("is loopback", base.hostname === "127.0.0.1", url)
  check("is a port this run picked", Number(base.port) > 0, url)
  check(
    "carries a secret and the note id",
    base.pathname.split("/").filter(Boolean).length === 2,
    base.pathname
  )

  const token = base.pathname.split("/").filter(Boolean)[0] ?? ""
  const at = (path: string) => `http://127.0.0.1:${base.port}${path}`

  section("what is served")
  const page = await fetch(url)
  const html = await page.text()
  check("answers the note", page.status === 200, page.status)
  check(
    "is a whole document",
    html.startsWith("<!doctype html>"),
    html.slice(0, 40)
  )
  check(
    "titles it with the note's name",
    html.includes("<title>API notes</title>")
  )
  check(
    "renders headings",
    html.includes(
      '<h2><span class="tint" style="color:var(--hl-yellow-text)">Endpoints</span></h2>'
    ),
    html.match(/<h2[\s\S]*?<\/h2>/)?.[0]
  )
  check(
    "keeps a block's own colour",
    html.includes(
      '<p class="tint" style="background-color:var(--hl-blue-bg)">on a blue block</p>'
    ),
    html.match(/<p[^>]*>on a blue block/)?.[0]
  )
  check(
    "drops a colour picked outside the menu",
    html.includes("<p>custom colour</p>"),
    html.match(/<p[^>]*>custom colour/)?.[0]
  )
  check(
    "lets long words break",
    html.includes("overflow-wrap: anywhere"),
    "the stylesheet has no wrapping rule"
  )
  check(
    "renders inline styles",
    html.includes("<em><strong>Send </strong></em><code>POST</code>"),
    html.match(/<p>Send[\s\S]*?<\/p>/)?.[0]
  )
  check(
    "renders links",
    html.includes(
      '<a href="https://example.test/hook" rel="noreferrer">the hook</a>'
    )
  )
  check(
    "gathers list items into one list",
    (html.match(/<ul class="bullets">/g) ?? []).length === 2 &&
      html.includes("<li>first<ul"),
    html.match(/<ul class="bullets">[\s\S]*?<\/ul>/)?.[0]
  )
  check(
    "renders code blocks",
    html.includes('<code class="language-ts">const a = 1 &lt; 2</code>')
  )
  check("renders tables with a head", html.includes("<thead><tr><th>Name</th>"))
  check("keeps a cell's span", html.includes('<td colspan="2">member</td>'))
  check(
    "keeps the column widths the note was written with",
    html.includes(
      '<table class="sized"><colgroup><col style="width:62px"><col></colgroup>'
    ),
    html.match(/<table[\s\S]*?<\/colgroup>/)?.[0]
  )
  check(
    "and does not pin the table's own width when a column is unsized",
    !html.includes('<table class="sized" style='),
    html.match(/<table[^>]*>/)?.[0]
  )
  check(
    "inlines the drawing",
    html.includes('<figure class="drawing"><svg viewBox=')
  )

  section("what the page will not do")
  check(
    "escapes the note's own markup",
    html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") &&
      !html.includes("<script>alert(1)</script>")
  )
  check(
    "drops a scheme it will not follow, keeping the words",
    !html.includes("javascript:alert(1)") && html.includes("do not click")
  )

  section("the secret")
  const wrongToken = await fetch(at(`/${"0".repeat(token.length)}/${NOTE_ID}`))
  check(
    "a wrong token is not found",
    wrongToken.status === 404,
    wrongToken.status
  )
  const noToken = await fetch(at("/"))
  check("no token is not found", noToken.status === 404, noToken.status)
  const shortToken = await fetch(at(`/${token.slice(0, 8)}/${NOTE_ID}`))
  check(
    "a truncated token is not found",
    shortToken.status === 404,
    shortToken.status
  )
  const strayId = await fetch(at(`/${token}/${"9".repeat(36)}`))
  check(
    "an id that is not a note is not found",
    strayId.status === 404,
    strayId.status
  )
  const traversal = await fetch(at(`/${token}/..%2F..%2Fmanifest.json`))
  check(
    "a path out of the workspace is not found",
    traversal.status === 404,
    traversal.status
  )

  section("the reload poll")
  const head = await fetch(url, { method: "HEAD" })
  const etag = head.headers.get("etag") ?? ""
  check("HEAD carries the version", etag.length > 2, etag)
  check("HEAD carries no body", (await head.text()) === "")
  check(
    "the page holds the version it was rendered at",
    html.includes(`<meta name="version" content="${etag.replace(/"/g, "")}">`),
    etag
  )

  bodies[NOTE_ID] = {
    format: "blocks",
    text: JSON.stringify([
      {
        type: "paragraph",
        content: [{ type: "text", text: "changed", styles: {} }],
      },
    ]),
  }
  const changed = await fetch(url, { method: "HEAD" })
  check(
    "the version follows the note",
    changed.headers.get("etag") !== etag,
    changed.headers.get("etag")
  )

  section("the other notes")
  const empty = await fetch(at(`/${token}/${EMPTY_ID}`))
  check("a note nobody has typed into still renders", empty.status === 200)
  const legacy = await fetch(at(`/${token}/${LEGACY_ID}`))
  const legacyHtml = await legacy.text()
  check(
    "a markdown note is shown as itself",
    legacyHtml.includes('<pre class="markdown"># Older'),
    legacyHtml.slice(0, 200)
  )

  const index = await fetch(at(`/${token}`))
  const indexHtml = await index.text()
  check(
    "the index lists every note",
    index.status === 200 && indexHtml.includes("API notes")
  )
  check("and says where each is filed", indexHtml.includes("Specs"))

  section("shutting down")
  await preview.stop()
  const afterStop = await fetch(url).catch(() => null)
  check("the port is gone with it", afterStop === null)

  finish()
}

await main()
