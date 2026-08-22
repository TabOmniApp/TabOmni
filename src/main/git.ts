import { execFile } from "node:child_process"
import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import type { GitChange, GitFileState, GitStatusEntry } from "../shared/api"

const run = promisify(execFile)

/**
 * What is left of the git integration: the branch name beside a folder, and
 * the state of the files under it.
 *
 * The panel that read a working tree — staging, commits, and the GitHub pull
 * requests beside them — was removed, and none of *that* is coming back through
 * here: there is still no way to stage anything and nothing here talks to a
 * forge. What is answered is what a file **is** — which Explorer colours its
 * rows with, since a file nobody has committed reads differently from one that
 * has been edited, and a `node_modules` the same grey as `src` is a tree that
 * makes somebody read the names to find the code — and, for the Changes list,
 * which files those are and how far each has moved from `HEAD`.
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
 * A status entry with the path git itself used still on it.
 *
 * `path` is absolute and rooted at the folder, which is what the tree's rows
 * are addressed by; `relative` is the repository's own term for the same file,
 * which is what every other git command answers in. `changes` matches one
 * against the other, and the alternative — rebuilding the absolute path from a
 * second command's output — is how a repository reached through a symlink ends
 * up with two spellings of one file (`/tmp` on macOS is `/private/tmp`).
 */
export type StatusEntry = GitStatusEntry & { relative: string }

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
export async function workingTree(dir: string): Promise<StatusEntry[]> {
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
/**
 * How many untracked files are worth counting the lines of.
 *
 * An untracked file is not in any diff, so the only way to say `+N` for one is
 * to read it. That is cheap for the handful somebody has just written and not
 * cheap for a directory of generated output that is untracked rather than
 * ignored — so past this the rows say the letter and no number, which is what
 * they would say for a binary file anyway.
 */
const MAX_COUNTED_NEW_FILES = 200

/** And how large one of those may be. A minified bundle is one line and twelve
 * megabytes; reading it to print `+1` is the read that is not worth making. */
const MAX_COUNTED_BYTES = 2 * 1024 * 1024

/**
 * What has changed in a checkout, with how far each file has moved.
 *
 * `workingTree` is the same `git status` read from the same place, and this is
 * deliberately built on it rather than beside it: which files are changed is one
 * question with one answer, and two readers of porcelain output disagreeing
 * about a conflict or a rename is the kind of bug nobody finds. What is added
 * here is the counts, and what is taken away is the ignored — a repository's
 * ignored files are not anybody's changes, and they are most of the entries.
 *
 * The counts come from `--numstat` against `HEAD`, which covers everything git
 * is already tracking. An untracked file appears in no diff at all, so it is
 * counted by reading it, under the two caps above. A repository with no commit
 * yet has no `HEAD` to diff against: the files are still listed, with no
 * numbers, which is the honest answer rather than an empty panel.
 */
export async function changes(dir: string): Promise<GitChange[]> {
  const entries = (await workingTree(dir)).filter(
    (entry) => entry.state !== "ignored"
  )
  if (entries.length === 0) return []

  const counts = await numstat(dir)

  // Newest work first would need a stat per row; alphabetical by path is what a
  // list of files in a repository is expected to be, and is stable while
  // somebody is reading it — a row that moves as it is clicked is worse than a
  // row in the wrong order.
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path))

  let counted = 0
  const changed: GitChange[] = []
  for (const entry of sorted) {
    const numbers = counts.get(entry.relative)
    if (numbers) {
      changed.push({ path: entry.path, state: entry.state, ...numbers })
      continue
    }

    // Not in the diff: either untracked, or a repository with no `HEAD`.
    const newLines =
      !entry.directory &&
      entry.state === "untracked" &&
      counted < MAX_COUNTED_NEW_FILES
        ? await countLines(entry.path)
        : null
    if (newLines !== null) counted += 1

    changed.push({
      path: entry.path,
      state: entry.state,
      added: newLines,
      removed: newLines === null ? null : 0,
    })
  }

  return changed
}

/**
 * `--numstat` against `HEAD`, keyed by the same absolute path the entries carry.
 *
 * `--no-renames` on purpose: porcelain status reports a rename as one entry for
 * the new name, so a numstat that split it into `old => new` would key a count
 * under a path no row has and leave the row that exists with none.
 */
