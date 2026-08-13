import { watch } from "node:fs"

/**
 * The Explorer's watchers: one per directory the tree has open.
 *
 * The panel used to have none at all, and Refresh was the whole answer — the
 * thing being avoided was a watcher on the *workspace*, which on a repository
 * with a `node_modules` in it means thousands of handles and a tree rebuilt by
 * every `npm install`. Watching only what is expanded keeps that bargain: the
 * number of handles is the number of open rows, none of them recursive, and a
 * folder nobody has looked in costs nothing. Collapsing a folder closes its
 * watcher, which is why the renderer sends the whole set rather than a diff —
 * `expanded` is the set, and one message that replaces it cannot drift from
 * what is on screen the way an add/remove pair can.
 *
 * What is reported is a directory, not a change: `fs.watch` says different
 * things on every platform — a rename here is two events, one event, or an
 * event naming the wrong half — and the tree re-reads the directory anyway. So
 * the event carries the one thing every platform agrees on.
 *
 * This is deliberately not the reliable path. `fs.watch` misses writes on
 * network and virtualised filesystems, the same caveat `transcript.ts` polls
 * around; Refresh is still in the header for when it stays quiet.
 */

/**
 * Long enough that one save — which is a write, a rename and a truncate on some
 * editors — is read once, short enough that the row appears while the hand is
 * still on the mouse.
 */
const DEBOUNCE_MS = 120

export class DirectoryWatchers {
  /** Watched directory to what closes it — the watcher, and any debounce still
   * pending, which would otherwise report a directory nobody is watching. */
  private readonly watched = new Map<string, () => void>()

  constructor(private readonly emit: (dir: string) => void) {}

  /** Watches exactly these directories: whatever is new is opened, whatever is
   * no longer here is closed. */
  set(dirs: string[]): void {
    const wanted = new Set(dirs)
    for (const dir of [...this.watched.keys()]) {
      if (!wanted.has(dir)) this.close(dir)
    }
    for (const dir of wanted) this.open(dir)
  }

  closeAll(): void {
    for (const dir of [...this.watched.keys()]) this.close(dir)
  }

  private open(dir: string): void {
    if (this.watched.has(dir)) return

    try {
      let debounce: NodeJS.Timeout | null = null

      // `persistent: false`, like the transcript's: a watcher must not be the
      // reason the process has something left to do.
      const watcher = watch(dir, { persistent: false }, () => {
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => {
          debounce = null
          this.emit(dir)
        }, DEBOUNCE_MS)
      })

      // A directory that goes while it is being watched — a branch switched
      // under it — surfaces as an error on some platforms and silence on
      // others. Closing is all there is to do either way; the tree keeps
      // drawing whatever it last read until something asks for it again.
      watcher.on("error", () => this.close(dir))

      this.watched.set(dir, () => {
        watcher.close()
        if (debounce) clearTimeout(debounce)
      })
    } catch {
      // Unreadable, or gone between the renderer expanding it and this. The
      // read behind the same row already failed and the tree says so there;
      // a second complaint from here would be about the same directory.
    }
  }

  private close(dir: string): void {
    this.watched.get(dir)?.()
    this.watched.delete(dir)
  }
}
