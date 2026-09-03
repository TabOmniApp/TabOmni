/**
 * A learning distilled out of a chat, and the file it becomes.
 *
 * The loop this serves: the more a project is worked on in its chats, the more
 * of what was learned should be waiting for the next turn — and the CLI already
 * has the two places it looks. A **skill** is `.claude/skills/<name>/SKILL.md`,
 * which the user's own `claude` discovers by itself; a **memory** is a line in
 * the project's `CLAUDE.md`, which is the same file the CLI's own `#` shortcut
 * appends to. This app adds no store of its own and serves nothing: it writes
 * the two files the CLI was always going to read, and only when somebody
 * presses Save on a proposal (`distill-dialog.tsx`).
 *
 * Shared rather than main's because three sides hold the shape: main parses a
 * model's answer into it and writes the approved ones down
 * (`main/learnings.ts`), the renderer draws the proposals, and
 * `test/learnings.ts` checks the lot. Free of `electron` and the DOM, the way
 * `shared/note-files.ts` is.
 */

import type { AssistantMessage } from "./api"

export const LEARNING_KINDS = ["skill", "memory"] as const
export type LearningKind = (typeof LEARNING_KINDS)[number]

export type LearningProposal = {
  kind: LearningKind
  /** A kebab-case slug — a skill's directory name, a memory's label. Already
   * through `slugOf` by the time it is on this type. */
  name: string
  /** One line saying when the learning applies — a skill's frontmatter
   * `description`, the sentence the dialog leads with. */
  description: string
  /** The learning itself, markdown. A memory's is collapsed to one bullet on
   * the way into `CLAUDE.md` — see `memoryLineOf`. */
  body: string
}

/**
 * The proposals out of an answer, or null when there are none to be had.
 *
 * The bargain every parse of a model's fenced answer strikes, for the same
 * reason: a model told to answer with one fenced block usually does and
 * sometimes puts a sentence in front of it, so the fence is looked for first
 * and the outermost brackets second. No repair — an entry missing a field is
 * dropped rather than guessed at, because what survives this gate is text
 * somebody will write into their repository.
 *
 * Null is "nothing here was JSON at all"; an empty array is a real answer —
 * the chat taught nothing worth keeping — and reads as one.
 */
export function proposalsIn(text: string): LearningProposal[] | null {
  const fenced = /```(?:json)?\s*([[{][\s\S]*?)```/.exec(text)
  const source = fenced?.[1] ?? bracketed(text)
  if (source === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

  return parsed.flatMap((entry) => {
    const proposal = asProposal(entry)
    return proposal ? [proposal] : []
  })
}

/** The outermost `[…]`, for an answer that came back without a fence. */
function bracketed(text: string): string | null {
  const from = text.indexOf("[")
  const to = text.lastIndexOf("]")
  return from === -1 || to <= from ? null : text.slice(from, to + 1)
}

/** One entry, if it is one. Everything is checked because none of it was typed
 * by anybody — this is a model's output on its way to somebody's disk. */
function asProposal(entry: unknown): LearningProposal | null {
  if (typeof entry !== "object" || entry === null) return null
  const row = entry as Record<string, unknown>

  const kind = LEARNING_KINDS.find((id) => id === row.kind)
  const name = slugOf(typeof row.name === "string" ? row.name : "")
  const description =
    typeof row.description === "string" ? row.description.trim() : ""
  const body = typeof row.body === "string" ? row.body.trim() : ""
  if (!kind || !name || !description || !body) return null

  return { kind, name, description, body }
}

/**
 * A name the filesystem and the CLI will both take: lower-case, words joined
 * with `-`, nothing that means something to a path. Empty when nothing of the
 * name survives, which `asProposal` reads as "drop the entry" — a skill written
 * to `.claude/skills//SKILL.md` is not a near miss, it is a different path.
 */
export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

/**
 * The file a skill proposal becomes, relative to the project.
 *
 * The frontmatter is the two fields the CLI reads a skill by — `name` says
 * what, `description` says when — and the body is the instruction itself.
 * Relative on purpose: joining it onto a root is the caller's business
 * (`main/learnings.ts`), and a path built there is a path gated there.
 */
export function skillFileOf(proposal: LearningProposal): {
  dir: string
  path: string
  text: string
} {
  const dir = `.claude/skills/${proposal.name}`
  return {
    dir,
    path: `${dir}/SKILL.md`,
    text: [
      "---",
      `name: ${proposal.name}`,
      `description: ${proposal.description.replace(/\n+/g, " ")}`,
      "---",
      "",
      proposal.body,
      "",
    ].join("\n"),
  }
}

/**
 * A memory as the one line it takes up in `CLAUDE.md`.
 *
 * Collapsed to a single bullet rather than pasted in as paragraphs: `CLAUDE.md`
 * is read at the top of every turn of every chat in the project, so a memory's
 * rent is per-token and forever. A learning that needs more room than a
 * sentence or two is a skill, and the distilling turn is told so.
 */
export function memoryLineOf(proposal: LearningProposal): string {
  return `- ${proposal.body.replace(/\s*\n+\s*/g, " ").trim()}`
}

/** The heading the appended memories live under — one place both the append
 * and anybody reading the file can point at. */
export const LEARNINGS_HEADING = "## Learnings"

/**
 * `CLAUDE.md` with one more memory in it.
 *
 * Appended under `LEARNINGS_HEADING` — at the end of that section where the
 * file has one, so the bullets stay together, and as a new section at the end
 * where it does not. The rest of the file is carried through byte for byte:
 * this is the one write this feature makes to a file the user also edits by
 * hand, and rewriting anything beyond the appended line is how a tool loses
 * somebody's paragraph.
 */
export function appendLearning(existing: string | null, line: string): string {
  const text = existing ?? ""
  const lines = text.length ? text.split("\n") : []

  const heading = lines.findIndex((row) => row.trim() === LEARNINGS_HEADING)
  if (heading === -1) {
    const head = text.trimEnd()
    return `${head ? `${head}\n\n` : ""}${LEARNINGS_HEADING}\n\n${line}\n`
  }

  // The section runs to the next heading of any level, or the end of the file.
  let end = lines.length
  for (let row = heading + 1; row < lines.length; row += 1) {
    if (/^#{1,6}\s/.test(lines[row]!)) {
      end = row
      break
    }
  }
  // Backed off the blank lines before the next section, so the bullet lands
  // under the last one rather than after the gap.
  while (end > heading + 1 && lines[end - 1]!.trim() === "") end -= 1

  const kept = [...lines.slice(0, end), line, ...lines.slice(end)]
  return `${kept.join("\n").trimEnd()}\n`
}

/**
 * A chat's lines as the plain text a distilling turn reads.
 *
 * What is kept is what happened: what was asked, what was answered, and which
 * tools ran with what result — the trail the learnings are in. `thinking` is
 * dropped for the reason a one-turn agent drops it: it is what the model
 * considered on the way, not what the conversation established. Roles this
 * module has never heard of are skipped rather than guessed at, because a
 * chat's file outlives any one version of this list.
 */
export function transcriptOf(lines: AssistantMessage[]): string {
  const said: string[] = []
  for (const line of lines) {
    if (line.role === "user") said.push(`User:\n${line.text}`)
    else if (line.role === "assistant") said.push(`Assistant:\n${line.text}`)
    else if (line.role === "tool") {
      const result = line.result ? ` → ${line.result}` : ""
      said.push(`[tool] ${line.name}: ${line.summary}${result}`)
    }
  }
  return said.join("\n\n")
}
