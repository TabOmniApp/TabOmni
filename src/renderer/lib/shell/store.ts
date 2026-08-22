import { create } from "zustand"

import { useStudio } from "../store"
import { useWorktrees } from "../worktree/store"

/**
 * One shell in the dock: a pty, in a project's directory or in one of its
 * worktrees.
 *
 * **Identified by where it runs**, which is the whole shape of this store:
 * there is one shell per place, and clicking a project in the column points the
 * dock at that project's. A pty's cwd is fixed when it starts and cannot be
 * moved, so "the terminal follows the project" can only mean a second pty and
 * not a `cd` sent into the first — and a `cd` would be worse anyway: it lands
 * in whatever is half-typed at the prompt, does nothing while a command is
 * running, and leaves one scrollback holding three projects' history.
 *
 * Not remembered across a launch, unlike the sessions this replaced. A shell
 * here is ad-hoc — something opened beside the work for one command — and
 * replaying five of them on every launch would be a surprise rather than a
 * convenience. The ptys are killed on quit either way.
 */
export type Shell = {
  /** The place it runs in, which is also its identity — see `placeId`. */
  id: string
  folderId: string
  /** The worktree it runs in, or null for the project's own checkout. An
   * **id**, never a path: main resolves the directory from its own record. */
  worktreeId: string | null
  /** Bumped to remount the pane, which is what starting a shell over is. */
  attempt: number
  exited: boolean
}

/** A place a shell can run in, before one has been started there. */
export type Place = { folderId: string; worktreeId: string | null }

type ShellState = {
  shells: Shell[]
  /** The shell the dock's Terminal tab is showing, or null when there is none. */
  activeId: string | null
  /**
   * Where the *next* shell would go: the project or checkout last clicked.
   *
   * Recorded rather than acted on, because acting on it would mean spawning a
   * process. Clicking a project is about the project — a pty started in it
   * because a row in a list was clicked, running unread behind a collapsed
   * dock, is exactly the kind of thing that has to be asked for. Showing the
   * Terminal tab is the asking; see `ensure`.
   */
  target: Place | null

  /** Points the dock at a place. Switches to that place's shell when it already
   * has one, and otherwise only records where the next one goes. */
  showFor: (folderId: string, worktreeId?: string | null) => void
  /**
   * Starts a shell for the target if it has none, and shows it.
   *
   * Called by the panel while it is on screen, which is what keeps a pty from
   * being started for a tab nobody opened. With nothing clicked yet it falls
   * back to the first folder rather than to a picker: a tab that opens onto a
   * question is a tab that has to be answered before it is any use.
   */
  ensure: () => void
  /** Ends the shell's pty and drops it. The place keeps no history: what is
   * opened for it next is a fresh shell. */
  close: (id: string) => void
  /** Starts a shell's pty over, in the same place. */
  restart: (id: string) => void
  setExited: (id: string, exited: boolean) => void
}

/**
 * The id of the shell that runs in a place.
 *
 * A worktree id when there is one, because that is the narrower answer: a
 * checkout of a project is a different directory from the project, and the two
 * must not share a pty. Both are uuids from the same generator, so one cannot
 * be mistaken for the other.
 */
export function placeId(folderId: string, worktreeId?: string | null): string {
  return worktreeId ?? folderId
}

export const useShells = create<ShellState>((set, get) => {
  /** Keeps only the shells whose place is still there, and re-points the dock
   * when the one it was showing went. The pty is not killed here: the pane
   * unmounts with the shell and its own teardown is what ends it, the same path
   * closing one takes. */
  function keep(alive: (shell: Shell) => boolean) {
    const shells = get().shells.filter(alive)
    if (shells.length === get().shells.length) return
    const gone = !shells.some((shell) => shell.id === get().activeId)
    set({
      shells,
      activeId: gone ? (shells.at(-1)?.id ?? null) : get().activeId,
    })
  }

  // A folder dropped from the workspace takes its shells with it: they run in a
  // directory the studio no longer points at, and the dock would be showing a
  // project nothing else in the app can say anything about.
  useStudio.subscribe((studio) => {
    const kept = new Set(studio.folders.map((folder) => folder.id))
    keep((shell) => kept.has(shell.folderId))
    const target = get().target
    if (target && !kept.has(target.folderId)) set({ target: null })
  })

  // And a removed worktree takes its own, for the stronger reason that the
  // directory is deleted rather than merely unlisted.
  useWorktrees.subscribe((state) => {
    const kept = new Set(state.worktrees.map((worktree) => worktree.id))
    keep((shell) => shell.worktreeId === null || kept.has(shell.worktreeId))
    const target = get().target
    if (target?.worktreeId && !kept.has(target.worktreeId))
      set({ target: null })
  })

  return {
    shells: [],
    activeId: null,
    target: null,

    showFor(folderId, worktreeId = null) {
      const id = placeId(folderId, worktreeId)
      set({
        target: { folderId, worktreeId },
        // Only onto a shell that is already running. A place with none stays a
        // target until the Terminal tab asks for it.
        activeId: get().shells.some((shell) => shell.id === id)
          ? id
          : get().activeId,
      })
    },

    ensure() {
      const guessed = (): Place | null => {
        const folder = useStudio.getState().folders[0]
        return folder ? { folderId: folder.id, worktreeId: null } : null
      }

      const place = get().target ?? guessed()
      if (!place) return

      const id = placeId(place.folderId, place.worktreeId)
      const known = get().shells.some((shell) => shell.id === id)
      set({
        target: place,
        shells: known
          ? get().shells
          : [...get().shells, { id, ...place, attempt: 0, exited: false }],
        activeId: id,
      })
    },

    close(id) {
      keep((shell) => shell.id !== id)
    },

    restart(id) {
      set({
        shells: get().shells.map((shell) =>
          shell.id === id
            ? { ...shell, attempt: shell.attempt + 1, exited: false }
            : shell
        ),
        activeId: id,
      })
    },

    setExited(id, exited) {
      set({
        shells: get().shells.map((shell) =>
          shell.id === id ? { ...shell, exited } : shell
        ),
      })
    },
  }
})
