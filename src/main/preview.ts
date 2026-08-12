import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"

import type { NoteBlock, NoteBody, NoteFolder, NoteRecord } from "../shared/api"
import { drawingIdsIn, parseNote } from "./note-blocks"
import { escapeHtml, page, renderMarkdown, renderNote } from "./note-html"

/**
 * The Notes panel's read-only window onto the workspace: one loopback server
 * that renders a note as a finished page.
 *
 * What it is for is a note that has to be read somewhere this app is not — in a
 * browser beside the thing it documents, or by something that reads pages
 * rather than looks at them. Both of those want the same thing, which is why
 * the rendering happens here rather than in the renderer and is pushed: a page
 * that arrives complete needs no editor to have been open, no note to have been
 * the one on screen, and no script to run before the words are there.
 *
 * Bound to loopback, on a port the OS picks, behind a secret this run
 * generated. The workspace's notes are the user's own writing and a fixed port
 * with no secret would put them on every page any local process can guess at.
 * The port is ephemeral for the same reason the inbox's is not: nothing has to
 * find this server by convention — every link that reaches it was copied out of
 * the app after the server was already up.
 *
 * The consequence, and it is deliberate: **a link lives as long as the app
 * run.** Both halves of it change on the next launch, so a preview left open
 * overnight is a dead tab rather than a page quietly serving a note to whoever
 * still has the URL. Nothing is written to disk to make it outlive that.
 */

/** Bound to nothing but this machine. A server that hands out the workspace's
 * notes is not something to put on a network. */
const HOST = "127.0.0.1"

/** The secret in every link's first path segment, in hex. 16 bytes is not
 * guessable and still fits in a URL someone might read out. */
const TOKEN_BYTES = 16

/** What the workspace gives this server. Injected rather than imported so the
 * file has no opinion about `~/.tabomni` — the same shape `InboxServers` takes,
 * and for the same reason. */
export type NoteSource = {
  notes: () => Promise<NoteRecord[]>
  folders: () => Promise<NoteFolder[]>
  body: (id: string) => Promise<NoteBody>
  /** The drawing's last export, or "" for a scene that has never been drawn
   * into a picture. */
  drawingSvg: (id: string) => Promise<string>
}

export class NotePreview {
  private server: Server | null = null
  private port = 0
  private readonly token = randomBytes(TOKEN_BYTES).toString("hex")
  /** One chain, so two notes previewed in the same moment cannot each bind a
   * server and leave one of them held by nothing. */
  private starting: Promise<number> | null = null

  constructor(private readonly source: NoteSource) {}

  /** The link to a note, binding the server if this is the first one asked
   * for. */
  async urlOf(noteId: string): Promise<string> {
    const port = await this.start()
    return `http://${HOST}:${port}/${this.token}/${encodeURIComponent(noteId)}`
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.starting = null
    if (!server) return

    await new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  }

  private start(): Promise<number> {
    if (this.server) return Promise.resolve(this.port)
    this.starting ??= new Promise<number>((resolve, reject) => {
      const server = createServer((request, response) => {
        void this.serve(request, response)
      })

      server.once("error", (error) => {
        this.starting = null
        reject(error)
      })
      // Port 0: the OS picks one that is free, which is the only way to bind
      // without asking the user to keep a port setting out of everything
      // else's way.
      server.listen(0, HOST, () => {
        const address = server.address()
        this.server = server
        this.port = typeof address === "object" && address ? address.port : 0
        resolve(this.port)
      })
    })
    return this.starting
  }

  private async serve(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    try {
      // Read-only, and it says so: a preview that answered a POST would be a
      // second way into the workspace's files.
      if (request.method !== "GET" && request.method !== "HEAD") {
        return send(request, response, 405, "text/plain", "Method not allowed")
      }

      const [token, noteId, ...rest] = (request.url ?? "/")
        .split("?")[0]!
        .split("/")
        .filter(Boolean)
        .map((segment) => decodeURIComponent(segment))

      if (!token || !this.matches(token) || rest.length > 0) {
        // No hint about what was wrong with it. A wrong token and a wrong note
        // id answer identically, so the 404 cannot be used to find out which
        // half was guessed right.
        return send(request, response, 404, "text/plain", "Not found")
      }

      if (noteId === undefined) {
        return await this.serveIndex(request, response)
      }
      return await this.serveNote(request, response, noteId)
    } catch (error) {
      console.error("Could not render the preview", error)
      send(request, response, 500, "text/plain", "Preview failed")
    }
  }

  /** Constant-time, so a token cannot be found one character at a time by
   * timing the 404. */
  private matches(candidate: string): boolean {
    const given = Buffer.from(candidate)
    const token = Buffer.from(this.token)
    return given.length === token.length && timingSafeEqual(given, token)
  }

