import { cn } from "@/lib/utils"
import {
  FileText,
  Folder,
  Mail,
  Plus,
  Settings2,
  Terminal,
  Webhook,
} from "lucide-react"

import type { Relation } from "@/lib/db/engines/types"
import { useExplorer, type OpenTab } from "@/lib/db/explorer-store"
import { SETTINGS_TAB_ID, useApi } from "@/lib/http/store"
import { messagesOf, SETTINGS_TAB, useInbox } from "@/lib/inbox/store"
import { specName } from "@/lib/spec/schema"
import { draftOf, isDirty, useSpecs } from "@/lib/spec/store"
import { useStudio, type Pane } from "@/lib/store"
import { arrange, bare, kindOf, PREFIX } from "@/lib/tabs"
import { SESSION_TYPES, sessionLabel } from "@/lib/terminal/catalog"
import { activeSessionOf, sessionsOf, useTerminal } from "@/lib/terminal/store"
import { KIND_ICONS, KIND_LABELS } from "./db/database-tree"
import { METHOD_TONES } from "./api/request-list"
import { IconButton } from "./icon-button"
import { TabStrip, type TabStripItem } from "./tab-strip"

/**
 * One strip of tabs for the whole workbench, above whichever panel is showing.
 *
 * The panels each used to draw their own, which meant that leaving Database
 * for API took the tables off the screen — they were still open, but nothing
 * said so, and coming back was a trip through the rail. Since the strips were
 * identical anyway, they are now one: a table, a request, a spec and a session
 * sit side by side, and clicking any of them goes to the panel that shows it.
 *
 * Tabs open grouped by panel rather than interleaved in the order they were
 * opened, so an untouched strip reads as runs rather than a shuffle. Dragging
 * overrides that and may put a tab anywhere, including between two of another
 * panel's: the arrangement is the user's, and a strip that silently sprang a
 * tab back to its own run was refusing a move for a reason only the code knew.
 *
 * The order that results cannot live in any one panel — a request between two
 * tables is a position none of the three stores has anywhere to record — so it
 * is `tabOrder` on the studio store, and the panels keep only their own
 * membership. `arrange` in `lib/tabs.ts` reconciles the two.
 */
