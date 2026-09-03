import { check, finish, section } from "./harness"

/**
 * The learning loop's pure half — `shared/learnings.ts`.
 *
 * Everything here is a gate or a file shape: what a model's answer is let to
 * become (`proposalsIn`), the two files an approved proposal turns into
 * (`skillFileOf`, `appendLearning`), and the transcript a distilling turn is
 * handed (`transcriptOf`). The turn itself is `distillLearnings` in
 * `review-agent.ts` and is not run here — this is what stands between its
 * output and somebody's repository.
 */
const {
  appendLearning,
  LEARNINGS_HEADING,
  memoryLineOf,
  proposalsIn,
  skillFileOf,
  slugOf,
  transcriptOf,
} = await import("../src/shared/learnings")

import type { AssistantMessage } from "../src/shared/api"

section("proposalsIn")

const skill = {
  kind: "skill",
  name: "run-the-tests",
  description: "When running this repo's tests.",
  body: "Use `bun run test`, never `bun test`.",
}

check(
  "reads a fenced answer",
  proposalsIn(
    ["Here is what I found.", "```json", JSON.stringify([skill]), "```"].join(
      "\n"
    )
  )?.length === 1
)

check(
  "reads bare brackets when there is no fence",
  proposalsIn(JSON.stringify([skill]))?.length === 1
)

check(
  "an empty array is a real answer",
  proposalsIn("```json\n[]\n```")?.length === 0
)

check("prose is null, not empty", proposalsIn("Nothing to keep here.") === null)

check(
  "an entry missing a field is dropped, not repaired",
  proposalsIn(
    JSON.stringify([
      skill,
      { kind: "memory", name: "x", body: "no description" },
    ])
  )?.length === 1
)

check(
  "an unknown kind is dropped",
  proposalsIn(JSON.stringify([{ ...skill, kind: "rule" }]))?.length === 0
)

check(
  "a name is slugged on the way in",
  proposalsIn(JSON.stringify([{ ...skill, name: "Run The Tests!" }]))?.[0]
    ?.name === "run-the-tests"
)

check(
  "a name with nothing left after slugging drops the entry",
  proposalsIn(JSON.stringify([{ ...skill, name: "!!!" }]))?.length === 0
)

section("slugOf")

check(
  "lower-cases and joins with dashes",
  slugOf("Fix The Build") === "fix-the-build"
)
check("strips leading and trailing dashes", slugOf("--x--") === "x")
check("empty when nothing survives", slugOf("!!!") === "")

section("skillFileOf")

const file = skillFileOf({
  kind: "skill",
  name: "run-the-tests",
  description: "When running\nthis repo's tests.",
  body: "Use `bun run test`.",
})

check(
  "lands under .claude/skills",
  file.path === ".claude/skills/run-the-tests/SKILL.md"
)
check(
  "dir is the file's own directory",
  file.dir === ".claude/skills/run-the-tests"
)
check("frontmatter carries the name", file.text.includes("name: run-the-tests"))
check(
  "a multi-line description is one frontmatter line",
  file.text.includes("description: When running this repo's tests.")
)
check(
  "the body follows the frontmatter",
  file.text.trimEnd().endsWith("Use `bun run test`.")
)

section("memoryLineOf and appendLearning")

const memory = {
  kind: "memory" as const,
  name: "test-runner",
  description: "Which runner this repo uses.",
  body: "Tests run under `bun run test`;\nplain `bun test` finds nothing.",
}

check(
  "a memory is one bullet, newlines collapsed",
  memoryLineOf(memory) ===
    "- Tests run under `bun run test`; plain `bun test` finds nothing."
)

check(
  "an absent file becomes heading plus bullet",
  appendLearning(null, "- a fact") === `${LEARNINGS_HEADING}\n\n- a fact\n`
)

check(
  "a file without the heading gains it at the end",
  appendLearning("# Project\n\nHello.\n", "- a fact") ===
    `# Project\n\nHello.\n\n${LEARNINGS_HEADING}\n\n- a fact\n`
)

check(
  "a bullet joins the existing section",
  appendLearning(`# P\n\n${LEARNINGS_HEADING}\n\n- first\n`, "- second") ===
    `# P\n\n${LEARNINGS_HEADING}\n\n- first\n- second\n`
)

check(
  "a mid-file section keeps what follows it",
  appendLearning(
    `# P\n\n${LEARNINGS_HEADING}\n\n- first\n\n## Commands\n\nrun it\n`,
    "- second"
  ) ===
    `# P\n\n${LEARNINGS_HEADING}\n\n- first\n- second\n\n## Commands\n\nrun it\n`
)

section("transcriptOf")

const lines: AssistantMessage[] = [
  { id: "1", role: "user", text: "How do tests run?" },
  { id: "2", role: "thinking", text: "Let me look." },
  {
    id: "3",
    role: "tool",
    name: "Read",
    summary: "package.json",
    result: "40 lines",
  },
  { id: "4", role: "assistant", text: "Through `bun run test`." },
]

const transcript = transcriptOf(lines)

check("keeps what was asked", transcript.includes("User:\nHow do tests run?"))
check(
  "keeps what was answered",
  transcript.includes("Assistant:\nThrough `bun run test`.")
)
check(
  "keeps the tool trail on one line",
  transcript.includes("[tool] Read: package.json → 40 lines")
)
check("drops thinking", !transcript.includes("Let me look."))

finish()
