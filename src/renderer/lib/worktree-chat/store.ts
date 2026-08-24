import { create } from "zustand"

import {
  chatRootId,
  type AssistantMessage,
  type ChatPlace,
  type WorktreeChat,
  type WorktreeChatAnswer,
  type WorktreeChatAsk,
  type WorkspaceFolder,
  type WorktreeChatOptions,
} from "@shared/api"
import { useProjects } from "../projects"
import { useShells } from "../shell/store"
import { useStudio } from "../store"

/**
 * The chats held in the workspace's projects.
 *
 * A view of what `main/worktree-chat.ts` owns. The turn runs in the
 * main process, so this holds no process and no timers — only the listing, the
 * lines of whichever chats have been opened, and which chat is on screen.
 *
 * **Many** conversations at once: several chats answering in parallel is the
 * point rather than an edge case — a question about one project while another
 * is being refactored. So everything here is keyed by chat id.
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
   * What is typed into a chat's composer and not yet sent, by chat id.
   *
   * **Per chat, which it was not.** The composer held one local draft and the
   * pane was never keyed, so a half-written message followed you into the next
   * chat you clicked and sat under its own field — one draft shared by every
   * conversation. Here it belongs to the chat it was written in: switching tabs
   * and coming back finds it, and switching away does not carry it.
   *
   * It is also how a message can be written *for* somebody: the `Changes` pane's
   * `Ask AI to fix` opens a chat with the whole review already in the field and
   * unsent, so the last word is still the reader's — a prompt assembled by a
   * button is exactly the kind that wants a sentence added before it goes. Which
   * is why `create` takes one and writes it in the same `set` as the chat: the
   * composer reads this as its initial value, and a draft arriving a render
   * later would arrive after the field had been built empty.
   */
  drafts: Record<string, string>
  /** Keeps what is in a field — the composer on its way out. Empty text forgets
   * the entry rather than storing one. */
  keepDraft: (chatId: string, text: string) => void
  /** Forgets one, so a field rebuilt later comes up empty rather than repeating
   * a message that has already been sent. */
  clearDraft: (chatId: string) => void

  /**
   * Another chat in the same place — the `+` in the strip.
   *
   * `draft` is text for its composer rather than a message: it is put in the
   * field, not sent. Resolves to the new chat's id, or null if it could not be
   * started — a caller that has something to *say* in it needs to name it, and
   * reading `selectedId` back would be a guess at whether this call is what put
   * it there.
   */
  create: (place: ChatPlace, draft?: string) => Promise<string | null>
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
  drafts: {},
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

    // The pane too, or clicking a chat row would select a chat nothing is
    // drawing: `worktree` is not a section, so it is only ever reached from a
    // list in somebody else's sidebar, and this is the only thing that shows
    // it. Leaves the sections alone, as a session's pane does.
    useStudio.getState().showPane("worktree")

    /*
     * And the workbench works in this chat's project.
     *
     * Here rather than only on the row in the left column that used to be the
     * one way in: a chat is an ordinary tab in the strip, and switching to one
     * left the crumb, the Explorer's root and the dock's shell wherever they
     * were. The last of those is the one that matters — a chat edits its
     * project with `acceptEdits`, and a terminal beside it pointed at another
     * project is a trap, not an inconvenience.
     *
     * This is what `useFiles.reveal` already does for a file tab, for the same
     * reason — the tree draws one project, so putting something from another
     * one on screen has to move that selection first.
     */
    const place = chat ? placeOf(chat) : null
    if (place) {
      useProjects.getState().setActive(place.folderId)
      useShells.getState().showFor(place.folderId)
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

  async create(place, draft) {
    try {
      const chat = await window.desktop.createWorktreeChat(place)
      set({
        chats: [...get().chats, chat],
        messages: { ...get().messages, [chat.id]: [] },
        // In the same write as the chat: the composer takes this as its initial
        // value, and one landing a render later would land after the field had
        // been built empty.
        drafts: draft ? { ...get().drafts, [chat.id]: draft } : get().drafts,
      })
      get().select(chat.id)
      return chat.id
    } catch (error) {
      console.error("Could not start a chat", error)
      return null
    }
  },

  keepDraft(chatId, text) {
    if (!text) {
      get().clearDraft(chatId)
      return
    }
    if (get().drafts[chatId] === text) return
    set({ drafts: { ...get().drafts, [chatId]: text } })
  },

  clearDraft(chatId) {
    if (get().drafts[chatId] === undefined) return
    set({ drafts: without(get().drafts, chatId) })
  },

  async remove(id) {
    await window.desktop.deleteWorktreeChat(id).catch((error: unknown) => {
      console.error("Could not delete that chat", error)
    })

    const { messages } = get()
    const rest = { ...messages }
    delete rest[id]
    set({
      chats: get().chats.filter((chat) => chat.id !== id),
      messages: rest,
      drafts: without(get().drafts, id),
    })
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

      /*
       * The one event that changes a line instead of adding one.
       *
       * Matched on `toolId` rather than on position, because several calls can
       * be outstanding at once and they come back in whatever order the tools
       * finish in. A `toolId` no line carries is dropped: that is the result of
       * a call whose row was written by a build that had no ids.
       */
      if (event.type === "tool-result") {
        const held = get().messages[chatId]
        if (!held) return
        set({
          messages: {
            ...get().messages,
            [chatId]: held.map((line) =>
              line.role === "tool" && line.toolId === event.toolId
                ? { ...line, result: event.result, failed: event.failed }
                : line
            ),
          },
        })
        return
      }

      const line: AssistantMessage | null =
        event.type === "text"
          ? {
              id: `s${Date.now()}-${Math.random()}`,
              role: "assistant",
              text: event.text,
            }
          : event.type === "thinking"
            ? {
                id: `s${Date.now()}-${Math.random()}`,
                role: "thinking",
                text: event.text,
              }
            : event.type === "tool"
              ? {
                  id: `s${Date.now()}-${Math.random()}`,
                  role: "tool",
                  name: event.name,
                  summary: event.summary,
                  toolId: event.toolId,
                  title: event.title,
                  path: event.path,
                  stat: event.stat,
                  change: event.change,
                }
              : event.type === "usage"
                ? {
                    id: `s${Date.now()}-${Math.random()}`,
                    role: "usage",
                    usage: event.usage,
                  }
                : event.type === "decision"
                  ? {
                      id: `s${Date.now()}-${Math.random()}`,
                      role: "ask",
                      text: event.text,
                    }
                  : event.type === "done" && event.error
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

/** One project's chats, oldest first. Keyed by root id, which for a chat is
 * its folder — the same key its group and its scope use. */
export function chatsOf(chats: WorktreeChat[], rootId: string): WorktreeChat[] {
  return chats.filter((chat) => chatRootId(chat) === rootId)
}

/**
 * The place a record names.
 *
 * Null for a record naming none — a chat written while chats lived in a
 * `git worktree` checkout has only that checkout's id, and there is nowhere
 * left to run its next turn. Its lines are still on disk and still readable.
 */
export function placeOf(chat: WorktreeChat): ChatPlace | null {
  const rootId = chatRootId(chat)
  return rootId ? { folderId: rootId } : null
}

/** The place a root id names, for the callers that have only the id: the `+` at
 * the end of a group's strip, and `New chat` on a row. */
export function placeOfRoot(
  rootId: string,
  folders: WorkspaceFolder[]
): ChatPlace | null {
  const folder = folders.find((entry) => entry.id === rootId)
  return folder ? { folderId: folder.id } : null
}

/** One key dropped from a record. Written out because the destructuring form
 * leaves a binding nothing reads, which is a lint error here. */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const rest = { ...record }
  delete rest[key]
  return rest
}
