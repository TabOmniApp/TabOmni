import { SquareTerminal } from "lucide-react"
import type { ComponentType } from "react"

import type { AgentKind, ClaudeModel, ClaudePermissionMode } from "@shared/api"
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
 * The models the composer offers, in the order it offers them.
 *
 * Aliases, not dated model ids — see `ClaudeModel` in `shared/api.ts` for
 * why. The CLI is the authority on which aliases exist, and it accepts more
 * than this: the list is the ones worth a menu row, not a claim to be
 * exhaustive.
 */
export const CLAUDE_MODELS: { id: ClaudeModel; label: string }[] = [
  { id: "default", label: "Default model" },
  { id: "fable", label: "Fable" },
  { id: "opus", label: "Opus" },
  { id: "opusplan", label: "Opus in plan mode, Sonnet otherwise" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
]

/**
 * The permission modes the composer offers.
 *
 * Descriptions are deliberately short and behavioural — this is the setting
 * that decides what the agent may do to the user's files without asking, so
 * a row that is vague about it is worse than no row.
 */
export const CLAUDE_PERMISSION_MODES: {
  id: ClaudePermissionMode
  label: string
  description: string
}[] = [
  {
    id: "default",
    label: "Default",
    description: "Whatever the CLI is already configured to use.",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Reads and plans only — no edits until you approve.",
  },
  {
    id: "acceptEdits",
    label: "Accept edits",
    description: "File edits go through without asking; other tools still ask.",
  },
  {
    id: "auto",
    label: "Auto — never ask",
    description:
      "Nothing is asked about, including deletions and shell commands.",
  },
]

/** Just the ids, for validating what came back out of the settings store —
 * a value written by an older build (or edited by hand) must not become a
 * flag the CLI rejects at startup. */
export const CLAUDE_MODEL_IDS = new Set<string>(
  CLAUDE_MODELS.map((model) => model.id)
)

export const CLAUDE_PERMISSION_MODE_IDS = new Set<string>(
  CLAUDE_PERMISSION_MODES.map((mode) => mode.id)
)

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
