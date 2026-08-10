import { randomUUID } from "node:crypto"
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http"
import {
  createServer as createTcpServer,
  type Server as TcpServer,
  type Socket,
} from "node:net"

import type {
  HttpSendInput,
  InboxKind,
  InboxMessage,
  InboxServerStatus,
  InboxStatus,
  InboxWebhook,
} from "../shared/api"
import { isTextual } from "./http"
import { parseMail } from "./mime"

/**
 * The two servers behind the Mail and Webhooks panels: an SMTP sink and a
 * catch-all HTTP endpoint, each bound to the loopback interface and each
 * started and stopped on its own — the panels are separate and so are their
 * switches. What they share is this manager, one capped list of captures, and
 * one file to keep it in.
 *
 * Written here rather than pulled in, for the same reason `search.ts` is not
 * ripgrep: a mail catcher the user has to `brew install` first is a panel that
 * works on the machine it was written on. What SMTP needs to accept a message
 * from a framework mailer is a few hundred lines — a greeting, an envelope,
 * and a `DATA` block terminated by a lone dot — and the parsing that follows is
 * `mime.ts`.
 *
 * Nothing is ever delivered. `MAIL FROM` is answered, `RCPT TO` is answered,
 * the message is read and then kept here: that is the whole point, and it is
 * why the SMTP server accepts any credentials offered. An app configured
 * against this cannot mail a customer by accident, which is the failure a
 * development mail server exists to prevent.
 */

/** Bound to loopback and nothing else. A catch-all endpoint that answers 200
 * to anything is not something to put on a network. */
const HOST = "127.0.0.1"

/** What either server will hold for one message. Past it, SMTP refuses the
 * message with a 552 and the webhook catcher answers 413 — a truncated capture
 * that looked complete would be worse than a refusal. */
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024

/**
 * How many captures the workspace keeps.
 *
 * An inbox is read newest first and nobody scrolls to the four hundredth
 * webhook, while the whole list is held in memory and written to disk on every
 * capture. `Clear` is one button away for the rest.
 */
const MAX_MESSAGES = 200

/** The name the SMTP server answers under. Not the machine's own hostname:
 * this is a sink, and a greeting claiming to be the user's laptop invites the
 * question of whether something might actually be sent. */
const SMTP_NAME = "tabula.inbox"

/** Long enough for a mailer that opens a connection and thinks about it, short
 * enough that a client which vanished mid-`DATA` does not hold the port. */
const SMTP_IDLE_MS = 60_000

type Emit = {
  message: (message: InboxMessage) => void
  status: (status: InboxStatus) => void
}

/** Where captures survive a restart. Injected rather than imported so this
 * file has no opinion about `~/.tabula`. */
type Storage = {
  load: () => Promise<InboxMessage[]>
  save: (messages: InboxMessage[]) => Promise<void>
}

type Inbox = {
  /** One entry per kind, each started and stopped on its own — the Mail and
   * Webhooks panels have a switch each. */
  servers: Record<InboxKind, TcpServer | HttpServer | null>
  /** Open SMTP conversations. `net.Server.close` waits for every one of them,
   * and a mailer holding an idle socket would otherwise keep Stop waiting the
   * full idle timeout. */
  sockets: Set<Socket>
  status: InboxStatus
  /** Newest first, which is the order the panel shows and the order the cap
   * drops from the end of. Both kinds together: they share a file, and each
   * panel filters to its own. Null until read from disk. */
  messages: InboxMessage[] | null
  /** In flight while the first read is happening, so two captures landing
   * together cannot each start one and file against a different array. */
  loading: Promise<InboxMessage[]> | null
}

function idle(port: number): InboxServerStatus {
  return { listening: false, port, error: null }
}

export class InboxServers {
  private readonly inbox: Inbox = {
    servers: { mail: null, webhook: null },
    sockets: new Set(),
    status: { mail: idle(0), webhook: idle(0) },
    messages: null,
    loading: null,
  }
  /** Writes are serialised so two captures landing together cannot both
   * read-modify-write the same file. */
  private queue: Promise<unknown> = Promise.resolve()
  /** One chain for both servers, so a start and a stop cannot overlap — see
   * `serialise`. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly emit: Emit,
    private readonly storage: Storage
  ) {}

  status(): InboxStatus {
    return this.inbox.status
  }

  /**
   * Binds one server, replacing whatever that kind already had bound.
   *
   * One at a time because the two panels have a switch each: stopping Mail to
   * free 1025 must leave the webhook catcher exactly where it was.
   */
  start(server: InboxKind, port: number): Promise<InboxStatus> {
    return this.serialise(async () => {
      await this.unbind(server)

      const bound =
        server === "mail"
          ? createTcpServer((socket) => this.serveSmtp(socket))
          : createHttpServer((request, response) =>
              this.serveWebhook(request, response)
            )

      const status = await listen(bound, port)
      this.inbox.status = { ...this.inbox.status, [server]: status }
      this.inbox.servers[server] = status.listening ? bound : null

      // A server that falls over after it came up — the port taken from under
      // it by something else, a socket error with nowhere to go — must not
      // leave the panel claiming it is still listening.
      bound.on("error", (error) => this.fail(server, error))

      this.emit.status(this.inbox.status)
      return this.inbox.status
    })
  }

