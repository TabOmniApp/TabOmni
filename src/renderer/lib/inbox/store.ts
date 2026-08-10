import { create } from "zustand"

import {
  INBOX_DEFAULT_PORTS,
  INBOX_CONFIG_KEY,
  type HttpResponseResult,
  type InboxKind,
  type InboxMessage,
  type InboxStatus,
} from "@shared/api"
import { useStudio } from "@/lib/store"
import { isStringArray, recall, remember } from "@/lib/tab-memory"

/**
 * One store behind two panels.
 *
 * Mail and Webhooks are separate sections of the rail — they replace separate
 * applications, and the work of reading a rendered email has nothing in common
 * with the work of comparing a signature header. What they are not is separate
 * *data*: both servers live on one manager, their captures share a file and a
 * cap, and the settings for both are one blob under one key. Two stores would
 * mean two subscriptions to the same event and two copies of the same list,
 * each able to be stale in its own way.
 *
 * So the data here is shared and the panel state — which tabs are open, which
 * one is selected — is keyed by kind. `messagesOf` is what each panel reads.
 */

/** The id each panel's settings page occupies in its own `openIds`. */
export const SETTINGS_TAB: Record<InboxKind, string> = {
  mail: "mail-settings",
  webhook: "webhook-settings",
}

/**
 * What the panels remember about their servers.
 *
 * `autoStart` is per server and is the renderer's own: the main process is
 * handed a port and binds it, and has no business deciding for itself that a
 * project's ports should be taken at launch. Per server because the two are
 * genuinely different habits — a webhook catcher is worth leaving up all day,
 * an SMTP sink generally only while mail is being worked on.
 */
export type InboxSettings = Record<
  InboxKind,
  { port: number; autoStart: boolean }
>

const DEFAULT_SETTINGS: InboxSettings = {
  mail: { port: INBOX_DEFAULT_PORTS.mail, autoStart: false },
  webhook: { port: INBOX_DEFAULT_PORTS.webhook, autoStart: false },
}

/** Where the replay target is remembered, per project. Typed once, then it is
 * the same handler for every event from the same provider. */
const REPLAY_URL_KEY = "inbox.replayUrl"

/** Which captures each panel had open, and which one was on screen. */
const OPEN_TABS_KEY = "inbox.tabs"

type RememberedPanels = {
  openIds: Record<InboxKind, string[]>
  selectedId: Record<InboxKind, string | null>
}

function isRememberedPanels(value: unknown): value is RememberedPanels {
  const record = value as Partial<RememberedPanels> | null
  if (!record?.openIds || !record.selectedId) return false
  return (["mail", "webhook"] as const).every((server) => {
    const selected = record.selectedId?.[server]
    return (
      isStringArray(record.openIds?.[server]) &&
      (selected === null || typeof selected === "string")
    )
  })
}

/** A replay in flight, or what came back from one. */
export type ReplayOutcome = {
  sending: boolean
  response: HttpResponseResult | null
  error: string | null
}

function idleStatus(settings: InboxSettings): InboxStatus {
  return {
    mail: { listening: false, port: settings.mail.port, error: null },
    webhook: { listening: false, port: settings.webhook.port, error: null },
  }
}

