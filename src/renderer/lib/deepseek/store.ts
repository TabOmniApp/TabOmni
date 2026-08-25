import { create } from "zustand"

import type { DshStatus } from "@shared/api"
import { useProjects } from "../projects"
import { useStudio } from "../store"

/**
 * The DeepSeek Harness chat — one conversation with a running `dsh web`.
 *
 * The gateway owns the session; this holds only the tab state, the current
 * session id, the lines on screen and whether a turn is in flight, in the same
 * shape as `worktree-chat/store.ts`. One conversation at a time, deliberately:
 * the tab is a singleton, and a second one would need the session picker this
 * first cut does not have.
 */

/** The singleton tab's own id — prefixed `ds:` in the strip. */
export const DEEPSEEK_TAB_ID = "deepseek"

/** One line of the conversation. */
export type DeepSeekMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; streaming: boolean }
  | { role: "error"; text: string }

type DeepSeekState = {
  /** Tab membership, for the strip — one id, or none. */
  openIds: string[]
  selectedId: string | null

  /** The gateway's answer to `dshStatus`, or null before the first probe. */
  status: DshStatus | null
  /** The gateway session the conversation is in; created on first send. */
  sessionId: string | null
  sending: boolean
  messages: DeepSeekMessage[]
  /** Whether the event stream is open right now. The stream lives for the
   * whole run once opened, so a turn's frames always have a socket to arrive
   * on — and so sending a message never has to restart it mid-flight. */
  streamOpen: boolean

  /** Opens the tab and brings the pane on screen. */
  open: () => void
  select: (id: string) => void
  close: (id: string) => void
  closeOthers: (id: string) => void
  closeAll: () => void
  reorder: (ids: string[]) => void

  refreshStatus: () => Promise<void>
  /** Drops the current session and conversation; the next send starts a new one. */
  newSession: () => void
  send: (text: string) => Promise<void>
  stop: () => void
  /** Subscribes to the gateway's event stream. Called once from the workbench,
   * because a turn outlives the pane being switched away from. */
  listen: () => () => void
}