  stop(server: InboxKind): Promise<InboxStatus> {
    return this.serialise(async () => {
      await this.unbind(server)
      this.emit.status(this.inbox.status)
      return this.inbox.status
    })
  }

  /**
   * Runs one bind or unbind at a time.
   *
   * Both a panel and its own auto-start can ask for a start, and two of them
   * interleaving would have one server's `listen` land after the other's
   * `close` — leaving a port bound by a server nothing holds a reference to,
   * and the panel reporting the one that failed. One chain for both servers
   * rather than one each: they never contend, and sharing it is what makes
   * "stop both" on quit a queue rather than a race.
   */
  private serialise<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task)
    this.chain = next.catch(() => undefined)
    return next
  }

  /** Closes one kind's server, leaving the other and the captures alone. */
  private async unbind(server: InboxKind): Promise<void> {
    // Only SMTP holds conversations this has to break; the HTTP side answers
    // and hangs up, and `closeAllConnections` in `close` covers keep-alive.
    if (server === "mail") {
      for (const socket of this.inbox.sockets) socket.destroy()
      this.inbox.sockets.clear()
    }

    await close(this.inbox.servers[server])
    this.inbox.servers[server] = null
    this.inbox.status = {
      ...this.inbox.status,
      [server]: idle(this.inbox.status[server].port),
    }
  }

  /** Closes both servers, for a quit that leaves no port held. */
  async stopAll(): Promise<void> {
    await Promise.all([this.stop("mail"), this.stop("webhook")])
  }

  async messages(): Promise<InboxMessage[]> {
    if (this.inbox.messages) return this.inbox.messages

    // An unreadable file reads as an empty inbox, the same way a missing one
    // does. This is awaited by a capture that has already been answered on the
    // wire, so a rejection here would be one nobody is in a position to catch.
    this.inbox.loading ??= this.storage.load().catch(() => [])
    const loaded = await this.inbox.loading
    this.inbox.messages ??= loaded
    return this.inbox.messages
  }

  async markRead(id: string): Promise<void> {
    const messages = await this.messages()
    const message = messages.find((candidate) => candidate.id === id)
    if (!message || !message.unread) return
    message.unread = false
    this.write(messages)
  }

  async remove(id: string): Promise<void> {
    await this.messages()
    this.inbox.messages = (this.inbox.messages ?? []).filter(
      (candidate) => candidate.id !== id
    )
    this.write(this.inbox.messages)
  }

  /** Empties one panel's half. The other keeps everything it caught — two
   * panels with one Clear between them would be a button that deleted
   * something the user could not see. */
  async clear(server: InboxKind): Promise<void> {
    await this.messages()
    this.inbox.messages = (this.inbox.messages ?? []).filter(
      (message) => message.kind !== server
    )
    this.write(this.inbox.messages)
  }

  private fail(which: InboxKind, error: Error) {
    this.inbox.status = {
      ...this.inbox.status,
      [which]: {
        listening: false,
        port: this.inbox.status[which].port,
        error: error.message,
      },
    }
    this.emit.status(this.inbox.status)
  }

  /** Files one capture: newest first, capped, persisted, announced. */
  private async record(message: InboxMessage): Promise<void> {
    // Awaited only to be sure the file has been read; the list is taken from
    // the inbox afterwards rather than from what this resolved with, so a
    // second capture landing in between is not overwritten.
    await this.messages()

    this.inbox.messages = [message, ...(this.inbox.messages ?? [])].slice(
      0,
      MAX_MESSAGES
    )

    this.write(this.inbox.messages)
    this.emit.message(message)
  }

  private write(messages: InboxMessage[]): void {
    // Not awaited by the caller: a capture is already answered on the wire by
    // the time this runs, and a slow disk must not hold the SMTP connection
    // open. Failures are swallowed for the same reason the panel keeps its
    // list in memory — the capture is still there to read.
    this.queue = this.queue
      .then(() => this.storage.save(messages))
      .catch(() => undefined)
  }

  /**
   * One SMTP conversation.
   *
   * A deliberately small subset: `EHLO`, an envelope, `DATA`, and `QUIT`. It
   * advertises `AUTH` and accepts whatever is offered, because a framework
   * configured with a username and password will not send without being asked
   * for them — and there is nothing here for credentials to protect. It does
   * not advertise `STARTTLS`: a client that insists on encryption to localhost
   * should say so loudly rather than have this pretend.
   *
   * "Accepts whatever is offered" still means walking the whole exchange. A
   * client that sent `AUTH LOGIN` is waiting for a password prompt, and a
   * server that skipped ahead to `235` because it was never going to check
   * anything gets "invalid login sequence" from the client and no mail at all.
   */
  private serveSmtp(socket: Socket): void {
    let buffer = Buffer.alloc(0)
    /** Non-null once `DATA` has been accepted: everything is message now. */
    let collecting = false
    /** Where the terminator search left off, so a large message is not
     * re-scanned from the start on every packet. */
    let scanned = 0
    let refuse = false
    /**
     * Which line of an `AUTH` exchange the client still owes.
     *
     * `LOGIN` sends the username and the password as two separate lines, each
     * answered with its own `334` prompt; `PLAIN` sends both at once as one
     * base64 blob. Neither is read.
     */
    let awaiting: "login-user" | "login-password" | "credential" | null = null

    let from = ""
    let recipients: string[] = []

    const write = (line: string) => {
      if (!socket.writableEnded) socket.write(`${line}\r\n`)
    }

    this.inbox.sockets.add(socket)
    socket.on("close", () => this.inbox.sockets.delete(socket))

    socket.setTimeout(SMTP_IDLE_MS, () => socket.destroy())
    // A mailer that hangs up mid-transaction is normal, not an error worth
    // taking the server down over.
    socket.on("error", () => socket.destroy())
    write(`220 ${SMTP_NAME} Tabula Inbox`)

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk])

      for (;;) {
        if (collecting) {
          const end = findDataEnd(buffer, scanned)
          if (!end) {
            // Past the ceiling the message is thrown away as it arrives rather
            // than held to be refused at the end: the sender has not stopped
            // talking, and buffering it all to say no would be the same memory
            // cost as saying yes. Four bytes stay, since the terminator may be
            // straddling this packet and the next.
            if (buffer.length > MAX_MESSAGE_BYTES) {
              refuse = true
              buffer = buffer.subarray(buffer.length - 4)
            }
            scanned = Math.max(buffer.length - 4, 0)
            return
          }

          const raw = buffer.subarray(0, end.start)
          buffer = buffer.subarray(end.next)
          collecting = false
          scanned = 0

          if (refuse) {
            write(`552 Message larger than ${MAX_MESSAGE_BYTES} bytes`)
          } else {
            const id = randomUUID()
            void this.record(mailMessage(id, from, recipients, raw))
            write(`250 2.0.0 Ok: queued as ${id}`)
          }
          refuse = false
          from = ""
          recipients = []
          continue
        }

        const newline = buffer.indexOf(0x0a)
        if (newline === -1) {
          // A command line this long is not a command.
          if (buffer.length > 4096) socket.destroy()
          return
        }
        const line = buffer
          .subarray(0, newline)
          .toString("latin1")
          .replace(/\r$/, "")
        buffer = buffer.subarray(newline + 1)

        if (awaiting) {
          // `*` on its own is how a client abandons an exchange it has changed
          // its mind about — answering `235` to that would be authenticating
          // somebody who just said not to.
          if (line.trim() === "*") {
            awaiting = null
            write("501 5.7.0 Authentication cancelled")
          } else if (awaiting === "login-user") {
            awaiting = "login-password"
            write(`334 ${base64("Password:")}`)
          } else {
            awaiting = null
            write("235 2.7.0 Authentication successful")
          }
          continue
        }

        const [word = "", rest = ""] = splitCommand(line)
        const command = word.toUpperCase()

        if (command === "EHLO") {
          write(`250-${SMTP_NAME} greets you`)
          write(`250-SIZE ${MAX_MESSAGE_BYTES}`)
          write("250-8BITMIME")
          write("250-AUTH PLAIN LOGIN")
          write("250 HELP")
        } else if (command === "HELO") {
          write(`250 ${SMTP_NAME}`)
        } else if (command === "AUTH") {
          // Both mechanisms may carry their first piece on the command line —
          // an "initial response" — which moves the exchange on a step rather
          // than finishing it. Only `PLAIN` is finished by one, because for
          // `PLAIN` that one blob is the whole credential.
          const [mechanism = "", initial = ""] = rest.trim().split(/\s+/)
          const kind = mechanism.toUpperCase()

          if (kind === "LOGIN") {
            awaiting = initial ? "login-password" : "login-user"
            write(`334 ${base64(initial ? "Password:" : "Username:")}`)
          } else if (kind === "PLAIN") {
            if (initial) {
              write("235 2.7.0 Authentication successful")
            } else {
              awaiting = "credential"
              // Empty prompt: the client is sending one blob and there is
              // nothing to label it with.
              write("334 ")
            }
          } else {
            write("504 5.5.4 Unrecognized authentication type")
          }
        } else if (command === "MAIL") {
          from = address(rest)
          recipients = []
          write("250 2.1.0 Ok")
        } else if (command === "RCPT") {
          recipients.push(address(rest))
          write("250 2.1.5 Ok")
        } else if (command === "DATA") {
          if (recipients.length === 0) {
            write("503 5.5.1 Need RCPT before DATA")
          } else {
            collecting = true
            scanned = 0
            refuse = false
            write("354 End data with <CR><LF>.<CR><LF>")
          }
        } else if (command === "RSET") {
          from = ""
          recipients = []
          write("250 2.0.0 Ok")
        } else if (command === "NOOP") {
          write("250 2.0.0 Ok")
        } else if (command === "QUIT") {
          write(`221 2.0.0 ${SMTP_NAME} closing connection`)
          socket.end()
          return
        } else if (command === "VRFY") {
          // Nothing here has a mailbox to confirm, and RFC 5321 has a code for
          // exactly that.
          write("252 2.5.2 Cannot verify, will accept anyway")
        } else {
          write("502 5.5.1 Command not implemented")
        }
      }
    })
  }

  /**
   * One captured HTTP request.
   *
   * Every method and every path is accepted — a catch-all is the point, since
   * the sender is a provider's dashboard that was given one URL and will not be
   * asked what it thinks the route should be. The answer is a plain 200 with
   * CORS open, so a webhook fired from a browser during development is not
   * refused by a preflight the panel could have allowed.
   */
  private serveWebhook(
    request: IncomingMessage,
    response: ServerResponse
  ): void {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, cors)
      response.end()
      return
    }

    const chunks: Buffer[] = []
    let size = 0
    let refused = false

    request.on("data", (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_MESSAGE_BYTES) {
        refused = true
        response.writeHead(413, cors)
        response.end()
        request.destroy()
        return
      }
      chunks.push(chunk)
    })

    request.on("end", () => {
      if (refused) return

      const id = randomUUID()
      void this.record(webhookMessage(id, request, Buffer.concat(chunks)))

      response.writeHead(200, { ...cors, "Content-Type": "application/json" })
      response.end(JSON.stringify({ ok: true, id }))
    })
  }
}

