import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { UserMcpServer } from "../shared/api"

/**
 * The MCP servers the user's own `claude` has, so this app can offer them.
 *
 * **Why read someone else's config at all.** A chat here runs with
 * `--strict-mcp-config` and a config this app wrote, which is what keeps a
 * conversation the app is hosting from quietly inheriting whatever the CLI was
 * configured with. That decision is right and stays. What it cost was the
 * obvious thing somebody wants next: the issue tracker they already have set up
 * in the terminal, in the chat that is editing the branch the issue is about.
 * So the servers are *listed* here, switched on one at a time in Settings › MCP,
 * and the ones switched on are copied into the config `mcp.ts` writes. Nothing
 * is inherited — every server in that file is one this app was told to put
 * there.
 *
 * **Where they live.** `~/.claude.json`, which is where `claude mcp add`
 * writes: `mcpServers` at the top level for the `user` scope, and
 * `projects.<dir>.mcpServers` for one added under a particular directory. Both
 * are listed, because matching by directory would mean the list changed as the
 * left column was clicked around — and a workspace holds several projects at
 * once. The switch is the workspace's, so the list is too.
 *
 * A `.mcp.json` in a repository is deliberately not read. That file is the
 * project's own, checked in and shared, and copying a server out of it because
 * that project happened to be selected is the inheriting this app refuses.
 * Adding it with `claude mcp add` is what says yes to it.
 */

/** What a server looks like in the CLI's config: this app never interprets it
 * beyond a line for the row, and hands the rest over as it stands. */
type ServerConfig = Record<string, unknown>

/** A listed server and the config behind it. Only the first half crosses to the
 * renderer — the second holds tokens and is main's alone. */
export type UserMcpEntry = UserMcpServer & { config: ServerConfig }

/** Where `claude mcp add` writes. */
export function userConfigPath(): string {
  return path.join(os.homedir(), ".claude.json")
}

/**
 * Every server the user has configured, or none.
 *
 * A missing or unreadable config is an empty list rather than an error: not
 * having used the CLI is the ordinary case, and Settings drawing "none
 * configured" is the honest answer to it.
 */
export async function readUserMcpServers(): Promise<UserMcpEntry[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(userConfigPath(), "utf8"))
  } catch {
    return []
  }
  return serversFrom(parsed)
}

/**
 * The pure half: a parsed `~/.claude.json` as a list of servers.
 *
 * Defensive about every level, because this is a file another program owns and
 * a shape that has changed before. Anything that is not an object of objects is
 * skipped rather than throwing — one malformed project must not take the whole
 * list with it.
 *
 * The user's own scope is listed first and a name is kept once. Two projects
 * configuring `clickup` are all but always the same server added twice, and a
 * list with it twice would be two switches for one thing, either of which
 * silently wins.
 */
export function serversFrom(config: unknown): UserMcpEntry[] {
  const root = asObject(config)
  const entries: UserMcpEntry[] = []
  const seen = new Set<string>()

  const take = (
    servers: unknown,
    scope: UserMcpServer["scope"],
    project: string | null
  ) => {
    for (const [name, value] of Object.entries(asObject(servers))) {
      const server = asObject(value)
      if (!name || seen.has(name) || Object.keys(server).length === 0) continue
      seen.add(name)
      entries.push({
        name,
        scope,
        project,
        detail: describe(server),
        config: server,
      })
    }
  }

  take(root.mcpServers, "user", null)
  for (const [dir, value] of Object.entries(asObject(root.projects))) {
    take(asObject(value).mcpServers, "project", dir)
  }

  return entries
}

/**
 * One line saying what a server is, for the row somebody decides from.
 *
 * The transport and where it goes, which is the whole of what can be said
 * without knowing the server: a name alone does not distinguish the hosted
 * ClickUp from a script called `clickup` in someone's downloads, and that
 * difference is the one a switch here is about. Env values are never in it —
 * they are the tokens.
 */
export function describe(config: ServerConfig): string {
  const url = typeof config.url === "string" ? config.url : ""
  const declared = typeof config.type === "string" ? config.type : ""
  // The type is optional in the CLI's own config and a URL is what decides it
  // when it is missing, the same way the CLI reads it.
  const transport = declared || (url ? "http" : "stdio")

  if (url) return `${transport} · ${hostOf(url)}`

  const command = typeof config.command === "string" ? config.command : ""
  if (!command) return transport

  const args = Array.isArray(config.args)
    ? config.args.filter((arg): arg is string => typeof arg === "string")
    : []
  // The command and its first argument: `npx` on its own says nothing, and the
  // whole argument list is a paragraph in a row that has one line.
  return `${transport} · ${[command, ...args.slice(0, 1)].join(" ")}`
}

/**
 * The servers a stored list of names actually names, in the order they were
 * listed.
 *
 * A name with nothing behind it is dropped rather than kept: the setting
 * outlives the config it points into, so a server removed with
 * `claude mcp remove` has to stop being handed over — and it goes on being
 * stored, so putting it back does not mean approving it again.
 */
export function chosen(
  entries: UserMcpEntry[],
  names: string[]
): UserMcpEntry[] {
  const wanted = new Set(names)
  return entries.filter((entry) => wanted.has(entry.name))
}

/** The host a URL points at, or the URL when it is not one this can parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
