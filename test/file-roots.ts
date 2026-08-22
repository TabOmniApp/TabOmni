import type { WorkspaceFolder, WorktreeRecord } from "../src/shared/api"
import {
  fileRootsOf,
  rootOfPath,
  shownRootOf,
} from "../src/renderer/lib/files/roots"
import { check, finish, section } from "./harness"

/**
 * What the Explorer is allowed to draw a tree under.
 *
 * The part worth a test is that a `git worktree` checkout is a root of its own
 * rather than a directory inside the project it was cut from — it lives under
 * `~/.tabomni/workspace/worktrees/`, nowhere near the folder — and that a path
 * is resolved to the *narrowest* root that holds it. Get either wrong and a
 * file in a checkout is coloured by the wrong repository's `git status`, or
 * filed under the wrong tab group.
 *
 * Pure, so there is nothing on disk here: these are two lists and a path.
 */

const folder = (
  id: string,
  name: string,
  dirPath: string
): WorkspaceFolder => ({
  id,
  name,
  path: dirPath,
  addedAt: "2026-01-01T00:00:00.000Z",
})

const worktree = (
  id: string,
  folderId: string,
  branch: string,
  dirPath: string
): WorktreeRecord => ({
  id,
  folderId,
  branch,
  path: dirPath,
  createdAt: "2026-01-01T00:00:00.000Z",
})

const folders = [
  folder("f-app", "app", "/code/app"),
  folder("f-api", "api", "/code/app/api"),
]

const worktrees = [
  worktree(
    "w-fix",
    "f-app",
    "fix/orders",
    "/tabomni/worktrees/f-app/fix-orders"
  ),
  worktree("w-spike", "f-app", "spike", "/tabomni/worktrees/f-app/spike"),
]

section("fileRootsOf")

const roots = fileRootsOf(folders, worktrees)

check(
  "every folder and every checkout is a root",
  roots.length === 4,
  roots.map((root) => root.id)
)

check(
  "a folder's checkouts follow it, and a folder with none is on its own",
  roots.map((root) => root.id).join(",") === "f-app,w-fix,w-spike,f-api",
  roots.map((root) => root.id)
)

check(
  "a checkout is keyed by its own id and keeps the folder it was cut from",
  roots[1]!.id === "w-fix" &&
    roots[1]!.worktreeId === "w-fix" &&
    roots[1]!.folderId === "f-app"
)

check(
  "a folder's root has no worktree, and is keyed by the folder",
  roots[0]!.id === "f-app" && roots[0]!.worktreeId === null
)

check(
  "the label is the folder's name, or the checkout's branch",
  roots[0]!.label === "app" && roots[1]!.label === "fix/orders"
)

section("rootOfPath")

check(
  "a file in a folder resolves to that folder",
  rootOfPath(roots, "/code/app/src/index.ts")?.id === "f-app"
)

check(
  "a folder nested inside another wins for a file inside it",
  rootOfPath(roots, "/code/app/api/src/main.ts")?.id === "f-api"
)

check(
  "a file in a checkout resolves to the checkout, not to the project",
  rootOfPath(roots, "/tabomni/worktrees/f-app/fix-orders/src/index.ts")?.id ===
    "w-fix"
)

check(
  "two checkouts of one project are told apart",
  rootOfPath(roots, "/tabomni/worktrees/f-app/spike/src/index.ts")?.id ===
    "w-spike"
)

check(
  "the root directory itself is in the root",
  rootOfPath(roots, "/code/app")?.id === "f-app"
)

check(
  "a sibling whose path merely starts the same is outside",
  rootOfPath(roots, "/code/app-old/src/index.ts") === null
)

check(
  "a path in no root is in no root",
  rootOfPath(roots, "/etc/passwd") === null
)

section("shownRootOf")

check(
  "with nothing chosen, the first project's own working tree is drawn",
  shownRootOf(folders, worktrees, {}, null)?.path === "/code/app"
)

const spike = shownRootOf(folders, worktrees, { "f-app": "w-spike" }, "f-app")

check(
  "a project reading a checkout draws that checkout",
  spike?.path === "/tabomni/worktrees/f-app/spike" &&
    spike?.worktreeId === "w-spike" &&
    spike?.label === "spike"
)

check(
  "another project is drawn on its own, and its neighbour's checkout is not",
  shownRootOf(folders, worktrees, { "f-app": "w-spike" }, "f-api")?.path ===
    "/code/app/api"
)

check(
  "a checkout that has gone falls back to the project rather than an empty tree",
  shownRootOf(folders, worktrees, { "f-app": "w-removed" }, "f-app")?.path ===
    "/code/app"
)

check(
  "a checkout of another project is not read into this one",
  shownRootOf(folders, worktrees, { "f-api": "w-fix" }, "f-api")?.path ===
    "/code/app/api"
)

check(
  "a remembered project that has left the workspace falls back to the first",
  shownRootOf(folders, worktrees, {}, "f-gone")?.path === "/code/app"
)

check(
  "a workspace with no folders draws nothing",
  shownRootOf([], worktrees, {}, null) === null
)

finish()
