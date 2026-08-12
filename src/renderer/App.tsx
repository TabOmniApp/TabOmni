import { TooltipProvider } from "@/components/ui/tooltip"

import { ThemeProvider } from "@/components/theme-provider"
import { StudioLoader } from "@/components/studio/studio-loader"

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
