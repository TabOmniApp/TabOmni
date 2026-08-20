import type { AgentKind, AgentToolStatus } from "../shared/api"
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
 * The same command with a session's own flags applied.
 *
 * Which model and which permission mode a session runs under are the CLI's
 * own settings, left to it: this app passes neither, so a `claude` started
 * here is the one the user would get by running it themselves. Only `claude`
 * gets any of the flags below; the other kinds take none.
 */
export function agentCommandWith(
  kind: AgentKind,
  options: {
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
     * This is what makes a restart keep the conversation: the same tab, the
     * same transcript, and a new process. `--resume` writes on into the same
     * file (unlike `--fork-session`), so the chat view carries on reading
     * where it left off.
     */
    resume?: boolean
    /**
     * The MCP config this workspace offers the agent — its databases, its
     * saved requests, its notes — or null when every one of them is switched
     * off in Settings, which is the default.
     *
     * `--mcp-config` adds to whatever the user already has configured rather
     * than replacing it (that would be `--strict-mcp-config`): somebody's own
     * MCP servers are theirs, and a session started here should not quietly
     * lose them.
     */
    mcpConfig?: string | null
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
  if (options.mcpConfig) flags.push(`--mcp-config ${quote(options.mcpConfig)}`)

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
