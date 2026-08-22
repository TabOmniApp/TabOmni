import { parseWorktrees, worktreeSlug } from "../src/main/git"
import { check, finish, section } from "./harness"

/**
 * Reading `git worktree list --porcelain`.
 *
 * The format is the part worth a test — blocks separated by blank lines, bare
 * words for the flags, and nothing in a block saying which one is the
 * repository's own working tree. A wrong answer here is a row that cannot be
 * removed because the app thinks it is the main checkout, or the reverse.
 *
 * Pure, so this needs no repository. `test/files.ts` is where things that want
 * a real one live.
 */

section("a repository with two worktrees")

const two = parseWorktrees(
  [
    "worktree /repo",
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/main",
    "",
    "worktree /wt/fix-orders",
    "HEAD 2222222222222222222222222222222222222222",
    "branch refs/heads/fix-orders",
    "",
  ].join("\n")
)

check("both blocks are read", two.length === 2)

check(
  "the first is the main working tree and the second is not",
  two[0]!.main && !two[1]!.main
)

check(
  "paths and branches come out whole",
  two[1]!.path === "/wt/fix-orders" && two[1]!.branch === "fix-orders"
)

check("the head is shortened to seven characters", two[0]!.head === "1111111")

section("branch names with slashes in them")

check(
  "only the refs/heads/ prefix is taken off",
  parseWorktrees(
    ["worktree /wt/a", "branch refs/heads/feature/nested/deep", ""].join("\n")
  )[0]!.branch === "feature/nested/deep"
)

section("a detached head")

check(
  "has no branch, and is still a worktree",
  (() => {
    const [only] = parseWorktrees(
      [
        "worktree /wt/detached",
        "HEAD 3333333333333333333333333333333333333333",
        "detached",
        "",
      ].join("\n")
    )
    return only !== undefined && only.branch === null && only.head === "3333333"
  })()
)

section("flags")

check(
  "locked is read both bare and with a reason after it",
  (() => {
    const bare = parseWorktrees(
      ["worktree /a", "branch refs/heads/x", "locked", ""].join("\n")
    )[0]!
    const reasoned = parseWorktrees(
      [
        "worktree /a",
        "branch refs/heads/x",
        "locked on removable media",
        "",
      ].join("\n")
    )[0]!
    return bare.locked && reasoned.locked
  })()
)

check(
  "prunable is read, and the worktree is still listed",
  (() => {
    const [only] = parseWorktrees(
      [
        "worktree /gone",
        "branch refs/heads/x",
        "prunable gitdir missing",
        "",
      ].join("\n")
    )
    return only !== undefined && only.prunable && only.path === "/gone"
  })()
)

check(
  "a worktree with none of them has both false",
  (() => {
    const [only] = parseWorktrees(
      ["worktree /a", "branch refs/heads/x", ""].join("\n")
    )
    return only !== undefined && !only.locked && !only.prunable
  })()
)

section("shapes git actually emits")

check(
  "a bare repository has no branch and no head",
  (() => {
    const [only] = parseWorktrees(["worktree /repo.git", "bare", ""].join("\n"))
    return (
      only !== undefined &&
      only.main &&
      only.branch === null &&
      only.head === null
    )
  })()
)

check(
  "no trailing blank line still closes the last block",
  parseWorktrees(["worktree /repo", "branch refs/heads/main"].join("\n"))
    .length === 1
)

check(
  "empty output is no worktrees rather than one blank",
  parseWorktrees("").length === 0
)

check(
  "a fresh worktree with no commit yet has a path and nothing else",
  (() => {
    const [only] = parseWorktrees(["worktree /wt/new", ""].join("\n"))
    return only !== undefined && only.path === "/wt/new" && only.head === null
  })()
)

section("a branch name as one path segment")

check(
  "an ordinary name is left alone",
  worktreeSlug("fix-orders") === "fix-orders"
)

check(
  "a slash cannot make it two directories deep",
  !worktreeSlug("feature/orders").includes("/") &&
    worktreeSlug("feature/orders") === "feature-orders"
)

check(
  "traversal cannot escape the directory it belongs in",
  (() => {
    const escapes = ["..", "../..", "../evil", "./x"]
    return escapes.every((name) => {
      const slug = worktreeSlug(name)
      return (
        !slug.includes("/") &&
        !slug.includes("\\") &&
        slug !== ".." &&
        slug !== "."
      )
    })
  })()
)

check(
  "a leading dot does not make a hidden directory",
  !worktreeSlug(".hidden").startsWith(".")
)

check(
  "a leading dash does not make something that looks like an option",
  !worktreeSlug("-rf").startsWith("-")
)

check(
  "a name with nothing usable in it still yields a directory",
  worktreeSlug("///") === "branch" && worktreeSlug("") === "branch"
)

check(
  "spaces and colons collapse rather than reaching the filesystem",
  worktreeSlug("my branch: v2") === "my-branch-v2"
)

check(
  "the result is always a single non-empty segment",
  ["..", ".", "/", "a/b/c", "", "  ", "-", "..foo.."].every((name) => {
    const slug = worktreeSlug(name)
    return (
      slug.length > 0 && !slug.includes("/") && slug !== "." && slug !== ".."
    )
  })
)

finish()
