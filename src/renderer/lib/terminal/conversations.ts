import { create } from "zustand"

import { recall, remember } from "../tab-memory"
import { useStudio } from "../store"
import { useTerminal } from "./store"

/**
 * The conversations open for reading, which are tabs in the Explorer pane.
 *
 * A `claude` conversation is a file the CLI wrote — every run of it, from this
 * app or from a terminal of the user's own, appends to
 * `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. That means the studio
 * can show a conversation it never started and has no process for, which is
 * what this store holds: a transcript being read, with no pty behind it.
 *
 * **Why the Explorer pane rather than the Terminal one.** The list these are
 * opened from is in the Explorer sidebar, under the folder they belong to, and
 * `showPane` moves the sidebar with the pane — so opening one into the Terminal
 * pane would take the rail to the Terminal sidebar, which has no row for it to
 * mark. The tab belongs to the panel whose sidebar lists it.
 *
 * Kept apart from the files store rather than added to its `openIds`, which
 * are absolute paths: `prune`, `restore`, `flush` and `movedPath` all read one
 * as a path, and an id that is not one would have to be guarded for in each.
 * `lib/panels.ts` is where the two are added up into the one pane's tabs.
 *
 * A session running *is* a conversation, so what makes these separate from the
 * Terminal panel's sessions is only that nothing is being talked to: `resume`
 * hands one back to `useTerminal` and the tab goes.
 */
export type OpenConversation = {
  /** The CLI's own session id: the transcript's file name, what `--resume`
   * takes, and this tab's own id. */
  id: string
  folderId: string
  /**
   * The CLI's generated title, as the folder's listing gave it.
   *
   * Kept rather than re-read so the tab strip has a label without reading the
   * head of a transcript for every open tab on every launch.
   */
  title: string
}

const OPEN_TABS_KEY = "explorer.conversations"

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600_000],
  ["month", 30 * 24 * 3600_000],
  ["day", 24 * 3600_000],
  ["hour", 3600_000],
  ["minute", 60_000],
]

/**
 * How long ago a conversation was last written to, coarsened to whichever unit
 * reads naturally — a list of conversations has no use for "3600 seconds ago".
 *
 * Here rather than in either component because both the chat view's Past
 * sessions drawer and the Explorer sidebar's list draw the same figure from the
 * same `updatedAt`.
 */
export function relativeTime(updatedAt: number): string {
  const delta = updatedAt - Date.now()
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(delta) >= size)
      return RELATIVE.format(Math.round(delta / size), unit)
  }
  return "just now"
}

type Remembered = {
  open: OpenConversation[]
  activeId: string | null
  onScreen: boolean
}

function isConversation(value: unknown): value is OpenConversation {
  const record = value as Partial<OpenConversation> | null
  return (
    typeof record?.id === "string" &&
    typeof record.folderId === "string" &&
    typeof record.title === "string"
  )
}

function isRemembered(value: unknown): value is Remembered {
  const record = value as Partial<Remembered> | null
  return (
    Array.isArray(record?.open) &&
    record.open.every(isConversation) &&
    (record.activeId === null || typeof record.activeId === "string") &&
    typeof record.onScreen === "boolean"
  )
}

/**
 * How a conversation tab is told apart from a file's own path within the
 * Explorer pane's ids.
 *
 * A file tab is addressed by its absolute path, so any id that starts with
 * this marker is not one: no path begins `chat:` on either platform.
 */
const CHAT_MARKER = "chat:"

export const chatTabId = (claudeSessionId: string): string =>
  CHAT_MARKER + claudeSessionId

export const isChatTabId = (id: string): boolean => id.startsWith(CHAT_MARKER)

/** The conversation a chat tab is about, with the marker taken back off. */
export const chatIdOf = (tabId: string): string =>
  tabId.slice(CHAT_MARKER.length)

type ConversationsState = {
  open: OpenConversation[]
  /** Which conversation the pane would draw. */
  activeId: string | null
  /**
   * Whether the Explorer pane is drawing a conversation rather than a file.
   *
   * The pane holds two lists and one screen, so something has to say which was
   * picked last. It lives here rather than in the files store because this is
   * the newcomer: `useFiles.select` clears it, which is the one line the older
   * store gives up to the arrangement.
   */
  onScreen: boolean

  /** Opens one for reading and puts the Explorer pane on it. */
  read: (conversation: OpenConversation) => void
  select: (id: string) => void
  close: (id: string) => void
  closeOthers: (id: string) => void
  closeAll: () => void
  reorder: (ids: string[]) => void
  /** Hands the conversation to a real session — a pty resuming it — and closes
   * the read-only tab, since what it was for is now on screen elsewhere. */
  resume: (id: string) => void
  /** Says the pane is on a file now. Called by the files store, which is the
   * only thing that can know. */
  blur: () => void
  /** Restores the tabs. Idempotent: Strict Mode mounts twice. */
  restore: () => Promise<void>
}

