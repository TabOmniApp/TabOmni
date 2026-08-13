import { execFile } from "node:child_process"
import { realpath } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import type { GitFileState, GitStatusEntry } from "../shared/api"

const run = promisify(execFile)

/**
 * What is left of the git integration: the branch name beside a folder, and
 * the state of the files under it.
 *
 * The panel that read a working tree — diffs, staging, commits, and the GitHub
 * pull requests beside them — was removed, and none of that is coming back
 * through here. What these two answer is what a file *is*, which Explorer
 * colours its rows with: a file nobody has committed reads differently from one
 * that has been edited, and a `node_modules` that is the same grey as `src` is
 * a tree that makes somebody read the names to find the code.
 */
export async function currentBranch(dir: string): Promise<string | null> {
  try {
    const branch = (await git(dir, ["branch", "--show-current"])).trim()
    // Empty output means a detached HEAD rather than no branch at all.
    if (branch) return branch
    const sha = (await git(dir, ["rev-parse", "--short", "HEAD"])).trim()
    return sha ? `detached @ ${sha}` : null
  } catch {
    return null
  }
}

/**
 * How many entries are carried back before the rest are dropped.
 *
 * A ceiling rather than a promise, like the palette's index. It is here for the
 * repository somebody has just run a formatter over, or checked out a branch
 * across: the renderer holds this in a store and looks a path up in it per row,
 * and past a certain size the colours stop being information anyway.
 */
export const MAX_STATUS_ENTRIES = 5000

/**
 * Every path under `dir` git has something to say about — changed, new,
 * conflicted, or ignored.
 *
 * `--ignored` without a mode is `traditional`, and that is the point: paired
 * with the default untracked mode it reports a wholly ignored directory as one
 * entry — `node_modules/` — instead of the hundred thousand files under it. The
 * renderer treats a directory entry as a prefix, so one line greys the subtree.
 * A new directory arrives the same way (`?? build-output/`), which is also why
 * the tree can colour a folder without aggregating anything.
 *
 * Paths come back absolute, and rooted at `dir` rather than at the repository:
 * porcelain output is relative to the repository root, which is not necessarily
 * the folder — somebody can point the studio at `packages/web` of a monorepo —
 * and `rev-parse` answers with the *resolved* root, so a folder reached through
 * a symlink would otherwise come back under a prefix no row in the tree has.
 * Both are corrected here, where git's own answers are, rather than guessed at
 * in the renderer.
 *
 * A folder that is not a repository at all is not an error: it is the ordinary
 * case for a directory somebody keeps notes in, and it has no state to report.
 */
export async function workingTree(dir: string): Promise<GitStatusEntry[]> {
  let root: string
  try {
    root = (await git(dir, ["rev-parse", "--show-toplevel"])).trim()
    if (!root) return []
  } catch {
    return []
  }

  // Where the folder sits inside the repository, in the repository's own terms.
  // `realpath` because that is what git answered with, and comparing a resolved
  // path to an unresolved one is how `/tmp` on macOS becomes "outside the repo".
  const inRepo = await realpath(dir)
    .then((resolved) => path.relative(root, resolved))
    .catch(() => "")

  let stdout: string
  try {
    stdout = await git(dir, [
      // Git's own flag for a program that reads status in the background, and
      // load-bearing here: a plain `git status` refreshes the index and writes
      // `.git/index` when it does, which is a directory this app watches —
      // status would report a change to itself, and the read would run again.
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
      "-z",
      "--ignored",
      // Explicit rather than inherited: `status.showUntrackedFiles=all` in
      // somebody's config would expand every ignored directory into its files,
      // which is the one output size this cannot afford.
      "--untracked-files=normal",
    ])
  } catch {
    return []
  }

  return parseStatus(stdout).map((entry) => ({
    ...entry,
    // Back onto the path the tree actually holds: what is under the folder is
    // addressed from the folder, and anything else in the repository keeps the
    // repository's own path — it matches no row either way, and inventing one
    // for it would be worse than carrying it.
    path: isUnder(inRepo, entry.relative)
      ? path.join(dir, path.relative(inRepo, entry.relative))
      : path.join(root, entry.relative),
  }))
}

/** Whether a repo-relative path is inside a repo-relative directory. `""` is
 * the root, and holds everything. */
function isUnder(dir: string, target: string): boolean {
  if (dir === "") return true
  return target === dir || target.startsWith(dir + "/")
}

/**
 * Porcelain v1 into entries.
 *
 * Apart from the transport so it can be read — and tested — as what it is: a
 * parser of a format with two shapes in it. Records are NUL-terminated (so
 * nothing is quoted or escaped, which is the whole reason for `-z`), and a
 * rename or a copy is two records, the destination and then the source. The
 * source is dropped: it is where the file *was*, and no row in the tree stands
 * for it.
 *
 * Paths stay as git wrote them — relative to the repository root, with forward
 * slashes — and are made absolute by the caller, which is the one that knows
 * where the folder sits in the repository.
 */
export function parseStatus(
  stdout: string
): (Omit<GitStatusEntry, "path"> & { relative: string })[] {
  const records = stdout.split("\0")
  const entries: (Omit<GitStatusEntry, "path"> & { relative: string })[] = []

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    // The trailing empty string after the last NUL, and nothing shorter than
    // `XY ` can be a record.
    if (record === undefined || record.length < 4) continue

    const x = record[0]!
    const y = record[1]!
    const target = record.slice(3)

    // The record after a rename or a copy is where it came from, and is not a
    // record of its own — stepping over it here is what keeps it from being
    // read as a status of `R ` or a path of its own.
    if (x === "R" || x === "C" || y === "R" || y === "C") index += 1

    if (entries.length >= MAX_STATUS_ENTRIES) break

    // Git ends a directory with a separator when the whole of it is untracked
    // or ignored; the renderer reads that as "and everything under it".
    const directory = target.endsWith("/")
    const relative = directory ? target.slice(0, -1) : target

    entries.push({ relative, state: stateOf(x, y), directory })
  }

  return entries
}

/**
 * The two status letters as one thing to draw.
 *
 * The index and the working tree are collapsed deliberately. This is a tree of
 * files and not a staging area — there is no way to stage anything in the
 * studio — so "changed, and not committed" is the whole of what a row can
 * usefully say. Conflicts are kept apart because they are the one state where
 * the file on disk is not something anybody wrote.
 */
function stateOf(x: string, y: string): GitFileState {
  if (x === "?") return "untracked"
  if (x === "!") return "ignored"
  // Both sides having an opinion, or either being `U`, is what a conflict looks
  // like in porcelain v1 — `DD`, `AU`, `UU`, and so on.
  if (
    x === "U" ||
    y === "U" ||
    (x === "A" && y === "A") ||
    (x === "D" && y === "D")
  ) {
    return "conflicted"
  }
  // The working tree first: a file staged as modified and then deleted on disk
  // is, to somebody looking at the tree, gone.
  if (y === "D" || x === "D") return "deleted"
  if (x === "A") return "added"
  return "modified"
}

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd: dir,
    windowsHide: true,
    // The default 1 MB is a few thousand paths, which `--ignored` can reach in
    // a repository with enough build output — and an overrun is an exception
    // rather than a truncated read.
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}
