import { lazy, Suspense } from "react"

const Studio = lazy(() =>
  import("./studio").then((mod) => ({ default: mod.Studio }))
)

export function StudioLoader() {
  return (
    <Suspense
      fallback={
        <div className="grid h-svh place-items-center">
          <p className="animate-pulse text-sm text-muted-foreground">
            Loading the studio…
          </p>
        </div>
      }
    >
      <Studio />
    </Suspense>
  )
}
