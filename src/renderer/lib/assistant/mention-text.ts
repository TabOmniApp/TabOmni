import type { MentionKind } from "../terminal/mention-text"

/**
 * The rules the assistant composer's `@` follows, with nothing behind them.
 *
 * The same split as `lib/terminal/mention-text.ts` against `mentions.ts`, and
 * the same reason: the catalogue touches four zustand stores as it is imported,
 * so this is the half a test can reach.
 *
 * **What differs from the chat composer's `@` is what a pick leaves behind.**
 * There, a chip is expanded into a line of context on the way to a CLI that can
 * see nothing but the prompt. Here the panels are already reachable — the
 * assistant is started with whichever of the Database, API and Notes MCP servers
 * are switched on, and every one of their tools takes a thing's *name* — so the
 * name is the whole reference. Pasting a table's columns in would be handing the
 * agent a stale copy of something it can read for itself.
 *
 * So a mention is plain text, and the highlight is drawn behind it from the
 * catalogue: what is tinted is what the workspace still holds, which means a
 * name typed by hand lights up as well as one picked from the menu, and one
 * whose thing has been deleted stops being tinted.
 */

/**
 * What can be mentioned here, which is the chat composer's kinds plus one.
 *
 * A **database** is mentionable here and not there for the same reason the rest
 * of this file exists: a chip has to expand into something, and what a database
 * would expand into is its schema — which means connecting, and a menu opening
 * is not consent to connect (the comment on `primeMentions` in
 * `lib/terminal/mentions.ts`). A name needs no connection, and `list_tables`
 * takes one. So the workspace's databases are all offered whether or not the
 * Database panel has opened any of them, and the open one's tables are offered
 * on top.
 */
export type PlainMentionKind = MentionKind | "database"

/** The row's right-hand word — which panel this came from. */
export const PLAIN_LABELS: Record<PlainMentionKind, string> = {
  database: "database",
  table: "table",
  request: "request",
  note: "note",
}

/** A thing the assistant can be pointed at, as the menu shows it. No `resolve`:
 * the name is the reference. */
export type PlainMention = {
  kind: PlainMentionKind
  /** Inserted verbatim, and what the MCP tools take — `list_databases`,
   * `list_tables`, `get_request` and `read_note` all accept a name. */
  label: string
  /** The row's right-hand hint — which database a table is in, what a request
   * sends. */
  detail: string
}

/** Where the `@` being typed starts, and what has been typed after it. */
export type MentionQuery = { from: number; filter: string }

/**
 * `@` anywhere a word could start rather than only at the start of the message,
 * because a mention belongs mid-sentence ("why is @users slow?"). The leading
 * boundary is what keeps an email address typed into the prompt from opening a
 * menu.
 */
const QUERY = /(?:^|\s)@([\w./:-]*)$/

/** The mention query the caret is sitting in, or null when it is not in one. */
export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const match = QUERY.exec(text.slice(0, caret))
  if (!match) return null
  const filter = match[1] ?? ""
  return { from: caret - filter.length - "@".length, filter }
}

/**
 * The draft with the typed `@query` replaced by the name, and where the caret
 * lands.
 *
 * A space follows, so the next word is not typed onto the end of the name — and
 * so the tint, which ends at the name, does not appear to swallow it. Not a
 * second one where the draft already had one: picking a row in the middle of a
 * finished sentence must not push its words apart.
 */
export function insertMention(
  text: string,
  query: MentionQuery,
  caret: number,
  label: string
): { text: string; caret: number } {
  const inserted = /^\s/.test(text.slice(caret)) ? label : `${label} `
  return {
    text: text.slice(0, query.from) + inserted + text.slice(caret),
    caret: query.from + inserted.length,
  }
}

/** A run of the draft, tinted when it names something the workspace holds. */
export type MentionSegment = { text: string; kind: PlainMentionKind | null }

/**
 * A single-character name would tint every `a` in the message. Two is the
 * shortest that can be meant.
 */
const MIN_LABEL = 2

/**
 * The draft cut into tinted and untinted runs.
 *
 * Matched case-sensitively and against whole names: a note called `Notes` does
 * not tint the word `notes`, and `public.users` does not tint the `users` inside
 * `other.users`. Longest first, so a database-qualified table wins over the same
 * table unqualified.
 *
 * The trailing boundary has to let a full stop through — a mention at the end of
 * a sentence has one — while still refusing a dot that another name is hanging
 * off: with only the database `shop` known, `shop.public.users` is a table this
 * app has not read, and tinting the `shop` at the front of it would claim
 * otherwise.
 */
export function markMentions(
  text: string,
  known: readonly PlainMention[]
): MentionSegment[] {
  const kinds = new Map<string, PlainMentionKind>()
  for (const mention of known) {
    if (mention.label.length < MIN_LABEL) continue
    if (!kinds.has(mention.label)) kinds.set(mention.label, mention.kind)
  }
  if (text === "" || kinds.size === 0) return [{ text, kind: null }]

  const labels = [...kinds.keys()].sort((left, right) =>
    right.length === left.length
      ? left.localeCompare(right)
      : right.length - left.length
  )
  const pattern = new RegExp(
    `(?<![\\w.])(?:${labels.map(escapeForRegExp).join("|")})(?!\\w)(?!\\.\\w)`,
    "g"
  )

  const segments: MentionSegment[] = []
  let at = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index
    if (start > at) segments.push({ text: text.slice(at, start), kind: null })
    segments.push({
      text: match[0],
      kind: kinds.get(match[0]) ?? null,
    })
    at = start + match[0].length
  }
  if (at < text.length) segments.push({ text: text.slice(at), kind: null })

  return segments
}

/** A name is a database's or a note's own, so it can hold anything. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Orders `all` by how well it answers `filter` — a name that starts with it
 * first, then one that contains it, then a detail that does.
 *
 * The chat composer's `rankMentions` does the same over its own row type; the
 * two menus sit on one keyboard and must not sort differently.
 */
export function rankPlainMentions(
  all: readonly PlainMention[],
  filter: string
): PlainMention[] {
  if (filter === "") return [...all]
  const needle = filter.toLowerCase()

  const scored: { mention: PlainMention; score: number }[] = []
  for (const mention of all) {
    const at = mention.label.toLowerCase().indexOf(needle)
    if (at === 0) scored.push({ mention, score: 0 })
    else if (at > 0) scored.push({ mention, score: 1 })
    else if (mention.detail.toLowerCase().includes(needle))
      scored.push({ mention, score: 2 })
  }

  return scored
    .sort((left, right) => left.score - right.score)
    .map((entry) => entry.mention)
}
