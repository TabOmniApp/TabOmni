import { execFile } from "node:child_process"
import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { addWorktree, removeWorktree, worktrees } from "../src/main/git"
import { check, finish, section } from "./harness"

/**
 * `addWorktree` and `removeWorktree` against a real repository, for the reason
 * `git-changes.ts` builds one: what is being relied on is git's own refusals,
 * and a fake would only prove this file agrees with itself.
 *
 * The case this was written for is the round trip. `removeWorktree` keeps the
 * branch on purpose, so a second `add -b` under the same name met `fatal: a
 * branch named 'x' already exists` and there was nothing to do about it from the
 * dialog — `test/worktrees.ts` covers the pure halves and could not see it,
 * because the whole failure is which arguments git was handed.
 */

const run = promisify(execFile)

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd: dir })
  return stdout
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false
  )
}

/** The checkouts git itself lists, by their last path segment — the absolute
 * paths go through a symlink on macOS and are unsafe to compare. */
async function checkoutsIn(dir: string): Promise<string[]> {
  return (await worktrees(dir)).map((entry) => path.basename(entry.path)).sort()
}

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "tabomni-worktree-"))
  const repo = path.join(root, "repo")
  const at = (slug: string) => path.join(root, "checkouts", slug)

  await git(root, "init", "--initial-branch", "main", "repo")
  await git(repo, "config", "user.email", "test@example.com")
  await git(repo, "config", "user.name", "Test")
  await writeFile(path.join(repo, "a.txt"), "one\n")
  await git(repo, "add", ".")
  await git(repo, "commit", "-m", "first")

  section("a new branch")

  const first = await addWorktree(repo, at("fix-orders"), "fix-orders", "HEAD")

  check("is added", first.error === null, first)
  check("and is cut here, so nothing was reused", first.reused === false, first)
  check("the directory is there", await exists(at("fix-orders")))
  check(
    "and git lists it",
    (await checkoutsIn(repo)).join() === "fix-orders,repo",
    await checkoutsIn(repo)
  )

  section("removing it")

  // The work that must survive: a commit on the branch, in the checkout, which
  // is the whole argument for keeping the branch when the directory goes.
  await writeFile(path.join(at("fix-orders"), "b.txt"), "two\n")
  await git(at("fix-orders"), "add", ".")
  await git(at("fix-orders"), "commit", "-m", "work on the branch")
  const done = await git(at("fix-orders"), "rev-parse", "HEAD")

  check(
    "git does not refuse",
    (await removeWorktree(repo, at("fix-orders"))) === null
  )
  check("the directory is gone", !(await exists(at("fix-orders"))))
  check(
    "and so is the record git keeps",
    (await checkoutsIn(repo)).join() === "repo",
    await checkoutsIn(repo)
  )
  check(
    "but the branch is still there — the commits are the work",
    (await git(repo, "branch", "--list", "fix-orders")).includes("fix-orders")
  )

  section("adding it back under the same name")

  const again = await addWorktree(repo, at("fix-orders"), "fix-orders", "HEAD")

  check("is added rather than refused", again.error === null, again)
  check("by reusing the branch", again.reused === true, again)
  check(
    "which lands on the commit made before it was removed, not on HEAD",
    (await git(at("fix-orders"), "rev-parse", "HEAD")) === done
  )
  check(
    "so the file committed to it is back",
    await exists(path.join(at("fix-orders"), "b.txt"))
  )

  section("what is still refused")

  // One branch, two checkouts: git's own refusal, and this must not have talked
  // it into anything.
  const twice = await addWorktree(repo, at("second"), "fix-orders", "HEAD")

  check("a branch already checked out elsewhere", twice.error !== null, twice)
  check("and nothing was left at the path", !(await exists(at("second"))))

  const taken = await addWorktree(repo, at("fix-orders"), "other", "HEAD")

  check("a path that is already a checkout", taken.error !== null, taken)

  const nowhere = await addWorktree(repo, at("bad-from"), "bad-from", "nope")

  check("a `from` that is not a commit", nowhere.error !== null, nowhere)
  check(
    "reported as git's own words, which is what the dialog shows",
    nowhere.error?.includes("nope") === true,
    nowhere.error
  )

  section("a branch name that is not a path segment")

  const nested = await addWorktree(
    repo,
    at("feature-orders"),
    "feature/orders",
    "main"
  )

  check(
    "is added — the slug is the caller's business",
    nested.error === null,
    nested
  )
  check(
    "on the branch it named, slashes and all",
    (
      await git(at("feature-orders"), "rev-parse", "--abbrev-ref", "HEAD")
    ).trim() === "feature/orders"
  )

  await rm(root, { recursive: true, force: true })
  finish()
}

await main()
