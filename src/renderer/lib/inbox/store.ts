import { create } from "zustand"

import {
  INBOX_DEFAULT_PORT,
  INBOX_CONFIG_KEY,
  type InboxMessage,
  type InboxServerStatus,
} from "@shared/api"
import { useStudio } from "@/lib/store"
import { isStringArray, recall, remember } from "@/lib/tab-memory"

/** The id the settings page occupies in `openIds`. */
export const SETTINGS_TAB = "mail-settings"

/**
 * What the panel remembers about its server.
 *
 * `autoStart` is the renderer's own: the main process is handed a port and
 * binds it, and has no business deciding for itself that a project's port
 * should be taken at launch.
 */
export type InboxSettings = { port: number; autoStart: boolean }

const DEFAULT_SETTINGS: InboxSettings = {
  port: INBOX_DEFAULT_PORT,
  autoStart: false,
}

/** Which captures the panel had open, and which one was on screen. */
const OPEN_TABS_KEY = "inbox.tabs"

type RememberedPanel = {
  openIds: string[]
  selectedId: string | null
}

function isRememberedPanel(value: unknown): value is RememberedPanel {
  const record = value as Partial<RememberedPanel> | null
  if (!record) return false
  const selected = record.selectedId
  return (
    isStringArray(record.openIds) &&
    (selected === null || typeof selected === "string")
  )
}

function idleStatus(settings: InboxSettings): InboxServerStatus {
  return { listening: false, port: settings.port, error: null }
}

type InboxState = {
  /** Newest first. */
  messages: InboxMessage[]
  status: InboxServerStatus
  settings: InboxSettings

  openIds: string[]
  selectedId: string | null

  refresh: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  /** Saves the port and auto-start choice. Restarts the server when it is up,
   * since a port changed under a listening server means nothing. */
  saveSettings: (settings: InboxSettings) => Promise<void>

  remove: (id: string) => Promise<void>
  clear: () => Promise<void>

  select: (id: string) => void
  openSettings: () => void
  close: (id: string) => void
  closeOthers: (id: string) => void
  closeAll: () => void
  reorder: (ids: string[]) => void
}

async function readSettings(): Promise<InboxSettings> {
  const raw = await window.desktop.getSetting(INBOX_CONFIG_KEY)
  if (!raw) return DEFAULT_SETTINGS

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return DEFAULT_SETTINGS
    // Still read out of a `mail` key: the blob was written that way while the
    // Webhooks panel had a key of its own beside it, and a workspace upgrading
    // from that build should keep the port it chose.
    const value = parsed as { mail?: { port?: number; autoStart?: unknown } }
    return {
      port: Number(value.mail?.port) || DEFAULT_SETTINGS.port,
      autoStart: value.mail?.autoStart === true,
    }
  } catch {
    // A setting written by a newer build, or half-written by a crash. The
    // defaults are a working panel; a thrown parse error is a blank one.
    return DEFAULT_SETTINGS
  }
}

