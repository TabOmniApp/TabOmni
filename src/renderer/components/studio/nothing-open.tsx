import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

import { SECTIONS, SECTION_ACCENT, type Section } from "./activity-bar"

/**
 * What each section offers somebody with nothing open — the sidebar on the
 * left, named by what is actually in it.
 *
 * Terminal is the one that is not "pick something": its sidebar lists folders,
 * and a session has to be started before there is anything to pick.
 */
const HINTS: Record<Section, string> = {
  database: "Pick a table from the list on the left, or open a query tab.",
  api: "Pick a request from the list on the left, or create one.",
  mail: "Mail caught by the SMTP sink on the left opens here.",
  webhook: "Callbacks caught by the endpoint on the left open here.",
  terminal: "Start a session with + on the left — a shell, or Claude Code.",
  note: "Pick a note from the list on the left, or write a new one.",
}

/**
 * The pane with nothing in it: one notice for the whole workbench rather than
 * whichever panel happens to be showing.
 *
 * The tab strip belongs to the workbench and not to a panel, so "nothing is
 * open" is a fact about the workbench. Each panel answering it separately meant
 * the Database panel's "No table selected" spoke for all five — telling
 * somebody who had come to read captured mail to pick a table, because
 * `database` is the pane a fresh launch starts on.
 *
 * It follows the rail rather than the pane. The pane is where the last tab was,
 * and with no tabs there is no last one; the sidebar on screen is the only
 * thing that could be acted on from here.
 */
export function NothingOpen({ section }: { section: Section }) {
  const { Icon } = SECTIONS.find((entry) => entry.id === section)!

  return (
    <Empty className="size-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon" style={{ color: SECTION_ACCENT[section] }}>
          <Icon />
        </EmptyMedia>
        <EmptyTitle>Nothing open</EmptyTitle>
        <EmptyDescription>
          {HINTS[section]} Whatever you open joins the strip above, and stays
          there while you work in another panel.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
