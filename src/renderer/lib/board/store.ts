import { create } from "zustand"

import type { BoardCard, BoardColumn, BoardTone } from "@shared/api"
import { useProjects } from "../projects"
import { useStudio } from "../store"
import { useWorktreeChats, placeOfRoot } from "../worktree-chat/store"
// Aliased: the store's own action is called `moveColumn` too, and a method body
// calling the module-scope function of its own name reads like recursion.
import { columnsOf, moveCard, moveColumn as shiftColumn } from "./cards"

/**
 * A project's kanban board: what is next, what is running, what is done.
 *
 * **One tab per project, and the tab's id *is* the project's**, which is the
 * shape `lib/files/changes.ts` has — see `rootOf` in `lib/panels.ts`, which is
 * the identity function for both. A board is about one repository, so there is
 * nothing for a second tab of it to be about.
 *
 * The cards are the **whole workspace's** in one list, read once at launch:
 * the strip has to know how many cards a project has waiting before its board
 * has ever been opened, and the list is short enough that a call per project
 * would be more code and more reads for the same answer. Order within the list
 * is order within a column — `moveCard` in `cards.ts` is the one place that
 * knows it.
 *
 * Nothing here is remembered across launches, unlike the notes' tabs and like
 * the `Changes` tab this copies: a board tab is opened from the project it
 * belongs to in one click, and restoring one would be restoring a tab for every
 * project somebody glanced at.
 *
 * The link to a chat is **this side's only**. A card names a chat; the chat
 * knows nothing, and `cardOfChat` is how its header finds the card. So deleting
 * a chat needs no write here — see `linkedChat`.
 */
type BoardState = {
  /** Every project's cards, in the file's order. */
  cards: BoardCard[]
  /**
   * Every project's columns, in the file's order, which is left to right.
   *
   * Empty for a project that has never had a board opened — `columnsOf` in
   * `cards.ts` seeds the three defaults for the read, and `open` writes them.
   */
  columns: BoardColumn[]
  loaded: boolean

  /** Projects with a board tab open, oldest first — the strip's membership.
   * Ids here are folder ids, which are the tab ids. */
  openIds: string[]
  selectedId: string | null

  refresh: () => Promise<void>

  /** Opens a project's board and puts it on screen. */
  open: (folderId: string) => void
  select: (folderId: string) => void
  close: (folderId: string) => void
  closeOthers: (folderId: string) => void
  closeAll: () => void
  reorder: (ids: string[]) => void

  /**
   * A new card at the foot of a column.
   *
   * Takes the text it is created with rather than a blank to be renamed: the
   * card is written to disk here, and the dialog that collects the text has a
   * Cancel button — so nothing exists until that dialog is submitted. See
   * `CardDialog`.
   */
  add: (
    folderId: string,
    columnId: string,
    fields: { title: string; body: string }
  ) => void
  edit: (id: string, fields: { title?: string; body?: string }) => void
  /** Where a drop lands — see `moveCard`, which is the whole of the logic. */
  move: (id: string, columnId: string, index: number) => void
  remove: (id: string) => void

  /** A new column at the right-hand end of a project's board. */
  addColumn: (folderId: string, name: string) => void
  renameColumn: (id: string, name: string) => void
  setColumnTone: (id: string, tone: BoardTone) => void
  /**
   * Removes a column, and **leaves its cards where they are**.
   *
   * Nothing rewrites the cards: a delete that silently moved eight of them into
   * another column would be a delete that lost track of work. A card whose
   * column has gone is drawn in the first one instead — `columnOf` in `cards.ts`
   * is that rule, and the menu item says so before it is picked.
   */
  removeColumn: (id: string) => void
  /** Where a dragged column lands — see `moveColumn`. */
  moveColumn: (id: string, index: number) => void

  /** Points a card at a chat that already exists. */
  link: (id: string, chatId: string) => void
  unlink: (id: string) => void
  /**
   * Starts a chat in the card's project and links it.
   *
   * The card's title and body go in as the composer's **draft** rather than as
   * a message — `create` in `lib/worktree-chat/store.ts` already takes one — so
   * the first turn is still the user's to phrase and to read before it runs. A
   * card that sent itself would be a board that starts agents.
   */
  startChat: (id: string) => Promise<void>
}

const now = () => new Date().toISOString()

