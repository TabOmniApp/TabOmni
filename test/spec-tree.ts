import {
  buildSpecTree,
  canMoveInto,
  folderPaths,
  isInside,
  movedInto,
  type SpecNode,
} from "../src/renderer/lib/spec/tree"
import { check, finish, section } from "./harness"

/**
 * The spec sidebar's folder tree.
 *
 * Derived from the paths rather than stored beside them, so what is checked is
 * the derivation: that a set of files produces the folders a reader expects,
 * one row per directory, and that the path predicates behind renaming and
 * dropping cannot confuse `docs/spec` with `docs/specs` — which would move
 * another folder's specs.
 */

/** A tree as one line per row, indented, so a failure is readable. */
function draw(nodes: SpecNode[], depth = 0): string {
  return nodes
    .map((node) =>
      node.kind === "folder"
        ? // Joined rather than interpolated: a folder with nothing in it would
          // otherwise carry a trailing newline into the comparison.
          [
            `${"  ".repeat(depth)}[${node.label}]`,
            draw(node.children, depth + 1),
          ]
            .filter(Boolean)
            .join("\n")
        : `${"  ".repeat(depth)}${node.path.slice(node.path.lastIndexOf("/") + 1)}`
    )
    .filter(Boolean)
    .join("\n")
}

section("what the paths imply")

check("nothing at all is an empty tree", buildSpecTree([]).length === 0)

const flat = buildSpecTree([
  "docs/specs/FR_002.spec.json",
  "docs/specs/FR_001.spec.json",
])
check(
  "every directory gets its own row, nested",
  draw(flat) ===
    "[docs]\n  [specs]\n    FR_001.spec.json\n    FR_002.spec.json",
  draw(flat)
)
/**
 * A chain of folders is *not* merged into one row. An earlier version did that
 * — `docs` holding only `specs` read as `docs/specs` — and the folder it
 * swallowed then had no row of its own: it could not be renamed, deleted or
 * dropped onto, and the row that remained carried both names while acting on
 * only the inner one.
 */
check(
  "each row points at exactly one directory",
  flat[0]?.kind === "folder" &&
    flat[0].path === "docs" &&
    flat[0].children[0]?.kind === "folder" &&
    flat[0].children[0].path === "docs/specs"
)

const nested = buildSpecTree([
  "docs/specs/auth/FR_010.spec.json",
  "docs/specs/FR_001.spec.json",
  "docs/specs/store/FR_020.spec.json",
])
check(
  "folders come before specs, each group alphabetical",
  draw(nested) ===
    [
      "[docs]",
      "  [specs]",
      "    [auth]",
      "      FR_010.spec.json",
      "    [store]",
      "      FR_020.spec.json",
      "    FR_001.spec.json",
    ].join("\n"),
  draw(nested)
)

check(
  "a folder holding both a folder and a spec lists both",
  draw(buildSpecTree(["a/b.spec.json", "a/c/d.spec.json"])) ===
    "[a]\n  [c]\n    d.spec.json\n  b.spec.json",
  draw(buildSpecTree(["a/b.spec.json", "a/c/d.spec.json"]))
)
check(
  "a spec at the repository root needs no folder at all",
  draw(buildSpecTree(["FR_001.spec.json"])) === "FR_001.spec.json"
)
check(
  "two roots stay two roots",
  buildSpecTree(["docs/a.spec.json", "design/b.spec.json"]).length === 2
)

section("a folder with nothing in it yet")

/**
 * Git does not track an empty directory, so one cannot be worked out from the
 * files — it is passed in, and it disappears again when the panel is reloaded
 * unless a spec has been put in it. Worth showing all the same: it is where
 * the next spec is going.
 */
const withEmpty = buildSpecTree(
  ["docs/specs/FR_001.spec.json"],
  ["docs/specs/draft"]
)
check(
  "an empty folder is shown beside the specs",
  draw(withEmpty) === "[docs]\n  [specs]\n    [draft]\n    FR_001.spec.json",
  draw(withEmpty)
)

/** The case reported: two folders made one inside the other, with nothing in
 * either. Each must have its own row, or neither can be acted on separately. */
const madeByHand = buildSpecTree([], ["aaa", "aaa/bbb"])
check(
  "a folder made inside another is a row under it, not merged with it",
  draw(madeByHand) === "[aaa]\n  [bbb]",
  draw(madeByHand)
)
check(
  "and the outer row deletes the outer folder",
  madeByHand[0]?.kind === "folder" && madeByHand[0].path === "aaa"
)
check(
  "while the inner row deletes only the inner one",
  madeByHand[0]?.kind === "folder" &&
    madeByHand[0].children[0]?.kind === "folder" &&
    madeByHand[0].children[0].path === "aaa/bbb"
)

check(
  "every folder can be listed, for remembering what was collapsed",
  folderPaths(nested).join() ===
    "docs,docs/specs,docs/specs/auth,docs/specs/store",
  folderPaths(nested)
)

section("what counts as inside a folder")

/** The case that matters: a folder rename reads these to decide what moves,
 * and a prefix match without the separator takes the neighbour's files. */
check(
  "a spec in the folder is inside it",
  isInside("docs/specs/a.json", "docs/specs")
)
check(
  "one in a folder under it is too",
  isInside("docs/specs/auth/a.json", "docs/specs")
)
check(
  "a folder whose name merely starts the same is not",
  !isInside("docs/specsheet/a.json", "docs/specs")
)
check(
  "the folder itself is not inside itself",
  !isInside("docs/specs", "docs/specs")
)
check("everything is inside the root", isInside("a.json", ""))

check(
  "renaming a folder carries what is under it",
  movedInto("docs/specs/auth/a.json", "docs/specs", "docs/screens") ===
    "docs/screens/auth/a.json"
)
check(
  "and leaves the neighbour alone",
  movedInto("docs/specsheet/a.json", "docs/specs", "docs/screens") ===
    "docs/specsheet/a.json"
)
check(
  "renaming to the same name changes nothing",
  movedInto("docs/specs/a.json", "docs/specs", "docs/specs") ===
    "docs/specs/a.json"
)
check(
  "moving out of the root prefixes rather than splices",
  movedInto("a.json", "", "docs") === "docs/a.json"
)

section("what may be dropped where")

const folder = (path: string) => ({ kind: "folder" as const, path })
const spec = (path: string) => ({ kind: "spec" as const, path })

check(
  "a folder may move into an unrelated folder",
  canMoveInto(folder("docs/specs/auth"), "docs/archive")
)
/** On disk this is a rename of a directory into its own child: the
 * destination travels with the source, and what it costs is the folder. */
check(
  "a folder may not be dropped into itself",
  !canMoveInto(folder("docs/specs"), "docs/specs")
)
check(
  "nor into anything under it",
  !canMoveInto(folder("docs/specs"), "docs/specs/auth")
)
check(
  "but a folder whose name merely starts the same is fine",
  canMoveInto(folder("docs/spec"), "docs/specs")
)
check(
  "a folder may move up to the top level",
  canMoveInto(folder("docs/specs/auth"), "")
)

check(
  "a spec may move to another folder",
  canMoveInto(spec("docs/specs/a.spec.json"), "docs/archive")
)
check(
  "a spec dropped back where it already is does nothing",
  !canMoveInto(spec("docs/specs/a.spec.json"), "docs/specs")
)
check(
  "a spec at the top level may move into a folder",
  canMoveInto(spec("a.spec.json"), "docs")
)
check(
  "and one at the top level dropped on the top level does nothing",
  !canMoveInto(spec("a.spec.json"), "")
)

finish()
