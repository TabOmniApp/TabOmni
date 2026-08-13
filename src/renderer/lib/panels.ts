import { useExplorer, type OpenTab } from "./db/explorer-store"
import type { Relation } from "./db/engines/types"
import { useFiles } from "./files/store"
import { useApi } from "./http/store"
import { useInbox } from "./inbox/store"
import { useNotes } from "./note/store"
import { PANES, useStudio, type Pane } from "./store"
import { arrange, bare, kindOf, neighbour, PREFIX } from "./tabs"
import { activeSessionOf, liveSessions, useTerminal } from "./terminal/store"

/**
 * The six panels' tabs, addressed alike.
 *
 * The strip above the pane is one strip, so everything about a tab that is not
 * its label and its icon is the same question whichever panel it came from:
 * which tabs are open, which one the pane is showing, what happens when one is
 * picked, closed, or dragged somewhere else. Each panel used to answer those
 * for itself, and the answers only agreed by accident — closing the Database
 * panel's last tab left the pane on its own "pick a table" notice while the
 * strip still held two sessions, because nothing in that store had any way to
 * know they were there.
 *
 * So the panels keep what is genuinely theirs — a table's rows, a session's
 * pty, a note's editor — and the tab logic lives here, once. A panel joins the
 * strip by adding an entry to `PANELS`: six small functions, none of which
 * mention any other panel.
 *
 * Ids here are the strip's prefixed ones (`db:public.users`) at the edges and
 * the panel's own inside each entry; `PREFIX` and `bare` in `lib/tabs.ts` are
 * the translation, and are also what a test can reach without a store.
 */
type PanelTabs = {
  /** What this panel has open, in its own order, ids as the panel knows them. */
  open: () => string[]
  /** Which of them it would put on screen — null when it would show nothing. */
  active: () => string | null
  /** Puts one on screen, and the pane on this panel with it. */
  select: (id: string) => void
  close: (id: string) => void
  closeOthers: (id: string) => void
  closeAll: () => void
  reorder: (ids: string[]) => void
}

/*
 * Each panel's two questions, as functions of its store's state rather than
 * reads of it: the commands below want them through `getState`, and the hooks
 * at the bottom want the same derivation as a selector, subscribed to. Written
 * once here, they cannot drift apart.
 */
type ExplorerState = ReturnType<typeof useExplorer.getState>
type FilesState = ReturnType<typeof useFiles.getState>
type ApiState = ReturnType<typeof useApi.getState>
type InboxState = ReturnType<typeof useInbox.getState>
type NoteState = ReturnType<typeof useNotes.getState>
type TerminalState = ReturnType<typeof useTerminal.getState>

/** No database open means no tabs: they belong to the connection, not to the
 * panel, and the ones on screen went with it. */
const dbOpen = (state: ExplorerState): string[] =>
  state.databaseId === null ? [] : state.openTabs.map(dbTabId)

const dbActive = (state: ExplorerState): string | null =>
  state.databaseId === null
    ? null
    : (state.activeQueryTabId ??
      (state.selected ? relationId(state.selected) : null))

const filesActive = (state: FilesState): string | null =>
  state.selectedId && state.openIds.includes(state.selectedId)
    ? state.selectedId
    : null

const apiActive = (state: ApiState): string | null =>
  state.selectedId && state.openIds.includes(state.selectedId)
    ? state.selectedId
    : null

const mailActive = (state: InboxState): string | null =>
  state.selectedId && state.openIds.includes(state.selectedId)
    ? state.selectedId
    : null

const noteActive = (state: NoteState): string | null =>
  state.selectedId && state.openIds.includes(state.selectedId)
    ? state.selectedId
    : null

// Not `activeId` itself: with none set the panel falls back to the most recent
// live session, and the strip has to mark the same one it draws.
const terminalActive = (state: TerminalState): string | null =>
  activeSessionOf(state.sessions, state.activeId)?.id ?? null

