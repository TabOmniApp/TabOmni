import { create } from "zustand"

import type {
  AssistantMessage,
  WorktreeChat,
  WorktreeChatAnswer,
  WorktreeChatAsk,
  WorktreeChatOptions,
} from "@shared/api"
import { useProjects } from "../projects"
import { useShells } from "../shell/store"
import { useStudio } from "../store"
import { useWorktrees } from "../worktree/store"

/**
 * The chats held in worktrees.
 *
 * A view of what `main/worktree-chat.ts` owns. The turn runs in the
 * main process, so this holds no process and no timers — only the listing, the
 * lines of whichever chats have been opened, and which chat is on screen.
 *
 * **Many** conversations at once: a worktree exists so a piece of work can run
 * in isolation, and several of them answering in parallel is the point rather
 * than an edge case. So everything here is keyed by chat id.
 */
type WorktreeChatState = {
  chats: WorktreeChat[]
  loading: boolean

  /** Lines per chat, for the chats that have been opened this run. */
  messages: Record<string, AssistantMessage[]>
  /** Which chats have a turn in flight. */
  sending: string[]
  /**
   * The question each chat is stopped on, for the chats that are.
   *
   * One per chat, not a queue: the turn is *held* while it waits, so there
   * cannot be a second one behind it. Keyed by chat rather than by ask because
   * that is how the pane looks it up — the answer names the ask, which is what
   * keeps the two from getting out of step.
   *
   * Lost on a reload, like `sending` and for the same reason: what is on the
   * other end is a process in the main process, not a record.
   */
  asks: Record<string, WorktreeChatAsk>

  /** Chats with a tab open, oldest first — the strip's membership. */
  openIds: string[]
  selectedId: string | null

  refresh: () => Promise<void>
  /** Puts a chat on screen, reading its lines the first time. */
  select: (id: string) => void
  close: (id: string) => void
  closeOthers: (id: string) => void
  closeAll: () => void
  reorder: (ids: string[]) => void

  /**
   * Opens a worktree's chat: the one it was last on, or a new one.
   *
   * What a worktree row does. Resolves once there is something on screen, so a
   * caller can await it before it moves the pane.
   */
  openWorktree: (worktreeId: string) => Promise<void>
  /** Another chat in the same checkout — the `+` in the strip. */
  create: (worktreeId: string) => Promise<void>
  remove: (id: string) => Promise<void>

  send: (id: string, prompt: string) => Promise<void>
  stop: (id: string) => void
  /**
   * Answers what a chat is waiting on, and takes the card down.
   *
   * Cleared here rather than on the `decision` event coming back: the turn
   * carries on the moment main has the answer, so a card left up until the
   * round trip completes is a card somebody can answer twice.
   */
  answer: (chatId: string, answer: WorktreeChatAnswer) => void
  /** The model, effort and permission for one chat — the composer's toolbar. */
  setOptions: (id: string, options: WorktreeChatOptions) => void

  /** Subscribes to turns. Called once from the workbench: a turn outlives the
   * pane being switched away from, and its lines have to land either way. */
  listen: () => () => void
}

