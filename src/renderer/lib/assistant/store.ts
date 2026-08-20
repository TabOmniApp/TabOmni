import { create } from "zustand"

import type {
  AssistantChat,
  AssistantEvent,
  AssistantMessage,
} from "@shared/api"

/**
 * The workspace assistant, as the panel sees it.
 *
 * The conversation itself is the main process's — `claude -p` per turn, one
 * session id across them, and the lines written to `chats/<id>.json`
 * (`main/assistant.ts`) — so what is here is the chat on screen and which of the
 * two things the panel is showing. That split is deliberate: a turn takes as
 * long as it takes, and closing the panel or reloading the window must not end
 * it or lose the thread.
 *
 * **The list is what opens**, unless there is nothing in it yet — a panel that
 * always opened onto a fresh composer would bury yesterday's conversation
 * behind a button, and a panel that always opened onto an empty list would put
 * a list of nothing in front of somebody's first question.
 */

export type { AssistantMessage } from "@shared/api"

/** Which of the panel's two screens is showing. */
export type AssistantView = "list" | "chat"

type AssistantState = {
  /** Whether the panel is on screen at all. The button in the title bar is the
   * only way in, so this is the whole of its state. */
  open: boolean
  view: AssistantView
  chats: AssistantChat[]
  /** The chat on screen, or null for one that has not been started — a
   * composer with nothing above it. */
  chatId: string | null
  messages: AssistantMessage[]
  /** A turn is in flight: Send has become Stop, and another chat cannot be
   * opened underneath the answer. */
  sending: boolean

  toggle: () => void
  /** Reads the list and shows it — or goes straight to a new chat when there
   * is nothing to list. */
  showList: () => Promise<void>
  openChat: (id: string) => Promise<void>
  newChat: () => Promise<void>
  deleteChat: (id: string) => Promise<void>
  send: (prompt: string) => Promise<void>
  stop: () => Promise<void>
  /** Subscribes to the main process's events. Called once, at launch. */
  listen: () => () => void
}

let nextId = 0
const id = () => `r${(nextId += 1)}`

export const useAssistant = create<AssistantState>((set, get) => ({
  open: false,
  view: "list",
  chats: [],
  chatId: null,
  messages: [],
  sending: false,

  toggle() {
    const opening = !get().open
    set({ open: opening })
    // The list is read on the way in rather than kept fresh while the panel is
    // shut: a chat can only change from in here, so what was read last time is
    // still right until the panel is opened again.
    if (opening) void get().showList()
  },

  async showList() {
    const chats = await window.desktop.assistantChats().catch(() => [])

    // Mid-turn, the answer being written is what the panel should be showing;
    // the list can wait until it has landed.
    if (get().sending) {
      set({ chats })
      return
    }

    if (chats.length === 0) {
      set({ chats, view: "chat", chatId: null, messages: [] })
      await window.desktop.assistantNew().catch(() => {})
      return
    }
    set({ chats, view: "list" })
  },

  async openChat(chatId) {
    if (get().sending) return
    const messages = await window.desktop.assistantOpen(chatId)
    set({ chatId, messages, view: "chat" })
  },

  async newChat() {
    if (get().sending) return
    await window.desktop.assistantNew()
    set({ chatId: null, messages: [], view: "chat" })
  },

  async deleteChat(chatId) {
    if (get().sending) return
    const chats = await window.desktop.assistantDelete(chatId)

    set({
      chats,
      // Deleting the chat on screen leaves nothing to show it, so the panel
      // goes back to the list — or to a fresh composer, when that was the last
      // chat there was.
      ...(get().chatId === chatId
        ? {
            chatId: null,
            messages: [],
            view: chats.length > 0 ? ("list" as const) : ("chat" as const),
          }
        : {}),
    })
  },

  async send(prompt) {
    const text = prompt.trim()
    if (!text || get().sending) return

    set((state) => ({
      view: "chat",
      sending: true,
      messages: [...state.messages, { id: id(), role: "user", text }],
    }))

    try {
      await window.desktop.assistantSend(text)
    } catch (error) {
      // A refused send never produces a `done`, so the turn has to be ended
      // here or the composer waits forever.
      set((state) => ({
        sending: false,
        messages: [
          ...state.messages,
          {
            id: id(),
            role: "error",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      }))
    }
  },

  async stop() {
    await window.desktop.assistantStop()
  },

  listen() {
    return window.desktop.onAssistantEvent((event: AssistantEvent) => {
      if (event.type === "text") {
        set((state) => ({
          messages: [
            ...state.messages,
            { id: id(), role: "assistant", text: event.text },
          ],
        }))
        return
      }

      if (event.type === "tool") {
        set((state) => ({
          messages: [
            ...state.messages,
            {
              id: id(),
              role: "tool",
              name: event.name,
              summary: event.summary,
            },
          ],
        }))
        return
      }

      set((state) => ({
        sending: false,
        messages: event.error
          ? [...state.messages, { id: id(), role: "error", text: event.error }]
          : state.messages,
      }))

      // The turn is what gave this chat its title and its place at the top of
      // the list, and a first turn is what gave it a row at all.
      void window.desktop
        .assistantChats()
        .then((chats) => {
          set((state) => ({
            chats,
            // A chat started from the composer has no id here until now: the
            // main process minted one, and it is the newest row.
            chatId: state.chatId ?? chats[0]?.id ?? null,
          }))
        })
        .catch(() => {})
    })
  },
}))

/**
 * A tool's name as the panel says it.
 *
 * The CLI names an MCP tool `mcp__tabomni-database__query`, which is precise
 * and unreadable; what a row wants is the panel it came from and what it did.
 */
export function toolLabel(name: string): string {
  const mcp = /^mcp__tabomni-([a-z]+)__(.+)$/.exec(name)
  if (!mcp) return name
  return `${mcp[1]} · ${mcp[2]!.replaceAll("_", " ")}`
}
