import { create } from "zustand"

/**
 * The strip under the pane, and which of its two tabs is showing.
 *
 * Conductor's right side is a file list over a `Setup / Run / Terminal` strip,
 * and that lower strip is the shape being copied here: a dock for the things
 * that are *about* what is on screen rather than things that were opened. It
 * sits under the pane rather than under the Explorer, which is where Conductor
 * puts it — see The dock in `docs/design.md`.
 *
 * The `Terminal` tab is Conductor's own, and an ad-hoc shell is all it is: the
 * work an agent does happens in a project's chat, so a shell is somewhere to
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

/**
 * The height of the dock's tab strip, in px — `studio.tsx` gives it to the
 * panel as its `collapsedSize`, so that closing the dock leaves the strip on
 * screen instead of taking it away.
 *
 * That is the whole of what stops the chevron being a one-way door. There used
 * to be a button at the right of the title bar for the way back, from when the
 * dock collapsed to nothing; a strip that is always there answers it where the
 * question is asked, and the button is gone.
 *
 * One number rather than a Tailwind `h-9` in the strip and a `36` here: they
 * have to agree or the dock closes to a sliver of its own tabs, and nothing
 * would catch the drift.
 */
export const DOCK_STRIP_HEIGHT = 36

type DockState = {
  open: boolean
  tab: DockTab
  /** Opens the dock on one tab, or switches to it when already open. */
  openOn: (tab: DockTab) => void
  close: () => void
  /** What the chevron in the strip does: shows the dock on whichever tab it was
   * last left on, or hides it. */
  toggle: () => void
  /**
   * One tab's own toggle — `⌃\`` for the terminal.
   *
   * Showing that tab when it is not the one on screen, and hiding the dock when
   * it is. The editors' behaviour for the key, and the reason it is not
   * `openOn` plus `close` at the call site: whether the key shows or hides
   * depends on the tab as well as on `open`, which is this store's to know.
   */
  toggleTab: (tab: DockTab) => void
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

  toggleTab(tab) {
    const { open, tab: showing } = get()
    if (open && showing === tab) set({ open: false })
    else set({ open: true, tab })
  },
}))
