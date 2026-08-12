import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import type { ClaudeSlashCommand, ClaudeSlashSource } from "../shared/api"

/**
 * What Claude Code's own `/` menu offers, assembled for this app's composer.
 *
 * The CLI has no way to be asked this — there is no `claude --list-commands`
 * — so the two halves come from different places and are honest about it:
 * the on-disk half (`.claude/commands`, `.claude/skills`) is read from the
 * same directories the CLI reads, and so is always exactly what that project
 * and this machine actually have; the built-in half (`/clear`, `/model`, …)
 * is the hardcoded list below, which no amount of care can keep from drifting
 * when the CLI adds or renames one. Nothing here validates against the
 * installed CLI, and nothing needs to: this menu only ever *types* text into
 * the composer, so the worst a stale entry can do is send a `/` line the CLI
 * answers with "unknown command".
 */

/** How deep `.claude/commands` is walked. Namespacing by directory is a real
 * feature (`frontend/test.md` is `/frontend:test`), but a `commands` tree
 * this deep is a mistake rather than a layout to support. */
const MAX_COMMAND_DEPTH = 4

/**
 * Claude Code's built-in commands, as of CLI 2.x.
 *
 * Deliberately only the ones that make sense typed into *this* composer: a
 * message composed here is pasted into the session's stdin, so a command
 * that acts on the conversation (`/clear`, `/compact`) or on settings
 * (`/model`) works exactly as if typed at the CLI's own prompt. Commands
 * whose whole point is the CLI's interactive full-screen UI (`/help`'s
 * pager, `/vim`, `/terminal-setup`) are left out — they would "work", but
 * reaching for them from a detached composer is not how anyone uses them.
 */
const BUILTIN_COMMANDS: { name: string; description: string }[] = [
  {
    name: "clear",
    description: "Clear the conversation history and start fresh",
  },
  {
    name: "compact",
    description: "Summarize the conversation so far to free up context",
  },
  {
    name: "context",
    description: "Show what is currently taking up the context window",
  },
  { name: "cost", description: "Show token usage and cost for this session" },
  { name: "init", description: "Write a CLAUDE.md describing this codebase" },
  { name: "memory", description: "Edit the CLAUDE.md memory files" },
  { name: "model", description: "Change the model this session uses" },
  { name: "permissions", description: "View and edit tool permission rules" },
  { name: "review", description: "Review a pull request" },
  { name: "status", description: "Show version, account, and connectivity" },
  {
    name: "agents",
    description: "Manage the subagents available to this session",
  },
  { name: "mcp", description: "Manage MCP servers and their authentication" },
  { name: "todos", description: "Show the current todo list" },
  {
    name: "export",
    description: "Export this conversation to a file or the clipboard",
  },
  { name: "resume", description: "Resume an earlier conversation" },
  {
    name: "rewind",
    description: "Rewind the conversation to an earlier point",
  },
]

/**
 * Reads the handful of scalar keys this menu needs out of a leading `---`
 * frontmatter block.
 *
 * Not a YAML parser and not trying to be one. It reads exactly two shapes,
 * because those are the two that real command and skill files use for these
 * keys: a single-line scalar, and a `|`/`>` block scalar whose indented
 * lines are folded into one (a description is displayed as one line here
 * whichever way it was written). Anything else — nesting, lists, anchors —
 * is skipped rather than guessed at, which costs at worst a missing
 * description on one menu row.
 */
