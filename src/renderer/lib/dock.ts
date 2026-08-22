import { create } from "zustand"

/**
 * The two stacked halves of the right-hand column, and which of them the lower
 * one is showing.
 *
 * Conductor's right side is the file list over a `Setup / Run / Terminal`
 * strip, and the lower strip is the shape being copied here: a dock for the
 * things that are *about* what is on screen rather than things that were
 * opened. The sections are the upper half; this is the lower one.
 *
 * The `Terminal` tab is Conductor's own, and an ad-hoc shell is all it is: the
 * work an agent does happens in a worktree's chat, so a shell is somewhere to
 * run `git log` beside it rather than a surface being demoted into a corner.
 * There was a Terminal *panel* — a pane, a tab strip, a chat view over the
 * transcript — and it is gone; this is what replaced it. One shell per project,
 * pointed at whichever was last clicked (`lib/shell/store.ts`).
 *
 * There was an `Assistant` tab in front of both of them — the workspace chat the
 * title bar's button opened — and it went with that panel. What is left is the
 * two tabs that are about a project rather than about the workspace.
 */
export type DockTab = "run" | "terminal"

type DockState = {
  open: boolean
  tab: DockTab
  /** Opens the dock on one tab, or switches to it when already open. */
  openOn: (tab: DockTab) => void
  close: () => void
  /** What the title bar's button does: shows the dock on whichever tab it was
   * last left on, or hides it. */
  toggle: () => void
}

export const useDock = create<DockState>((set, get) => ({
  open: false,
  tab: "terminal",

  openOn(tab) {
    set({ open: true, tab })
  },

  close() {
    set({ open: false })
  },

  toggle() {
    set({ open: !get().open })
  },
}))
