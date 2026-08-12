/**
 * Just enough MIME to read a message a development server sent.
 *
 * Deliberately not a mail library, for the reason `search.ts` is deliberately
 * not ripgrep: the Inbox panel has to behave the same on every machine, and a
 * parser is a dependency that would have to be trusted with whatever a project
 * puts on the wire. What is here is the shape real framework mailers produce —
 * `multipart/alternative` inside `multipart/mixed`, base64 and quoted-printable
 * bodies, RFC 2047 subjects — and nothing beyond it. A part it cannot make
 * sense of is shown as an attachment rather than dropped, so a message is never
 * silently less than it was.
 *
 * Everything structural runs on the message decoded as latin1, which maps one
 * byte to one character. That is what lets a boundary be found by string index
 * and the part behind it recovered as the exact bytes it arrived as — the
 * charset a part declares is applied to those bytes afterwards, per part, which
 * is the only order that works when a mail carries a UTF-8 body and a Shift_JIS
 * attachment name.
 */

/** Bytes kept inline for an attachment, as a data URL for the preview. Past
 * this the panel shows the name, type and size and nothing else — see
 * `InboxAttachment.dataUrl`. */
const MAX_INLINE_ATTACHMENT_BYTES = 2 * 1024 * 1024

/** A ceiling on nesting. Real mail is two or three levels deep; anything
 * claiming more is either broken or trying to be. */
const MAX_DEPTH = 8

export type MimeAttachment = {
  filename: string
  contentType: string
  size: number
  dataUrl: string | null
}

export type ParsedMail = {
  subject: string
  from: string
  to: string
  /** The `text/plain` and `text/html` alternatives, empty when absent. */
  text: string
  html: string
  attachments: MimeAttachment[]
}

/** One part: its headers, folded and lower-cased by name, and its raw bytes. */
type Part = {
  headers: Map<string, string>
  /** Still latin1 — decoded per part, once its charset is known. */
  body: string
}

/**
 * Splits a header block from the body that follows it.
 *
 * Folded headers (a continuation line starting with space or tab) are joined
 * back into one value here, so nothing downstream has to know they were ever
 * wrapped. A repeated header keeps the first occurrence: the ones this reads
 * are single-valued, and a message with two `Subject:` lines is a message with
 * one subject and a mistake.
 */
export function splitHeaders(section: string): Part {
  // A part whose header block is empty starts with the blank line itself, so
  // the "one blank line ends the headers" pattern has nothing in front of it
  // to match against — hence the second case rather than a single regex.
  const empty = /^\r?\n/.exec(section)
  const separator = empty ?? /\r?\n\r?\n/.exec(section)
  const head = empty
    ? ""
    : separator
      ? section.slice(0, separator.index)
      : section
  const body = separator
    ? section.slice(separator.index + separator[0].length)
    : ""

  const headers = new Map<string, string>()
  let name = ""
  let value = ""

  const commit = () => {
    if (name && !headers.has(name)) headers.set(name, value.trim())
    name = ""
    value = ""
  }

  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && name) {
      // A folded value: the newline goes, one space stays. RFC 5322 says the
      // whitespace is part of the value, and joining without it turns
      // `Very Long\r\n Subject` into `Very LongSubject`.
      value += " " + line.trim()
      continue
    }
    commit()
    const colon = line.indexOf(":")
    if (colon === -1) continue
    name = line.slice(0, colon).trim().toLowerCase()
    value = line.slice(colon + 1)
  }
  commit()

  return { headers, body }
}

/**
 * A header's value and its parameters: `text/plain; charset="utf-8"`.
 *
 * Parameter values may be quoted or bare, and RFC 2231 lets a long one be
 * split across `name*0`, `name*1` or given a charset with `name*`. The split
 * form is reassembled; the charset form is un-percent-encoded. Both turn up on
 * attachment filenames from real mailers, which is the only place it matters.
 */