/** Binds a server, reporting the failure rather than throwing it: a port in
 * use is something the settings tab asks the user about, not a rejected IPC
 * call wrapped in Electron's own wording. */
function listen(
  server: TcpServer | HttpServer,
  port: number
): Promise<InboxServerStatus> {
  return new Promise((resolve) => {
    const onError = (error: Error) => {
      server.off("listening", onListening)
      resolve({ listening: false, port, error: error.message })
    }
    const onListening = () => {
      server.off("error", onError)
      resolve({ listening: true, port, error: null })
    }

    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(port, HOST)
  })
}

function close(server: TcpServer | HttpServer | null): Promise<void> {
  if (!server) return Promise.resolve()
  return new Promise((resolve) => {
    // `close` waits for open connections, and a keep-alive client would
    // otherwise keep the port past the moment the user pressed Stop. The SMTP
    // side has no equivalent; its sockets are destroyed by `stop` instead.
    if ("closeAllConnections" in server) server.closeAllConnections()
    server.close(() => resolve())
  })
}

/** An `AUTH` prompt, which travels base64-encoded like everything else in the
 * exchange. */
function base64(prompt: string): string {
  return Buffer.from(prompt, "utf8").toString("base64")
}

/** The command word and whatever followed it. */
function splitCommand(line: string): [string, string] {
  const space = line.search(/[ :]/)
  if (space === -1) return [line, ""]
  return [line.slice(0, space), line.slice(space)]
}

