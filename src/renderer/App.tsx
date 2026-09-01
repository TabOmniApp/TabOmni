import { TooltipProvider } from "@/components/ui/tooltip"

import { ThemeProvider } from "@/components/theme-provider"
import { StudioLoader } from "@/components/studio/studio-loader"

/**
 * The studio, and the whole of what this renderer draws.
 *
 * It used to read a `?view=` off its own URL and draw the Database or API panel
 * on its own instead — `main.ts` opened this same renderer in a second window
 * for each. Both panels are gone, so there is one window, no query to read and
 * no lazy panel chunk to pick between; see `docs/design.md` § Database and API,
 * removed.
 */
export function App() {
  return (
    <div className="font-sans antialiased">
      <ThemeProvider defaultTheme="dark">
        {/*
          A toolbar of icon buttons sits a few pixels apart, so tooltips open on
          a delay: at zero they fire one after another as the pointer crosses
          the row on its way somewhere else.
        */}
        <TooltipProvider delay={400}>
          <StudioLoader />
        </TooltipProvider>
      </ThemeProvider>
    </div>
  )
}