export const useInbox = create<InboxState>((set, get) => {
  /** Whether the strip has already been put back — see `refresh`. */
  let restored = false

  // Subscribed once for the window rather than per component: a capture that
  // arrived while the panel was closed still belongs in the list, and the
  // unread count on the rail is the reason to know about it.
  window.desktop.onInboxMessage(({ message }) => {
    set((state) => ({ messages: [message, ...state.messages] }))
  })

  window.desktop.onInboxStatus(({ status }) => {
    set({ status })
  })

  /** Every tab change goes through here, which is why remembering the strip is
   * one call rather than one per action. */
  function setPanel(openIds: string[], selectedId: string | null) {
    set({ openIds, selectedId })
    remember(OPEN_TABS_KEY, { openIds, selectedId })
  }

  /**
   * Reopens what the last launch had open. A capture is only kept while it is
   * in the capped list, so an id that has since aged out — or been cleared —
   * names nothing and is dropped; the settings tab always resolves.
   */
  function restoreTabs(messages: InboxMessage[]) {
    void recall(OPEN_TABS_KEY, isRememberedPanel).then((stored) => {
      if (!stored) return
      // Anything opened while this read was in flight wins.
      if (get().openIds.length > 0) return

      const openIds = stored.openIds.filter(
        (id) =>
          id === SETTINGS_TAB || messages.some((message) => message.id === id)
      )
      if (openIds.length === 0) return

      const selected = stored.selectedId
      setPanel(
        openIds,
        selected && openIds.includes(selected) ? selected : (openIds[0] ?? null)
      )
    })
  }

  return {
    messages: [],
    status: idleStatus(DEFAULT_SETTINGS),
    settings: DEFAULT_SETTINGS,
    openIds: [],
    selectedId: null,

    async refresh() {
      const [messages, settings, status] = await Promise.all([
        window.desktop.inboxMessages(),
        readSettings(),
        window.desktop.inboxStatus(),
      ])

      set({
        messages,
        settings,
        // The port the server is actually on when it is up; the saved one when
        // it is not, so the settings tab is not showing a zero.
        status: status.port ? status : idleStatus(settings),
      })

      if (settings.autoStart && !status.listening) void get().start()

      // Only on the first read: a later refresh must not reopen what has been
      // closed since.
      if (!restored) {
        restored = true
        restoreTabs(messages)
      }
    },

    async start() {
      set({ status: await window.desktop.inboxStart(get().settings.port) })
    },

    async stop() {
      set({ status: await window.desktop.inboxStop() })
    },

    async saveSettings(next) {
      const listening = get().status.listening

      set({ settings: next })
      // Kept under a `mail` key for the sake of a workspace that downgrades —
      // see `readSettings`.
      await window.desktop.setSetting(
        INBOX_CONFIG_KEY,
        JSON.stringify({ mail: next })
      )

      if (listening) await get().start()
      else set({ status: idleStatus(next) })
    },

    async remove(id) {
      const { messages } = get()

      get().close(id)
      set({ messages: messages.filter((candidate) => candidate.id !== id) })
      await window.desktop.inboxDelete(id)
    },

    async clear() {
      const { openIds } = get()

      set({ messages: [] })
      // The settings tab is not a capture and survives the list going.
      const kept = openIds.filter((id) => id === SETTINGS_TAB)
      setPanel(kept, kept[0] ?? null)

      await window.desktop.inboxClear()
    },

    select(id) {
      const { openIds, messages } = get()
      useStudio.getState().showPane("mail")

      setPanel(openIds.includes(id) ? openIds : [...openIds, id], id)

      // Opening it is what makes it read — there is no other moment that means
      // the same thing, and a separate "mark as read" would be a button for
      // something the user has already done.
      const message = messages.find((candidate) => candidate.id === id)
      if (!message?.unread) return
      set({
        messages: messages.map((candidate) =>
          candidate.id === id ? { ...candidate, unread: false } : candidate
        ),
      })
      void window.desktop.inboxMarkRead(id)
    },

    openSettings() {
      get().select(SETTINGS_TAB)
    },

    close(id) {
      const { openIds, selectedId } = get()
      const index = openIds.indexOf(id)
      if (index === -1) return

      const remaining = openIds.filter((_, position) => position !== index)
      setPanel(
        remaining,
        selectedId === id
          ? (remaining[index] ?? remaining[index - 1] ?? null)
          : selectedId
      )
    },

    closeOthers(id) {
      setPanel([id], id)
    },

    closeAll() {
      setPanel([], null)
    },

    reorder(ids) {
      const { openIds, selectedId } = get()
      const reordered = ids.filter((id) => openIds.includes(id))
      if (reordered.length !== openIds.length) return
      setPanel(reordered, selectedId)
    },
  }
})

export function unreadCount(messages: InboxMessage[]): number {
  return messages.reduce(
    (total, message) => total + (message.unread ? 1 : 0),
    0
  )
}

/**
 * How long ago something arrived, in the shortest form that is still true.
 *
 * An inbox is read by recency — "was that the one I just sent?" — and a
 * timestamp answers that question only after the reader has done the
 * subtraction themselves.
 */
export function receivedLabel(iso: string, now = Date.now()): string {
  const seconds = Math.max(Math.round((now - Date.parse(iso)) / 1000), 0)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`

  const date = new Date(iso)
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
