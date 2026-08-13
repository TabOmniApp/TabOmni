import { FilePen } from "lucide-react"

import { useFiles } from "@/lib/files/store"
import { nameOf, parentOf } from "@/lib/files/paths"

/**
 * The files this conversation has written, from its own transcript.
 *
 * Two things a chat cannot otherwise say. The first is what happened: a turn's
 * `Edit` calls are drawn as tool cards, in order, and are the first thing
 * switched off by "Show tool calls" — so the answer to "what did it change"
 * was a scroll back through a turn, or a `git status` in the terminal view. The
 * second is where: a path in a tool card is text, and the file it names is a
 * click away in Explorer.
 *
 * Newest last, matching the order of the transcript above it, so the file the
 * agent has just finished with is the one nearest the composer.
 */
export function TouchedFiles({ paths }: { paths: string[] }) {
  if (paths.length === 0) return null

  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-t px-3 py-1.5">
      <FilePen className="size-3 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-[0.65rem] text-muted-foreground uppercase">
        Changed
      </span>

      {paths.map((path) => (
        <button
          key={path}
          type="button"
          title={path}
          // `open` rather than `select`: a file the session wrote may never have
          // been read by this app at all, and the pane needs the text before it
          // can draw it. It also brings Explorer's own sidebar with it, which is
          // where the row for this file is.
          onClick={() => void useFiles.getState().open(path)}
          className="shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {nameOf(path)}
          <span className="ml-1 text-muted-foreground/60">
            {shortDir(path)}
          </span>
        </button>
      ))}
    </div>
  )
}

/**
 * The name of the directory above the file, and nothing for a path with no
 * directory in it — `parentOf` answers with the path itself there.
 *
 * Two `index.ts` in a row is the case this is for; the whole path is on the
 * hover line, since a strip of absolute paths is a strip of one repeated
 * prefix.
 */
function shortDir(path: string): string {
  const dir = parentOf(path)
  return dir === path ? "" : nameOf(dir)
}
