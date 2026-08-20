import type { CSSProperties, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * An icon-only control with a real tooltip.
 *
 * The workbench is full of these — new file, reload, toggle a pane — and they
 * used to lean on the `title` attribute, which the OS renders in its own style
 * after its own delay. `label` does three jobs here: the tooltip, the
 * accessible name, and nothing else to keep in sync.
 */
export function IconButton({
  label,
  onClick,
  disabled = false,
  pressed,
  variant = "ghost",
  side,
  className,
  style,
  children,
}: {
  label: string
  /** Which side the tooltip goes on. Worth setting only where the default
   * (above) has nowhere to go — a button against the top of the window. */
  side?: "top" | "bottom" | "left" | "right"
  onClick?: () => void
  disabled?: boolean
  /** Set for a toggle, which dims itself when off. */
  pressed?: boolean
  variant?: "ghost" | "outline"
  className?: string
  /** For the one thing a class cannot carry: a section's hue, which lives in a
   * CSS variable Tailwind never sees as a literal. */
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant={variant}
            disabled={disabled}
            onClick={onClick}
            aria-label={label}
            aria-pressed={pressed}
            className={className}
            style={style}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}
