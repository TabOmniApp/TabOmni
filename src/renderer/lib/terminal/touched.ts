/**
 * Which files a `claude` turn wrote, read out of the transcript's own tool
 * calls.
 *
 * **The transcript already says this, so nothing has to be watched for it.**
 * The CLI records every tool call it makes, with the arguments it made it with,
 * so an `Edit` is a line naming the file it edited. Explorer does watch the
 * folders it has open (`main/watch.ts`), but this is the earlier and the surer
 * answer: it names the file as the call is recorded rather than after a
 * debounce, and it holds on the filesystems `fs.watch` says nothing about — a
 * folder mounted into a container, or one over a network.
 *
 * Only writes count. `Read`, `Grep` and `Glob` name files too and change
 * nothing, so including them would turn "what changed" into "what was looked
 * at", which is most of a repository by the end of a turn.
 *
 * `Bash` is the honest gap: `sed -i`, a build, a `git checkout` all write files
 * and none of them says so in a way this can read. A turn that only ran commands
 * reports nothing here — the tree's own watchers are what pick that up, and
 * Refresh is what picks it up where they cannot.
 */

/** What the transcript hands over for one tool call. */
export type ToolCall = {
  name: string
  input: unknown
}

/**
 * The tools that write, and the argument each names its file with.
 *
 * A newer CLI's tool this does not know about is simply not reported: the file
 * would still be on disk, and Refresh would still find it. Guessing from a
 * name — anything containing "write" — would be the version that eventually
 * claims a path out of a tool that takes a glob.
 */
const WRITE_TOOLS: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
}

/** An absolute path out of a tool call's own input, or null. */
function pathOf(call: ToolCall): string | null {
  const key = WRITE_TOOLS[call.name]
  if (key === undefined) return null

  const input = call.input as Record<string, unknown> | null
  const value = input?.[key]
  if (typeof value !== "string" || value === "") return null

  // Relative paths are not this app's to resolve: the CLI runs in the folder's
  // own directory and writes absolute paths, and a `./src/x.ts` guessed against
  // the wrong cwd would open a file that does not exist.
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) ? value : null
}

/**
 * The files these calls wrote, most recently written last, each once.
 *
 * Deduplicated by keeping the *latest* mention: a file edited three times in a
 * turn belongs where its last edit was, which is what makes the tail of this
 * list "what the agent has just been doing".
 */
export function writtenPaths(calls: Iterable<ToolCall>): string[] {
  const seen: string[] = []
  for (const call of calls) {
    const path = pathOf(call)
    if (path === null) continue
    const at = seen.indexOf(path)
    if (at !== -1) seen.splice(at, 1)
    seen.push(path)
  }
  return seen
}
