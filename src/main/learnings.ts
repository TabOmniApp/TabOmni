import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { SaveLearningAnswer } from "../shared/api"
import {
  appendLearning,
  memoryLineOf,
  skillFileOf,
  slugOf,
  type LearningProposal,
} from "../shared/learnings"

/**
 * One approved proposal, written where the CLI will find it.
 *
 * This is the write half of distilling (`distillLearnings` in
 * `review-agent.ts` is the read half), and it only ever runs because somebody
 * pressed Save on one proposal in the dialog. Two shapes:
 *
 * - a **skill** becomes `.claude/skills/<name>/SKILL.md`, and an existing one
 *   is a refusal rather than an overwrite — the file there may be
 *   hand-written, and "it already exists" is an answer the dialog can show;
 * - a **memory** is appended to the project's `CLAUDE.md` under
 *   `## Learnings`, the rest of the file carried through untouched — see
 *   `appendLearning`.
 *
 * The proposal is re-checked on this side of the IPC rather than trusted: the
 * renderer got it from a model, and what lands here decides a path. Answers
 * rather than throws, like every other call in this corner — the dialog has
 * one way to say "it did not work".
 */
export async function saveLearning(
  dir: string,
  proposal: LearningProposal
): Promise<SaveLearningAnswer> {
  const name = slugOf(proposal.name)
  const description = proposal.description.trim()
  const body = proposal.body.trim()
  if (!name || !description || !body) {
    return { error: "That proposal is missing a field." }
  }
  const checked = { ...proposal, name, description, body }

  try {
    if (checked.kind === "skill") {
      const skill = skillFileOf(checked)
      await mkdir(join(dir, skill.dir), { recursive: true })
      // `wx` for the reason `createFile` in `files.ts` uses it: the failure is
      // "it is already there", never a hand-written skill silently replaced.
      await writeFile(join(dir, skill.path), skill.text, {
        encoding: "utf8",
        flag: "wx",
      })
      return { path: skill.path }
    }

    const target = join(dir, "CLAUDE.md")
    const existing = await readFile(target, "utf8").catch(() => null)
    await writeFile(
      target,
      appendLearning(existing, memoryLineOf(checked)),
      "utf8"
    )
    return { path: "CLAUDE.md" }
  } catch (failed) {
    const error = failed as NodeJS.ErrnoException
    if (error.code === "EEXIST") {
      return { error: `A skill named \`${name}\` already exists.` }
    }
    return { error: error.message ?? String(failed) }
  }
}