type InboxState = {
  /** Both kinds, newest first. Each panel filters with `messagesOf`. */
  messages: InboxMessage[]
  status: InboxStatus
  settings: InboxSettings
  /** Where `replay` sends, remembered across sessions. */
  replayUrl: string
  /** Keyed by message id — a replay belongs to the capture it came from, not
   * to the panel, so switching tabs and coming back still shows it. */
  replays: Record<string, ReplayOutcome>

  openIds: Record<InboxKind, string[]>
  selectedId: Record<InboxKind, string | null>

  refresh: () => Promise<void>
  start: (server: InboxKind) => Promise<void>
  stop: (server: InboxKind) => Promise<void>
  /** Saves one server's port and auto-start choice. Restarts that server when
   * it is up, since a port changed under a listening server means nothing. */
  saveSettings: (
    server: InboxKind,
    settings: InboxSettings[InboxKind]
  ) => Promise<void>

  setReplayUrl: (url: string) => void
  replay: (id: string) => Promise<void>

  remove: (id: string) => Promise<void>
  /** Empties one panel's half, leaving the other's alone. */
  clear: (server: InboxKind) => Promise<void>

  select: (server: InboxKind, id: string) => void
  openSettings: (server: InboxKind) => void
  close: (server: InboxKind, id: string) => void
  closeOthers: (server: InboxKind, id: string) => void
  closeAll: (server: InboxKind) => void
  reorder: (server: InboxKind, ids: string[]) => void
}

