/**
 * The Mail panel's SMTP sink, spoken to the way a mailer speaks to it: a real
 * conversation over a real socket.
 *
 * Nothing here checks the parser against a message this file made up and then
 * handed straight to `parseMail`. The failures worth catching live in the
 * seams — a `DATA` block whose terminator lands mid-packet, a line the sender
 * stuffed a dot onto, a boundary that also appears inside a base64 payload —
 * and none of those exist until the message has been through a socket.
 */

import { connect } from "node:net"

import type { InboxMessage } from "../src/shared/api"
import { InboxServers } from "../src/main/inbox"
import { decodeWords, parseMail, parseParameters } from "../src/main/mime"
import { check, finish, section } from "./harness"

/** A port well clear of anything a development machine runs. */
const MAIL_PORT = 34_025

/** A capture is filed after the wire has been answered, so a test that asked
 * for one has to wait for it rather than read straight after the response. */
function waitFor<T>(get: () => T | undefined, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 4000
    const poll = () => {
      const value = get()
      if (value !== undefined) return resolve(value)
      if (Date.now() > deadline) return reject(new Error(`timed out: ${label}`))
      setTimeout(poll, 10)
    }
    poll()
  })
}

/**
 * One SMTP session, driven a command at a time.
 *
 * Each `say` waits for the reply before the next command goes out, which is
 * what a mailer does and what makes a missing response a hang the test reports
 * rather than a race it passes through.
 */
function smtp(port: number) {
  const socket = connect(port, "127.0.0.1")
  let buffer = ""
  let waiting: ((reply: string) => void) | null = null

  socket.setEncoding("utf8")
  socket.on("data", (chunk: string) => {
    buffer += chunk
    // A multi-line reply repeats the code with a hyphen; the last one has a
    // space, and that is the line that ends the reply.
    const match = /^\d{3} [^\n]*\r?\n/m.exec(buffer)
    if (!match || !waiting) return
    const reply = buffer.slice(0, match.index + match[0].length)
    buffer = buffer.slice(reply.length)
    const resolve = waiting
    waiting = null
    resolve(reply)
  })

  const next = () =>
    new Promise<string>((resolve) => {
      waiting = resolve
    })

  return {
    greeting: next,
    async say(line: string, chunks?: string[]) {
      const reply = next()
      if (chunks) for (const chunk of chunks) socket.write(chunk)
      else socket.write(`${line}\r\n`)
      return reply
    },
    end() {
      socket.end()
    },
  }
}

async function main() {
  const captured: InboxMessage[] = []
  let saved: InboxMessage[] = []

  const inbox = new InboxServers(
    {
      message: (message) => captured.push(message),
      status: () => undefined,
    },
    {
      load: async () => saved,
      save: async (messages) => {
        saved = messages
      },
    }
  )

  const status = await inbox.start(MAIL_PORT)

  section("server")
  check("SMTP is listening", status.listening, status.error)

  if (!status.listening) {
    await inbox.stop()
    finish()
    return
  }

  await mailSession(captured)
  await ports(inbox)

  section("storage")
  check("every capture was persisted", saved.length === captured.length, {
    saved: saved.length,
    captured: captured.length,
  })

  await inbox.clear()
  check(
    "clearing empties the list and rewrites the file",
    (await inbox.messages()).length === 0 && saved.length === 0,
    saved.length
  )

  await inbox.stop()

  units()
  finish()
}

/**
 * A message shaped the way a framework mailer sends one: an RFC 2047 subject,
 * `multipart/mixed` wrapping a `multipart/alternative`, a quoted-printable
 * text part, and a base64 attachment.
 *
 * It is written to the socket in three deliberate pieces, with the terminator
 * split across the last two. That is the case a reader which assumes one
 * packet per message gets wrong, and it is entirely ordinary on the wire.
 */
