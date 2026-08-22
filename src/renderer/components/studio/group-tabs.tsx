import { Plus } from "lucide-react"

import {
  closeOthersInGroup,
  closePanelTab,
  closeTab,
  groupWorktreeId,
  reorderWithinGroup,
  selectTab,
  useShownGroup,
} from "@/lib/panels"
import type { Pane } from "@/lib/store"
import { bare } from "@/lib/tabs"
import { useWorktreeChats } from "@/lib/worktree-chat/store"
import { IconButton } from "./icon-button"
import { useTabItems } from "./tab-items"
import { TabStrip } from "./tab-strip"

/** What the strip inside a folder's tab is a list of, per panel. Read by
 * assistive tech, and the reason the two strips are not both "Open tabs". */
const LABELS: Record<Pane, string> = {
  files: "Files in this folder",
  // Never drawn: `Changes` has no `groupOf`, so its tabs never fold.
  changes: "Changed files",
  database: "Tables in this schema",
  api: "Requests in this folder",
  note: "Notes in this folder",
  worktree: "Chats in this worktree",
}

/** The Database panel's one group that is not a schema: the console's own
 * tabs, which belong to no schema and gather together. */
const DB_QUERIES = ""

/**
 * The second strip: one folder's own tabs, under the workbench strip's tab for
 * that folder.
 *
 * Nothing when the panel on screen is not grouping, which is every panel but
 * the worktree chats until somebody turns grouping on in Settings — so the
 * studio looks exactly as it did, and the row only appears where it has
 * something to say.
 *
 * Drawn by the workbench above the pane rather than by each panel, for the same
 * reason the outer strip is: a strip of tabs behaves the same way whatever it
 * is a strip of, and five copies of it would agree only by accident. What is
 * genuinely per panel is a tab's label and icon (`useTabItems`, shared with the
 * strip above) and, for the worktree chats, the `+` — a checkout's tab is the
 * one place another chat can be started in the branch already on screen without
 * being asked which one.
 */
export function GroupTabs({ pane }: { pane: Pane }) {
  const shown = useShownGroup(pane)
  const byId = useTabItems()
  const create = useWorktreeChats((state) => state.create)

  if (!shown) return null

  // Null for a group that is not a checkout's, which is every other panel's.
  const worktreeId = groupWorktreeId(shown.group)

  // `shown` speaks in strip ids, which is what this whole component handles:
  // the items are keyed by them, the strip marks and hands back one, and
  // `selectTab` takes one. Only the three calls that reach past the strip into
  // the panel want the panel's own id, and `bare` is where each takes it off.
  const items = shown.members.flatMap((member) => {
    const item = byId.get(member)
    return item ? [item] : []
  })

  return (
    <TabStrip
      label={
        pane === "database" && shown.group === DB_QUERIES
          ? "Query tabs"
          : LABELS[pane]
      }
      items={items}
      activeId={shown.active}
      trailing={
        pane === "worktree" && worktreeId ? (
          <IconButton
            label="New chat in this worktree"
            onClick={() => void create(worktreeId)}
          >
            <Plus />
          </IconButton>
        ) : undefined
      }
      onSelect={selectTab}
      onClose={(id) => closePanelTab(pane, bare(id, pane))}
      onCloseOthers={(id) =>
        closeOthersInGroup(pane, shown.group, bare(id, pane))
      }
      // Every tab in this folder, which is exactly what closing the folder's
      // own tab in the workbench strip does.
      onCloseAll={() => closeTab(shown.id)}
      onReorder={(ids) =>
        reorderWithinGroup(
          pane,
          shown.group,
          ids.map((id) => bare(id, pane))
        )
      }
    />
  )
}