export const useDeepseekChats = create<DeepSeekState>((set, get) => ({
  openIds: [],
  selectedId: null,

  status: null,
  sessionId: null,
  sending: false,
  messages: [],
  streamOpen: false,

  open() {
    set({ openIds: [DEEPSEEK_TAB_ID], selectedId: DEEPSEEK_TAB_ID })
    useStudio.getState().showPane("deepseek")
    void get().refreshStatus()
    // The stream opens with the tab, so a prompt typed into it has a live
    // socket already. Fire-and-forget: `send` retries it when it failed.
    void window.desktop
      .dshEventsStart()
      .then(() => set({ streamOpen: true }))
      .catch(() => set({ streamOpen: false }))
  },

  select(id) {
    if (id !== DEEPSEEK_TAB_ID) return
    set({
      openIds: get().openIds.includes(id)
        ? get().openIds
        : [...get().openIds, id],
      selectedId: id,
    })
    useStudio.getState().showPane("deepseek")
  },

  close(id) {
    if (id !== DEEPSEEK_TAB_ID) return
    set({ openIds: [], selectedId: null })
  },

  closeOthers(id) {
    set({ openIds: [id], selectedId: id })
  },

  closeAll() {
    set({ openIds: [], selectedId: null })
  },

  reorder(ids) {
    const open = new Set(get().openIds)
    set({ openIds: ids.filter((id) => open.has(id)) })
  },

  async refreshStatus() {
    try {
      set({ status: await window.desktop.dshStatus() })
    } catch (error) {
      set({
        status: {
          reachable: false,
          baseUrl: get().status?.baseUrl ?? "",
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  },

  newSession() {
    if (get().sending) return
    set({ sessionId: null, messages: [] })
  },

  async send(text) {
    const prompt = text.trim()
    if (!prompt || get().sending) return

    // A session is created on the first send, in the project being worked in —
    // the same "this project" the worktree chat uses — so the turn runs where
    // the rest of the studio is looking. With no active project the gateway's
    // own cwd (where it was started) is the fallback.
    let sessionId = get().sessionId
    if (!sessionId) {
      const activeFolderId = useProjects.getState().activeFolderId
      const folder = useStudio
        .getState()
        .folders.find((entry) => entry.id === activeFolderId)
      try {
        sessionId = await window.desktop.dshCreateSession(
          folder ? { cwd: folder.path } : {}
        )
      } catch (error) {
        set({
          messages: [
            ...get().messages,
            {
              role: "error",
              text: `Could not start a DeepSeek session: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        })
        return
      }
      set({ sessionId })
    }

    // Shown as sent before the gateway accepts it, like a worktree chat's
    // prompt — a composer that empties and shows nothing for a second reads as
    // a message that went nowhere.
    set({
      sending: true,
      messages: [...get().messages, { role: "user", text: prompt }],
    })

    try {
      // The gateway pushes events only while a client is listening, so a turn
      // must never start with the stream down. It is opened once and kept, so
      // this is the retry after it died — never a restart of a live one.
      if (!get().streamOpen) {
        await window.desktop.dshEventsStart()
        set({ streamOpen: true })
      }
      await window.desktop.dshSendPrompt({ sessionId, text: prompt })
    } catch (error) {
      set({
        sending: false,
        messages: [
          ...get().messages,
          {
            role: "error",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      })
    }
  },

  stop() {
    const sessionId = get().sessionId
    if (!sessionId || !get().sending) return
    set({ sending: false })
    void window.desktop.dshCancel(sessionId).catch((error: unknown) => {
      console.error("Could not stop the DeepSeek turn", error)
    })
  },

  listen() {
    return window.desktop.onDshEvent((event) => {
      if (event.kind === "error") {
        // The stream died — a gateway restart, or one that was never
        // reachable. Mark it closed so the next send reopens it; only say so
        // when a turn was waiting on it.
        set({ streamOpen: false })
        if (!get().sending) return
        set({
          sending: false,
          messages: [...get().messages, { role: "error", text: event.message }],
        })
        return
      }

      if (event.kind === "end") {
        // A stream that closes mid-turn has lost the rest of it. The next
        // send reopens it; nothing else needs saying when no turn was waiting.
        set({ streamOpen: false })
        if (!get().sending) return
        set({
          sending: false,
          messages: [
            ...get().messages,
            {
              role: "error",
              text: "The event stream closed while the turn was running.",
            },
          ],
        })
        return
      }

      if (event.sessionId !== get().sessionId) return

      const type = event.event.type
      const data = event.event.data

      if (type === "assistant/chunk") {
        const text = chunkText(data)
        if (text === null) return
        set({ messages: appendAssistant(get().messages, text) })
        return
      }

      if (type === "assistant/message") {
        set({ messages: finalizeAssistant(get().messages, messageText(data)) })
        return
      }

      if (type === "turn/end") {
        set({ sending: false })
      }
    })
  },
}))

/** The text carried by one `assistant/chunk`, or null when the chunk is not a
 * text block (a usage/finish/boundary chunk). The gateway streams text as
 * `text-delta` chunks. */
function chunkText(data: unknown): string | null {
  const chunk = (data as { chunk?: { type?: unknown; text?: unknown } }).chunk
  if (chunk?.type !== "text-delta") return null
  return typeof chunk.text === "string" ? chunk.text : null
}

/** The full text of a final `assistant/message`, joined across its text blocks. */
function messageText(data: unknown): string {
  const message = (data as { message?: { content?: unknown } }).message
  if (!Array.isArray(message?.content)) return ""
  return message.content
    .filter(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text"
    )
    .map((block) => (block as { text?: unknown }).text ?? "")
    .join("")
}

/** Appends one chunk to the streaming assistant line, or opens it. */
function appendAssistant(
  messages: DeepSeekMessage[],
  text: string
): DeepSeekMessage[] {
  const last = messages.at(-1)
  if (last?.role === "assistant" && last.streaming) {
    return [
      ...messages.slice(0, -1),
      { role: "assistant", text: last.text + text, streaming: true },
    ]
  }
  return [...messages, { role: "assistant", text, streaming: true }]
}

/** Settles the streaming line with the final message's complete text. */
function finalizeAssistant(
  messages: DeepSeekMessage[],
  text: string
): DeepSeekMessage[] {
  const last = messages.at(-1)
  if (last?.role === "assistant") {
    return [
      ...messages.slice(0, -1),
      { role: "assistant", text, streaming: false },
    ]
  }
  return [...messages, { role: "assistant", text, streaming: false }]
}
