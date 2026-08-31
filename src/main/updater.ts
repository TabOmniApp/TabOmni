import { spawn } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"

import type { UpdateCheck } from "../shared/api"
import { dataDir } from "./data-dir"

/**
 * Whether there is a newer Yasuo, and installing it.
 *
 * **Not `electron-updater`, and deliberately.** Squirrel.Mac will not replace a
 * bundle that carries no Developer ID, and these builds carry none — signing
 * costs an Apple Developer membership, which is the same reason `install.sh`
 * exists at all. So the whole of the update story here is: ask GitHub what the
 * latest release is, compare it against this build, and run the very script the
 * README already tells people to paste into a terminal. Nothing is downloaded
 * in the background, nothing is staged, and there is no delta.
 *
 * Free of `electron` — this process's own version, and where the script it runs
 * lives, are arguments — so `test/updates.ts` can import it under plain `bun`,
 * the same bargain `git.ts` makes.
 */

const REPO = "YasuoApp/Yasuo"

const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`

/** Where "What's new" goes, and the fallback button on anything but macOS. */
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`

/**
 * A check runs unasked, on a timer, so it must not be able to hang about: an
 * unreachable GitHub should read as `unknown` within a few seconds rather than
 * leave a request pending for however long the OS's default is.
 */
const REQUEST_TIMEOUT_MS = 10_000

/** The installer's output, kept because the app it is updating quits halfway
 * through and has nowhere left to show a failure. */
export function updateLogPath(): string {
  return path.join(dataDir(), "update.log")
}

/**
 * A version as numbers, for comparing.
 *
 * Anything that is not a run of digits ends the list rather than being coerced,
 * so `1.0.20-beta.1` is `[1, 0, 20]` and its prerelease is handled separately —
 * a `-beta` sorting as a fourth component would make it *newer* than the
 * release it precedes.
 */
export function versionParts(version: string): number[] {
  const core = version.replace(/^v/, "").split(/[-+]/, 1)[0] ?? ""
  return core.split(".").map((part) => {
    const value = Number.parseInt(part, 10)
    return Number.isNaN(value) ? 0 : value
  })
}

function isPrerelease(version: string): boolean {
  return /[-+]/.test(version.replace(/^v/, ""))
}

/**
 * Whether `candidate` is a release worth offering to somebody on `current`.
 *
 * Strictly newer, never merely different: a machine running a build ahead of
 * the latest release — anyone who ran `make app` from a checkout — should be
 * told nothing rather than offered a downgrade dressed up as an update.
 */
export function isNewer(candidate: string, current: string): boolean {
  const left = versionParts(candidate)
  const right = versionParts(current)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a !== b) return a > b
  }
  // Same numbers: `1.0.20` is newer than `1.0.20-beta.1`, and nothing else
  // about two prereleases of one version is worth guessing at.
  return isPrerelease(current) && !isPrerelease(candidate)
}

type Release = { version: string; notes: string; url: string }

/** The shape of the one release GitHub is asked for, checked rather than cast:
 * this is JSON off the network. */
function asRelease(value: unknown): Release | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const tag = record.tag_name
  if (typeof tag !== "string" || tag.length === 0) return null
  return {
    version: tag.replace(/^v/, ""),
    notes: typeof record.body === "string" ? record.body : "",
    url: typeof record.html_url === "string" ? record.html_url : RELEASES_PAGE,
  }
}

async function latestRelease(): Promise<Release> {
  const response = await fetch(LATEST_RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      // GitHub rejects an anonymous API request with no user agent outright,
      // and the rejection is a 403 that reads like rate limiting.
      "User-Agent": "Yasuo",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status}.`)
  }
  const release = asRelease(await response.json())
  if (!release) throw new Error("The latest release has no tag.")
  return release
}

/**
 * What the update badge is drawn from.
 *
 * `platform` decides only whether the button can install or merely link — the
 * check itself is worth doing everywhere, because "there is a newer version"
 * is true on Windows too even when this app cannot be the one to fetch it.
 */
export async function checkForUpdate(
  current: string,
  platform: NodeJS.Platform
): Promise<UpdateCheck> {
  let release: Release
  try {
    release = await latestRelease()
  } catch (error) {
    return {
      status: "unknown",
      current,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  if (!isNewer(release.version, current)) return { status: "current", current }
  return {
    status: "available",
    version: release.version,
    current,
    notes: release.notes,
    url: release.url,
    installable: platform === "darwin",
  }
}

/**
 * Runs `install.sh` for a version and reopens the app afterwards.
 *
 * **Detached, and that is the whole trick.** The script's third act is quitting
 * the app so that a bundle is not replaced out from under a running process —
 * it does that itself, `osascript` and a `pgrep` loop, because somebody running
 * it from a terminal needs it too. A child of the process being quit would die
 * with it midway through a `ditto`; a detached one outlives it and gets to the
 * `open` at the end.
 *
 * Output goes to a file for the same reason: by the time anything goes wrong,
 * the window that would have shown it is gone.
 */
export async function startInstaller(input: {
  /** The `install.sh` shipped inside the app bundle. */
  script: string
  version: string
  /** The bundle to reopen — where `install.sh` puts it, not where this process
   * happens to be running from. */
  appPath: string
}): Promise<void> {
  const logPath = updateLogPath()
  await mkdir(path.dirname(logPath), { recursive: true })
  // Truncated rather than appended: what matters is the run that just failed,
  // and this file is read by a person looking for exactly that.
  const log = openSync(logPath, "w")

  const child = spawn(
    "/bin/bash",
    [
      "-c",
      // Arguments rather than an interpolated string: a version is a value from
      // the network, and this one ends up on a command line.
      'bash "$1" "$2" && open "$3"',
      "yasuo-update",
      input.script,
      input.version,
      input.appPath,
    ],
    {
      detached: true,
      stdio: ["ignore", log, log],
      // No cwd of this app's: it may be inside the bundle about to be replaced.
      cwd: path.dirname(logPath),
    }
  )
  // The child holds its own copy; this one would otherwise outlive the spawn.
  closeSync(log)
  child.unref()
}