const PANELS: Record<Pane, PanelTabs> = {
  files: {
    open: () => useFiles.getState().openIds,
    // `open` rather than `select`: a tab restored from the last launch, or one
    // reached from the strip after its document was pruned, has to be read
    // before the pane has anything to draw. Reading one already held is a
    // no-op.
    select: (id) => void useFiles.getState().open(id),
    active: () => filesActive(useFiles.getState()),
    close: (id) => useFiles.getState().close(id),
    closeOthers: (id) => useFiles.getState().closeOthers(id),
    closeAll: () => useFiles.getState().closeAll(),
    reorder: (ids) => useFiles.getState().reorder(ids),
  },
  database: {
    open: () => dbOpen(useExplorer.getState()),
    active: () => dbActive(useExplorer.getState()),
    select: (id) => {
      const { openTabs, select, selectQueryTab } = useExplorer.getState()
      const tab = openTabs.find((item) => dbTabId(item) === id)
      if (!tab) return
      if (tab.kind === "relation") select(tab.relation)
      else selectQueryTab(tab.query.id)
    },
    close: (id) => useExplorer.getState().closeTab(id),
    closeOthers: (id) => useExplorer.getState().closeOtherTabs(id),
    closeAll: () => useExplorer.getState().closeAllTabs(),
    reorder: (ids) => useExplorer.getState().reorderTabs(ids),
  },
  api: {
    open: () => useApi.getState().openIds,
    active: () => apiActive(useApi.getState()),
    select: (id) => useApi.getState().select(id),
    close: (id) => useApi.getState().close(id),
    closeOthers: (id) => useApi.getState().closeOthers(id),
    closeAll: () => useApi.getState().closeAll(),
    reorder: (ids) => useApi.getState().reorder(ids),
  },
  mail: {
    open: () => useInbox.getState().openIds,
    active: () => mailActive(useInbox.getState()),
    select: (id) => useInbox.getState().select(id),
    close: (id) => useInbox.getState().close(id),
    closeOthers: (id) => useInbox.getState().closeOthers(id),
    closeAll: () => useInbox.getState().closeAll(),
    reorder: (ids) => useInbox.getState().reorder(ids),
  },
  terminal: {
    // A closed session is a row in the Terminal sidebar and nothing else: it
    // has no pty, so there is no pane for a tab here to switch to.
    open: () => liveSessions(useTerminal.getState().sessions).map((s) => s.id),
    active: () => terminalActive(useTerminal.getState()),
    select: (id) => useTerminal.getState().select(id),
    close: (id) => useTerminal.getState().close(id),
    closeOthers: (id) => useTerminal.getState().closeOthers(id),
    closeAll: () => useTerminal.getState().closeAll(),
    reorder: (ids) => useTerminal.getState().reorder(ids),
  },
  note: {
    open: () => useNotes.getState().openIds,
    active: () => noteActive(useNotes.getState()),
    select: (id) => useNotes.getState().select(id),
    close: (id) => useNotes.getState().close(id),
    closeOthers: (id) => useNotes.getState().closeOthers(id),
    closeAll: () => useNotes.getState().closeAll(),
    reorder: (ids) => useNotes.getState().reorder(ids),
  },
}

/**
 * Every open tab as the strip shows it: prefixed ids, in the arranged order.
 *
 * Built from the same two things the strip itself is — each panel's membership
 * and the studio's `tabOrder` — but without a label or an icon in it, which is
 * what lets the commands below answer "which tab is next to this one" without
 * being handed anything by the component.
 */
export function tabIds(): string[] {
  const open = PANES.flatMap((pane) =>
    PANELS[pane].open().map((id) => ({ id: PREFIX[pane] + id }))
  )
  return arrange(open, useStudio.getState().tabOrder).map((item) => item.id)
}

/**
 * Puts a tab on screen.
 *
 * The pane follows from the panel's own `select`, so a table opened from the
 * tree and one opened from the strip behave alike.
 */
export function selectTab(id: string) {
  const kind = kindOf(id)
  if (!kind) return
  PANELS[kind].select(bare(id, kind))
}

/**
 * Closes one tab, and leaves the pane showing something.
 *
 * Each panel already picks its own next tab, which is what should happen while
 * it still has one — closing one of two tables goes to the other table, not off
 * to whatever the strip happens to hold next. What it cannot do is answer for
 * the tab that was its last: the pane would sit on that panel's "nothing
 * selected" notice with the strip still full. So when the panel on screen has
 * nothing left to show, the tab beside the closed one takes over, whichever
 * panel that belongs to.
 */