  /**
   * Every note in the workspace, as one page of links.
   *
   * The link to a single note is what the app hands out, and this is what the
   * app hands out one segment shorter — worth serving because the reader this
   * is for is often after the notebook rather than the note, and because a
   * preview tab left open on it is a table of contents that keeps up.
   */
  private async serveIndex(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const [notes, folders] = await Promise.all([
      this.source.notes(),
      this.source.folders(),
    ])

    const sorted = [...notes].sort((left, right) =>
      left.name.localeCompare(right.name)
    )
    const items = sorted
      .map((note) => {
        const where = pathOf(note.folderId, folders)
        return (
          `<li><a href="/${this.token}/${encodeURIComponent(note.id)}">` +
          `${escapeHtml(note.name)}</a>` +
          (where ? ` <span class="where">${escapeHtml(where)}</span>` : "") +
          `</li>`
        )
      })
      .join("")

    const body =
      `<header><h1>Notes</h1><p>${sorted.length} note${
        sorted.length === 1 ? "" : "s"
      } in this workspace</p></header>` +
      (items
        ? `<ul class="index">${items}</ul>`
        : `<p class="missing">No notes yet</p>`)

    // The listing is what changes here, so that is what the version is over.
    const version = hash(
      sorted.map((note) => `${note.id}:${note.updatedAt}`).join("\n")
    )
    send(
      request,
      response,
      200,
      "text/html; charset=utf-8",
      page("Notes", version, body),
      version
    )
  }

  private async serveNote(
    request: IncomingMessage,
    response: ServerResponse,
    noteId: string
  ): Promise<void> {
    // Looked up in the listing rather than read straight off the path: it is
    // what gives the page its title, and it is also what keeps an id that is
    // not a note in this workspace — `../` and everything like it — from ever
    // reaching a filename.
    const note = (await this.source.notes()).find(
      (candidate) => candidate.id === noteId
    )
    if (!note) return send(request, response, 404, "text/plain", "Not found")

    const body = await this.source.body(note.id)
    const blocks = body.format === "blocks" ? parseNote(body.text) : []
    const drawings = await this.drawingsIn(blocks)

    const rendered =
      body.format === "markdown"
        ? renderMarkdown(body.text)
        : renderNote(blocks, drawings)

    // Over what the page is made of rather than the page itself, which cannot
    // be hashed before it is rendered — and this is the honest input anyway: a
    // note whose drawing changed has a page that changed.
    const version = hash(
      `${note.name} ${body.text} ${[...drawings.values()].join("")}`
    )

    const html = page(
      note.name || "Note",
      version,
      `<header><h1>${escapeHtml(note.name || "Note")}</h1>` +
        `<p>Updated ${escapeHtml(note.updatedAt)}</p></header>` +
        `<article>${rendered}</article>`
    )
    send(request, response, 200, "text/html; charset=utf-8", html, version)
  }

  /** The picture behind each drawing in the document, read once each. */
  private async drawingsIn(blocks: NoteBlock[]): Promise<Map<string, string>> {
    const drawings = new Map<string, string>()

    await Promise.all(
      drawingIdsIn(blocks).map(async (id) => {
        const svg = await this.source.drawingSvg(id)
        // Only what the studio itself exported. The file is written by this
        // app, but it is inlined into a page, and a `.svg` that is not an SVG
        // is markup going straight into the document.
        if (svg.trimStart().startsWith("<svg")) drawings.set(id, svg)
      })
    )
    return drawings
  }
}

/** Where a note is filed, as a path — "Specs / API" — or "" at the top
 * level. */
function pathOf(folderId: string | null, folders: NoteFolder[]): string {
  const names: string[] = []
  let current = folderId

  // Guarded by the visited set rather than trusted: a folder file edited by
  // hand into a cycle would otherwise hang the request.
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const folder = folders.find((candidate) => candidate.id === current)
    if (!folder) break
    names.unshift(folder.name)
    current = folder.parentId
  }

  return names.join(" / ")
}

function hash(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16)
}

/**
 * One response.
 *
 * `HEAD` is answered with the headers and no body, which is what the page's own
 * reload poll asks for — the whole point of that poll is to compare the ETag
 * without pulling the note down every two seconds.
 */
function send(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  type: string,
  body: string,
  version?: string
): void {
  const payload = Buffer.from(body, "utf8")
  response.writeHead(status, {
    "content-type": type,
    "content-length": payload.byteLength,
    // A preview is the note as it is right now; a cached one is the note as it
    // was, which is the one thing this must not show.
    "cache-control": "no-store",
    ...(version ? { etag: `"${version}"` } : {}),
  })
  if (request.method === "HEAD") return void response.end()
  response.end(payload)
}