export function WorkspaceTabs({ pane }: { pane: Pane }) {
  const projectId = useStudio((state) => state.projectId)
  const tabOrder = useStudio((state) => state.tabOrder)
  const setTabOrder = useStudio((state) => state.setTabOrder)

  const databaseId = useExplorer((state) => state.databaseId)
  const dbTabs = useExplorer((state) => state.openTabs)
  const dbSelected = useExplorer((state) => state.selected)
  const activeQueryTabId = useExplorer((state) => state.activeQueryTabId)
  const dbSelect = useExplorer((state) => state.select)
  const selectQueryTab = useExplorer((state) => state.selectQueryTab)
  const closeDbTab = useExplorer((state) => state.closeTab)
  const closeOtherDbTabs = useExplorer((state) => state.closeOtherTabs)
  const closeAllDbTabs = useExplorer((state) => state.closeAllTabs)
  const reorderDbTabs = useExplorer((state) => state.reorderTabs)
  const openQueryTab = useExplorer((state) => state.openQueryTab)

  const requests = useApi((state) => state.requests)
  const folders = useApi((state) => state.folders)
  const openIds = useApi((state) => state.openIds)
  const apiSelectedId = useApi((state) => state.selectedId)
  const apiSelect = useApi((state) => state.select)
  const closeApi = useApi((state) => state.close)
  const closeOtherApi = useApi((state) => state.closeOthers)
  const closeAllApi = useApi((state) => state.closeAll)
  const reorderApi = useApi((state) => state.reorder)

  const specPaths = useSpecs((state) => state.openPaths)
  const specSelected = useSpecs((state) => state.selectedPath)
  const specDrafts = useSpecs((state) => state.drafts)
  const specSelect = useSpecs((state) => state.select)
  const closeSpec = useSpecs((state) => state.close)
  const closeOtherSpecs = useSpecs((state) => state.closeOthers)
  const closeAllSpecs = useSpecs((state) => state.closeAll)
  const reorderSpecs = useSpecs((state) => state.reorder)

  const inboxMessages = useInbox((state) => state.messages)
  const inboxOpenIds = useInbox((state) => state.openIds)
  const inboxSelectedId = useInbox((state) => state.selectedId)
  const inboxSelect = useInbox((state) => state.select)
  const closeInbox = useInbox((state) => state.close)
  const closeOtherInbox = useInbox((state) => state.closeOthers)
  const closeAllInbox = useInbox((state) => state.closeAll)
  const reorderInbox = useInbox((state) => state.reorder)

  /** Mail's and Webhooks' tabs are built the same way from the same store, so
   * the strip asks for them by kind rather than spelling the run out twice. */
  const captureItems = (server: "mail" | "webhook"): TabStripItem[] =>
    inboxOpenIds[server].flatMap((id) => {
      if (id === SETTINGS_TAB[server]) {
        return [
          {
            id: PREFIX[server] + id,
            label: server === "mail" ? "Mail settings" : "Webhook settings",
            icon: (
              <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />
            ),
          },
        ]
      }
      const message = messagesOf(inboxMessages, server).find(
        (candidate) => candidate.id === id
      )
      if (!message) return []
      return [
        {
          id: PREFIX[server] + id,
          label: message.summary,
          title:
            message.kind === "mail"
              ? `${message.mail.from} \u2192 ${message.mail.to.join(", ")}`
              : message.webhook.path,
          copyText:
            message.kind === "webhook" ? message.webhook.path : undefined,
          copyLabel: message.kind === "webhook" ? "Copy path" : undefined,
          icon:
            message.kind === "mail" ? (
              <Mail className="size-3.5 shrink-0" />
            ) : (
              <Webhook className="size-3.5 shrink-0" />
            ),
        },
      ]
    })

  const sessions = useTerminal((state) => state.sessions)
  const terminalActiveId = useTerminal((state) => state.activeId)
  const terminalSelect = useTerminal((state) => state.select)
  const closeTerminal = useTerminal((state) => state.close)
  const closeOtherTerminals = useTerminal((state) => state.closeOthers)
  const closeAllTerminals = useTerminal((state) => state.closeAll)
  const reorderTerminals = useTerminal((state) => state.reorder)

  const ownSessions = sessionsOf(sessions, projectId)

  /** Every open tab, grouped by panel — the order a strip nobody has dragged
   * in is shown in, and the fallback `arrange` places new tabs against. */
  const grouped: TabStripItem[] = [
    ...(databaseId ? dbTabs.map(dbItem) : []),
    ...openIds.flatMap((id) => {
      if (id === SETTINGS_TAB_ID) {
        return [
          {
            id: PREFIX.api + id,
            label: "API settings",
            icon: (
              <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />
            ),
          },
        ]
      }
      const request = requests.find((candidate) => candidate.id === id)
      if (request) {
        return [
          {
            id: PREFIX.api + id,
            label: request.name,
            title: `${request.method} ${request.url}`,
            copyText: request.url,
            copyLabel: "Copy URL",
            icon: (
              <span
                className={cn(
                  "shrink-0 font-mono text-[0.6rem] font-semibold",
                  METHOD_TONES[request.method] ?? "text-muted-foreground"
                )}
              >
                {request.method}
              </span>
            ),
          },
        ]
      }
      const folder = folders.find((candidate) => candidate.id === id)
      if (!folder) return []
      return [
        {
          id: PREFIX.api + id,
          label: folder.name,
          icon: <Folder className="size-3 shrink-0 text-muted-foreground" />,
        },
      ]
    }),
    ...captureItems("mail"),
    ...captureItems("webhook"),
    ...specPaths.map((path) => ({
      id: PREFIX.spec + path,
      label: specName(path),
      title: path,
      copyText: path,
      copyLabel: "Copy path",
      dirty: isDirty(draftOf(specDrafts, path)),
      icon: <FileText className="size-3.5 shrink-0" />,
    })),
    ...ownSessions.map((session, index) => {
      const { icon: Icon } = SESSION_TYPES[session.kind]
      const ordinal = ownSessions
        .slice(0, index + 1)
        .filter(
          (candidate) =>
            candidate.kind === session.kind &&
            candidate.installing === session.installing
        ).length
      const label =
        session.name ?? sessionLabel(session.kind, session.installing, ordinal)

      return {
        id: PREFIX.terminal + session.id,
        label,
        icon: <Icon className="size-3.5 shrink-0" />,
        title: session.exited ? `${label} — ended` : label,
      }
    }),
  ]

  const items = arrange(grouped, tabOrder)

  /**
   * The tab the pane is showing.
   *
   * Read from the panel that is on screen rather than kept here: each panel
   * already knows what it is displaying, and a second answer would be one
   * more thing to hold in step with them.
   */
  const activeId =
    pane === "database"
      ? activeQueryTabId
        ? PREFIX.database + activeQueryTabId
        : dbSelected
          ? PREFIX.database + relationId(dbSelected)
          : null
      : pane === "api"
        ? apiSelectedId && openIds.includes(apiSelectedId)
          ? PREFIX.api + apiSelectedId
          : null
        : pane === "spec"
          ? specSelected && specPaths.includes(specSelected)
            ? PREFIX.spec + specSelected
            : null
          : pane === "mail" || pane === "webhook"
            ? inboxSelectedId[pane] &&
              inboxOpenIds[pane].includes(inboxSelectedId[pane]!)
              ? PREFIX[pane] + inboxSelectedId[pane]
              : null
            : // Not `activeId` itself: with none set the panel falls back to the
              // most recent session, and the strip has to mark the same one.
              (() => {
                const active = activeSessionOf(
                  sessions,
                  projectId,
                  terminalActiveId
                )
                return active ? PREFIX.terminal + active.id : null
              })()

  // Nothing here switches the pane: each panel's own `select` does that, so a
  // table opened from the tree and one opened from this strip behave alike.
  function select(id: string) {
    const kind = kindOf(id)
    if (!kind) return
    const own = bare(id, kind)

    if (kind === "api") apiSelect(own)
    else if (kind === "spec") specSelect(own)
    else if (kind === "mail" || kind === "webhook") inboxSelect(kind, own)
    else if (kind === "terminal") terminalSelect(own)
    else {
      const tab = dbTabs.find((item) => dbTabId(item) === own)
      if (!tab) return
      if (tab.kind === "relation") dbSelect(tab.relation)
      else selectQueryTab(tab.query.id)
    }
  }

  function close(id: string) {
    const kind = kindOf(id)
    if (!kind) return
    const own = bare(id, kind)

    if (kind === "database") closeDbTab(own)
    else if (kind === "api") closeApi(own)
    else if (kind === "spec") closeSpec(own)
    else if (kind === "mail" || kind === "webhook") closeInbox(kind, own)
    else closeTerminal(own)
  }

  function closeAll() {
    closeAllDbTabs()
    closeAllApi()
    closeAllSpecs()
    closeAllInbox("mail")
    closeAllInbox("webhook")
    if (projectId) closeAllTerminals(projectId)
  }

  function closeOthers(id: string) {
    const kind = kindOf(id)
    if (!kind) return

    // "Others" is now everything in the strip, not everything in one panel:
    // the other panels lose all of theirs, and the tab's own panel keeps it.
    if (kind !== "database") closeAllDbTabs()
    if (kind !== "api") closeAllApi()
    if (kind !== "spec") closeAllSpecs()
    if (kind !== "mail") closeAllInbox("mail")
    if (kind !== "webhook") closeAllInbox("webhook")
    if (kind !== "terminal" && projectId) closeAllTerminals(projectId)

    const own = bare(id, kind)
    if (kind === "database") closeOtherDbTabs(own)
    else if (kind === "api") closeOtherApi(own)
    else if (kind === "spec") closeOtherSpecs(own)
    else if (kind === "mail" || kind === "webhook") closeOtherInbox(kind, own)
    else closeOtherTerminals(own)
  }

  function reorder(ids: string[]) {
    // The strip's own order, which is the only place a tab's position relative
    // to another panel's can be held.
    setTabOrder(ids)

    // Each panel is also handed its own tabs in the sequence they now appear
    // in. Nothing reads that for the strip any more; it is what keeps a
    // panel's idea of "the next tab" — which is where closing one falls back
    // to — matching what the user can see.
    const of = (kind: Pane) =>
      ids.filter((id) => kindOf(id) === kind).map((id) => bare(id, kind))

    reorderDbTabs(of("database"))
    reorderApi(of("api"))
    reorderSpecs(of("spec"))
    reorderInbox("mail", of("mail"))
    reorderInbox("webhook", of("webhook"))
    if (projectId) reorderTerminals(projectId, of("terminal"))
  }

  return (
    <TabStrip
      label="Open tabs"
      items={items}
      activeId={activeId}
      trailing={
        // Only the query tab: a new session and a new request are both
        // buttons in their own sidebar already, and a query tab has nowhere
        // else to be started from.
        pane === "database" ? (
          <IconButton
            label="New query tab"
            disabled={!databaseId}
            onClick={() => openQueryTab()}
          >
            <Plus />
          </IconButton>
        ) : undefined
      }
      onSelect={select}
      onClose={close}
      onCloseOthers={closeOthers}
      onCloseAll={closeAll}
      onReorder={reorder}
    />
  )
}

function dbItem(tab: OpenTab): TabStripItem {
  if (tab.kind === "query") {
    return {
      id: PREFIX.database + tab.query.id,
      label: tab.query.title,
      icon: <Terminal className="size-3.5 shrink-0" />,
      title: tab.query.title,
    }
  }

  const Icon = KIND_ICONS[tab.relation.kind]
  const id = relationId(tab.relation)
  return {
    id: PREFIX.database + id,
    label: tab.relation.name,
    icon: <Icon className="size-3.5 shrink-0" />,
    title: `${id} — ${KIND_LABELS[tab.relation.kind]}`,
    copyText: id,
  }
}

function dbTabId(tab: OpenTab): string {
  return tab.kind === "relation" ? relationId(tab.relation) : tab.query.id
}

function relationId(relation: Relation): string {
  return `${relation.schema}.${relation.name}`
}
