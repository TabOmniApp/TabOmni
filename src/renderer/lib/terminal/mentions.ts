import { relationId } from "../panels"
import { oneLine, type Mention } from "./mention-text"
import { useExplorer } from "../db/explorer-store"
import { resolveUrl, useApi, variablesFrom } from "../http/store"
import { useNotes } from "../note/store"

/**
 * What the composer's `@` menu offers: the things the *other* panels are
 * holding, as text a CLI can read.
 *
 * This is the one feature that only a studio can have. An agent in an editor
 * can see the files and the terminal output; it cannot see the schema of the
 * database this project talks to, the request that reproduces a bug, or the
 * note that says what the payload has to look like — those live in other
 * applications. Here they live in the same window, in stores this module can
 * read, so the round trip through "open the other tool, copy something, paste
 * it into the prompt" is a menu instead.
 *
 * **Everything is resolved from what the renderer already has.** No IPC of its
 * own, no query run to answer a keystroke: a table's columns are the ones the
 * schema read already brought back, a request's URL is resolved with the same
 * `resolveUrl` the send path uses. A mention of something the studio has not
 * read yet simply is not offered.
 *
 * **A mention is a chip in the composer and context on the wire.** What the
 * chip carries and what it becomes is `mention-text.ts`; what each kind of thing
 * says about itself is below.
 */
/** Columns past this are summarised rather than listed: a wide table would
 * otherwise be most of the prompt. */
const MAX_COLUMNS = 24

/**
 * A table as `name (col type, col type)`.
 *
 * Types come from the tab's own schema read when the table has been opened, and
 * the completion list — which is names only — otherwise. Both are already in
 * the store; neither is worth a query from a menu.
 */
function tableMentions(): Mention[] {
  const { databaseId, relations, views, completions } = useExplorer.getState()
  if (databaseId === null) return []

  return relations.map((relation) => {
    const key = relationId(relation)
    const read = views[key]?.columns ?? []

    const described = read.length
      ? read.map((column) =>
          [
            column.name,
            column.type,
            column.primaryKey ? "PK" : null,
            column.nullable ? null : "NOT NULL",
          ]
            .filter(Boolean)
            .join(" ")
        )
      : (completions[key] ?? completions[relation.name] ?? [])

    const shown = described.slice(0, MAX_COLUMNS)
    const rest = described.length - shown.length
    const columns = shown.length
      ? `(${shown.join(", ")}${rest > 0 ? `, +${rest} more` : ""})`
      : "(columns not read yet)"

    return {
      id: `table:${key}`,
      kind: "table",
      label: key,
      detail: relation.kind,
      resolve: () => Promise.resolve(`${key} ${columns}`),
    }
  })
}

/**
 * A request as the address it would actually be sent to, with its headers and
 * body.
 *
 * Resolved through the active environment, because `{{baseUrl}}/login` is not
 * something the agent can act on and `http://localhost:3000/login` is. A
 * request whose variables are undefined keeps what it was typed as and says so
 * — the alternative is a mention that silently claims a URL nobody configured.
 */
function requestMentions(): Mention[] {
  const { requests, environments, activeEnvironmentId } = useApi.getState()
  const variables = variablesFrom(environments, activeEnvironmentId)

  return requests.map((request) => {
    const { url, error } = resolveUrl(request.url, variables)
    const headers = request.headers
      .filter((header) => header.enabled !== false && header.name.trim())
      .map((header) => `${header.name}: ${header.value}`)

    const parts = [`${request.method} ${url || request.url}`]
    if (error) parts.push(`(unresolved: ${error})`)
    if (headers.length) parts.push(`headers: ${headers.join("; ")}`)
    if (request.body.trim()) parts.push(`body: ${oneLine(request.body)}`)

    return {
      id: `request:${request.id}`,
      kind: "request",
      label: request.name,
      detail: `${request.method} ${request.url}`,
      resolve: () => Promise.resolve(parts.join(" · ")),
    }
  })
}

/**
 * A note as its own text.
 *
 * Every note is offered, and its body is read when one is picked — `loadBody`
 * answers from the cache when the note has been open and from disk when it has
 * not. Listing only the notes already read would have hidden the scratchpad from
 * a launch that had not opened it, which is most launches.
 */
function noteMentions(): Mention[] {
  return useNotes.getState().notes.map((note) => ({
    id: `note:${note.id}`,
    kind: "note" as const,
    label: note.name,
    detail: "note",
    resolve: async () => {
      const body = await useNotes.getState().loadBody(note.id)
      return `note "${note.name}" · ${oneLine(body.text)}`
    },
  }))
}

/**
 * Reads what a panel would have read if it had been opened.
 *
 * The rail's panels load themselves lazily — a request list nobody has looked at
 * is a file nobody has read — so a menu built from the stores alone would have
 * been empty on most launches, which reads as a broken feature rather than as an
 * empty workspace. Called when the menu opens, and each of these is a no-op once
 * its panel has loaded.
 *
 * Deliberately not the databases: reading a schema means connecting, and a menu
 * opening is not consent to connect. Tables appear once a database is open —
 * which is also when their columns are a thing this app knows.
 */
export function primeMentions(): void {
  if (useApi.getState().requests.length === 0) {
    void useApi.getState().refresh().catch(noop)
  }
  if (useNotes.getState().notes.length === 0) {
    void useNotes.getState().refresh().catch(noop)
  }
}

/** A failed read leaves the menu without those rows, which is the right answer
 * to it: nothing here is worth a dialog over. */
function noop() {}

/**
 * Everything mentionable right now, in the order the panels sit on the rail.
 *
 * Read on every keystroke rather than cached: a table read a moment ago, a
 * request just saved and a note written while the prompt was being typed are
 * exactly the things somebody reaches for, and a stale menu would be the one
 * that leaves them out.
 */
export function mentions(): Mention[] {
  return [...tableMentions(), ...requestMentions(), ...noteMentions()]
}

/** The live catalogue as a lookup, for `expandMentions` at send time. */
export function lookupMention(id: string): Mention | undefined {
  return mentions().find((mention) => mention.id === id)
}