export const useBoard = create<BoardState>((set, get) => {
  function persist(cards: BoardCard[]) {
    void window.desktop.saveBoardCards(cards).catch((error) => {
      console.error("Could not save the board", error)
    })
  }

  /** Applies a change to the list and writes it. Every change here is
   * structural — a card added, edited, moved, deleted — so there is nothing
   * to debounce, unlike a note's body. */
  function commit(cards: BoardCard[]) {
    set({ cards })
    persist(cards)
  }

  function commitColumns(columns: BoardColumn[]) {
    set({ columns })
    void window.desktop.saveBoardColumns(columns).catch((error) => {
      console.error("Could not save the board's columns", error)
    })
  }

  /**
   * Writes down the three default columns for a project that has none.
   *
   * On `open`, so that the columns a board is drawing are records that exist —
   * `columnsOf` seeds the same three for the read, and a board whose columns
   * were only ever derived would have nothing for `renameColumn` to name. Once
   * per project, ever.
   */
  function seedColumns(folderId: string) {
    const { columns } = get()
    if (columns.some((column) => column.folderId === folderId)) return
    commitColumns([...columns, ...columnsOf(columns, folderId, now())])
  }

  return {
    cards: [],
    columns: [],
    loaded: false,
    openIds: [],
    selectedId: null,

    async refresh() {
      const [cards, columns] = await Promise.all([
        window.desktop.listBoardCards().catch((error) => {
          console.error("Could not read the board", error)
          return [] as BoardCard[]
        }),
        window.desktop.listBoardColumns().catch((error) => {
          console.error("Could not read the board's columns", error)
          return [] as BoardColumn[]
        }),
      ])
      set({ cards, columns, loaded: true })
    },

    open(folderId) {
      seedColumns(folderId)
      get().select(folderId)
    },

    select(folderId) {
      const { openIds } = get()
      set({
        openIds: openIds.includes(folderId) ? openIds : [...openIds, folderId],
        selectedId: folderId,
      })

      // The pane, or the tab would be selected with nothing drawing it: this
      // pane is not a section, so nothing else shows it. The move `changes`
      // and a chat both make.
      useStudio.getState().showPane("board")

      // And the workbench works in this project, because the tab is scoped to
      // its root (`rootOf` in `lib/panels.ts`) and would otherwise be selected
      // and out of scope in the same breath.
      if (
        useStudio.getState().folders.some((folder) => folder.id === folderId)
      ) {
        useProjects.getState().setActive(folderId)
      }
    },

    close(folderId) {
      const openIds = get().openIds.filter((entry) => entry !== folderId)
      set({
        openIds,
        selectedId:
          get().selectedId === folderId
            ? (openIds.at(-1) ?? null)
            : get().selectedId,
      })
    },

    closeOthers(folderId) {
      set({ openIds: [folderId], selectedId: folderId })
    },

    closeAll() {
      set({ openIds: [], selectedId: null })
    },

    reorder(ids) {
      set({ openIds: ids })
    },

    add(folderId, columnId, fields) {
      const card: BoardCard = {
        id: crypto.randomUUID(),
        folderId,
        column: columnId,
        title: fields.title,
        body: fields.body,
        chatId: null,
        createdAt: now(),
        updatedAt: now(),
      }
      // At the end of the list, which is the foot of its column: a card added
      // is the newest thing to do, not the next.
      commit([...get().cards, card])
    },

    edit(id, fields) {
      commit(
        get().cards.map((card) =>
          card.id === id ? { ...card, ...fields, updatedAt: now() } : card
        )
      )
    },

    move(id, columnId, index) {
      const next = moveCard(
        get().cards,
        get().columns,
        id,
        columnId,
        index,
        now()
      )
      // Referentially the same list for a drop that moved nothing — a card let
      // go where it was picked up, or one deleted mid-drag.
      if (next === get().cards) return
      commit(next)
    },

    remove(id) {
      commit(get().cards.filter((card) => card.id !== id))
    },

    addColumn(folderId, name) {
      const named = name.trim()
      if (!named) return
      // At the end of the list, which is the right-hand end of the board: a
      // stage added is one the work has not reached yet.
      commitColumns([
        ...get().columns,
        {
          id: crypto.randomUUID(),
          folderId,
          name: named,
          // The neutral. A column's hue is worth choosing and not worth being
          // assigned at random, which is what cycling a palette would be.
          tone: "slate",
          createdAt: now(),
          updatedAt: now(),
        },
      ])
    },

    renameColumn(id, name) {
      const named = name.trim()
      // An empty name is ignored rather than blanking the column — the rule a
      // chat's rename follows.
      if (!named) return
      commitColumns(
        get().columns.map((column) =>
          column.id === id
            ? { ...column, name: named, updatedAt: now() }
            : column
        )
      )
    },

    setColumnTone(id, tone) {
      commitColumns(
        get().columns.map((column) =>
          column.id === id ? { ...column, tone, updatedAt: now() } : column
        )
      )
    },

    removeColumn(id) {
      const { columns } = get()
      const going = columns.find((column) => column.id === id)
      if (!going) return
      // Not the last one standing: a board with no columns has nowhere to draw
      // its cards and nowhere to put the button that would add a column back.
      const own = columns.filter((column) => column.folderId === going.folderId)
      if (own.length <= 1) return
      commitColumns(columns.filter((column) => column.id !== id))
    },

    moveColumn(id, index) {
      const next = shiftColumn(get().columns, id, index)
      if (next === get().columns) return
      commitColumns(next)
    },

    link(id, chatId) {
      commit(
        get().cards.map((card) =>
          card.id === id ? { ...card, chatId, updatedAt: now() } : card
        )
      )
    },

    unlink(id) {
      commit(
        get().cards.map((card) =>
          card.id === id ? { ...card, chatId: null, updatedAt: now() } : card
        )
      )
    },

    async startChat(id) {
      const card = get().cards.find((entry) => entry.id === id)
      if (!card) return

      const { folders } = useStudio.getState()
      const place = placeOfRoot(card.folderId, folders)
      // A card whose project has left the workspace has nowhere for a turn to
      // run. Said by the card rather than guessed at here — the same rule a
      // chat's own cwd resolve follows.
      if (!place) return

      const draft = card.body ? `${card.title}\n\n${card.body}` : card.title
      const chatId = await useWorktreeChats.getState().create(place, draft)
      if (!chatId) return
      get().link(id, chatId)
    },
  }
})
