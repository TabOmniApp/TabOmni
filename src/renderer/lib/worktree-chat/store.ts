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
  /**
   * Which chats are having their lines read off disk — the first time one is
   * opened, and only then (see `select`).
   *
   * Separate from `messages[id] === undefined`, which is also what a chat
   * nobody has opened looks like: the pane draws a welcome for an empty chat
   * and a skeleton for one still arriving, and it cannot tell those apart from
   * the lines alone.
   */
  reading: string[]
  /**
   * Which chats are working on something.
   *
   * Not "which have been sent to and not answered yet", which is what it was:
   * a chat takes a message while it is answering now, so a turn ending is not
   * the chat going quiet — the one behind it starts on its own. Main owns the
   * answer and says so with `busy`; the optimistic add in `send` is only there
   * so the spinner does not wait for the round trip.
   */
  sending: string[]
  /**
   * When each working chat started working, for the elapsed time under the
   * spinner. Kept beside `sending` rather than in the pane because the pane is
   * one instance reused across the strip: a clock local to it would restart
   * every time somebody looked at another chat and came back. Held across a
   * queued message and an `ask` too — it is how long this stretch of work has
   * been going, not how long the current turn has.
   */
  startedAt: Record<string, number>
  /**
   * How full each chat's context window is, as of its last reply.
   *
   * Live, and only for the chats a session has spoken for this run: main sends
   * it per reply rather than per turn, which is the whole point — the figure on
   * a turn's usage line is the same number an answer late. Nothing keeps it,
   * so a reloaded window falls back to the last usage line (`totalOf`) until
   * the next reply arrives.
   */
  context: Record<string, number>
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
  /** What a chat is called, in the column and on its tab. An empty name is
   * ignored — that is the field being left blank, not a chat being unnamed. */
  rename: (id: string, title: string) => void

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
  reading: [],
  drafts: {},
  sending: [],
  startedAt: {},
  context: {},
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
      set({ reading: [...get().reading, id] })
      void window.desktop
        .readWorktreeChat(id)
        .then((lines) => {
          set({ messages: { ...get().messages, [id]: lines } })
        })
        .catch((error: unknown) => {
          console.error("Could not read that chat", error)
        })
        .finally(() => {
          // In `finally` rather than beside the `set` above: a read that failed
          // leaves no lines, and a chat left marked as reading would sit under
          // a skeleton that never resolves.
          set({ reading: get().reading.filter((entry) => entry !== id) })
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

  // Written here and then to the record, like `setOptions` and for the same
  // reason: a row that only took its new name once a file had been written
  // would lag behind the Enter that gave it one.
  rename(id, title) {
    const name = title.trim()
    if (!name) return

    set({
      chats: get().chats.map((chat) =>
        chat.id === id ? { ...chat, title: name } : chat
      ),
    })

    void window.desktop.renameWorktreeChat(id, name).catch((error: unknown) => {
      console.error("Could not rename that chat", error)
    })
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

  /**
   * A message, whether or not the chat is already answering.
   *
   * The guard that used to be here — drop it if this chat is `sending` — was the
   * renderer's half of a rule the main process no longer has: a chat holds its
   * CLI open, so a second message is queued rather than refused. Enter while a
   * turn is running now does what it does in the terminal.
   */
  async send(id, prompt) {
    const text = prompt.trim()
    if (!text) return

    // Shown as sent before the turn starts: a composer that empties and then
    // shows nothing for a second reads as a message that went nowhere. This is
    // the *only* copy on screen — main writes the line down but does not
    // announce it, since a `text` event is a line of the answer and the prompt
    // drawn as one appeared twice.
    const already = get().sending.includes(id)
    set({
      sending: already ? get().sending : [...get().sending, id],
      // A message sent into a chat that is already working does not restart the
      // clock: the work has been going since the first one.
      startedAt: already
        ? get().startedAt
        : { ...get().startedAt, [id]: Date.now() },
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
        startedAt: without(get().startedAt, id),
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

      /*
       * Whether the chat is working, which is main's to say.
       *
       * Its own event because `done` is no longer the answer: a message sent
       * mid-turn is queued, and the turn that runs it starts without anything
       * arriving here to say so. Set rather than counted — the same value can
       * arrive twice.
       */
      // Where the conversation stands right now. Not a line, so nothing is
      // appended and no chat is re-read: the number simply moves.
      if (event.type === "context") {
        set({ context: { ...get().context, [chatId]: event.tokens } })
        return
      }

      if (event.type === "busy") {
        const sending = get().sending
        const has = sending.includes(chatId)
        if (event.busy === has) return
        set({
          sending: event.busy
            ? [...sending, chatId]
            : sending.filter((entry) => entry !== chatId),
          startedAt: event.busy
            ? { ...get().startedAt, [chatId]: Date.now() }
            : without(get().startedAt, chatId),
        })
        return
      }

      if (event.type === "done") {
        // A turn can end while a card is up — Stop, or a failure — and the
        // question died with the process that asked it.
        if (get().asks[chatId]) set({ asks: without(get().asks, chatId) })
        // The listing's title and order moved with the turn. Not on a failure:
        // its error line is still being written when this arrives, so the
        // listing would be re-read a beat too early. The line itself comes as
        // its own `error` event — drawing it from this one showed the failure
        // twice.
        if (!event.error) void get().refresh()
        return
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
                ? {
                    ...line,
                    result: event.result,
                    failed: event.failed,
                    ...(event.output ? { output: event.output } : {}),
                  }
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
                  input: event.input,
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
                  : event.type === "error"
                    ? {
                        id: `s${Date.now()}-${Math.random()}`,
                        role: "error",
                        text: event.text,
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

/** One project's chats, newest first. Keyed by root id, which for a chat is
 * its folder — the same key its group and its scope use. */
export function chatsOf(chats: WorktreeChat[], rootId: string): WorktreeChat[] {
  return newestFirst(chats.filter((chat) => chatRootId(chat) === rootId))
}

/**
 * The order the column lists chats in: most recently started at the top.
 *
 * By `createdAt` rather than `updatedAt` — a list ordered by activity
 * rearranges itself under the cursor while a turn is running, which is the row
 * you were reaching for moving as you click it. The file's own order is oldest
 * first, so a new chat landed at the bottom of a long project.
 */
function newestFirst(chats: WorktreeChat[]): WorktreeChat[] {
  return [...chats].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * The chats belonging to no project — what the column lists as `Ungrouped`.
 *
 * These are the records `chatRootId` reads as null: a chat written while chats
 * lived in a `git worktree` checkout holds that checkout's id, and there is
 * nowhere left to run its next turn. They were hidden for exactly that reason,
 * and hiding them was the wrong answer to it — the conversation is on disk and
 * readable, and a chat that silently stopped existing is worse than one that is
 * listed and says why when you send to it. `WorktreeChats.run` already finishes
 * such a turn with a line saying the project has gone, so the failure is
 * explained rather than mysterious.
 *
 * There is no `+` on that row and no `New chat here` on its menu: a chat needs
 * a directory to run in, and `Ungrouped` names the absence of one.
 */
export function ungroupedChats(chats: WorktreeChat[]): WorktreeChat[] {
  return newestFirst(chats.filter((chat) => chatRootId(chat) === null))
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
