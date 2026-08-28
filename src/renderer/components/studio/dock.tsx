import { ChevronDown, ChevronUp, Play, SquareTerminal } from "lucide-react"
import type { ComponentType } from "react"

import { cn } from "@/lib/utils"
import { useDock, DOCK_STRIP_HEIGHT, type DockTab } from "@/lib/dock"
import { anyRunning, useRun } from "@/lib/run/store"
import { IconButton } from "./icon-button"
import { RunPanel } from "./run-panel"
import { DockTerminal } from "./dock-terminal"

/**
 * The strip under the pane: a run script, and a shell in whichever project was
 * last clicked.
 *
 * Both are *about* what is on screen rather than things that were opened, which
 * is what makes them tabs of a dock instead of panes.
 *
 * It spans the pane's whole width, and that is the point of where it sits. It
 * was a panel inside the Explorer column — Conductor's `Setup / Run / Terminal`
 * under its file list — but Conductor's list is on the left and this one is a
 * capped 520px on the right, so the shell got 60-odd columns and the tree lost
 * its height whenever the dock opened. See `studio.tsx`.
 *
 * The chevron collapses it rather than a close button: the dock is one of two
 * halves the pane's column is split into, and collapsing it gives the editor
 * the whole column back.
 *
 * **The strip itself never goes.** Closing the dock collapses the panel to
 * `DOCK_STRIP_HEIGHT`, so what is left on screen is this row — the chevron
 * pointing the other way, and two tabs that each open the dock on themselves.
 * A dock that closed to nothing needed somewhere else to hold the way back, and
 * that was a button at the right of the title bar, three regions away from the
 * thing it showed. The row that closed it is the obvious place to reopen it.
 */
const TABS: {
  id: DockTab
  label: string
  Icon: ComponentType<{ className?: string }>
}[] = [
  { id: "run", label: "Run", Icon: Play },
  { id: "terminal", label: "Terminal", Icon: SquareTerminal },
]

export function Dock() {
  const open = useDock((state) => state.open)
  const tab = useDock((state) => state.tab)
  const openOn = useDock((state) => state.openOn)
  const toggle = useDock((state) => state.toggle)

  // Derived outside the selector: one handing back a new object would re-render
  // on every line of output a run prints.
  const runs = useRun((state) => state.runs)
  const running = anyRunning(runs)

  return (
    <div className="flex h-full min-h-0 flex-col border-t">
      <div
        role="tablist"
        aria-label="Dock"
        // The height is the panel's `collapsedSize`, so this row is exactly what
        // is left when the dock is shut.
        style={{ height: DOCK_STRIP_HEIGHT }}
        className="flex shrink-0 items-center gap-0.5 border-b px-1.5"
      >
        <IconButton
          label={open ? "Hide the panel" : "Show the panel"}
          onClick={toggle}
          className="size-6 shrink-0"
        >
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronUp className="size-3.5" />
          )}
        </IconButton>

        {TABS.map(({ id, label, Icon }) => {
          // Nothing is "selected" while the dock is shut: the strip is all
          // there is, and a lit tab would be pointing at a panel that is not
          // on screen.
          const active = open && tab === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => openOn(id)}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" />
              <span className="truncate">{label}</span>
              {/* The one piece of state a tab carries: a run is the thing here
                  that keeps going while another tab is showing. */}
              {id === "run" && running && (
                <span
                  aria-label="running"
                  style={{ backgroundColor: "var(--section-terminal)" }}
                  className="size-1.5 shrink-0 rounded-full"
                />
              )}
            </button>
          )
        })}
      </div>

      {/*
        Both panels stay mounted once the dock has shown them, hidden rather
        than unmounted — the same bargain the workbench's own panes make. The run
        panel holds a log that would otherwise be thrown away by switching tabs,
        while the process behind it kept printing into nothing; the terminal
        holds a pty, which does not survive being unmounted at all.

        `invisible` rather than `hidden`, because `display: none` destroys the
        scrolling box the log is pinned to the bottom of.
      */}
      <div className="relative min-h-0 flex-1">
        <div className={cn("absolute inset-0", tab !== "run" && "invisible")}>
          <RunPanel />
        </div>
        <div
          className={cn("absolute inset-0", tab !== "terminal" && "invisible")}
        >
          <DockTerminal />
        </div>
      </div>
    </div>
  )
}
