import { useId } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { AlertTriangle } from "lucide-react"

import { useStudio, type SetupState } from "@/lib/store"
import { TitleBarDragStrip } from "./title-bar"

/**
 * Shown while an imported project is being added to the studio.
 *
 * Covering the studio while that happens is deliberate: the workbench behind
 * this is showing a project that is halfway open, and there is nothing useful
 * to do in it yet.
 */
export function ProjectSetupOverlay() {
  const setup = useStudio((state) => state.setup)

  if (!setup) return null
  return <SetupCard setup={setup} />
}

function SetupCard({ setup }: { setup: SetupState }) {
  const dismissSetup = useStudio((state) => state.dismissSetup)

  const titleId = useId()

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm"
    >
      <TitleBarDragStrip />
      <div className="w-88 max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-6 shadow-lg">
        <h2 id={titleId} className="truncate font-heading text-sm font-medium">
          Opening {setup.name}
        </h2>

        {setup.error ? (
          <>
            <p className="mt-3 flex items-start gap-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {setup.error}
            </p>
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={dismissSetup}>
                Continue to the studio
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            Reading its files…
          </p>
        )}
      </div>
    </div>
  )
}
