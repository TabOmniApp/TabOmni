/**
 * The rules an `@` mention follows, with nothing behind them.
 *
 * Kept apart from `mentions.ts`, which reads four panels' stores: those touch
 * `window` as they are created, so a test importing them cannot run under `bun`
 * at all. The same split as `lib/files/icon-names.ts` against `icons.ts`, and for
 * the same reason — this is the half worth testing, and it is the half where a
 * mistake is silent.
 *
 * What a mention *is* — a table, a request, a note — is the catalogue's
 * business. This is what one looks like, what its chip carries, and what the chip
 * becomes on the way to the CLI.
 */

export type MentionKind = "table" | "request" | "note"

export type Mention = {
  /** Unique per row, and the React key. */
  id: string
  kind: MentionKind
  /** What the row shows, and what the inserted text names. */
  label: string
  /** The row's right-hand hint — where this came from. */
  detail: string
  /**
   * The one line this mention puts in the prompt, resolved when it is picked
   * rather than when the row is drawn.
   *
   * Late, because a menu that resolved every row would be a menu that reads
   * every note in the scratchpad to draw itself. One pick is one read, and it
   * happens in the beat between the click and the caret moving.
   */
  resolve: () => Promise<string>
}

/** Past this a value is cut, with what was dropped said out loud. */
const MAX_VALUE = 600

export const MENTION_LABELS: Record<MentionKind, string> = {
  table: "table",
  request: "request",
  note: "note",
}

/**
 * One line, cut to length.
 *
 * Newlines become spaces rather than being kept: the insertion goes into a
 * paragraph, and a multi-line value would either be split across paragraphs by
 * ProseMirror or arrive as one run-on line anyway. Saying how much was dropped
 * is what stops the agent from reasoning about a body it only has the top of.
 */
export function oneLine(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim()
  if (flat.length <= MAX_VALUE) return flat
  return `${flat.slice(0, MAX_VALUE)}… (${flat.length - MAX_VALUE} more characters)`
}

/**
 * The href a mention's chip carries.
 *
 * A scheme of this app's own, so nothing tries to fetch it and nothing else in
 * the document can be mistaken for one. The id inside is the catalogue's own
 * (`note:<uuid>`, `table:public.users`), encoded because a relation name is not
 * a URL component.
 */
export function mentionHref(mention: Mention): string {
  return `tabomni://mention/${encodeURIComponent(mention.id)}`
}

/** The mention id in an href, or null when it is an ordinary link. */
export function mentionIdOf(href: string): string | null {
  const match = /^tabomni:\/\/mention\/(.+)$/.exec(href)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    // A malformed escape is somebody else's link that happens to share the
    // scheme, not a mention this build wrote.
    return null
  }
}

/**
 * Which panel a chip's href belongs to, or null when it is an ordinary link.
 *
 * What the chip is *coloured* by, and the reason it is read off the href rather
 * than kept in a second attribute: Milkdown renders a link from its own schema,
 * and the href is the only thing of ours that travels with it.
 */
export function mentionKindOf(href: unknown): MentionKind | null {
  if (typeof href !== "string") return null
  const id = mentionIdOf(href)
  const kind = id?.slice(0, id.indexOf(":"))
  return kind !== undefined && kind in MENTION_LABELS
    ? (kind as MentionKind)
    : null
}

/**
 * A chip in the composer's markdown, as the commonmark serializer writes it.
 *
 * The label is matched tolerantly because it is a note's or a request's own
 * name: a `]` in it comes back escaped, and a stricter pattern would leave that
 * one mention unexpanded and the raw href in the prompt.
 */
const CHIP = /\[((?:[^\]\\]|\\.)*)\]\(tabomni:\/\/mention\/([^)\s]+)\)/g

/**
 * Replaces every mention chip in `markdown` with the line of context it stands
 * for — what the composer sends rather than what it shows.
 *
 * `lookup` is the caller's — `lookupMention` in `mentions.ts` for the composer,
 * a map for a test. A mention whose thing has gone since it
 * was inserted — a note deleted, a database closed — falls back to the label the
 * chip was showing: the sentence still reads, which is better than sending a
 * `tabomni://` href to a CLI that can do nothing with it.
 */
export async function expandMentions(
  markdown: string,
  lookup: (id: string) => Mention | undefined
): Promise<string> {
  const found = [...markdown.matchAll(CHIP)]
  if (found.length === 0) return markdown

  // Collapsed to one entry per href *before* anything is resolved: the same note
  // mentioned twice is one file to read, and a `has` check inside the resolves
  // would race — every one of them starts before the first has answered.
  const wanted = new Map<string, string>()
  for (const match of found) {
    const raw = match[2] ?? ""
    if (wanted.has(raw)) continue
    // The label as written, with the serializer's escapes taken back out.
    wanted.set(raw, (match[1] ?? "").replace(/\\(.)/g, "$1"))
  }

  const texts = new Map<string, string>()
  await Promise.all(
    [...wanted].map(async ([raw, label]) => {
      const id = mentionIdOf(`tabomni://mention/${raw}`)
      const mention = id === null ? undefined : lookup(id)
      try {
        texts.set(raw, mention ? await mention.resolve() : label)
      } catch {
        texts.set(raw, label)
      }
    })
  )

  return markdown.replace(CHIP, (whole, _label: string, raw: string) => {
    return texts.get(raw) ?? whole
  })
}

/**
 * Orders `all` by how well it answers `filter` — a label that starts with it
 * first, then one that contains it, then a detail that does. The same ranking
 * the `/` menu uses, for the same reason: two menus on one keyboard should not
 * sort differently.
 */
export function rankMentions(all: Mention[], filter: string): Mention[] {
  if (filter === "") return all
  const needle = filter.toLowerCase()

  const scored: { mention: Mention; score: number }[] = []
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
