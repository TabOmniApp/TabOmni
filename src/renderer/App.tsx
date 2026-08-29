import { lazy, Suspense, type ComponentType } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { isPanelWindowView, type PanelWindowView } from "@shared/api"

import { ThemeProvider } from "@/components/theme-provider"
import { StudioLoader } from "@/components/studio/studio-loader"

/**
 * A panel window asks for itself in the URL — `main.ts` opens this same
 * renderer with `?view=database` or `?view=api`.
 *
 * A query rather than a route: there is no router here and one flag is not a
 * reason to add one. Lazy, so the studio window never parses a panel window's
 * frame — the studio reaches the same panels through its own chunk.
 */
const PANEL_WINDOWS: Record<PanelWindowView, ComponentType> = {
  database: lazy(() =>
    import("@/components/studio/db/database-window").then((mod) => ({
      default: mod.DatabaseWindow,
    }))
  ),
  api: lazy(() =>
    import("@/components/studio/api/api-window").then((mod) => ({
      default: mod.ApiWindow,
    }))
  ),
}

/** Read once, at module scope: the URL a window was opened with does not
 * change under it — a navigation away is refused in `main.ts`. */
const view = new URLSearchParams(window.location.search).get("view")
const panelWindow = isPanelWindowView(view) ? view : null

export function App() {
  const Panel = panelWindow ? PANEL_WINDOWS[panelWindow] : null

  return (
    <div className="font-sans antialiased">
      <ThemeProvider defaultTheme="dark">
        {/*
          A toolbar of icon buttons sits a few pixels apart, so tooltips open on
          a delay: at zero they fire one after another as the pointer crosses
          the row on its way somewhere else.
        */}
        <TooltipProvider delay={400}>
          {Panel ? (
            // No splash: a panel window has no manifest to wait on, and a
            // launch screen for a list that is already there reads as a stall.
            <Suspense fallback={null}>
              <Panel />
            </Suspense>
          ) : (
            <StudioLoader />
          )}
        </TooltipProvider>
      </ThemeProvider>
    </div>
  )
}