export function parseParameters(raw: string): {
  value: string
  params: Map<string, string>
} {
  const [first = "", ...rest] = splitOutsideQuotes(raw, ";")
  const params = new Map<string, string>()
  const continued = new Map<string, string[]>()

  for (const piece of rest) {
    const equals = piece.indexOf("=")
    if (equals === -1) continue
    const key = piece.slice(0, equals).trim().toLowerCase()
    const value = unquote(piece.slice(equals + 1).trim())

    const section = /^(.+)\*(\d+)\*?$/.exec(key)
    if (section) {
      const list = continued.get(section[1]!) ?? []
      list[Number(section[2])] = value
      continued.set(section[1]!, list)
      continue
    }
    params.set(key.endsWith("*") ? key.slice(0, -1) : key, value)
  }

  for (const [key, pieces] of continued) {
    params.set(key, pieces.filter((piece) => piece !== undefined).join(""))
  }

  // `filename*=utf-8''report%20Q3.pdf` — the charset and language come first,
  // separated by apostrophes, and the rest is percent-encoded.
  for (const [key, value] of params) {
    const extended = /^([\w-]*)'([\w-]*)'(.*)$/.exec(value)
    if (!extended) continue
    params.set(key, decodeBytes(percentDecode(extended[3]!), extended[1]!))
  }

  return { value: first.trim().toLowerCase(), params }
}

/**
 * RFC 2047 encoded words: `=?UTF-8?B?SGVsbG8=?=`.
 *
 * Adjacent words separated only by whitespace are joined without it — that is
 * how a long subject is split across two of them, and leaving the space in
 * puts a gap in the middle of a word.
 */
export function decodeWords(value: string): string {
  if (!value.includes("=?")) return value

  let decodedPrevious = false
  return value.replace(
    /(\s*)=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_match, gap: string, charset: string, encoding: string, text: string) => {
      const bytes =
        encoding.toLowerCase() === "b"
          ? Buffer.from(text, "base64")
          : // In `Q`, an underscore is a space — the one way it differs from
            // quoted-printable proper.
            decodeQuotedPrintable(text.replace(/_/g, " "))
      const decoded = decodeBytes(bytes, charset)
      const separator = decodedPrevious ? "" : gap
      decodedPrevious = true
      return separator + decoded
    }
  )
}

/** Undoes `=3D` and soft line breaks. */
export function decodeQuotedPrintable(text: string): Buffer {
  const bytes: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (character !== "=") {
      bytes.push(character.charCodeAt(0) & 0xff)
      continue
    }
    const pair = text.slice(index + 1, index + 3)
    if (/^\r?\n/.test(pair)) {
      // A soft break: the newline is padding the encoder added to stay under
      // 76 columns, and is not part of the content.
      index += pair.startsWith("\r\n") ? 2 : 1
      continue
    }
    if (/^[0-9a-f]{2}$/i.test(pair)) {
      bytes.push(parseInt(pair, 16))
      index += 2
      continue
    }
    // A stray `=` that encodes nothing. Kept, since dropping it would silently
    // change text somebody wrote.
    bytes.push(0x3d)
  }
  return Buffer.from(bytes)
}

/** A part's body as the bytes it stands for. */
function decodeTransfer(body: string, encoding: string): Buffer {
  const kind = encoding.trim().toLowerCase()
  if (kind === "base64") {
    return Buffer.from(body.replace(/\s+/g, ""), "base64")
  }
  if (kind === "quoted-printable") return decodeQuotedPrintable(body)
  // `7bit`, `8bit`, `binary`, or nothing at all: latin1 gave us the bytes
  // already, so this is the identity.
  return Buffer.from(body, "latin1")
}

/**
 * Bytes as text, in whatever charset the part declared.
 *
 * `TextDecoder` knows the encodings a browser knows, which is every one a mail
 * from a web application arrives in. An unknown label falls back to UTF-8
 * rather than throwing: mangled text is a message that can still be read, and
 * an exception is a panel that shows nothing.
 */
function decodeBytes(bytes: Buffer, charset: string): string {
  const label = charset.trim().toLowerCase() || "utf-8"
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return new TextDecoder("utf-8").decode(bytes)
  }
}

/**
 * The parts of a multipart body.
 *
 * A delimiter only counts at the start of a line, which is what keeps a
 * boundary string appearing inside a base64 payload from cutting the message
 * in half. The preamble before the first delimiter and the epilogue after the
 * closing one are both dropped — they exist for mail readers that predate MIME
 * and say nothing about the message.
 */
