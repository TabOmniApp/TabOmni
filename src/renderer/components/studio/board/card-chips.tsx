import { CalendarDays, ChevronsDown, ChevronsUp, Minus } from "lucide-react"

import type { BoardPriority } from "@shared/api"
import { dueState } from "@/lib/board/cards"
import {
  BOARD_TONES,
  DUE_TONES,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  tagTone,
} from "@/lib/board/tones"
import { cn } from "@/lib/utils"

/**
 * The three marks a card can carry — a tag, a priority, a due date.
 *
 * Together in one file because they are one row on the card and one row in the
 * dialog, and drawn from `lib/board/tones.ts` rather than holding classes of
 * their own: a chip on a card and the same chip in the dialog's preview have to
 * be the same object, or the dialog stops being a preview.
 *
 * Each is a **shape as well as a colour**: the priority has an arrow, the date
 * has a calendar, a tag has neither. Colour alone would be the only difference
 * between three chips in a row, which fails for anyone who cannot separate
 * them — and fails for everyone at a glance, which is the only way a board is
 * ever read.
 */

/** The chip a tag draws as, in the hue its own text decides — see `tagTone`. */
export function TagChip({ tag }: { tag: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-[9rem] items-center truncate rounded px-1.5 py-0.5 text-[0.6875rem] leading-none font-medium",
        BOARD_TONES[tagTone(tag)].chip
      )}
    >
      {tag}
    </span>
  )
}

const PRIORITY_ICON: Record<BoardPriority, typeof ChevronsUp> = {
  high: ChevronsUp,
  medium: Minus,
  low: ChevronsDown,
}

/** The chip a priority draws as. Named as well as coloured, because `High` and
 * `Low` are two words and a board that made people learn a colour code for them
 * would be saving nothing. */
export function PriorityChip({ priority }: { priority: BoardPriority }) {
  const Icon = PRIORITY_ICON[priority]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[0.6875rem] leading-none font-medium",
        BOARD_TONES[PRIORITY_TONE[priority]].chip
      )}
    >
      <Icon className="size-3 shrink-0" />
      {PRIORITY_LABEL[priority]}
    </span>
  )
}

/**
 * A due date, coloured by how it reads against today.
 *
 * `today` is handed in rather than read here so that every card in a board
 * being drawn agrees about what day it is — and so the colour is a pure
 * function of two strings, which is what `dueState` is tested as.
 */
export function DueLine({
  due,
  today,
  className,
}: {
  due: string
  today: string
  className?: string
}) {
  const state = dueState(due, today)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[0.6875rem] leading-none tabular-nums",
        DUE_TONES[state],
        className
      )}
      title={state === "overdue" ? "Overdue" : undefined}
    >
      <CalendarDays className="size-3 shrink-0" />
      {formatDue(due)}
    </span>
  )
}

/**
 * `2026-05-31` as `31 May 2026`.
 *
 * The parts are read off the string and handed to `Date.UTC`, then formatted in
 * UTC — the round trip a bare `new Date("2026-05-31")` would make is exactly
 * the off-by-a-day the field's format was chosen to avoid (see `BoardCard.due`).
 * An unparseable value is drawn as itself rather than as `Invalid Date`.
 */
function formatDue(due: string): string {
  const [year, month, day] = due.split("-").map(Number)
  if (!year || !month || !day) return due
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)))
}
