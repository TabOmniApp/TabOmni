import { create } from "zustand"

import type { GitFileState, GitStatusEntry } from "@shared/api"
import { useStudio } from "../store"
import { isInside } from "./paths"

/**
 * What git says about the workspace's files, for the colours Explorer draws.
 *
 * Kept apart from the files store, which is the disk: that one answers "what is
 * in this directory" and holds the tabs, and this one answers "and what is that
 * file to git". A row reads both, and neither has to be re-read when the other
 * changes — an editor keystroke marks a tab dirty without touching this, and a
 * commit in the terminal repaints the tree without a `readdir`.
 *
 * One `git status` per folder, which is the granularity git itself works at.
 * It is asked for when the workspace's folders change, when Explorer's Refresh
 * is pressed, and — debounced — whenever a watched directory reports something,
 * `.git` included: a commit made in a Terminal session is a repaint of the whole
 * tree, and nothing else would have told us about it.
 */

/**
 * How long a folder's status is left to settle before it is asked for.
 *
 * A `git status` is worth hundreds of milliseconds on a large repository, and
 * the events that trigger one arrive in bursts — a checkout, a build, an
 * `npm install` all rewrite many directories at once. One read at the end of
 * the burst is what somebody actually looks at.
 */
const SETTLE_MS = 400

/**
 * The colour each state is drawn in — the tree's rows, and the tabs above the
 * pane.
 *
 * These are the editors' own git colours rather than a set chosen here, and
 * deliberately: this is the one part of the studio somebody arrives at already
 * knowing, and a green that means "new" everywhere else must not mean something
 * else here. Hence the literal values instead of the palette's steps — Tailwind
 * has no step at this tan, and an `amber-400` beside it reads as a warning
 * rather than as an edit. Each is a light/dark pair for the same reason the
 * rest of the studio's colours are: the dark tan is illegible on white.
 *
 * Ignored is the exception and is deliberately not a hue: "this is not your
 * code" is said by receding, in the theme's own grey.
 */
export const GIT_TONES: Record<GitFileState, string> = {
  untracked: "text-[#007100] dark:text-[#73c991]",
  added: "text-[#007100] dark:text-[#73c991]",
  modified: "text-[#895503] dark:text-[#e2c08d]",
  deleted: "text-[#ad0707] dark:text-[#c74e39]",
  conflicted: "text-[#ad0707] dark:text-[#e4676b]",
  ignored: "text-muted-foreground/60",
}

/**
 * The letter at the end of a row — git's own, and the one every editor draws.
 *
 * Ignored has none on purpose. The letter is for a state somebody might act on,
 * and there are hundreds of ignored rows to one modified file: a column of `I`
 * down the whole of `node_modules` would be the loudest thing in the tree,
 * saying the least. Receding is the whole of what ignored has to say.
 */
export const GIT_LETTERS: Record<GitFileState, string | null> = {
  untracked: "U",
  added: "A",
  modified: "M",
  deleted: "D",
  conflicted: "C",
  ignored: null,
}

/** What the row's hover line says after the path, so the colours are readable
 * by somebody who has not learnt them — and by somebody who cannot see them. */
export const GIT_LABELS: Record<GitFileState, string> = {
  untracked: "new",
  added: "new",
  modified: "modified",
  deleted: "deleted",
  conflicted: "conflicted",
  ignored: "ignored",
}

/**
 * One folder's answer, split by how it is looked up.
 *
 * `files` is the exact matches and is the common case — a `Record` because a
 * row asks about one path and there may be thousands. `dirs` are the entries
 * that stand for a subtree, and have to be tried as prefixes; there are a
 * handful of them (`node_modules/`, `dist/`, a new directory somebody just
 * made), which is what makes walking them per row affordable.
 */
type FolderStatus = {
  files: Record<string, GitFileState>
  dirs: GitStatusEntry[]
}

type GitStatusState = {
  byFolder: Record<string, FolderStatus>
  /** Reads one folder now. */
  refresh: (folderId: string) => Promise<void>
  /** Reads every folder now — the workspace loading, and Explorer's Refresh. */
  refreshAll: () => Promise<void>
  /** Reads one folder once the changes stop arriving. */
  schedule: (folderId: string) => void
}

export const useGitStatus = create<GitStatusState>((set, get) => {
  /** A pending read per folder, so a burst of events is one `git status`. */
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  return {
    byFolder: {},

    async refresh(folderId) {
      const entries = await window.desktop
        .gitStatus(folderId)
        .catch(() => [] as GitStatusEntry[])

      // Dropped if the folder left the workspace while this was in flight, the
      // same way the studio store drops a branch read against one.
      if (!useStudio.getState().folders.some(({ id }) => id === folderId))
        return

      const status: FolderStatus = { files: {}, dirs: [] }
      for (const entry of entries) {
        if (entry.directory) status.dirs.push(entry)
        else status.files[entry.path] = entry.state
      }

      set((state) => ({ byFolder: { ...state.byFolder, [folderId]: status } }))
    },

    async refreshAll() {
      await Promise.all(
        useStudio.getState().folders.map((folder) => get().refresh(folder.id))
      )
    },

    schedule(folderId) {
      const pending = timers.get(folderId)
      if (pending) clearTimeout(pending)
      timers.set(
        folderId,
        setTimeout(() => {
          timers.delete(folderId)
          void get().refresh(folderId)
        }, SETTLE_MS)
      )
    },
  }
})

/**
 * What git says about one path, or null for a path it says nothing about —
 * which is the ordinary case, a tracked file with no changes in it.
 *
 * The exact answer first, then the directories that stand for a subtree. The
 * longest of those wins, so a file explicitly reported inside a directory that
 * was reported wholesale is drawn as what it is.
 */
export function gitStateOf(
  state: GitStatusState,
  filePath: string
): GitFileState | null {
  for (const folder of Object.values(state.byFolder)) {
    const exact = folder.files[filePath]
    if (exact !== undefined) return exact

    let match: GitStatusEntry | null = null
    for (const dir of folder.dirs) {
      if (!isInside(dir.path, filePath)) continue
      if (match === null || dir.path.length > match.path.length) match = dir
    }
    if (match) return match.state
  }
  return null
}

/** Which folder a path belongs to, for the store that is keyed by folder. */
export function folderIdOf(filePath: string): string | null {
  const folder = useStudio
    .getState()
    .folders.find((candidate) => isInside(candidate.path, filePath))
  return folder?.id ?? null
}

// The workspace's folders are what there is to read, so a folder arriving is
// what asks for its status and a folder leaving is what forgets it. This is
// also the launch read: `init` sets the folders once the manifest is in.
useStudio.subscribe((studio, previous) => {
  if (studio.folders === previous.folders) return

  const kept = new Set(studio.folders.map((folder) => folder.id))
  const { byFolder } = useGitStatus.getState()
  if (Object.keys(byFolder).some((id) => !kept.has(id))) {
    useGitStatus.setState({
      byFolder: Object.fromEntries(
        Object.entries(byFolder).filter(([id]) => kept.has(id))
      ),
    })
  }

  for (const folder of studio.folders) {
    if (byFolder[folder.id] === undefined) {
      void useGitStatus.getState().refresh(folder.id)
    }
  }
})
