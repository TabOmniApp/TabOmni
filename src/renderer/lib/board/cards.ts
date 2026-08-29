import {
  BOARD_PRIORITY_IDS,
  DEFAULT_BOARD_COLUMNS,
  type BoardCard,
  type BoardColumn,
  type BoardPriority,
  type WorktreeChat,
} from "@shared/api"

/**
 * A board's arithmetic, with no store and no React around it.
 *
 * Split out for the reason the other pure halves are (see CLAUDE.md): a drag
 * across columns the user has named themselves is the part of this panel with an
 * answer that can be wrong in a way nobody notices — a card that lands one place
 * off, a card filed under a column that has been deleted, or a drag that
 * reorders a *different* project's board, since the file holds every project's
 * at once. `test/board-cards.ts` is that check.
 */

/**
 * One project's columns, left to right, seeded when it has none of its own.
 *
 * Seeded **here** rather than only on the write in the store, so that a board
 * always has columns to draw: the read is what every caller does, and a project
 * whose columns have not been written yet would otherwise be a board with no
 * columns and no way to add one. The store writes the same three on `open`, so
 * this fallback is what the first frame draws rather than a state to live in.
 */
export function columnsOf(
  columns: BoardColumn[],
  folderId: string,
  now: string = new Date().toISOString()
): BoardColumn[] {
  const own = columns.filter((column) => column.folderId === folderId)
  if (own.length > 0) return own
  return DEFAULT_BOARD_COLUMNS.map((column) => ({
    ...column,
    folderId,
    createdAt: now,
    updatedAt: now,
  }))
}

/**
 * The column a card is in, as one that exists.
 *
 * A card can name a column that has been **deleted** from under it: deleting a
 * column does not rewrite cards, because a delete that silently moved eight
 * cards is worse than one that leaves them findable. So an unknown column reads
 * as the **first**, which is where such a card is drawn — visible, and one drag
 * from wherever it belongs. Null only for a project with no columns at all,
 * which `columnsOf` makes impossible for anything drawn.
 */
export function columnOf(
  columns: BoardColumn[],
  card: BoardCard
): BoardColumn | null {
  const own = columnsOf(columns, card.folderId)
  return own.find((column) => column.id === card.column) ?? own[0] ?? null
}

/** One project's cards, in the list's own order, which is the board's. */
export function boardCardsOf(
  cards: BoardCard[],
  folderId: string
): BoardCard[] {
  return cards.filter((card) => card.folderId === folderId)
}

/**
 * One column of one project's board, top to bottom.
 *
 * Takes the project's columns too, because "which cards are in this column" is
 * not a question about the card's field alone — a card whose column has gone
 * belongs to the first one (see `columnOf`), and a board that filtered on the
 * field would simply stop drawing it.
 */
export function cardsOf(
  cards: BoardCard[],
  columns: BoardColumn[],
  folderId: string,
  columnId: string
): BoardCard[] {
  const drawn = membership(columns, folderId, columnId)
  return cards.filter((card) => card.folderId === folderId && drawn(card))
}

/**
 * Whether a card is drawn in a given column of a given project.
 *
 * **One rule, used by both the drawing and the drop**, which is the point of
 * pulling it out: `cardsOf` files an orphaned card into the first column, and a
 * `moveCard` that anchored against the column's *named* members alone put a
 * card dropped beside such an orphan in the wrong place — the two were two
 * answers to one question. Built once per column rather than per card, since
 * both callers ask about a whole column.
 */
function membership(
  columns: BoardColumn[],
  folderId: string,
  columnId: string
): (card: BoardCard) => boolean {
  const own = columnsOf(columns, folderId)
  const first = own[0]?.id
  const known = new Set(own.map((column) => column.id))

  return (card) =>
    card.column === columnId || (columnId === first && !known.has(card.column))
}

/**
 * How many of a project's cards are not in its **last** column — the count on
 * its tab.
 *
 * The last one rather than a column named `Done`, now that the names are the
 * user's: every board is read left to right and work ends at the right-hand end
 * of it, whatever that column has been called. Unfinished rather than all, the
 * way the `Changes` tab counts changed files — the number is there to say
 * whether the board is worth opening.
 */