export const useWorktreeChats = create<WorktreeChatState>((set, get) => ({
  chats: [],
  loading: false,
  messages: {},
  sending: [],
  asks: {},
  openIds: [],
  selectedId: null,

  async refresh() {
    set({ loading: true })
    try {
      set({ chats: await window.desktop.listWorktreeChats(), loading: false })
    } catch (error) {
      console.error("Could not read the worktree chats", error)
      set({ loading: false })
    }
  },

  select(id) {
    const { openIds, messages, chats } = get()
    const chat = chats.find((entry) => entry.id === id)
    set({
      openIds: openIds.includes(id) ? openIds : [...openIds, id],
      selectedId: id,
    })

    // The pane too, or clicking a worktree row would select a chat nothing is
    // drawing: `worktree` is not a section, so it is only ever reached from a
    // list in somebody else's sidebar, and this is the only thing that shows
    // it. Leaves the sections alone, as a session's pane does.
    useStudio.getState().showPane("worktree")

    /*
     * And the workbench works in this chat's checkout.
     *
     * Here rather than only on the worktree row that used to be the one way in.
     * A chat is now an ordinary tab in the one strip — its panel stopped
     * grouping by branch, so the strip no longer says which checkout a chat is
     * in — and switching to one left the crumb, the Explorer's root and the
     * dock's shell wherever they were. The last of those is the one that matters:
     * a chat edits its own branch with `acceptEdits`, and a terminal beside it
     * pointed at another checkout is a trap, not an inconvenience.
     *
     * This is what `useFiles.reveal` already does for a file tab, for the same
     * reason — the tree draws one checkout, so putting something from another one
     * on screen has to move that selection first.
     */
    const worktree = useWorktrees
      .getState()
      .worktrees.find((entry) => entry.id === chat?.worktreeId)
    if (worktree) {
      useProjects.getState().setActive(worktree.folderId, worktree.id)
      useShells.getState().showFor(worktree.folderId, worktree.id)
    }

    // Read once per run. The main process holds the lines and appends to them,
    // so a re-read on every tab switch would be a file read for an answer we
    // already have.
    if (!messages[id]) {
      void window.desktop
        .readWorktreeChat(id)
        .then((lines) => {
          set({ messages: { ...get().messages, [id]: lines } })
        })
        .catch((error: unknown) => {
          console.error("Could not read that chat", error)
        })
    }
  },

  close(id) {
    const openIds = get().openIds.filter((entry) => entry !== id)
    set({
      openIds,
      // The one to its right, as an editor does — falling back to the left when
      // it was last.
      selectedId:
        get().selectedId === id ? (openIds.at(-1) ?? null) : get().selectedId,
    })
  },

  closeOthers(id) {
    set({ openIds: [id], selectedId: id })
  },

  closeAll() {
    set({ openIds: [], selectedId: null })
  },

  reorder(ids) {
    // Only ids already open are kept, so a stale list can shuffle the tabs but
    // never conjure or drop one.
    const open = new Set(get().openIds)
    set({ openIds: ids.filter((id) => open.has(id)) })
  },

  async openWorktree(worktreeId) {
    if (get().chats.length === 0) await get().refresh()

    const own = get().chats.filter((chat) => chat.worktreeId === worktreeId)
    // The most recently touched, which is where somebody left off.
    const last = [...own].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    )[0]

    if (last) {
      get().select(last.id)
      return
    }
    await get().create(worktreeId)
  },

  async create(worktreeId) {
    try {
      const chat = await window.desktop.createWorktreeChat(worktreeId)
      set({
        chats: [...get().chats, chat],
        messages: { ...get().messages, [chat.id]: [] },
      })
      get().select(chat.id)
    } catch (error) {
      console.error("Could not start a chat", error)
    }
  },

  async remove(id) {
    await window.desktop.deleteWorktreeChat(id).catch((error: unknown) => {
      console.error("Could not delete that chat", error)
    })

    const { messages } = get()
    const rest = { ...messages }
    delete rest[id]
    set({ chats: get().chats.filter((chat) => chat.id !== id), messages: rest })
    get().close(id)
  },

  async send(id, prompt) {
    const text = prompt.trim()
    if (!text || get().sending.includes(id)) return

    // Shown as sent before the turn starts: a composer that empties and then
    // shows nothing for a second reads as a message that went nowhere. This is
    // the *only* copy on screen — main writes the line down but does not
    // announce it, since a `text` event is a line of the answer and the prompt
    // drawn as one appeared twice.
    set({
      sending: [...get().sending, id],
      messages: {
        ...get().messages,
        [id]: [
          ...(get().messages[id] ?? []),
          { id: `local-${Date.now()}`, role: "user", text },
        ],
      },
    })

    try {
      await window.desktop.sendWorktreeChat(id, text)
    } catch (error) {
      set({
        sending: get().sending.filter((entry) => entry !== id),
        messages: {
          ...get().messages,
          [id]: [
            ...(get().messages[id] ?? []),
            {
              id: `local-error-${Date.now()}`,
              role: "error",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        },
      })
    }
  },

  stop(id) {
    void window.desktop.stopWorktreeChat(id).catch((error: unknown) => {
      console.error("Could not stop that turn", error)
    })
  },

  answer(chatId, answer) {
    const ask = get().asks[chatId]
    if (!ask) return

    set({ asks: without(get().asks, chatId) })

    void window.desktop
      .answerWorktreeChatAsk(ask.id, answer)
      .catch((error: unknown) => {
        console.error("Could not answer that request", error)
      })
  },

  /**
   * Written here and then to the record, rather than waiting on the write.
   *
   * A picker that only moved once a file had been written would lag behind the
   * click that moved it. The failure it trades against is a choice that does not
   * outlive the launch, which is the smaller of the two — and `refresh` reads the
   * record back after every turn, so a write that failed shows up as the control
   * springing back rather than as a chat quietly running on something else.
   */
  setOptions(id, options) {
    set({
      chats: get().chats.map((chat) =>
        chat.id === id ? { ...chat, options } : chat
      ),
    })

    void window.desktop
      .setWorktreeChatOptions(id, options)
      .catch((error: unknown) => {
        console.error("Could not save that chat's options", error)
      })
  },

  listen() {
    return window.desktop.onWorktreeChatEvent((event) => {
      const { chatId } = event

      // The turn has stopped on something. Nothing else arrives for this chat
      // until it is answered, so there is no ordering to worry about here.
      if (event.type === "ask") {
        set({ asks: { ...get().asks, [chatId]: event.ask } })
        return
      }

      if (event.type === "done") {
        set({ sending: get().sending.filter((entry) => entry !== chatId) })
        // A turn can end while a card is up — Stop, or a failure — and the
        // question died with the process that asked it.
        if (get().asks[chatId]) set({ asks: without(get().asks, chatId) })
        if (!event.error) {
          // The listing's title and order moved with the turn.
          void get().refresh()
          return
        }
      }

      const line: AssistantMessage | null =
        event.type === "text"
          ? {
              id: `s${Date.now()}-${Math.random()}`,
              role: "assistant",
              text: event.text,
            }
          : event.type === "tool"
            ? {
                id: `s${Date.now()}-${Math.random()}`,
                role: "tool",
                name: event.name,
                summary: event.summary,
              }
            : event.type === "decision"
              ? {
                  id: `s${Date.now()}-${Math.random()}`,
                  role: "ask",
                  text: event.text,
                }
              : event.error
                ? {
                    id: `s${Date.now()}-${Math.random()}`,
                    role: "error",
                    text: event.error,
                  }
                : null

      if (!line) return
      set({
        messages: {
          ...get().messages,
          [chatId]: [...(get().messages[chatId] ?? []), line],
        },
      })
    })
  },
}))

/** One worktree's chats, oldest first — the strip inside its tab. */
export function chatsOf(
  chats: WorktreeChat[],
  worktreeId: string
): WorktreeChat[] {
  return chats.filter((chat) => chat.worktreeId === worktreeId)
}

/** One key dropped from a record. Written out because the destructuring form
 * leaves a binding nothing reads, which is a lint error here. */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const rest = { ...record }
  delete rest[key]
  return rest
}
