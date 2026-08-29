import { useEffect } from "react"
import { Plus, Terminal } from "lucide-react"

import { useDatabases } from "@/lib/db/databases-store"
import { useExplorer, type OpenTab } from "@/lib/db/explorer-store"
import { dbTabId, relationId } from "@/lib/panels"
import { DatabaseTree, KIND_ICONS, KIND_LABELS } from "./database-tree"
import { DatabaseWorkspace } from "./database-workspace"
import { IconButton } from "../icon-button"
import { PanelWindow } from "../panel-window"
import { TabStrip, type TabStripItem } from "../tab-strip"

/**
 * The Database panel on its own, in the window `openPanelWindow` opens.
 *
 * The same tree and the same workspace the studio draws, against the same
 * stores — this window is a second renderer of the one app, so nothing here is
 * a second implementation of anything. What surrounds them is `PanelWindow`.
 *
 * The databases are refreshed here because the tree draws them and nothing else
 * in this window would ask: the studio reads them in its own boot, which never
 * runs here. `useStudio` is deliberately left alone — the explorer store calls
 * `showPane("database")` on a selection, which sets a pane nothing in this
 * window draws, and that is harmless.
 */
export function DatabaseWindow() {
  const openTabs = useExplorer((state) => state.openTabs)
  const selected = useExplorer((state) => state.selected)
  const activeQueryTabId = useExplorer((state) => state.activeQueryTabId)
  const databaseId = useExplorer((state) => state.databaseId)
  const openQueryTab = useExplorer((state) => state.openQueryTab)

  useEffect(() => {
    void useDatabases.getState().refresh()
  }, [])

  const activeId = activeQueryTabId ?? (selected ? relationId(selected) : null)

  return (
    <PanelWindow
      title="Database"
      sidebar={<DatabaseTree />}
      tabs={
        <TabStrip
          label="Open tables"
          items={openTabs.map(tabItem)}
          activeId={activeId}
          trailing={
            <IconButton
              label="New query tab"
              disabled={!databaseId}
              onClick={() => openQueryTab()}
            >
              <Plus />
            </IconButton>
          }
          onSelect={selectTab}
          onClose={(id) => useExplorer.getState().closeTab(id)}
          onCloseOthers={(id) => useExplorer.getState().closeOtherTabs(id)}
          onCloseAll={() => useExplorer.getState().closeAllTabs()}
          onReorder={(ids) => useExplorer.getState().reorderTabs(ids)}
        />
      }
    >
      <DatabaseWorkspace />
    </PanelWindow>
  )
}

/**
 * A tab as this strip draws it.
 *
 * `useTabItems` builds the same thing for the studio, but under `lib/tabs.ts`'s
 * `PREFIX` — the prefix is what keeps five panels' ids apart in one strip, and
 * there is only one panel here. Unprefixed ids are also what lets the handlers
 * above hand an id straight to the explorer store.
 */
function tabItem(tab: OpenTab): TabStripItem {
  if (tab.kind === "query") {
    return {
      id: tab.query.id,
      label: tab.query.title,
      icon: <Terminal className="size-3.5 shrink-0" />,
      title: tab.query.title,
    }
  }

  const Icon = KIND_ICONS[tab.relation.kind]
  const id = relationId(tab.relation)
  return {
    id,
    label: tab.relation.name,
    icon: <Icon className="size-3.5 shrink-0" />,
    title: `${id} — ${KIND_LABELS[tab.relation.kind]}`,
    copyText: id,
  }
}

/** What `PANELS.database.select` does, without the strip prefix to strip. */
function selectTab(id: string): void {
  const { openTabs, select, selectQueryTab } = useExplorer.getState()
  const tab = openTabs.find((item) => dbTabId(item) === id)
  if (!tab) return
  if (tab.kind === "relation") select(tab.relation)
  else selectQueryTab(tab.query.id)
}
