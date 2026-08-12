import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { askClaude } from "../src/main/ai-cli"
import { check, finish, section } from "./harness"

/**
 * How this app runs the Claude Code CLI, and what it says when that fails.
 *
 * Run against real commands rather than a faked rejection: what is being
 * checked is how Node reports a spawn that could not start, one that ran out of
 * time and one that exited complaining — three shapes of the same error object,
 * and the whole point of the module is telling them apart. A stub of that
 * object would only assert what this file already assumes.
 *
 * `-p <prompt>` goes in front of whatever is run here, which is why the stand-in
 * commands are scripts that ignore their arguments.
 */

const dir = mkdtempSync(path.join(tmpdir(), "ai-cli-"))

function script(name: string, body: string): string {
  const file = path.join(dir, name)
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)
  return file
}

const env = process.env

async function failure(options: {
  command: string
  timeoutMs?: number
  maxBuffer?: number
}): Promise<string> {
  try {
    await askClaude({
      command: options.command,
      env,
      cwd: dir,
      prompt: "anything",
      timeoutMs: options.timeoutMs ?? 5_000,
      maxBuffer: options.maxBuffer ?? 64 * 1024,
    })
    return "(no failure)"
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

section("the answer")

const echo = script("echo.sh", 'printf "%s" "answered"')
check(
  "stdout comes back as a string",
  (await askClaude({
    command: echo,
    env,
    cwd: dir,
    prompt: "x",
    timeoutMs: 5_000,
    maxBuffer: 1024,
  })) === "answered"
)

/**
 * `execFile` gives a child a stdin pipe nobody writes to or closes, so the CLI
 * waits three seconds for input that never comes and warns about it — a warning
 * that then turns up in every failure message looking like the cause.
 */
const readsStdin = script("stdin.sh", 'cat; printf "%s" "done"')
const started = Date.now()
await askClaude({
  command: readsStdin,
  env,
  cwd: dir,
  prompt: "x",
  timeoutMs: 5_000,
  maxBuffer: 1024,
})
check(
  "stdin is closed, so a command that reads it is not left waiting",
  Date.now() - started < 2_000,
  Date.now() - started
)

section("what it says when that fails")

const missing = await failure({ command: path.join(dir, "not-here") })
check(
  "a command that is not there says so",
  missing.includes("installed"),
  missing
)
check("and does not talk about signing in", !missing.includes("signed in"))

const slow = script("slow.sh", "sleep 10")
const timedOut = await failure({ command: slow, timeoutMs: 1_000 })
check(
  "running out of time says so",
  timedOut.includes("did not answer"),
  timedOut
)
check(
  "and names the limit in minutes",
  timedOut.includes("1 minute") && !timedOut.includes("0 minute"),
  timedOut
)

const complained = script("complain.sh", 'echo "Invalid API key" >&2; exit 1')
const said = await failure({ command: complained })
check("an exit code is reported", said.includes("exit 1"), said)
check(
  "so is what the command complained about",
  said.includes("Invalid API key")
)

/** The warning is noise on every failure and has never once been the reason
 * for one; leaving it in put it where the cause should be. */
const noisy = script(
  "noisy.sh",
  'echo "Warning: no stdin data received in 3s, proceeding without it." >&2; echo "the real problem" >&2; exit 3'
)
const filtered = await failure({ command: noisy })
check(
  "the stdin warning is not repeated back",
  !filtered.includes("no stdin"),
  filtered
)
check("the line under it is", filtered.includes("the real problem"))

const silent = script("silent.sh", "exit 4")
const quiet = await failure({ command: silent })
check(
  "an exit with nothing on stderr still reports the code",
  quiet.includes("exit 4")
)
check("and suggests the usual cause", quiet.includes("signed in"), quiet)

/**
 * The prompt is a couple of kilobytes. Node's own message is
 * `Command failed: <the whole command>`, which made the one thing an error
 * toast showed the prompt that provoked it.
 */
check(
  "no failure message repeats the prompt back",
  [missing, timedOut, said, filtered, quiet].every(
    (message) => !message.includes("anything")
  )
)

finish()
