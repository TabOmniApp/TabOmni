import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

/**
 * Skeleton loading for the chat pane while a turn is being sent.
 *
 * Replaces the single "Working…" spinner with a set of skeleton blocks that
 * mimic the shape of a real turn — a thinking line, a few tool-call rows,
 * and an assistant bubble — so the user can see something is happening and
 * has a sense of the structure being built.
 *
 * The skeleton is deliberately less structured than the real rows: it should
 * read as "something is happening, the page is alive" without pretending to
 * be exact content.
 */
export function ChatSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3">
      {/* Spinner line — still shows the turn is working */}
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Spinner className="size-3" />
        <span className="text-muted-foreground/60">Working…</span>
      </div>

      {/* Thinking skeleton */}
      <SkeletonBlock
        lines={1}
        className="ml-8 w-3/5"
        barClassName="h-3 rounded"
      />

      {/* Tool call skeleton */}
      <SkeletonBlock
        lines={2}
        className="ml-8"
        barClassName="h-[0.6rem] rounded"
      />

      {/* Assistant message skeleton */}
      <SkeletonBlock
        lines={3}
        className="ml-4"
        barClassName="h-3 rounded last:w-2/3"
      />
    </div>
  )
}

/**
 * A vertical stack of placeholder bars, each pulsing at the same rate.
 */
function SkeletonBlock({
  lines,
  className,
  barClassName,
}: {
  lines: number
  className?: string
  barClassName?: string
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className={cn("w-full bg-muted/50", barClassName ?? "h-3 rounded")}
        />
      ))}
    </div>
  )
}
