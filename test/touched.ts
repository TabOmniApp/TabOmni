import { writtenPaths } from "../src/renderer/lib/terminal/touched"
import { check, finish, section } from "./harness"

/**
 * What Explorer is told a session changed.
 *
 * This reads another process's records: the CLI writes its tool calls to the
 * transcript, and the shape of an argument is that CLI's business rather than
 * this app's. So the failures worth catching are the ones where a wrong answer
 * is silent — a path that is not absolute would be resolved against the wrong
 * directory, and a tool that only *reads* files being counted would turn "what
 * changed" into "what was looked at" and re-read half a repository on every
 * turn.
 *
 * The ordering matters for the strip that draws it: the file the agent has just
 * finished with belongs at the end, next to the composer.
 */

const call = (name: string, input: unknown) => ({ name, input })

section("what counts as a write")

check(
  "Write and Edit name their file",
  JSON.stringify(
    writtenPaths([
      call("Write", { file_path: "/repo/a.ts", content: "x" }),
      call("Edit", {
        file_path: "/repo/b.ts",
        old_string: "a",
        new_string: "b",
      }),
    ])
  ) === JSON.stringify(["/repo/a.ts", "/repo/b.ts"])
)

check(
  "NotebookEdit names its own argument",
  JSON.stringify(
    writtenPaths([call("NotebookEdit", { notebook_path: "/repo/n.ipynb" })])
  ) === JSON.stringify(["/repo/n.ipynb"])
)

check(
  "reads are not writes",
  writtenPaths([
    call("Read", { file_path: "/repo/a.ts" }),
    call("Grep", { pattern: "x", path: "/repo" }),
    call("Glob", { pattern: "**/*.ts" }),
  ]).length === 0
)

check(
  "a Bash command that writes cannot be read as one",
  writtenPaths([call("Bash", { command: "sed -i '' s/a/b/ /repo/a.ts" })])
    .length === 0
)

check(
  "a tool this build does not know is left alone",
  writtenPaths([call("FutureWrite", { file_path: "/repo/a.ts" })]).length === 0
)

section("what a path has to look like")

check(
  "a relative path is refused rather than guessed at",
  writtenPaths([call("Edit", { file_path: "src/a.ts" })]).length === 0
)

check(
  "a Windows path counts",
  JSON.stringify(
    writtenPaths([call("Write", { file_path: "C:\\repo\\a.ts" })])
  ) === JSON.stringify(["C:\\repo\\a.ts"])
)

check(
  "a missing, empty or non-string argument is not a path",
  writtenPaths([
    call("Write", {}),
    call("Write", { file_path: "" }),
    call("Write", { file_path: 7 }),
    call("Write", null),
  ]).length === 0
)

section("order and repetition")

check(
  "a file edited twice appears once, where its last edit was",
  JSON.stringify(
    writtenPaths([
      call("Edit", { file_path: "/repo/a.ts" }),
      call("Edit", { file_path: "/repo/b.ts" }),
      call("Edit", { file_path: "/repo/a.ts" }),
    ])
  ) === JSON.stringify(["/repo/b.ts", "/repo/a.ts"])
)

check("nothing at all is an empty list", writtenPaths([]).length === 0)

finish()
