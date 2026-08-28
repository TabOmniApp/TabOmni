import type { BoardCard, BoardColumn, WorktreeChat } from "../src/shared/api"
import {
  boardCardsOf,
  cardOfChat,
  cardsOf,
  columnOf,
  columnsOf,
  linkedChat,
  moveCard,
  moveColumn,
  unfinishedCount,
} from "../src/renderer/lib/board/cards"
import { check, finish, section } from "./harness"

/**
 * A board's arithmetic: which columns a project has, which cards each holds,
 * and where a dragged card or column lands.
 *
 * Both files hold **every** project's records in one list, with order in the
 * list standing for order on the board, so the failures worth a test are the
 * ones that look like nothing: a card that lands a row off, a drag on one
 * project's board that reorders another's, and a card whose column has been
 * deleted quietly ceasing to be drawn anywhere. Pure, so this asks without a
 * store.
 */

const NOW = "2026-08-28T10:00:00.000Z"
const EARLIER = "2026-08-01T09:00:00.000Z"

function card(
  id: string,
  folderId: string,
  column: string,
  chatId: string | null = null
): BoardCard {
  return {
    id,
    folderId,
    column,
    title: id,
    body: "",
    chatId,
    createdAt: EARLIER,
    updatedAt: EARLIER,
  }
}

function column(id: string, folderId: string, name = id): BoardColumn {
  return {
    id,
    folderId,
    name,
    tone: "slate",
    createdAt: EARLIER,
    updatedAt: EARLIER,
  }
}

/*
 * Two projects, interleaved on purpose in both lists: a board that filters
 * correctly and a board that happens to be contiguous in the file look
 * identical otherwise.
 *
 * `web` has renamed its stages; `api` has none of its own and so is drawn with
 * the seeded defaults, which is what every board written before columns existed
 * looks like.
 */
const columns: BoardColumn[] = [
  column("todo", "web", "Backlog"),
  column("blocked", "api", "Blocked"),
  column("doing", "web", "Doing"),
  column("shipped", "web", "Shipped"),
]

const cards: BoardCard[] = [
  card("w1", "web", "todo"),
  card("a1", "api", "todo"),
  card("w2", "web", "todo"),
  card("w3", "web", "doing", "chat-1"),
  card("a2", "api", "done"),
  card("w4", "web", "shipped"),
  // A column that no longer exists — deleted from under it, which nothing
  // rewrites cards for.
  card("w5", "web", "triage"),
]

const ids = (list: { id: string }[]) => list.map((entry) => entry.id).join("")

section("a project's columns")

check(
  "its own, in the file's order, which is left to right",
  ids(columnsOf(columns, "web")) === "tododoingshipped"
)

check(
  "another project's are left out",
  ids(columnsOf(columns, "api")) === "blocked"
)

check(
  "a project with none is seeded with the three defaults, so a board always " +
    "has columns to draw",
  ids(columnsOf(columns, "fresh", NOW)) === "tododoingdone"
)

check(
  "and the seeded ids are the words, so a card written before columns existed " +
    "points at a real one",
  columnsOf(columns, "fresh", NOW).every(
    (entry) => entry.folderId === "fresh" && entry.createdAt === NOW
  )
)

section("which column a card is in")

check(
  "the one it names",
  columnOf(columns, card("x", "web", "doing"))?.name === "Doing"
)

check(
  "a card whose column was deleted is drawn in the first, not lost",
  columnOf(columns, card("x", "web", "gone"))?.id === "todo"
)

section("what a column holds")

check(
  "one column of one project",
  ids(cardsOf(cards, columns, "web", "todo")) === "w1w2w5"
)

check(
  "the orphan rides in the first column and nowhere else",
  ids(cardsOf(cards, columns, "web", "doing")) === "w3" &&
    ids(cardsOf(cards, columns, "web", "shipped")) === "w4"
)

check(
  "another project's cards of the same column id are left out",
  ids(cardsOf(cards, columns, "api", "todo")) === "a1"
)

