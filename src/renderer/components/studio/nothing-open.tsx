import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

import { SECTIONS, SECTION_ACCENT } from "./section-marks"
import { isSection } from "@/lib/sections"
import type { Pane } from "@/lib/store"

/**
 * Where the thing this pane last held is picked from — which is not one place
 * any more, and saying so is the whole job of these lines.
 *
 * The Explorer is the panel on the **right** and the projects are the column on
 * the **left**, so a hint saying "the sidebar" would be pointing at whichever of
 * the two the reader was not looking at. The other three have no list on screen
 * at all while `SIDEBAR_SECTIONS` is `Projects` alone — their panes and tabs
 * still work, so the honest thing to name is the way in that is still there:
 * `⌘P`, which indexes every table, request and note.
 */
const HINTS: Record<Pane, string> = {
  files: "Pick a file from the Explorer on the right.",
  changes:
    "Pick a file under Changes in the Explorer to read what this project has changed.",
  database: "Find a table with ⌘P, or open a query tab.",
  api: "Find a request with ⌘P.",
  note: "Find a note with ⌘P.",
  worktree:
    "Pick a chat under a project on the left, or start one from its row.",
}

/**
 * The pane with nothing in it: one notice for the whole workbench rather than
 * whichever panel happens to be showing.
 *
 * The tab strip belongs to the workbench and not to a panel, so "nothing is on
 * screen" is a fact about the workbench. Each panel answering it separately
 * meant the Database panel's "No table selected" spoke for all of them —
 * telling somebody who had come to read a note to pick a table, because
 * `database` is the pane a fresh launch starts on.
 *
 * Two things to say, and which one depends on the strip rather than on the
 * panel. With tabs in it, they are what to pick and the notice points up at
 * them; with none, there is nothing above to point at, so it points at the
 * sidebar on screen — which follows the rail, not the pane, because the pane
 * is where the last tab was and there is no last one.
 */
export function NothingOpen({
  pane,
  hasOpenTabs,
}: {
  pane: Pane
  hasOpenTabs: boolean
}) {
  // A chat has no section of its own — it is not one of the four kinds
  // the workspace holds — so the pane it draws in borrows the Explorer's mark
  // rather than inventing a fifth for an empty state.
  const mark = isSection(pane) ? pane : "files"
  const { Icon } = SECTIONS.find((entry) => entry.id === mark)!

  return (
    <Empty className="size-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon" style={{ color: SECTION_ACCENT[mark] }}>
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{hasOpenTabs ? "No tab open" : "Nothing open"}</EmptyTitle>
        <EmptyDescription>
          {hasOpenTabs ? (
            <>
              Pick one from the strip above — a table, a request, a chat and a
              note sit side by side there, whichever panel they belong to.
            </>
          ) : (
            <>
              {HINTS[pane]} Whatever you open joins the strip above, and stays
              there while you work in another panel.
            </>
          )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