/**
 * The address out of `FROM:<someone@example.com> SIZE=42`.
 *
 * Angle brackets when there are any, since that is what the grammar says and
 * what every client sends; otherwise the first word, which is what a hand-typed
 * session gives. An empty `<>` — a bounce — stays empty.
 */
function address(rest: string): string {
  const bracketed = /<([^>]*)>/.exec(rest)
  if (bracketed) return bracketed[1]!.trim()
  return rest.replace(/^[\s:]+/, "").split(/\s+/)[0] ?? ""
}

/**
 * The end of a `DATA` block: a lone dot on its own line.
 *
 * Returns where the message stops and where the next command begins, which are
 * five bytes apart and both needed — the terminator is neither part of the
 * message nor something the command parser should see.
 */
function findDataEnd(
  buffer: Buffer,
  from: number
): { start: number; next: number } | null {
  // A message that is empty puts the dot first, with no message-ending CRLF in
  // front of it for the usual pattern to match.
  if (from === 0 && buffer.subarray(0, 3).toString("latin1") === ".\r\n") {
    return { start: 0, next: 3 }
  }
  const index = buffer.indexOf("\r\n.\r\n", from, "latin1")
  if (index === -1) return null
  return { start: index, next: index + 5 }
}

/**
 * Undoes transparency: a line the sender began with a dot arrives with two, so
 * that a lone dot can mean "end of message" and nothing else.
 */
