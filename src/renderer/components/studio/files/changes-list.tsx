import type { GitChange } from "@shared/api"
import { useChanges } from "@/lib/files/changes"
import { GIT_LABELS, GIT_LETTERS, GIT_TONES } from "@/lib/files/git-status"
import { nameOf, parentOf, relativeTo } from "@/lib/files/paths"
import type { FileRoot } from "@/lib/files/roots"
import { cn } from "@/lib/utils"
import { SideRow } from "../side-row"

/**
 * The changed files of one checkout — the Explorer's `Changes` tab.
 *
 * The tree answers "what is in this checkout", which is thousands of rows most
 * of which nobody is thinking about; this answers "and what have I done to it",
 * which after an agent has run a turn is the often the only question worth
 * asking. A list rather than a filter over the tree, because the answer is a
 * dozen files scattered through it.
 *
 * A row opens **the checkout's one diff tab** rather than a tab of its own, so
 * reviewing twelve files is twelve clicks and one tab. That distinction is the
 * whole reason this list is allowed back into the sidebar: the one it replaced
 * opened a file tab per row, and reading a turn's work ended in closing tabs
 * afterwards.
 *
 * It does not read anything either. The list is drawn wherever this is, but the
 * count on the tab above it has to be right while the *tree* is showing, so
 * `useWatchChanges` is called by the panel rather than from here.
 */
export function ChangesList({ root }: { root: FileRoot }) {
  const changes = useChanges((state) => state.byRoot[root.id])
  const loading = useChanges((state) => state.loading.includes(root.id))

  if (changes === undefined) {
    // Only before the first answer. A re-read behind a list already on screen
    // says nothing — the rows are still true until they are replaced.
    return loading ? <Note>Reading…</Note> : null
  }

  if (changes.length === 0) {
    return <Note>Nothing has changed in this checkout.</Note>
  }

  return (
    <ul>
      {changes.map((change) => (
        <ChangeRow key={change.path} change={change} root={root} />
      ))}
    </ul>
  )
}

function ChangeRow({ change, root }: { change: GitChange; root: FileRoot }) {
  const active = useChanges(
    (state) => state.selectedPath[root.id] === change.path
  )

  // Where the file is, in the checkout's own terms, and empty for one sitting in
  // the checkout's own directory — where the name has already said everything.
  const directory = relativeTo(root.path, parentOf(change.path))

  return (
    <li>
      <SideRow
        active={active}
        title={`${change.path} — ${GIT_LABELS[change.state]}`}
        onClick={() => {
          // And the tab it opens is the checkout's one diff tab, not a tab of
          // this file's own.
          useChanges.getState().openPath(root.id, change.path)
          // And nothing else: the pane draws a file as a diff by asking for it
          // (`preferred` on `FilePane`), not by this writing `views` on the way
          // past. That write was a frame behind the path — the pane rendered the
          // new file as its own default viewer first, which for a `.md` is the
          // text editor — and a click that flickers through another editor is
          // the one thing a review list must not do. `Diff | Edit` in the header
          // is still what changes it, and still writes `views`.
        }}
      >
        {/*
         * One line, and the **directory** is what gives way on it.
         *
         * `min-w-0` with the default shrink on the directory and `shrink-0` on
         * the name is the whole of that: a narrow column eats into
         * `src/renderer/components/…` and leaves `chat-composer.tsx` whole,
         * which is the one part of a path anybody scans a list for. Truncating
         * the other way round gives a column of rows that all begin
         * `src/renderer/comp…` and end nowhere.
         *
         * `text-left` because a `<button>` centres its text by the browser's own
         * stylesheet, which Tailwind's preflight does not reset. Every other
         * `SideRow` hides it: their children are sized to their content, so
         * there is nothing for the alignment to distribute. This one grows.
         */}
        <span className="flex min-w-0 flex-1 items-baseline overflow-hidden text-left">
          {directory && (
            <span className="min-w-0 truncate text-[0.7rem] text-muted-foreground">
              {directory}/
            </span>
          )}
          <span
            className={cn("shrink-0 truncate text-xs", GIT_TONES[change.state])}
          >
            {nameOf(change.path)}
          </span>
        </span>

        {/* The letter and the counts travel together at the end, as the tree
            puts its letter at the end of a row. */}
        <span
          aria-hidden
          className={cn(
            "shrink-0 text-center font-mono text-[0.65rem]",
            GIT_TONES[change.state]
          )}
        >
          {GIT_LETTERS[change.state]}
        </span>
        <Counts change={change} />
      </SideRow>
    </li>
  )
}

/**
 * `+112 −8`, in the tree's own green and red.
 *
 * Nothing at all when there is no honest number — a binary file, or a new file
 * too large to have counted (see `MAX_COUNTED_NEW_FILES` in `main/git.ts`). A
 * zero is drawn: `+0 −0` is a real answer for a file whose only change is its
 * mode or its line endings, and it is the row that would otherwise look like a
 * bug.
 */
function Counts({ change }: { change: GitChange }) {
  if (change.added === null || change.removed === null) return null

  return (
    <span className="shrink-0 font-mono text-[0.65rem] tabular-nums">
      <span className={GIT_TONES.added}>+{change.added}</span>{" "}
      <span className={GIT_TONES.deleted}>−{change.removed}</span>
    </span>
  )
}

function Note({ children }: { children: string }) {
  return <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>
}