async function mailSession(captured: InboxMessage[]) {
  section("SMTP")

  const client = smtp(MAIL_PORT)
  check("greets with 220", (await client.greeting()).startsWith("220"))

  const ehlo = await client.say("EHLO tester")
  check("EHLO is answered", ehlo.startsWith("250"), ehlo)
  check("AUTH is advertised", ehlo.includes("AUTH"), ehlo)

  // A mailer configured with credentials will not send without being asked
  // for them, which is the only reason this is accepted at all.
  check(
    "AUTH PLAIN with an inline credential is accepted",
    (await client.say("AUTH PLAIN AHRlc3QAdGVzdA==")).startsWith("235")
  )

  await authLogin()

  check(
    "MAIL FROM is accepted",
    (await client.say("MAIL FROM:<app@localhost> SIZE=200")).startsWith("250")
  )
  check(
    "RCPT TO is accepted",
    (await client.say("RCPT TO:<someone@example.com>")).startsWith("250")
  )
  check(
    "a second recipient is accepted",
    (await client.say("RCPT TO:<copy@example.com>")).startsWith("250")
  )
  check("DATA opens with 354", (await client.say("DATA")).startsWith("354"))

  const message = [
    "From: =?UTF-8?B?VMOgaSBraG/huqNu?= <app@localhost>",
    "To: Someone <someone@example.com>",
    // Split across two encoded words, which have to join with no space added.
    "Subject: =?UTF-8?Q?H=C3=B3a_?= =?UTF-8?Q?=C4=91=C6=A1n_#42?=",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="OUTER"',
    "",
    "--OUTER",
    'Content-Type: multipart/alternative; boundary="INNER"',
    "",
    "--INNER",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Xin ch=C3=A0o, t=E1=BB=95ng c=E1=BB=99ng 1.000=E2=82=AB",
    // Dot-stuffed by the sender: this line really begins with one dot.
    "..hidden",
    "",
    "--INNER",
    'Content-Type: text/html; charset="utf-8"',
    "",
    "<p>Xin chào</p>",
    "",
    "--INNER--",
    "",
    "--OUTER",
    "Content-Type: application/pdf",
    "Content-Disposition: attachment; filename*=utf-8''h%C3%B3a-%C4%91%C6%A1n.pdf",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("%PDF-1.4 fake").toString("base64"),
    "",
    "--OUTER--",
    "",
  ].join("\r\n")

  // The terminator straddles the last two writes.
  const body = `${message}\r\n.\r\n`
  const cut = body.length - 3
  const reply = await client.say("", [
    body.slice(0, 40),
    body.slice(40, cut),
    body.slice(cut),
  ])
  check("the message is accepted", reply.startsWith("250"), reply)

  check("QUIT is answered", (await client.say("QUIT")).startsWith("221"))
  client.end()

  const message1 = await waitFor(
    () => captured.find((entry) => entry.kind === "mail"),
    "a captured mail"
  )
  if (message1.kind !== "mail") return

  const mail = message1.mail
  check("the envelope sender is kept", mail.from === "app@localhost", mail.from)
  check(
    "every recipient of the transaction is kept",
    mail.to.join(",") === "someone@example.com,copy@example.com",
    mail.to
  )
  check(
    "a subject split across encoded words joins without a gap",
    mail.subject === "Hóa đơn #42",
    mail.subject
  )
  check(
    "an encoded display name is decoded",
    mail.headerFrom === "Tài khoản <app@localhost>",
    mail.headerFrom
  )
  check(
    "the quoted-printable text part is decoded",
    mail.text.includes("Xin chào, tổng cộng 1.000₫"),
    mail.text
  )
  check(
    "a dot-stuffed line is put back",
    mail.text.includes("\n.hidden"),
    JSON.stringify(mail.text)
  )
  check(
    "the HTML alternative is kept apart from the text",
    mail.html.trim() === "<p>Xin chào</p>",
    mail.html
  )
  check(
    "one attachment was found",
    mail.attachments.length === 1,
    mail.attachments
  )
  check(
    "an RFC 2231 filename is decoded",
    mail.attachments[0]?.filename === "hóa-đơn.pdf",
    mail.attachments[0]?.filename
  )
  check(
    "the attachment's bytes are its decoded length",
    mail.attachments[0]?.size === 13,
    mail.attachments[0]?.size
  )
  check(
    "the raw message is kept whole",
    mail.raw.includes("--OUTER--"),
    mail.raw.length
  )
  check("the capture starts unread", message1.unread)
  check(
    "the list summary is the subject",
    message1.summary === "Hóa đơn #42",
    message1.summary
  )
}

