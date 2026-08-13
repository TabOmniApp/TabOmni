import type {
  AgentKind,
  AgentToolStatus,
  ClaudeModel,
  ClaudePermissionMode,
} from "../shared/api"
import { locate, quote } from "./shell-env"

type AgentTool = {
  /**
   * What to run for a session of this kind, or null to leave the user at their
   * own prompt.
   *
   * A bare command name rather than a path, resolved by the login shell, so any
   * of the ways the CLI installs itself — npm, Homebrew, its own installer — is
   * found. The `*_BIN` overrides are for a custom install.
   */
  command: string | null
  /** Null when there is nothing to install: the shell is always there. */
  installCommand: string | null
}

/**
 * The kinds of session the Terminal panel offers, in the order it offers them.
 *
 * One place decides both what a kind runs and how it is installed, so the
 * picker cannot offer something the session cannot start.
 */
const AGENT_TOOLS: Record<AgentKind, AgentTool> = {
  terminal: { command: null, installCommand: null },
  claude: {
    command: process.env.CLAUDE_BIN ?? "claude",
    installCommand: "npm install -g @anthropic-ai/claude-code",
  },
}

const KINDS = Object.keys(AGENT_TOOLS) as AgentKind[]

/** What a session of `kind` runs, or undefined for a plain shell. */
export function agentCommand(kind: AgentKind): string | undefined {
  return AGENT_TOOLS[kind]?.command ?? undefined
}

/**
 * The same command with a session's model and permission mode applied.
 *
 * `--model` has a mid-session counterpart the composer uses (`/model`).
 * A permission mode does not, and the reason is a choice rather than a
 * limit: the CLI does accept `/config permissionMode=…`, but that writes
 * `permissions.defaultMode` into the user's own `~/.claude/settings.json`,
 * where it would become the default for every other project and for every
 * `claude` they run in a terminal of their own. A per-project setting has no
 * business doing that, so the mode stays a startup flag — and a change to it
 * restarts the session, resuming the same conversation (`resume` below).
 *
 * Only `claude` gets them; the other kinds take no such flags.
 */
export function agentCommandWith(
  kind: AgentKind,
  options: {
    model?: ClaudeModel | null
    permissionMode?: ClaudePermissionMode | null
    /**
     * The session id to run under, which decides what the CLI names its
     * transcript file — and so which file the chat view can tail. Without it
     * the CLI picks its own id and the only way to find the session would be
     * to guess at whichever file in the directory was written last, which two
     * sessions open on one project would get wrong.
     */
    claudeSessionId?: string | null
    /**
     * Whether that id names a conversation the CLI already has, in which case
     * it is continued rather than started.
     *
     * This is what makes "Restart to apply" keep the conversation: a restart
     * is the same tab, the same transcript, and a new process with the
     * settings the user just chose. `--resume` writes on into the same file
     * (unlike `--fork-session`), so the chat view carries on reading where it
     * left off.
     */
    resume?: boolean
  }
): string | undefined {
  const command = agentCommand(kind)
  if (command === undefined || kind !== "claude") return command

  const flags: string[] = []
  // The two are mutually exclusive: the CLI rejects `--session-id` for an id
  // it has already used, and `--resume` for one it has never seen.
  if (options.claudeSessionId)
    flags.push(
      options.resume
        ? `--resume ${quote(options.claudeSessionId)}`
        : `--session-id ${quote(options.claudeSessionId)}`
    )
  // `default` is the absence of a flag, not a value to pass: the CLI's own
  // configured default is a real setting the user may have chosen elsewhere,
  // and overriding it with a guess would be worse than leaving it alone.
  if (options.model && options.model !== "default")
    flags.push(`--model ${quote(options.model)}`)
  if (options.permissionMode && options.permissionMode !== "default")
    flags.push(`--permission-mode ${quote(options.permissionMode)}`)

  return flags.length === 0 ? command : `${command} ${flags.join(" ")}`
}

/** How `kind` installs itself. Rejects for a kind that installs nothing. */
export function agentInstallCommand(kind: AgentKind): string {
  const installCommand = AGENT_TOOLS[kind]?.installCommand
  if (!installCommand) throw new Error(`Nothing to install for "${kind}"`)
  return installCommand
}

/** Whether each kind can be started on this machine. */
export function agentToolStatuses(): Promise<AgentToolStatus[]> {
  return Promise.all(KINDS.map(statusOf))
}

async function statusOf(kind: AgentKind): Promise<AgentToolStatus> {
  const tool = AGENT_TOOLS[kind]
  // The shell is the one kind that needs no looking up — a machine without one
  // could not have started any of the others either.
  if (!tool.command) {
    return { kind, installed: true, resolved: null, installCommand: null }
  }

  const resolved = await locate(tool.command)
  return {
    kind,
    installed: resolved !== null,
    resolved,
    installCommand: tool.installCommand,
  }
}