check(
  "a folder with no cards — a project whose board is empty, or one that has " +
    "left the workspace and whose cards are still on disk",
  boardCardsOf(cards, "gone").length === 0
)

check(
  "the tab's count is what is not in the last column, whatever it is called",
  unfinishedCount(cards, columns, "web") === 4
)

section("moving a card")

check(
  "within a column, to the foot",
  ids(
    cardsOf(
      moveCard(cards, columns, "w1", "todo", 2, NOW),
      columns,
      "web",
      "todo"
    )
  ) === "w2w5w1"
)

check(
  "within a column, to the head",
  ids(
    cardsOf(
      moveCard(cards, columns, "w2", "todo", 0, NOW),
      columns,
      "web",
      "todo"
    )
  ) === "w2w1w5"
)

check(
  "into another column, at a named position",
  ids(
    cardsOf(
      moveCard(cards, columns, "w1", "shipped", 0, NOW),
      columns,
      "web",
      "shipped"
    )
  ) === "w1w4"
)

check(
  "an index past the end lands last rather than being refused",
  ids(
    cardsOf(
      moveCard(cards, columns, "w1", "doing", 99, NOW),
      columns,
      "web",
      "doing"
    )
  ) === "w3w1"
)

check(
  "a negative index lands first",
  ids(
    cardsOf(
      moveCard(cards, columns, "w1", "doing", -3, NOW),
      columns,
      "web",
      "doing"
    )
  ) === "w1w3"
)

check(
  "the other project's board is untouched",
  ids(
    boardCardsOf(moveCard(cards, columns, "w1", "shipped", 0, NOW), "api")
  ) === "a1a2"
)

check(
  "every card is still there, and only once",
  moveCard(cards, columns, "w1", "shipped", 0, NOW).length === cards.length
)

check(
  "an id naming nothing is the same list back — a drop that raced a delete",
  moveCard(cards, columns, "nope", "shipped", 0, NOW) === cards
)

section("what a move is worth")

check(
  "crossing columns is something that happened to the card",
  moveCard(cards, columns, "w1", "doing", 0, NOW).find(
    (entry) => entry.id === "w1"
  )?.updatedAt === NOW
)

check(
  "reordering within one is the board being tidied, and spends no timestamp",
  moveCard(cards, columns, "w1", "todo", 1, NOW).find(
    (entry) => entry.id === "w1"
  )?.updatedAt === EARLIER
)

section("moving a column")

check(
  "to the end",
  ids(columnsOf(moveColumn(columns, "todo", 2), "web")) === "doingshippedtodo"
)

check(
  "to the head",
  ids(columnsOf(moveColumn(columns, "shipped", 0), "web")) ===
    "shippedtododoing"
)

check(
  "an index past the end lands last",
  ids(columnsOf(moveColumn(columns, "todo", 99), "web")) === "doingshippedtodo"
)

check(
  "the other project's columns keep their places",
  ids(columnsOf(moveColumn(columns, "todo", 2), "api")) === "blocked"
)

check(
  "an id naming nothing is the same list back",
  moveColumn(columns, "nope", 0) === columns
)

check(
  "no column is lost or duplicated",
  moveColumn(columns, "todo", 2).length === columns.length
)

section("the link to a chat")

const chats: WorktreeChat[] = [
  {
    id: "chat-1",
    folderId: "web",
    title: "the orders bug",
    createdAt: EARLIER,
    updatedAt: EARLIER,
  },
]

check(
  "a chat finds the card it is the work of",
  cardOfChat(cards, "chat-1")?.id === "w3"
)

check("a chat no card names", cardOfChat(cards, "chat-9") === null)

check(
  "a card finds its chat",
  linkedChat(chats, card("x", "web", "doing", "chat-1"))?.title ===
    "the orders bug"
)

check(
  "a card whose chat has been deleted reads as unlinked, not as an error",
  linkedChat(chats, card("x", "web", "doing", "chat-gone")) === null
)

check(
  "a card that never had one",
  linkedChat(chats, card("x", "web", "todo")) === null
)

finish()
