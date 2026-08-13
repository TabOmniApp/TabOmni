import { create } from "zustand"

/**
 * How the activity rail is arranged.
 *
 * One key rather than two: the order and what is hidden are read and written
 * together, and split across two settings a half-applied restore would put a
 * section back in the wrong place.
 */
const LAYOUT_KEY = "activity-bar.layout"

/**
 * A way into the studio: one button on the activity rail, one sidebar.
 *
 * **Not every pane is one of these.** `Pane` in `lib/store.ts` is built from
 * this plus `terminal`, which is a pane with no rail button and no sidebar of
 * its own: a session opens from the Explorer sidebar's own Sessions list and
 * draws in a pane like any other tab. The two were the same union while every
 * pane had a rail section, and the comment here said they were never going to
 * diverge — then one did, so the subset is spelled out and the compiler is what
 * finds the places that assumed six.
 *
 * The ids live here rather than beside the rail's labels and icons because
 * `lib/store.ts` needs them to define `Pane`, and it already reads this module
 * for the layout — the other direction would be a cycle through a component.
 */
export type Section = "files" | "database" | "api" | "mail" | "note"

/** Every section, in the rail's own order — see `SECTIONS` in
 * `components/studio/activity-bar.tsx`, which is this list with a label and an
 * icon against each id. */
export const SECTION_IDS: Section[] = [
  "files",
  "database",
  "api",
  "mail",
  "note",
]

export function isSection(value: string): value is Section {
  return (SECTION_IDS as string[]).includes(value)
}

/** Fire-and-forget, like every other settings write in the renderer — nobody
 * should wait on disk to see a section move. */
function persist(order: string[], hidden: string[]) {
  void window.desktop
    .setSetting(LAYOUT_KEY, JSON.stringify({ order, hidden }))
    .catch((error) => {
      console.error("Could not save the activity bar layout", error)
    })
}

function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

type RailState = {
  /**
   * Section ids, in the order the rail should show them.
   *
   * Held as plain strings and reconciled against the rail's own list wherever
   * it is read, so an id left here by a section a later build renamed or
   * dropped is inert rather than a hole in the rail — the same bargain
   * `tabOrder` makes in `lib/store.ts`. Empty until the first drag, when the
   * rail's own order is the answer.
   */
  order: string[]
  /** Section ids the user has taken off the rail. Still real sections — what
   * is hidden is the way in, not the panel. */
  hidden: string[]

  /** Reads the remembered layout. Idempotent: Strict Mode mounts twice. */
  restore: () => Promise<void>
  setOrder: (order: string[]) => void
  setHidden: (hidden: string[]) => void
  /** Back to the rail's own order, with nothing hidden. */
  reset: () => void
}

let restorePromise: Promise<void> | null = null

export const useRail = create<RailState>((set, get) => ({
  order: [],
  hidden: [],

  restore() {
    restorePromise ??= (async () => {
      let raw: string | null = null
      try {
        raw = await window.desktop.getSetting(LAYOUT_KEY)
      } catch (error) {
        console.error("Could not read the activity bar layout", error)
      }
      if (!raw) return

      try {
        const stored = JSON.parse(raw) as Record<string, unknown>
        set({ order: ids(stored.order), hidden: ids(stored.hidden) })
      } catch {
        // A layout is not worth reporting a parse failure over: the rail's own
        // order is a working answer, and the next change overwrites the file.
      }
    })()
    return restorePromise
  },

  setOrder(order) {
    set({ order })
    persist(order, get().hidden)
  },

  setHidden(hidden) {
    set({ hidden })
    persist(get().order, hidden)
  },

  reset() {
    set({ order: [], hidden: [] })
    persist([], [])
  },
}))