export function unfinishedCount(
  cards: BoardCard[],
  columns: BoardColumn[],
  folderId: string
): number {
  const own = columnsOf(columns, folderId)
  const last = own.at(-1)?.id
  if (!last) return boardCardsOf(cards, folderId).length
  return boardCardsOf(cards, folderId).filter(
    (card) => columnOf(columns, card)?.id !== last
  ).length
}

/**
 * The card at `index` of a column, moved there — the whole list back.
 *
 * The whole list, because the file is the whole workspace's and order within it
 * *is* order within a column: one write, and nothing to keep two orderings in
 * agreement. Everything not moving keeps its relative position, including the
 * other projects' cards, which this must not touch.
 *
 * `index` is a position among the destination column's **remaining** cards —
 * the card being moved is taken out first — so dropping a card at the foot of
 * the column it is already in is `index` one less than the length it had, and
 * an index past the end lands last rather than being refused.
 *
 * `now` is a parameter rather than read here so a test can name it, and it is
 * only spent when the **column** changes: crossing into another column is
 * something that happened to the card, and shuffling two cards within one is the
 * board being tidied. An `updatedAt` bumped by tidying is a timestamp that
 * cannot answer "when did this start".
 */
export function moveCard(
  cards: BoardCard[],
  columns: BoardColumn[],
  id: string,
  columnId: string,
  index: number,
  now: string = new Date().toISOString()
): BoardCard[] {
  const moving = cards.find((card) => card.id === id)
  if (!moving) return cards

  const rest = cards.filter((card) => card.id !== id)
  const moved: BoardCard = {
    ...moving,
    column: columnId,
    updatedAt: moving.column === columnId ? moving.updatedAt : now,
  }

  // The column **as drawn**, orphans included — the same rule `cardsOf` uses, so
  // an index computed against what is on screen means the same thing here.
  const drawn = membership(columns, moving.folderId, columnId)
  const target = rest.filter(
    (card) => card.folderId === moving.folderId && drawn(card)
  )
  // Clamped rather than trusted: the caller is a drop handler, and a gap index
  // computed against a list that has just lost a card can be either side of it.
  const anchor = target[Math.max(0, index)]
  const last = target[target.length - 1]
  const at =
    anchor !== undefined
      ? rest.indexOf(anchor)
      : last !== undefined
        ? rest.indexOf(last) + 1
        : // An empty column has nothing to sit beside, and where in the file a
          // card sits only matters against the others in its own column.
          rest.length

  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

/**
 * Which one column of which one board — the test every column write applies.
 *
 * Exported because the store's renames, recolours and deletes have exactly the
 * same collision to avoid as `moveColumn` does; see the note there.
 */
export function columnKey(
  folderId: string,
  id: string
): (column: BoardColumn) => boolean {
  return (column) => column.folderId === folderId && column.id === id
}

/**
 * A project's column moved to `index` among its own — the whole list back.
 *
 * The same shape as `moveCard` and for the same reasons: order is order in the
 * list, other projects' columns keep their places, and `index` counts against
 * this project's columns with the one being moved taken out.
 *
 * **A column is named by its project and its id together**, which is not
 * belt-and-braces: the three seeded columns are the *same three ids* on every
 * project (`DEFAULT_BOARD_COLUMNS`, so that cards written before columns were
 * records need no migration). Finding one by id alone picked whichever project
 * came first in the file, and taking one out by id alone deleted every
 * project's `doing` at once — a column that vanished off a board nobody was
 * dragging. `columnKey` is that pair, and every caller that touches one column
 * of one board goes through it.
 *
 * No timestamp is spent. Where a column sits is the board being arranged, not
 * something that happened to the column — the argument `moveCard` makes about a
 * reorder within one column, applied a level up.
 */
export function moveColumn(
  columns: BoardColumn[],
  folderId: string,
  id: string,
  index: number
): BoardColumn[] {
  const is = columnKey(folderId, id)
  const moving = columns.find(is)
  if (!moving) return columns

  const rest = columns.filter((column) => !is(column))
  const own = rest.filter((column) => column.folderId === moving.folderId)

  const anchor = own[Math.max(0, index)]
  const last = own[own.length - 1]
  const at =
    anchor !== undefined
      ? rest.indexOf(anchor)
      : last !== undefined
        ? rest.indexOf(last) + 1
        : rest.length

  return [...rest.slice(0, at), moving, ...rest.slice(at)]
}

/**
 * The card a chat is the work of, or null — the link read backwards.
 *
 * At most one: a card names one chat, and nothing offers to point two cards at
 * the same conversation. `find` rather than a lookup built up front because the
 * caller is one chat's header asking about itself, and a board is tens of cards.
 */
export function cardOfChat(
  cards: BoardCard[],
  chatId: string
): BoardCard | null {
  return cards.find((card) => card.chatId === chatId) ?? null
}

/**
 * The chat a card names, or null when there is not one any more.
 *
 * The `chatRootId` idiom, and for the same reason: a chat can be deleted while
 * a card still points at it, and the card is not what owns the conversation.
 * Resolving at read time rather than clearing the field on delete means there
 * is no second write to get wrong, and no state where the board and the chat
 * listing disagree about what exists.
 */
export function linkedChat(
  chats: WorktreeChat[],
  card: BoardCard
): WorktreeChat | null {
  if (!card.chatId) return null
  return chats.find((chat) => chat.id === card.chatId) ?? null
}

/**
 * A card's tags, cleaned — the only way the fields are read.
 *
 * Three fields were added to a type whose records are **already on disk**
 * (tags, priority, due), and nothing in main normalises a board file on the way
 * through: `listBoardCards` is a read of the JSON. So each is read through a
 * function that answers for a card written by any version, including a newer
 * one — the rule `toneOf` follows for a column's hue.
 *
 * Trimmed, blanks dropped, and de-duplicated **case-insensitively** while
 * keeping the first spelling: `api` and `API` typed on two cards are one label
 * to whoever is reading the board, and two chips of different colours on it.
 */
export function tagsOf(card: BoardCard): string[] {
  if (!Array.isArray(card.tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of card.tags) {
    if (typeof raw !== "string") continue
    const tag = raw.trim()
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

/** What the dialog's one line of text means as tags. Commas, because a tag can
 * hold a space (`design system`) and a board is not worth a chip editor. */
export function parseTags(text: string): string[] {
  return tagsOf({ tags: text.split(",") } as BoardCard)
}

/** The same line back, for the field to start from. */
export function tagText(card: BoardCard): string {
  return tagsOf(card).join(", ")
}

/** A card's priority, or null for one that has none — and for one naming a
 * level this build has never heard of. */
export function priorityOf(card: BoardCard): BoardPriority | null {
  const priority = card.priority
  if (typeof priority !== "string") return null
  return BOARD_PRIORITY_IDS.includes(priority as BoardPriority)
    ? (priority as BoardPriority)
    : null
}

/**
 * A card's due day as `YYYY-MM-DD`, or null.
 *
 * The shape is checked rather than the date parsed: this is compared against
 * today as a **string** everywhere (see `dueState`), which is only sound for
 * the one format, and a `Date` round-trip is exactly the timezone shift the
 * field was written to avoid.
 */
export function dueOf(card: BoardCard): string | null {
  const due = card.due
  if (typeof due !== "string") return null
  return /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null
}

/**
 * How a due day reads against today — which is the whole of what its colour
 * says.
 *
 * `soon` is **today or tomorrow**, deliberately short: a board is scanned for
 * what to do now, and a window of a week would paint most of a healthy board
 * amber. String comparison, which is exact for `YYYY-MM-DD` and needs no clock
 * beyond the day the caller passes in.
 */
export function dueState(
  due: string,
  today: string
): "overdue" | "soon" | "later" {
  if (due < today) return "overdue"
  return due <= addDays(today, 1) ? "soon" : "later"
}

/** Today where the user is, as a due date is written. Not `toISOString`, which
 * is UTC and so is yesterday for anyone west of it after 5pm. */
export function todayKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

/** `days` on from a `YYYY-MM-DD`, back in the same shape. Through UTC on
 * purpose: these are calendar arithmetic on a bare day, and a local `Date`
 * would land on the hour a DST change skips. */
function addDays(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}
