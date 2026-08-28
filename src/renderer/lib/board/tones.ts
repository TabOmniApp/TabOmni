import type { BoardTone } from "@shared/api"

/**
 * What a column's hue draws as — the classes for the id a record holds.
 *
 * The split `GIT_TONES` has from `GitFileState`: the record on disk says which
 * of six was picked, and what that is worth in pixels lives here, so a change of
 * palette is one file and touches nothing that was saved.
 *
 * Four uses per tone, and they are deliberately not one colour applied at four
 * strengths:
 *
 * - `dot` is the mark in the column header — the only place a tone is at full
 *   strength, because it is the thing being read.
 * - `head` tints the header behind it, faintly. A column is furniture and a card
 *   is content; a header at card strength would compete with the cards under it.
 * - `edge` is the card's left border, which is what carries the hue **down** the
 *   column so a card dragged into the wrong one is visible as wrong at a glance.
 * - `ring` is the insertion line while dragging, so the gap being aimed at is
 *   the colour of the column it is in rather than one accent for the whole app.
 *
 * `slate` is the neutral, and it is first in the picker for that reason: a
 * column with nothing to say about itself should be able to say nothing.
 */
export const BOARD_TONES: Record<
  BoardTone,
  { dot: string; head: string; edge: string; ring: string }
> = {
  slate: {
    dot: "bg-slate-400 dark:bg-slate-500",
    head: "bg-slate-500/5 dark:bg-slate-400/5",
    edge: "border-l-slate-300 dark:border-l-slate-600",
    ring: "bg-slate-400 dark:bg-slate-500",
  },
  blue: {
    dot: "bg-blue-500 dark:bg-blue-400",
    head: "bg-blue-500/8 dark:bg-blue-400/8",
    edge: "border-l-blue-400 dark:border-l-blue-500",
    ring: "bg-blue-500 dark:bg-blue-400",
  },
  violet: {
    dot: "bg-violet-500 dark:bg-violet-400",
    head: "bg-violet-500/8 dark:bg-violet-400/8",
    edge: "border-l-violet-400 dark:border-l-violet-500",
    ring: "bg-violet-500 dark:bg-violet-400",
  },
  amber: {
    dot: "bg-amber-500 dark:bg-amber-400",
    head: "bg-amber-500/8 dark:bg-amber-400/8",
    edge: "border-l-amber-400 dark:border-l-amber-500",
    ring: "bg-amber-500 dark:bg-amber-400",
  },
  emerald: {
    dot: "bg-emerald-500 dark:bg-emerald-400",
    head: "bg-emerald-500/8 dark:bg-emerald-400/8",
    edge: "border-l-emerald-400 dark:border-l-emerald-500",
    ring: "bg-emerald-500 dark:bg-emerald-400",
  },
  rose: {
    dot: "bg-rose-500 dark:bg-rose-400",
    head: "bg-rose-500/8 dark:bg-rose-400/8",
    edge: "border-l-rose-400 dark:border-l-rose-500",
    ring: "bg-rose-500 dark:bg-rose-400",
  },
}

/** What the picker calls each of them. */
export const TONE_LABEL: Record<BoardTone, string> = {
  slate: "Neutral",
  blue: "Blue",
  violet: "Violet",
  amber: "Amber",
  emerald: "Green",
  rose: "Rose",
}

/** The tone of a column that names one this build has never heard of — a board
 * written by a newer version. The neutral, which is the one answer that is safe
 * in both directions. */
export function toneOf(tone: string): BoardTone {
  return tone in BOARD_TONES ? (tone as BoardTone) : "slate"
}