async function readSettings(): Promise<InboxSettings> {
  const raw = await window.desktop.getSetting(INBOX_CONFIG_KEY)
  if (!raw) return DEFAULT_SETTINGS

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return DEFAULT_SETTINGS
    const value = parsed as Record<
      string,
      { port?: number; autoStart?: unknown }
    >
    return {
      mail: {
        port: Number(value.mail?.port) || DEFAULT_SETTINGS.mail.port,
        autoStart: value.mail?.autoStart === true,
      },
      webhook: {
        port: Number(value.webhook?.port) || DEFAULT_SETTINGS.webhook.port,
        autoStart: value.webhook?.autoStart === true,
      },
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
  // arrived while both panels were closed still belongs in the list, and the
  // unread counts on the rail are the reason to know about it.
  window.desktop.onInboxMessage(({ message }) => {
    set((state) => ({ messages: [message, ...state.messages] }))
  })

  window.desktop.onInboxStatus(({ status }) => {
    set({ status })
  })

  /** Both panels' tab lists change the same way; only one kind's is touched.
   * Every tab change goes through here, which is why remembering the strip is
   * one call rather than one per action. */
  function setPanel(
    server: InboxKind,
    openIds: string[],
    selectedId: string | null
  ) {
    set((state) => ({
      openIds: { ...state.openIds, [server]: openIds },
      selectedId: { ...state.selectedId, [server]: selectedId },
    }))
    const { openIds: open, selectedId: selected } = get()
    remember(OPEN_TABS_KEY, { openIds: open, selectedId: selected })
  }

  /**
   * Reopens what the last launch had open. A capture is only kept while it is
   * in the capped list, so an id that has since aged out — or been cleared —
   * names nothing and is dropped; the two settings tabs always resolve.
   */
  function restoreTabs(messages: InboxMessage[]) {
    void recall(OPEN_TABS_KEY, isRememberedPanels).then((stored) => {
      if (!stored) return

      for (const server of ["mail", "webhook"] as const) {
        // Anything opened while this read was in flight wins.
        if (get().openIds[server].length > 0) continue

        const openIds = stored.openIds[server].filter(
          (id) =>
            id === SETTINGS_TAB[server] ||
            messages.some(
              (message) => message.id === id && message.kind === server
            )
        )
        if (openIds.length === 0) continue

        const selected = stored.selectedId[server]
        setPanel(
          server,
          openIds,
          selected && openIds.includes(selected)
            ? selected
            : (openIds[0] ?? null)
        )
      }
    })
  }

  return {
    messages: [],
    status: idleStatus(DEFAULT_SETTINGS),
    settings: DEFAULT_SETTINGS,
    replayUrl: "",
    replays: {},
    openIds: { mail: [], webhook: [] },
    selectedId: { mail: null, webhook: null },

    async refresh() {
      const [messages, settings, status, replayUrl] = await Promise.all([
        window.desktop.inboxMessages(),
        readSettings(),
        window.desktop.inboxStatus(),
        window.desktop.getSetting(REPLAY_URL_KEY),
      ])

      set({
        messages,
        settings,
        replayUrl: replayUrl ?? "",
        // The ports the servers are actually on when they are up; the saved
        // ones when they are not, so a settings tab is not showing zeroes.
        status: status.mail.port ? status : idleStatus(settings),
      })

      for (const server of ["mail", "webhook"] as const) {
        if (settings[server].autoStart && !status[server].listening) {
          void get().start(server)
        }
      }

      // Only on the first read: a later refresh must not reopen what has been
      // closed since.
      if (!restored) {
        restored = true
        restoreTabs(messages)
      }
    },

    async start(server) {
      const { settings } = get()
      set({
        status: await window.desktop.inboxStart(server, settings[server].port),
      })
    },

    async stop(server) {
      set({ status: await window.desktop.inboxStop(server) })
    },

    async saveSettings(server, next) {
      const { status } = get()

      const settings = { ...get().settings, [server]: next }
      set({ settings })
      await window.desktop.setSetting(
        INBOX_CONFIG_KEY,
        JSON.stringify(settings)
      )

      if (status[server].listening) await get().start(server)
      else
        set({
          status: { ...get().status, [server]: idleStatus(settings)[server] },
        })
    },

    setReplayUrl(url) {
      set({ replayUrl: url })
      void window.desktop.setSetting(REPLAY_URL_KEY, url)
    },

    async replay(id) {
      const { replayUrl } = get()
      if (!replayUrl.trim()) return

      const put = (outcome: ReplayOutcome) =>
        set((state) => ({ replays: { ...state.replays, [id]: outcome } }))

      put({ sending: true, response: null, error: null })
      try {
        const response = await window.desktop.inboxReplay(id, replayUrl.trim())
        put({ sending: false, response, error: null })
      } catch (error) {
        put({
          sending: false,
          response: null,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },

    async remove(id) {
      const { messages } = get()

      const message = messages.find((candidate) => candidate.id === id)
      if (message) get().close(message.kind, id)
      set({ messages: messages.filter((candidate) => candidate.id !== id) })
      await window.desktop.inboxDelete(id)
    },

    async clear(server) {
      const { messages, openIds } = get()

      set({ messages: messages.filter((message) => message.kind !== server) })
      // The settings tab is not a capture and survives the list going.
      const kept = openIds[server].filter((id) => id === SETTINGS_TAB[server])
      setPanel(server, kept, kept[0] ?? null)

      await window.desktop.inboxClear(server)
    },

    select(server, id) {
      const { openIds, messages } = get()
      useStudio.getState().showPane(server)

      setPanel(
        server,
        openIds[server].includes(id)
          ? openIds[server]
          : [...openIds[server], id],
        id
      )

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

    openSettings(server) {
      get().select(server, SETTINGS_TAB[server])
    },

    close(server, id) {
      const { openIds, selectedId } = get()
      const index = openIds[server].indexOf(id)
      if (index === -1) return

      const remaining = openIds[server].filter(
        (_, position) => position !== index
      )
      setPanel(
        server,
        remaining,
        selectedId[server] === id
          ? (remaining[index] ?? remaining[index - 1] ?? null)
          : selectedId[server]
      )
    },

    closeOthers(server, id) {
      setPanel(server, [id], id)
    },

    closeAll(server) {
      setPanel(server, [], null)
    },

    reorder(server, ids) {
      const { openIds, selectedId } = get()
      const reordered = ids.filter((id) => openIds[server].includes(id))
      if (reordered.length !== openIds[server].length) return
      setPanel(server, reordered, selectedId[server])
    },
  }
})

/** One panel's captures, newest first. */
export function messagesOf(
  messages: InboxMessage[],
  server: InboxKind
): InboxMessage[] {
  return messages.filter((message) => message.kind === server)
}

export function unreadCount(
  messages: InboxMessage[],
  server: InboxKind
): number {
  return messages.reduce(
    (total, message) =>
      total + (message.kind === server && message.unread ? 1 : 0),
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
