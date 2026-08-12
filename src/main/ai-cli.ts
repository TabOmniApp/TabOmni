import { execFile } from "node:child_process"

/**
 * How this app asks the Claude Code CLI a one-shot question.
 *
 * Five features do it — the data browser's filter, the API import, the commit
 * message, the review, and the spec generator — and each used to spawn the CLI
 * itself and wrap a failure in the same sentence. Which meant five copies of
 * two bugs.
 *
 * The first was stdin. `execFile` gives the child a pipe nobody ever writes to
 * or closes, so the CLI waits three seconds for input that is never coming and
 * prints a warning about it — which then turns up in every failure message
 * looking like the cause. Ending that pipe is why this is not the promisified
 * `execFile`; see the note at the call.
 *
 * The second was the failure itself. Node's own message is
 * `Command failed: <the whole command>`, and for these calls the command
 * contains a two-kilobyte prompt, so the one thing an error toast showed was
 * the prompt. What a reader needs is which of the three things went wrong:
 * the CLI is not there, it ran out of time, or it exited saying something.
 */
export async function askClaude(options: {
  command: string
  env: NodeJS.ProcessEnv
  cwd: string
  prompt: string
  /**
   * What it may use while answering. Omitted for the one-shot text transforms,
   * which need no tools at all — and a CLI with none cannot wander off into
   * the project.
   */
  tools?: string[]
  timeoutMs: number
  maxBuffer: number
}): Promise<string> {
  const args = ["-p", options.prompt]
  if (options.tools?.length) {
    // `--disallowedTools` spells out the same thing the other way: read-only
    // against the user's own repository, and no permission prompt to answer
    // since there is no TTY to answer it at.
    args.push(
      "--allowedTools",
      ...options.tools,
      "--disallowedTools",
      "Bash",
      "Write",
      "Edit"
    )
  }

  return new Promise((resolve, reject) => {
    const child = execFile(
      options.command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs,
        maxBuffer: options.maxBuffer,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        // stderr comes from here rather than off the error: only the
        // promisified `execFile` attaches it, and this is the callback form.
        if (error) {
          reject(new Error(describe(error, options.timeoutMs, stderr)))
        } else resolve(stdout)
      }
    )

    /*
     * Closing stdin, which is the whole reason this is not the promisified
     * `execFile`.
     *
     * Passing `stdio: ["ignore", …]` in the options above looks like it would
     * do it and does nothing at all: `execFile` forwards only `cwd`, `env`,
     * `windowsHide` and a few others to `spawn`, and always opens its own
     * pipes. The child is therefore handed a stdin pipe nobody ever writes to
     * or closes, so the CLI waits three seconds for input that is never coming
     * and warns about it — and a command that genuinely reads stdin waits for
     * ever. Ending the pipe here gives it EOF at once.
     */
    child.stdin?.end()
  })
}

type CliFailure = {
  code?: number | string
  killed?: boolean
  signal?: string
}

/** The first line or two of what the CLI complained about, without the prompt
 * that provoked it. */
function said(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    // Gone now that stdin is closed, but an older CLI may still say it, and it
    // has never once been the reason a call failed.
    .filter((line) => !line.startsWith("Warning: no stdin data received"))

  return lines.slice(0, 2).join(" ")
}

function describe(error: unknown, timeoutMs: number, stderr: string): string {
  const failure = error as CliFailure

  if (failure.code === "ENOENT") {
    return "Could not run Claude Code — check that it is installed and on your PATH."
  }

  if (failure.killed || failure.signal === "SIGTERM") {
    // At least one: rounding a sub-minute limit down gives "within 0 minutes",
    // which reads as a bug rather than as a limit.
    const minutes = Math.max(1, Math.round(timeoutMs / 60_000))
    return `Claude Code did not answer within ${minutes} minute${
      minutes === 1 ? "" : "s"
    }. Asking about fewer files, or a smaller screenshot, usually finishes.`
  }

  if (typeof failure.code === "string" && failure.code.includes("maxBuffer")) {
    return "Claude Code answered with more than this can hold."
  }

  const complaint = said(stderr)
  const exit = typeof failure.code === "number" ? ` (exit ${failure.code})` : ""
  return complaint
    ? `Claude Code stopped${exit}: ${complaint}`
    : `Claude Code stopped${exit} without saying why — check that it is signed in.`
}
