import { useEffect, type ReactNode } from "react"

import { useSettings } from "@/lib/settings"

/**
 * The frame a panel gets when it is opened in a window of its own.
 *
 * A list down the left and the panel's own workspace beside it, with the
 * panel's tabs above that — the studio's shape with the workbench taken away:
 * no rail, no dock, no projects, and a strip holding one panel's tabs rather
 * than five panels' (`lib/tabs.ts` arranges the studio strip's mixture, and a
 * window with one panel in it has nothing to interleave).
 *
 * The settings are restored here rather than by the studio's boot, because a
 * panel window can be the only window open: `Studio`'s init effect never runs
 * in it. What each panel's own list needs beyond that is its own to ask for.
 */
export function PanelWindow({
  title,
  sidebar,
  tabs,
  children,
}: {
  /** The native title bar draws the page's title, and the one in `index.html`
   * is the studio's. */
  title: string
  sidebar: ReactNode
  tabs: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    void useSettings.getState().restore()
  }, [])

  useEffect(() => {
    document.title = title
  }, [title])

  return (
    <div className="flex h-screen min-h-0 bg-background text-foreground">
      <div className="flex w-64 shrink-0 flex-col border-r">{sidebar}</div>

      <div className="flex min-w-0 flex-1 flex-col">
        {tabs}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