async function numstat(
  dir: string
): Promise<Map<string, { added: number; removed: number }>> {
  const counts = new Map<string, { added: number; removed: number }>()

  let stdout: string
  try {
    stdout = await git(dir, [
      // For the reason in `workingTree`: this app watches `.git`, and a read
      // that writes the index would report a change to itself.
      "--no-optional-locks",
      "diff",
      "--numstat",
      "-z",
      "--no-renames",
      "HEAD",
      "--",
    ])
  } catch {
    // No commits yet, or not a repository. Both mean no numbers.
    return counts
  }

  // `added\tremoved\tpath` per NUL-terminated record, with `-` for either
  // number when git will not count a binary file's lines.
  for (const record of stdout.split("\0")) {
    if (!record) continue
    const [added, removed, relative] = record.split("\t")
    if (added === undefined || removed === undefined || !relative) continue
    if (added === "-" || removed === "-") continue

    // Keyed by git's own path, which is what the status entries carry beside
    // their absolute one — see `StatusEntry`.
    counts.set(relative, {
      added: Number(added),
      removed: Number(removed),
    })
  }

  return counts
}

/**
 * The lines in a file somebody has just written, or null for one there is no
 * point counting.
 *
 * A trailing newline is not a line of its own, so `a\nb\n` is two — the same
 * count git would print for adding that file.
 */
async function countLines(filePath: string): Promise<number | null> {
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size > MAX_COUNTED_BYTES) return null

    const text = await readFile(filePath, "utf8")
    if (text === "") return 0
    // A NUL in the first stretch of a file is what every tool uses to decide it
    // is not text, and `+12000` for a PNG is worse than no number.
    if (text.slice(0, 8000).includes("\0")) return null

    const lines = text.split("\n")
    return lines.at(-1) === "" ? lines.length - 1 : lines.length
  } catch {
    return null
  }
}

/**
 * A file as `HEAD` has it, or null when `HEAD` does not have it.
 *
 * `git show` rather than reading anything: the point of a diff's left-hand side
 * is the committed content, which is in the object store and not on disk. The
 * path is turned into the repository's own terms first, since that is the only
 * form `HEAD:` takes.
 */
export async function fileAtHead(
  dir: string,
  filePath: string
): Promise<string | null> {
  let root: string
  try {
    root = (await git(dir, ["rev-parse", "--show-toplevel"])).trim()
    if (!root) return null
  } catch {
    return null
  }

  // Turned into the repository's terms the same way `workingTree` turns them
  // back, and through `dir` rather than through the file: a **deleted** file has
  // no `realpath` to resolve, and it is exactly the file whose committed side
  // somebody wants to see. Resolving one path and not the other is what made
  // `/tmp` on macOS answer with `../../private/tmp/…`.
  const inRepo = await realpath(dir)
    .then((resolved) => path.relative(root, resolved))
    .catch(() => "")
  const relative = path.join(inRepo, path.relative(dir, filePath))

  // Outside the repository the folder is in — nothing `HEAD:` could name.
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    return null

  try {
    // Forward slashes always: `HEAD:src\main.ts` is not a path git knows, even
    // on Windows.
    return await git(dir, [
      "show",
      `HEAD:${relative.split(path.sep).join("/")}`,
    ])
  } catch {
    // Not in HEAD, which is what a file somebody has just written looks like.
    return null
  }
}

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

/**
 * One checkout of a repository: the repo's own working tree, or a worktree
 * added beside it.
 *
 * `git worktree` is what makes two agents able to work on one project at once
 * without standing on each other — each gets a directory and a branch of its
 * own, sharing the single object store. Conductor is built on it, and this is
 * the same primitive rather than a copy of the repository.
 */
export type Worktree = {
  /** Absolute path to the checkout. */
  path: string
  /** The branch checked out there, or null when the head is detached. */
  branch: string | null
  /** Short SHA of its head, or null for a worktree with no commit yet. */
  head: string | null
  /** The repository's own working tree — the one that is not addable or
   * removable, and the one every other worktree was branched from. */
  main: boolean
  /** Locked against pruning, usually because it is on removable media. Listed
   * so a remove that will fail can say why before it is tried. */
  locked: boolean
  /** Git believes the directory is gone. Left in the list rather than filtered
   * out: a worktree somebody deleted by hand is exactly the row that needs to
   * be prunable from here. */
  prunable: boolean
}