function splitParts(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`
  const parts: string[] = []

  let index = findDelimiter(body, delimiter, 0)
  while (index !== -1) {
    const after = index + delimiter.length
    if (body.startsWith("--", after)) break

    const start = skipLineEnd(body, after)
    const next = findDelimiter(body, delimiter, start)
    if (next === -1) {
      parts.push(body.slice(start))
      break
    }
    // The line ending in front of a delimiter belongs to the delimiter, not to
    // the part before it — a base64 attachment would otherwise gain a newline.
    parts.push(body.slice(start, trimLineEnd(body, next)))
    index = next
  }

  return parts
}

function findDelimiter(body: string, delimiter: string, from: number): number {
  let index = body.indexOf(delimiter, from)
  while (index > 0 && body[index - 1] !== "\n") {
    index = body.indexOf(delimiter, index + 1)
  }
  return index
}

/** Past the end of the line `index` sits on — the transport padding after a
 * delimiter, which may carry trailing whitespace before it. */
function skipLineEnd(body: string, index: number): number {
  const newline = body.indexOf("\n", index)
  return newline === -1 ? body.length : newline + 1
}

function trimLineEnd(body: string, index: number): number {
  if (body[index - 1] === "\n")
    return body[index - 2] === "\r" ? index - 2 : index - 1
  return index
}

function splitOutsideQuotes(value: string, separator: string): string[] {
  const pieces: string[] = []
  let current = ""
  let quoted = false

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (character === '"' && value[index - 1] !== "\\") quoted = !quoted
    if (character === separator && !quoted) {
      pieces.push(current)
      current = ""
      continue
    }
    current += character
  }
  pieces.push(current)
  return pieces
}

function unquote(value: string): string {
  if (!value.startsWith('"')) return value
  return value
    .slice(1, value.endsWith('"') ? -1 : undefined)
    .replace(/\\(.)/g, "$1")
}

function percentDecode(value: string): Buffer {
  const bytes: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    if (
      value[index] === "%" &&
      /^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))
    ) {
      bytes.push(parseInt(value.slice(index + 1, index + 3), 16))
      index += 2
      continue
    }
    bytes.push(value.charCodeAt(index) & 0xff)
  }
  return Buffer.from(bytes)
}

/** Whether a part is a file the message carries rather than the message
 * itself. An inline image in an HTML mail is a file too: it has a name and a
 * `Content-ID` the markup points at, and nothing here renders those. */
function attachmentName(part: Part): string | null {
  const disposition = parseParameters(
    part.headers.get("content-disposition") ?? ""
  )
  const type = parseParameters(part.headers.get("content-type") ?? "")
  const filename = disposition.params.get("filename") ?? type.params.get("name")

  if (filename) return decodeWords(filename)
  if (disposition.value === "attachment") return "attachment"
  return null
}

/**
 * Reads a whole message.
 *
 * `raw` is the bytes exactly as they came off the socket, dot-unstuffed but
 * otherwise untouched.
 */
export function parseMail(raw: Buffer): ParsedMail {
  const message = splitHeaders(raw.toString("latin1"))

  const result: ParsedMail = {
    subject: decodeWords(message.headers.get("subject") ?? ""),
    from: decodeWords(message.headers.get("from") ?? ""),
    to: decodeWords(message.headers.get("to") ?? ""),
    text: "",
    html: "",
    attachments: [],
  }

  collect(message, result, 0)
  return result
}

/**
 * Walks one part, filling in whichever of the three slots it belongs to.
 *
 * The first `text/plain` and the first `text/html` win. A message with two of
 * either is a `multipart/alternative` whose later parts are meant as
 * *replacements* for the earlier ones — but taking the last would mean an HTML
 * mail's plain-text fallback overwrote nothing while a trailing signature part
 * overwrote the body, and neither is what someone reading the panel wants.
 */
function collect(part: Part, result: ParsedMail, depth: number): void {
  const type = parseParameters(part.headers.get("content-type") ?? "text/plain")
  const filename = attachmentName(part)

  if (type.value.startsWith("multipart/") && depth < MAX_DEPTH) {
    const boundary = type.params.get("boundary")
    if (!boundary) return
    for (const section of splitParts(part.body, boundary)) {
      collect(splitHeaders(section), result, depth + 1)
    }
    return
  }

  const bytes = decodeTransfer(
    part.body,
    part.headers.get("content-transfer-encoding") ?? ""
  )

  if (!filename && type.value === "text/html" && !result.html) {
    result.html = decodeBytes(bytes, type.params.get("charset") ?? "utf-8")
    return
  }
  if (
    !filename &&
    (type.value === "text/plain" || type.value === "") &&
    !result.text
  ) {
    result.text = decodeBytes(bytes, type.params.get("charset") ?? "utf-8")
    return
  }
  if (!filename && type.value.startsWith("text/")) return

  const contentType = type.value || "application/octet-stream"
  result.attachments.push({
    filename: filename ?? "attachment",
    contentType,
    size: bytes.byteLength,
    dataUrl:
      bytes.byteLength <= MAX_INLINE_ATTACHMENT_BYTES
        ? `data:${contentType};base64,${bytes.toString("base64")}`
        : null,
  })
}
