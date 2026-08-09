import type { MouseEvent, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * One selectable row in a sidebar list: a file, or a table.
 *
 * Both sidebars had their own copy of this button — same height, same
 * active and hover treatment, but each written out by hand and neither
 * quite matching. `indent` is the tree depth; the base inset is built in so a
 * flat list and a nested one still align.
 *
 * A full-bleed row is the one place the shared `Button` has to be talked out of
 * its own shape — centred, rounded, inset — so that reshaping happens once,
 * here, rather than at each call site.
 */
export function SideRow({
  active = false,
  indent = 0,
  title,
  onClick,
  onContextMenu,
  className,
  children,
}: {
  active?: boolean
  indent?: number
  title?: string
  onClick?: () => void
  /** For a row that carries its own right-click menu. */
  onContextMenu?: (event: MouseEvent) => void
  className?: string
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      aria-current={active ? "true" : undefined}
      style={{ paddingLeft: `${indent * 0.75 + 0.75}rem` }}
      className={cn(
        "h-6 w-full justify-start gap-1.5 rounded-none pr-2 text-xs font-normal",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        className
      )}
    >
      {children}
    </Button>
  )
}