/**
 * Parses `git worktree list --porcelain`.
 *
 * Pure and exported for the same reason `parseStatus` is: the shape of git's
 * output is the part worth a test, and a test should not need a repository.
 *
 * The format is blocks separated by blank lines, each opening with a
 * `worktree <path>` line. Attributes are bare words or `key value` pairs, and a
 * detached head has `detached` where a branch would have `branch refs/heads/x`.
 * The **first** block is always the repository's own working tree, which is the
 * only way to tell it apart — nothing in a block says "I am the main one".
 */
export function parseWorktrees(stdout: string): Worktree[] {
  const out: Worktree[] = []
  let current: Worktree | null = null

  const push = () => {
    if (current) out.push(current)
    current = null
  }

  for (const raw of stdout.split("\n")) {
    const line = raw.trim()

    if (line.startsWith("worktree ")) {
      push()
      current = {
        path: line.slice("worktree ".length),
        branch: null,
        head: null,
        // Corrected once the block is closed; only position decides it.
        main: out.length === 0,
        locked: false,
        prunable: false,
      }
      continue
    }

    if (!current) continue

    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).slice(0, 7)
    } else if (line.startsWith("branch ")) {
      // `refs/heads/feature/x` keeps the slashes in its name, so only the
      // known prefix is taken off.
      const ref = line.slice("branch ".length)
      current.branch = ref.startsWith("refs/heads/")
        ? ref.slice("refs/heads/".length)
        : ref
    } else if (line === "locked" || line.startsWith("locked ")) {
      current.locked = true
    } else if (line === "prunable" || line.startsWith("prunable ")) {
      current.prunable = true
    }
    // `bare` and `detached` need nothing: a bare repository has no branch and
    // no head to read, which is already what the blanks say.
  }
  push()

  return out
}

/** Every checkout of the repository `dir` belongs to. Empty when it is not a
 * repository at all, which is the same answer `currentBranch` gives. */
export async function worktrees(dir: string): Promise<Worktree[]> {
  try {
    return parseWorktrees(await git(dir, ["worktree", "list", "--porcelain"]))
  } catch {
    return []
  }
}

/**
 * Adds a worktree at `path`, on a new branch `branch` cut from `from`.
 *
 * `-b` rather than checking out an existing branch: two checkouts of one branch
 * is a state git refuses anyway, and the point of a new worktree here is a
 * place to do something that has not been done yet. Resolves to an error
 * message rather than throwing — a branch name already taken and a path that
 * exists are both ordinary answers a caller has to show, not faults.
 */
export async function addWorktree(
  dir: string,
  path: string,
  branch: string,
  from: string
): Promise<string | null> {
  try {
    await git(dir, ["worktree", "add", "-b", branch, path, from])
    return null
  } catch (error) {
    return messageOf(error)
  }
}

/**
 * Removes a worktree, and prunes the administrative record behind it.
 *
 * `--force` is passed deliberately. Without it git refuses a worktree with
 * uncommitted changes, and this is called from a row somebody has already
 * confirmed removing — a second refusal surfacing as an error they cannot act
 * on from here is worse than doing what they asked. The branch is **not**
 * deleted: the commits are the work, and removing a directory is not a
 * reason to throw them away.
 */
export async function removeWorktree(
  dir: string,
  path: string
): Promise<string | null> {
  try {
    await git(dir, ["worktree", "remove", "--force", path])
    return null
  } catch (error) {
    // A directory somebody deleted by hand leaves a record git still lists;
    // pruning is what clears it, and it is not an error if there was nothing.
    await git(dir, ["worktree", "prune"]).catch(() => "")
    return messageOf(error)
  }
}

/**
 * A branch name as one path segment.
 *
 * A worktree lives in a directory named after its branch, and a branch name is
 * not a path segment: `feature/orders` would be two directories deep, `..`
 * would be a directory *above* the one intended, and a name that is all
 * punctuation would leave nothing at all. So everything outside word
 * characters, dots and dashes collapses to a dash, leading dots and dashes go
 * (they make hidden or option-looking directories), and an empty result falls
 * back to a fixed word.
 *
 * Not reversible, and does not need to be: the record holds both the branch and
 * the path, so nothing ever has to read one back out of the other.
 */
export function worktreeSlug(branch: string): string {
  const slug = branch
    .replace(/[^\w.-]+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/\.+$/, "")
  return slug || "branch"
}

/** git's own stderr, which is what a caller should show: "fatal: invalid
 * reference" says more than any sentence written here could. */
function messageOf(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr?.trim()
  if (stderr) return stderr
  return error instanceof Error ? error.message : String(error)
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
