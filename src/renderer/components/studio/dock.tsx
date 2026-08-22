import { ChevronDown, Play, SquareTerminal } from "lucide-react"
import type { ComponentType } from "react"

import { cn } from "@/lib/utils"
import { useDock, type DockTab } from "@/lib/dock"
import { anyRunning, useRun } from "@/lib/run/store"
import { IconButton } from "./icon-button"
import { RunPanel } from "./run-panel"
import { DockTerminal } from "./dock-terminal"

/**
 * The lower half of the right-hand column: a run script, and a shell.
 *
 * Conductor stacks `Setup / Run / Terminal` under its file list, and this is
 * that strip: a run script, and a shell in whichever project was last clicked.
 * Both are *about* what is on screen rather than things that were opened, which
 * is what makes them tabs of a dock instead of panes.
 *
 * The chevron collapses it rather than a close button, which is what Conductor
 * puts in the same corner: this half is one of two the column is split into,
 * and collapsing it gives the sections above the whole column back.
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
  const tab = useDock((state) => state.tab)
  const openOn = useDock((state) => state.openOn)
  const close = useDock((state) => state.close)

  // Derived outside the selector: one handing back a new object would re-render
  // on every line of output a run prints.
  const runs = useRun((state) => state.runs)
  const running = anyRunning(runs)

  return (
    <div className="flex h-full min-h-0 flex-col border-t">
      <div
        role="tablist"
        aria-label="Dock"
        className="flex h-9 shrink-0 items-center gap-0.5 border-b px-1.5"
      >
        <IconButton label="Hide" onClick={close} className="size-6 shrink-0">
          <ChevronDown className="size-3.5" />
        </IconButton>

        {TABS.map(({ id, label, Icon }) => {
          const active = tab === id
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
