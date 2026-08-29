import { PanelLeftClose, PanelLeftOpen } from "lucide-react"

import { useProjects } from "@/lib/projects"
import { RAIL_WIDTH } from "@/lib/store"
import { IconButton } from "../icon-button"

/**
 * The left column's toggle, and the mirror of Explorer's — same width, same
 * argument, same failure it was written against: a column that collapses to
 * nothing leaves nowhere to hold the way back.
 *
 * It used to be in the column's own top row beside the traffic lights, and that
 * row had to be drawn twice — once in the column, once in the crumb bar — so
 * that the button could survive the column it collapsed. See `WindowLeftEdge`,
 * which is now the clearance and nothing else.
 *
 * **On the column's inner edge, not the window's.** Explorer's is against the
 * window because that is the side its column is collapsible from, and this one
 * is for the same reason: the handle it undoes is on the right of this column,
 * so the button belongs at the end the column moves from. It also keeps the
 * window's left edge to the traffic lights alone.
 *
 * Out of flow (`absolute`) for the reason Explorer's is: in flow it charged the
 * project list 36px of width on every row for a button used at the top.
 */
export function ProjectRail() {
  const sidebar = useProjects((state) => state.sidebar)
  const toggleSidebar = useProjects((state) => state.toggleSidebar)

  return (
    <div
      style={{ width: RAIL_WIDTH }}
      // `h-9` to put this button on the same line as the Explorer rail's, which
      // is the height of the tree's header over there. `top-0` is the top of
      // the column *under* its window strip, so the traffic lights are never
      // over it.
      className="absolute top-0 right-0 flex h-9 items-center justify-center"
    >
      <IconButton
        label={sidebar ? "Hide projects" : "Show projects"}
        // Into the window rather than above: the crumb bar is directly over
        // this, and the default would put the tooltip on it.
        side="bottom"
        onClick={toggleSidebar}
        className="size-6"
      >
        {sidebar ? (
          <PanelLeftClose className="size-3.5" />
        ) : (
          <PanelLeftOpen className="size-3.5" />
        )}
      </IconButton>
    </div>
  )
}
