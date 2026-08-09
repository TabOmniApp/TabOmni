import { cn } from "@/lib/utils"

import { activeSessionOf, useTerminal } from "@/lib/terminal/store"
import { useStudio } from "@/lib/store"
import { TerminalSessionView } from "./terminal-session-view"

/**
 * The Terminal panel, given the whole pane instead of a tab in the panel under
 * the editor.
 *
 * Every session stays mounted, including the ones belonging to projects that
 * are not open: a session is a pty, so taking it out of the tree would end the
 * conversation rather than hide it.
 */
export function TerminalWorkspace() {
  const projectId = useStudio((state) => state.projectId)
  const sessions = useTerminal((state) => state.sessions)
  const activeId = useTerminal((state) => state.activeId)

  const active = activeSessionOf(sessions, projectId, activeId)

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="relative min-h-0 flex-1">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={cn(
              "absolute inset-0",
              session.id !== active?.id && "invisible"
            )}
          >
            <TerminalSessionView
              session={session}
              visible={session.id === active?.id}
            />
          </div>
        ))}

        {!active && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {projectId
              ? "Start a session with + above: a terminal, or Claude Code."
              : "Open a project to start a session."}
          </p>
        )}
      </div>
    </div>
  )
}