function readFrontmatter(source: string): Map<string, string> {
  const fields = new Map<string, string>()
  if (!source.startsWith("---")) return fields

  const end = source.indexOf("\n---", 3)
  if (end === -1) return fields

  const lines = source.slice(3, end).split("\n")

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as string
    // A nested key (`metadata:` then two-space-indented children) is not a
    // field this reads; skipping indented lines is what keeps a child key
    // from being mistaken for a top-level one of the same name — and, below,
    // what lets a block scalar's own body be consumed by its key.
    if (line !== line.trimStart()) continue

    const colon = line.indexOf(":")
    if (colon <= 0) continue

    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()

    // `description: |` (or `>`, either with a `-`/`+` chomping indicator):
    // the value is the indented block that follows, not this line.
    if (/^[|>][-+]?$/.test(value)) {
      const block: string[] = []
      while (index + 1 < lines.length) {
        const next = lines[index + 1] as string
        if (next.trim() !== "" && next === next.trimStart()) break
        block.push(next.trim())
        index++
      }
      const folded = block.join(" ").trim()
      if (folded !== "") fields.set(key, folded)
      continue
    }

    const unquoted = value.replace(/^["'](.*)["']$/, "$1")
    if (unquoted !== "") fields.set(key, unquoted)
  }

  return fields
}

/** Every `.md` under a `commands` directory, as paths relative to it. */
async function walkCommands(dir: string, depth = 0): Promise<string[]> {
  if (depth >= MAX_COMMAND_DEPTH) return []

  // Missing is the normal case, not a failure: most projects have no
  // `.claude/commands` at all.
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const found: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue

    if (entry.isDirectory()) {
      const nested = await walkCommands(path.join(dir, entry.name), depth + 1)
      found.push(...nested.map((rel) => path.join(entry.name, rel)))
    } else if (entry.name.endsWith(".md")) {
      found.push(entry.name)
    }
  }

  return found
}

async function readCommands(
  root: string,
  source: ClaudeSlashSource
): Promise<ClaudeSlashCommand[]> {
  const dir = path.join(root, "commands")
  const files = await walkCommands(dir)

  return Promise.all(
    files.map(async (rel) => {
      const fields = readFrontmatter(
        await readFile(path.join(dir, rel), "utf8").catch(() => "")
      )
      return {
        // `frontend/test.md` is `/frontend:test` — the CLI namespaces a
        // command by the directories it sits in, not just its filename.
        name: rel.slice(0, -".md".length).split(path.sep).join(":"),
        description: fields.get("description") ?? "",
        argumentHint: fields.get("argument-hint") ?? null,
        source,
      }
    })
  )
}

async function readSkills(
  root: string,
  source: ClaudeSlashSource
): Promise<ClaudeSlashCommand[]> {
  const dir = path.join(root, "skills")
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])

  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map(async (entry): Promise<ClaudeSlashCommand | null> => {
        const skillFile = await readFile(
          path.join(dir, entry.name, "SKILL.md"),
          "utf8"
        ).catch(() => null)
        // A directory without a `SKILL.md` is not a skill — the CLI ignores
        // it too, so it must not become a menu row that does nothing.
        if (skillFile === null) return null

        const fields = readFrontmatter(skillFile)
        // A skill can declare that it is not something a person invokes — it
        // exists for the model to reach for. Listing one here would offer a
        // `/` command that is not one.
        if (fields.get("user_invocable") === "false") return null

        return {
          name: fields.get("name") ?? entry.name,
          description: fields.get("description") ?? "",
          argumentHint: null,
          source,
        }
      })
  )

  return skills.filter((skill): skill is ClaudeSlashCommand => skill !== null)
}

/**
 * Everything the composer's `/` menu should offer for a session running in
 * `projectDir`.
 *
 * Ordered by precedence, most specific first, and then deduplicated by name
 * so a project command that deliberately shadows a personal one of the same
 * name appears once — as the project's — the same way the CLI resolves it.
 */
export async function claudeSlashCommands(
  projectDir: string
): Promise<ClaudeSlashCommand[]> {
  const projectRoot = path.join(projectDir, ".claude")
  const userRoot = path.join(homedir(), ".claude")

  const groups = await Promise.all([
    readCommands(projectRoot, "project-command"),
    readSkills(projectRoot, "project-skill"),
    readCommands(userRoot, "user-command"),
    readSkills(userRoot, "user-skill"),
  ])

  const byName = new Map<string, ClaudeSlashCommand>()
  for (const command of [...groups.flat(), ...builtins()]) {
    if (!byName.has(command.name)) byName.set(command.name, command)
  }

  return [...byName.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  )
}

function builtins(): ClaudeSlashCommand[] {
  return BUILTIN_COMMANDS.map((command) => ({
    ...command,
    argumentHint: null,
    source: "builtin" as const,
  }))
}
