import { cn } from "@/lib/utils"

import {
  activeSessionOf,
  liveSessions,
  useTerminal,
} from "@/lib/terminal/store"
import { useStudio } from "@/lib/store"
import { TerminalSessionView } from "./terminal-session-view"

/**
 * The sessions, given the whole pane instead of a tab in the panel under the
 * editor.
 *
 * A pane with no rail section and no sidebar of its own: sessions are started
 * and listed in the Explorer sidebar, under the folders they run in, and this
 * draws whichever of them the strip has selected.
 *
 * Every session stays mounted, whichever folder it belongs to: a session is a
 * pty, so taking it out of the tree would end the conversation rather than
 * hide it.
 */
export function TerminalWorkspace() {
  const folders = useStudio((state) => state.folders)
  const sessions = useTerminal((state) => state.sessions)
  const activeId = useTerminal((state) => state.activeId)

  const active = activeSessionOf(sessions, activeId)

  // Closed sessions are rows in the sidebar, not panes: unmounting the view is
  // what ends the pty, so leaving one mounted would be leaving it running.
  const live = liveSessions(sessions)

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="relative min-h-0 flex-1">
        {live.map((session) => (
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
            {folders.length > 0
              ? "Start a session from the Sessions list in Explorer: a terminal, or Claude Code."
              : "Add a folder to start a session."}
          </p>
        )}
      </div>
    </div>
  )
}
