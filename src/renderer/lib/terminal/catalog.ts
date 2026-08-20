import { SquareTerminal } from "lucide-react"
import type { ComponentType } from "react"

import type { AgentKind } from "@shared/api"
import { ClaudeCodeIcon } from "@/components/studio/terminal/claude-code-icon"

/**
 * How each kind of session is named and drawn.
 *
 * Only the presentation lives here: which kinds exist, what they run and
 * whether they are installed is the main process's answer
 * (`electron/agent-tools.ts`), and the picker renders whatever it is told
 * rather than a list of its own.
 */
export const SESSION_TYPES: Record<
  AgentKind,
  {
    label: string
    description: string
    icon: ComponentType<{ className?: string }>
  }
> = {
  terminal: {
    label: "Terminal",
    description: "Your own shell, in the project's directory.",
    icon: SquareTerminal,
  },
  claude: {
    label: "Claude Code",
    description:
      "Anthropic's coding agent, using the CLI on this machine. Read it as a chat or as its own terminal.",
    icon: ClaudeCodeIcon,
  },
}

/**
 * What a session's tab says.
 *
 * Numbered from the second one of a kind onwards, the way an editor names a
 * second untitled buffer: one `claude` needs no ordinal, and three do.
 */
export function sessionLabel(
  kind: AgentKind,
  installing: boolean,
  ordinal: number
): string {
  const { label } = SESSION_TYPES[kind]
  if (installing) return `Install ${label}`
  return ordinal > 1 ? `${label} ${ordinal}` : label
}

/**
 * One session of a list's own name — a renamed session's, or its kind and how
 * many of that kind come before it.
 *
 * Takes the list rather than the session because the ordinal is a position
 * within it: the same session is "Claude" in a list where it is the only one
 * and "Claude 2" beside another. Structurally typed so the strip and the
 * palette can both ask without `TerminalSession` having to be imported here —
 * that would point this module at the store that already reads it.
 */
export function sessionTitle(
  sessions: { kind: AgentKind; installing: boolean; name: string | null }[],
  index: number
): string {
  const session = sessions[index]
  if (!session) return ""
  if (session.name) return session.name

  const ordinal = sessions
    .slice(0, index + 1)
    .filter(
      (candidate) =>
        candidate.kind === session.kind &&
        candidate.installing === session.installing
    ).length

  return sessionLabel(session.kind, session.installing, ordinal)
}