/**
 * The `AUTH LOGIN` exchange, on its own connection, exactly as a client walks
 * it: a prompt for the username, then a prompt for the password, then the
 * result.
 *
 * The reason this is checked step by step rather than "does it end in 235":
 * nothing here reads the credentials, and a server that jumped straight to 235
 * after the username looks like it is being helpfully lenient. It is not — the
 * client is waiting for `334` at that point and reports an invalid login
 * sequence instead of sending the mail.
 */
async function authLogin() {
  const client = smtp(MAIL_PORT)
  await client.greeting()
  await client.say("EHLO tester")

  const username = await client.say("AUTH LOGIN")
  check(
    "AUTH LOGIN asks for the username",
    username.startsWith("334") && decode(username) === "Username:",
    username
  )

  const password = await client.say(btoa("someone"))
  check(
    "and then for the password, rather than finishing early",
    password.startsWith("334") && decode(password) === "Password:",
    password
  )

  check(
    "the password ends the exchange",
    (await client.say(btoa("hunter2"))).startsWith("235")
  )

  // A client that changes its mind mid-exchange must not be told it is logged
  // in.
  await client.say("AUTH LOGIN")
  check(
    "an abandoned exchange is refused, not accepted",
    (await client.say("*")).startsWith("501")
  )

  client.end()
}

/** The prompt out of a `334 <base64>` reply. */
function decode(reply: string): string {
  return Buffer.from(reply.slice(4).trim(), "base64").toString("utf8")
}

/**
 * Stop has to free the port, not merely report itself stopped — a second
 * server binding it is the only thing that actually proves that, and a Stop
 * that left the port held would fail the user on the next Start rather than
 * here.
 */
async function ports(inbox: InboxServers) {
  section("stop and start")

  const stopped = await inbox.stop()
  check("stopping reports it down", !stopped.listening, stopped)

  const rival = new InboxServers(
    { message: () => undefined, status: () => undefined },
    { load: async () => [], save: async () => undefined }
  )
  const borrowed = await rival.start(MAIL_PORT)
  check("and really releases its port", borrowed.listening, borrowed)

  const clash = await inbox.start(MAIL_PORT)
  check(
    "a port still held is reported rather than thrown",
    !clash.listening && Boolean(clash.error),
    clash
  )
  await rival.stop()

  const again = await inbox.start(MAIL_PORT)
  check("and the port is takeable again once freed", again.listening, again)
}

/** The parts of `mime.ts` a socket cannot reach. */
function units() {
  section("mime")

  check(
    "an encoded word beside plain text keeps the space between them",
    decodeWords("Re: =?UTF-8?B?SGVsbG8=?=") === "Re: Hello",
    decodeWords("Re: =?UTF-8?B?SGVsbG8=?=")
  )
  check(
    "a quoted parameter with a semicolon in it is not split on it",
    parseParameters('attachment; filename="a;b.txt"').params.get("filename") ===
      "a;b.txt"
  )
  check(
    "a parameter split across sections is joined",
    parseParameters(
      'attachment; filename*0="long-"; filename*1="name.txt"'
    ).params.get("filename") === "long-name.txt"
  )

  // A boundary string that also occurs inside a part's own content: only the
  // one at the start of a line delimits.
  const tricky = Buffer.from(
    [
      'Content-Type: multipart/mixed; boundary="B"',
      "",
      "--B",
      "Content-Type: text/plain",
      "",
      "a line mentioning --B in passing",
      "--B--",
      "",
    ].join("\r\n")
  )
  check(
    "a boundary inside a part's content does not split it",
    parseMail(tricky).text.trim() === "a line mentioning --B in passing",
    JSON.stringify(parseMail(tricky).text)
  )

  const plain = Buffer.from(["Subject: Bare", "", "just text", ""].join("\r\n"))
  check(
    "a message with no MIME headers at all is still read",
    parseMail(plain).text.trim() === "just text",
    parseMail(plain).text
  )
}

await main()