function unstuff(raw: Buffer): Buffer {
  const text = raw.toString("latin1")
  if (!text.includes("..")) return raw
  return Buffer.from(text.replace(/(^|\r\n)\.\./g, "$1."), "latin1")
}

function mailMessage(
  id: string,
  from: string,
  recipients: string[],
  raw: Buffer
): InboxMessage {
  const bytes = unstuff(raw)
  const parsed = parseMail(bytes)

  return {
    id,
    kind: "mail",
    receivedAt: new Date().toISOString(),
    summary: parsed.subject || "(no subject)",
    unread: true,
    mail: {
      from,
      to: recipients,
      subject: parsed.subject,
      headerFrom: parsed.from,
      headerTo: parsed.to,
      text: parsed.text,
      html: parsed.html,
      attachments: parsed.attachments,
      raw: bytes.toString("utf8"),
    },
  }
}

/**
 * Headers a captured request must not carry into a new connection.
 *
 * They describe the hop it arrived on rather than the request itself: a `Host`
 * naming the catcher's own port would reach the wrong virtual host, and a
 * `Content-Length` copied from a body this app re-encodes would truncate it.
 * Everything else goes as it came — a signature header is exactly what makes a
 * replay worth having.
 */
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "upgrade",
  "expect",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
])

/** How long a replay waits. Its target is a development server on this
 * machine, which either answers quickly or is not running. */
const REPLAY_TIMEOUT_MS = 30_000

/** Turns a captured request back into one to send at `url`. */
export function replayInput(webhook: InboxWebhook, url: string): HttpSendInput {
  return {
    method: webhook.method,
    url,
    headers: webhook.headers.filter(
      (header) => !HOP_BY_HOP.has(header.name.toLowerCase())
    ),
    // A body is sent only for the methods that carry one, and only when it was
    // captured as text: bytes the panel did not keep cannot be replayed, and
    // sending an empty body in their place would look like a request that had
    // none.
    body:
      webhook.isText && webhook.body && !/^(GET|HEAD)$/i.test(webhook.method)
        ? webhook.body
        : null,
    timeoutMs: REPLAY_TIMEOUT_MS,
  }
}

function webhookMessage(
  id: string,
  request: IncomingMessage,
  body: Buffer
): InboxMessage {
  const target = new URL(request.url ?? "/", "http://localhost")
  const headers: { name: string; value: string }[] = []
  // `rawHeaders` rather than `headers`: it keeps the case a sender wrote and
  // the duplicates it sent, both of which are what someone comparing a
  // signature header against their own code needs to see.
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    headers.push({
      name: request.rawHeaders[index]!,
      value: request.rawHeaders[index + 1] ?? "",
    })
  }

  const contentType = request.headers["content-type"] ?? ""
  const text = isTextual(contentType)

  return {
    id,
    kind: "webhook",
    receivedAt: new Date().toISOString(),
    summary: `${request.method ?? "GET"} ${target.pathname}`,
    unread: true,
    webhook: {
      method: request.method ?? "GET",
      path: target.pathname + target.search,
      query: [...target.searchParams].map(([name, value]) => ({ name, value })),
      headers,
      body: text ? body.toString("utf8") : "",
      isText: text,
      size: body.byteLength,
    },
  }
}
