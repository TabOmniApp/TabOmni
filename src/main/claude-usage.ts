import { readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import type { ClaudeUsageLimits } from "../shared/api"

/**
 * The account's five-hour and weekly allowance, read out of the CLI's own
 * cache.
 *
 * `/usage` in the TUI is the only thing that asks the API for these, and it
 * writes what it got to `cachedUsageUtilization` in `~/.claude.json` — the
 * same cache it falls back to, with an "as of" note, when the usage endpoint
 * is itself rate-limited. Reading that file is the whole of what this app
 * does about limits: it is the transcript arrangement again, a reader of what
 * the CLI already writes rather than a second client of the API. Nothing here
 * refreshes it, and nothing can — there is no `claude usage` to shell out to,
 * and the endpoint wants the OAuth token the CLI holds.
 *
 * Which is why `fetchedAt` is carried through rather than dropped. The cache
 * is refreshed on the CLI's schedule, not on the app's, and an hour-old figure
 * shown as if it were current is worse than an hour-old figure labelled as
 * one.
 */
export async function claudeUsageLimits(): Promise<ClaudeUsageLimits | null> {
  for (const file of configFiles()) {
    const cached = await cachedLimits(file)
    if (cached) return cached
  }
  return null
}

/**
 * The last answer read out of a file, kept against the file's own version of
 * itself.
 *
 * The renderer polls this a few times a minute so a `/usage` run in any
 * terminal reaches the bar quickly, and `.claude.json` is not small — it
 * carries the CLI's whole per-project history, hundreds of kilobytes of it,
 * for two numbers at the end. Parsing that on a timer to reach the same answer
 * is the waste worth removing, not the polling: the file's size and mtime say
 * whether the parse would tell us anything new.
 */
type Memo = {
  size: number
  mtimeMs: number
  limits: ClaudeUsageLimits | null
}
const memos = new Map<string, Memo>()

async function cachedLimits(file: string): Promise<ClaudeUsageLimits | null> {
  let size: number
  let mtimeMs: number
  try {
    const info = await stat(file)
    size = info.size
    mtimeMs = info.mtimeMs
  } catch {
    // No file is not a stale answer about one: forget what it used to say so a
    // config dir that comes back is read afresh.
    memos.delete(file)
    return null
  }

  const memo = memos.get(file)
  if (memo && memo.size === size && memo.mtimeMs === mtimeMs) return memo.limits

  const parsed = await readJson(file)
  const limits = (parsed && readLimits(parsed)) || null
  // A read that landed mid-write parses to nothing; remembering that against
  // this mtime would hold the failure until the CLI wrote again, so leave the
  // memo alone and let the next poll try the finished file.
  if (parsed) memos.set(file, { size, mtimeMs, limits })
  return limits
}

/**
 * Where `.claude.json` might be, most specific first.
 *
 * `CLAUDE_CONFIG_DIR` moves it alongside the rest of the tree, so the
 * home-directory copy is the fallback rather than the only candidate — and it
 * is still tried, since a stale or half-written file under the config dir
 * should not hide a readable one. Read from this process's environment, with
 * the same caveat as `transcript.ts`: a variable set in a shell profile does
 * not reach an app launched from the Dock.
 */
function configFiles(): string[] {
  const configured = process.env.CLAUDE_CONFIG_DIR
  const home = path.join(homedir(), ".claude.json")
  return configured ? [path.join(configured, ".claude.json"), home] : [home]
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"))
    // The CLI rewrites this file whole, but a read landing mid-write would
    // throw here rather than at `readFile` — either way there is nothing to
    // report, and the next poll gets the finished file.
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** One entry of the `limits` array the newer CLI writes. */
type RawLimit = {
  group?: unknown
  percent?: unknown
  resets_at?: unknown
}

/** One of the older per-window objects (`five_hour`, `seven_day`). */
type RawWindow = {
  utilization?: unknown
  resets_at?: unknown
}

/**
 * The two figures out of a parsed `.claude.json`, or null if it carries
 * neither.
 *
 * Read the same way as everything else that crosses out of a file this app
 * does not own: two shapes are accepted because the CLI writes both — the
 * `limits` array is the newer, grouped form — and a field that is not the type
 * it should be costs that one figure rather than the row.
 */
function readLimits(config: Record<string, unknown>): ClaudeUsageLimits | null {
  const cached = asRecord(config["cachedUsageUtilization"])
  const utilization = asRecord(cached?.["utilization"])
  if (!utilization) return null

  const rows = Array.isArray(utilization["limits"])
    ? (utilization["limits"] as RawLimit[])
    : []
  const grouped = (group: string): RawLimit | undefined =>
    rows.find((row) => row.group === group)

  const session = grouped("session")
  const weekly = grouped("weekly")
  const fiveHour = asRecord(utilization["five_hour"]) as RawWindow | null
  const sevenDay = asRecord(utilization["seven_day"]) as RawWindow | null

  const sessionPercent =
    asPercent(session?.percent) ?? asPercent(fiveHour?.utilization)
  const weeklyPercent =
    asPercent(weekly?.percent) ?? asPercent(sevenDay?.utilization)

  // A cache with neither figure in it is not one worth drawing a row for.
  if (sessionPercent === null && weeklyPercent === null) return null

  return {
    sessionPercent,
    weeklyPercent,
    sessionResetsAt:
      asString(session?.resets_at) ?? asString(fiveHour?.resets_at),
    weeklyResetsAt:
      asString(weekly?.resets_at) ?? asString(sevenDay?.resets_at),
    fetchedAt: asNumber(cached?.["fetchedAtMs"]),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

/** A percentage, or null for anything that is not one. Clamped rather than
 * rejected above 100: the API reports overage that way, and a bar pinned full
 * is the honest drawing of it. */
function asPercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, value))
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