export const useConversations = create<ConversationsState>((set, get) => {
  let restorePromise: Promise<void> | null = null

  function rememberTabs() {
    const { open, activeId, onScreen } = get()
    remember(OPEN_TABS_KEY, { open, activeId, onScreen })
  }

  /** Drops the tabs of folders the workspace no longer points at, the way the
   * files store drops their files: the transcript is still on disk, but this
   * app has nothing to say about a directory it is not pointed at. */
  function prune(folderIds: string[]) {
    const kept = new Set(folderIds)
    const { open } = get()
    const remaining = open.filter((entry) => kept.has(entry.folderId))
    if (remaining.length === open.length) return

    set({
      open: remaining,
      activeId: remaining.some((entry) => entry.id === get().activeId)
        ? get().activeId
        : (remaining.at(-1)?.id ?? null),
      onScreen: remaining.length > 0 && get().onScreen,
    })
    rememberTabs()
  }

  useStudio.subscribe((studio) => {
    // Not before the workspace has been read: `init` has a moment where the
    // studio is loaded and its folders have not arrived, and pruning against an
    // empty list there would close every tab just restored.
    if (!studio.loaded) return
    prune(studio.folders.map((folder) => folder.id))
  })

  return {
    open: [],
    activeId: null,
    onScreen: false,

    read(conversation) {
      useStudio.getState().showPane("files")
      set((state) => ({
        open: state.open.some((entry) => entry.id === conversation.id)
          ? state.open.map((entry) =>
              // The title is re-read every time the list is: a conversation the
              // CLI has since named should not keep the placeholder it opened
              // with.
              entry.id === conversation.id ? conversation : entry
            )
          : [...state.open, conversation],
        activeId: conversation.id,
        onScreen: true,
      }))
      rememberTabs()
    },

    select(id) {
      useStudio.getState().showPane("files")
      set({ activeId: id, onScreen: true })
      rememberTabs()
    },

    close(id) {
      const { open, activeId } = get()
      const index = open.findIndex((entry) => entry.id === id)
      if (index === -1) return

      const remaining = open.filter((_, position) => position !== index)
      const next =
        activeId === id
          ? (remaining[index]?.id ?? remaining[index - 1]?.id ?? null)
          : activeId

      set({
        open: remaining,
        activeId: next,
        // With none left the pane goes back to whatever file is selected, or to
        // the strip's own fallback — `fillPane` is what answers that.
        onScreen: next !== null && get().onScreen,
      })
      rememberTabs()
    },

    closeOthers(id) {
      const kept = get().open.filter((entry) => entry.id === id)
      set({ open: kept, activeId: kept[0]?.id ?? null })
      rememberTabs()
    },

    closeAll() {
      set({ open: [], activeId: null, onScreen: false })
      rememberTabs()
    },

    reorder(ids) {
      const { open } = get()
      const reordered = ids
        .map((id) => open.find((entry) => entry.id === id))
        .filter((entry): entry is OpenConversation => entry !== undefined)
      if (reordered.length !== open.length) return
      set({ open: reordered })
      rememberTabs()
    },

    resume(id) {
      const conversation = get().open.find((entry) => entry.id === id)
      if (!conversation) return

      // Already running: a second `claude` on one transcript would be two
      // processes appending to the same file, and the CLI refuses a session id
      // that is in use anyway. The tab that has it is the answer.
      const running = useTerminal
        .getState()
        .sessions.find(
          (session) => !session.closed && session.claudeSessionId === id
        )
      if (running) {
        useTerminal.getState().select(running.id)
      } else {
        useTerminal
          .getState()
          .open(conversation.folderId, "claude", { claudeSessionId: id })
      }

      get().close(id)
    },

    blur() {
      if (!get().onScreen) return
      set({ onScreen: false })
      rememberTabs()
    },

    restore() {
      restorePromise ??= (async () => {
        const stored = await recall(OPEN_TABS_KEY, isRemembered)
        if (!stored || get().open.length > 0) return

        // The transcripts are not checked for here: that is a read of every
        // file's head, on the launch path, for tabs the user may not look at.
        // A conversation whose file has gone draws its own notice instead.
        set({
          open: stored.open,
          activeId: stored.open.some((entry) => entry.id === stored.activeId)
            ? stored.activeId
            : (stored.open.at(-1)?.id ?? null),
          onScreen: stored.onScreen && stored.open.length > 0,
        })
      })()
      return restorePromise
    },
  }
})
