import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Pencil,
  Plus,
  RotateCw,
  SquareTerminal,
  X,
  XCircle,
} from "lucide-react"

import type { TerminalSession } from "@/lib/terminal/store"
import { SESSION_TYPES, sessionLabel } from "@/lib/terminal/catalog"
import { activeSessionOf, sessionsOf, useTerminal } from "@/lib/terminal/store"
import { useStudio } from "@/lib/store"
import { RenameDialog } from "../db/rename-dialog"
import { IconButton } from "../icon-button"
import { PanelHeader } from "../panel-header"
import { SideRow } from "../side-row"
import { NewTerminalDialog } from "./new-terminal-dialog"

/** Where a session falls among others of the same kind, in list order — the
 * ordinal `sessionLabel` numbers a second "Claude Code" with. */
function ordinalOf(list: TerminalSession[], target: TerminalSession): number {
  let count = 0
  for (const session of list) {
    if (
      session.kind === target.kind &&
      session.installing === target.installing
    ) {
      count += 1
    }
    if (session.id === target.id) break
  }
  return count
}

/** What a session's row shows: its own name once renamed, the generated
 * label otherwise. */
function labelOf(list: TerminalSession[], session: TerminalSession): string {
  return (
    session.name ??
    sessionLabel(session.kind, session.installing, ordinalOf(list, session))
  )
}

/**
 * The sessions open in this project, and the button that starts another.
 *
 * A list rather than the single session this panel used to hold: a terminal
 * beside the agent that is editing the files is the pairing people actually
 * work in, and both are the same kind of thing — a pty in the project's
 * directory — so both belong in the same list.
 */
export function TerminalSidebar() {
  const project = useStudio((state) =>
    state.projects.find((candidate) => candidate.id === state.projectId)
  )
  const sessions = useTerminal((state) => state.sessions)
  const activeId = useTerminal((state) => state.activeId)
  const select = useTerminal((state) => state.select)
  const close = useTerminal((state) => state.close)
  const closeOthers = useTerminal((state) => state.closeOthers)
  const closeAll = useTerminal((state) => state.closeAll)
  const restart = useTerminal((state) => state.restart)
  const rename = useTerminal((state) => state.rename)

  const [picking, setPicking] = useState(false)
  const [menuTarget, setMenuTarget] = useState<TerminalSession | null>(null)
  const [renaming, setRenaming] = useState<TerminalSession | null>(null)

  const own = sessionsOf(sessions, project?.id ?? null)
  const active = activeSessionOf(sessions, project?.id ?? null, activeId)

  return (
    <ContextMenu>
      <div className="flex h-full flex-col">
        <PanelHeader title="Terminal">
          <IconButton
            label="New session"
            disabled={!project}
            onClick={() => setPicking(true)}
          >
            <Plus />
          </IconButton>
        </PanelHeader>

        {!project ? (
          <Empty className="p-4">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SquareTerminal />
              </EmptyMedia>
              <EmptyTitle>No project open</EmptyTitle>
              <EmptyDescription className="text-xs">
                A session runs in a project&rsquo;s own directory.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-auto pb-3">
            <section>
              {own.length === 0 ? (
                <div className="space-y-2 p-3">
                  <p className="text-xs text-muted-foreground">
                    No sessions yet.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setPicking(true)}
                    className="h-6 w-full gap-1 text-xs"
                  >
                    <Plus className="size-3" />
                    New session
                  </Button>
                </div>
              ) : (
                <ContextMenuTrigger render={<ul className="pt-1" />}>
                  {own.map((session) => {
                    const { icon: Icon } = SESSION_TYPES[session.kind]
                    const label = labelOf(own, session)

                    return (
                      <li key={session.id} className="group relative">
                        {/* The close control sits over the row rather than
                            inside it: a button within a button is neither valid
                            markup nor reachable by keyboard. */}
                        <SideRow
                          active={session.id === active?.id}
                          onClick={() => select(session.id)}
                          onContextMenu={() => setMenuTarget(session)}
                          className="pr-7"
                        >
                          <Icon className="size-3.5 shrink-0" />
                          <span className="truncate">{label}</span>
                          {session.exited && (
                            <span className="shrink-0 text-[0.65rem] text-muted-foreground">
                              ended
                            </span>
                          )}
                        </SideRow>
                        <button
                          type="button"
                          aria-label={`Close ${label}`}
                          onClick={() => close(session.id)}
                          className="absolute inset-y-0 right-1 my-auto inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100"
                        >
                          <X className="size-3" />
                        </button>
                      </li>
                    )
                  })}
                </ContextMenuTrigger>
              )}
            </section>
          </div>
        )}

        {picking && project && (
          <NewTerminalDialog
            projectId={project.id}
            onClose={() => setPicking(false)}
          />
        )}

        {renaming && (
          <RenameDialog
            title="Rename session"
            label="Session name"
            currentName={labelOf(own, renaming)}
            onRename={async (name) => {
              rename(renaming.id, name)
              return null
            }}
            onClose={() => setRenaming(null)}
          />
        )}
      </div>

      {menuTarget && project && (
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={() => setRenaming(menuTarget)}>
            <Pencil />
            Rename…
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              select(menuTarget.id)
              restart(menuTarget.id)
            }}
          >
            <RotateCw />
            Restart
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => close(menuTarget.id)}>
            <X />
            Close
          </ContextMenuItem>
          <ContextMenuItem
            disabled={own.length <= 1}
            onClick={() => closeOthers(menuTarget.id)}
          >
            <XCircle />
            Close others
          </ContextMenuItem>
          <ContextMenuItem onClick={() => closeAll(project.id)}>
            <XCircle />
            Close all
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
}
