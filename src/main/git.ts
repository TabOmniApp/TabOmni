import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)

/**
 * What is left of the git integration: the branch name in the system bar.
 *
 * The panel that read a working tree — changes, diffs, staging, commits, and
 * the GitHub pull requests beside them — was removed. The one thing outside it
 * that asked git a question is the system bar, and it asks only this.
 */
export async function currentBranch(dir: string): Promise<string | null> {
  try {
    const branch = (await git(dir, ["branch", "--show-current"])).trim()
    // Empty output means a detached HEAD rather than no branch at all.
    if (branch) return branch
    const sha = (await git(dir, ["rev-parse", "--short", "HEAD"])).trim()
    return sha ? `detached @ ${sha}` : null
  } catch {
    return null
  }
}

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd: dir, windowsHide: true })
  return stdout
}
