import { useEffect } from "react"
import { Plus } from "lucide-react"

import { useExplorer } from "@/lib/db/explorer-store"
import {
  closeAllTabs,
  closeOtherTabs,
  closeShownTab,
  closeTab,
  reorderTabs,
  selectTab,
  tabIds,
  useActiveTabId,
} from "@/lib/panels"
import { isStudioShortcut } from "@/lib/shortcuts"
import { useStudio, type Pane } from "@/lib/store"
import { IconButton } from "./icon-button"
import { useTabItems } from "./tab-items"
import { TabStrip } from "./tab-strip"

/**
 * One strip of tabs for the whole workbench — above whichever panel is showing,
 * or beside it, which is the Settings dialog's `tabsPlacement`.
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
 *
 * A tab here is not always one thing open. With grouping on, a panel's tabs are
 * gathered under the folder each belongs to and this strip holds one tab per
 * folder, with `GroupTabs` drawing that folder's own tabs inside it. Which ids
 * that leaves is `tabIds` in `lib/panels.ts`; what each of them looks like is
 * `useTabItems`, shared with the strip inside.
 */
export function WorkspaceTabs({
  pane,
  orientation,
}: {
  pane: Pane
  /** A row above the pane or a column beside it. Handed in rather than read
   * from the settings store here, because the box the strip goes in is the
   * workbench's to draw — `studio.tsx` is what puts a column in a resizable
   * panel, and what falls back to the row when there is nothing to list. */
  orientation: "horizontal" | "vertical"
}) {
  // Read for the subscription: the strip is `tabIds` reconciled against this,
  // and both are computed rather than held, so this is what tells the component
  // that a drag has changed the answer.
  useStudio((state) => state.tabOrder)

  const databaseId = useExplorer((state) => state.databaseId)
  const openQueryTab = useExplorer((state) => state.openQueryTab)

  const byId = useTabItems()
  const items = tabIds().flatMap((id) => {
    const item = byId.get(id)
    return item ? [item] : []
  })

  const activeId = useActiveTabId(pane)

  /*
   * ⌘W closes the tab the pane is showing, the way an editor's does.
   *
   * Answered here because the strip is where the key belongs: the File menu
   * cannot claim the accelerator — see `registerAccelerator` in
   * `electron/menu.ts` — so it displays the key and sends the intent, and this
   * is where both arrive.
   *
   * With an empty strip the key is left alone rather than swallowed: there is
   * no tab to close, and the window's own ⇧⌘W is the menu's.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isStudioShortcut(event, "w")) return
      if (!activeId) return

      event.preventDefault()
      closeShownTab(activeId)
    }

    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true })
    }
  }, [activeId])

  // The same intent from the menu, which is the way to it without a keyboard —
  // and, on the platforms where a session's terminal keeps Ctrl+W, the way to
  // it from a terminal.
  useEffect(
    () =>
      window.desktop.onMenuCommand((command) => {
        if (command === "close-tab" && activeId) closeShownTab(activeId)
      }),
    [activeId]
  )

  return (
    <TabStrip
      label="Open tabs"
      items={items}
      activeId={activeId}
      orientation={orientation}
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
      onSelect={selectTab}
      onClose={closeTab}
      onCloseOthers={closeOtherTabs}
      onCloseAll={closeAllTabs}
      onReorder={reorderTabs}
    />
  )
}