export function closeTab(id: string) {
  const kind = kindOf(id)
  if (!kind) return

  // Read before the close, while the closed tab still has neighbours.
  const order = tabIds()
  PANELS[kind].close(bare(id, kind))

  fillPane(neighbour(order, id))
}

/**
 * Puts something on screen when the panel showing has nothing to show, and
 * leaves the pane alone otherwise.
 *
 * `prefer` is the tab that stood beside a closed one; without it the strip is
 * taken from the front. Exported for the panels' own lists, which close tabs
 * without going through the strip — the Terminal sidebar's rows are the ones
 * that can empty a pane this way.
 */
export function fillPane(prefer: string | null = null) {
  const { pane } = useStudio.getState()
  if (PANELS[pane].active() !== null) return

  // Checked against the strip as it is now: a panel's close may have taken more
  // tabs with it than the one asked for, and `select` on an id no longer open
  // would put a tab back rather than do nothing.
  const order = tabIds()
  const next = prefer && order.includes(prefer) ? prefer : (order[0] ?? null)
  if (next) selectTab(next)
}

/**
 * Keeps one tab and closes the rest — every panel's, not just this tab's.
 *
 * "Others" is the strip, so the other five panels lose all of theirs, and the
 * kept tab is selected at the end: it may well belong to a panel that was not
 * the one on screen.
 */
export function closeOtherTabs(id: string) {
  const kind = kindOf(id)
  if (!kind) return

  for (const pane of PANES) {
    if (pane !== kind) PANELS[pane].closeAll()
  }
  PANELS[kind].closeOthers(bare(id, kind))
  selectTab(id)
}

export function closeAllTabs() {
  for (const pane of PANES) PANELS[pane].closeAll()
}

/**
 * The strip's new arrangement, after a drag.
 *
 * `tabOrder` is the only place a tab's position relative to another panel's can
 * be recorded. Each panel is also handed its own tabs in the sequence they now
 * appear in: nothing draws the strip from that any more, but it is what keeps a
 * panel's idea of "the next tab" — where closing one falls back to — matching
 * what the user can see.
 */
export function reorderTabs(ids: string[]) {
  useStudio.getState().setTabOrder(ids)

  for (const pane of PANES) {
    PANELS[pane].reorder(
      ids.filter((id) => kindOf(id) === pane).map((id) => bare(id, pane))
    )
  }
}

/**
 * The tab the pane is showing, as the strip addresses it — null when the panel
 * on screen has nothing to show.
 *
 * Read back out of the panels rather than kept anywhere: each one already
 * knows what it is displaying, and a second answer would be one more thing to
 * hold in step with them. The studio pane asks the same question to decide
 * whether to draw a panel at all.
 */
export function useActiveTabId(pane: Pane): string | null {
  const own = {
    files: useFiles(filesActive),
    database: useExplorer(dbActive),
    api: useApi(apiActive),
    mail: useInbox(mailActive),
    terminal: useTerminal(terminalActive),
    note: useNotes(noteActive),
  }[pane]

  return own === null ? null : PREFIX[pane] + own
}

/** Whether anything at all is open in the strip. */
export function useHasOpenTabs(): boolean {
  // Booleans rather than the arrays themselves: a selector that returns a new
  // array never returns the same reference twice, and would re-render on every
  // write to the store it reads.
  const files = useFiles((state) => state.openIds.length > 0)
  const database = useExplorer((state) => dbOpen(state).length > 0)
  const api = useApi((state) => state.openIds.length > 0)
  const mail = useInbox((state) => state.openIds.length > 0)
  const terminal = useTerminal(
    (state) => liveSessions(state.sessions).length > 0
  )
  const note = useNotes((state) => state.openIds.length > 0)

  return files || database || api || mail || terminal || note
}

/** A relation tab is addressed by the relation it shows; a query tab by its
 * own id, which is what the panel gave it. */
export function dbTabId(tab: OpenTab): string {
  return tab.kind === "relation" ? relationId(tab.relation) : tab.query.id
}

export function relationId(relation: Relation): string {
  return `${relation.schema}.${relation.name}`
}
