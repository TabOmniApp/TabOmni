import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { Download, Plus, RefreshCw } from "lucide-react"

import type { AgentKind, AgentToolStatus } from "@shared/api"
import { SESSION_TYPES } from "@/lib/terminal/catalog"
import { useTerminal } from "@/lib/terminal/store"

/**
 * The picker behind the Terminal panel's `+`: which kind of session to open.
 *
 * A kind whose CLI is not on this machine offers to install it instead of to
 * start it — the alternative was a session that opens only to print
 * `command not found`, which tells the user what happened but not what to do
 * about it.
 */
export function NewTerminalDialog({
  projectId,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
  const tools = useTerminal((state) => state.tools)
  const checking = useTerminal((state) => state.checkingTools)
  const refreshTools = useTerminal((state) => state.refreshTools)
  const open = useTerminal((state) => state.open)

  // Asked every time the dialog opens: a CLI the user installed in a terminal
  // of their own, minutes ago, is exactly what a cached answer gets wrong.
  useEffect(() => {
    void refreshTools()
  }, [refreshTools])

  function start(kind: AgentKind, installing: boolean) {
    open(projectId, kind, { installing })
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            Runs on this machine, in the project&apos;s own directory.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {tools === null && checking && (
            <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              Looking for the CLI on this machine…
            </p>
          )}

          {tools?.map((tool) => (
            <SessionTypeRow
              key={tool.kind}
              tool={tool}
              onStart={() => start(tool.kind, false)}
              onInstall={() => start(tool.kind, true)}
            />
          ))}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={checking}
            onClick={() => void refreshTools()}
            className="gap-1.5"
          >
            <RefreshCw className={checking ? "animate-spin" : undefined} />
            Check again
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SessionTypeRow({
  tool,
  onStart,
  onInstall,
}: {
  tool: AgentToolStatus
  onStart: () => void
  onInstall: () => void
}) {
  const { label, description, icon: Icon } = SESSION_TYPES[tool.kind]

  const body = (
    <>
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">
          {tool.installed
            ? description
            : `Not installed. ${tool.installCommand ?? ""}`.trim()}
        </span>
      </span>
    </>
  )

  // Installed kinds are a button end to end — the `+` says what the click does
  // without being the only thing that can be hit. An uninstalled one is not
  // clickable at all: its own button is the only action it has.
  if (tool.installed) {
    return (
      <button
        type="button"
        onClick={onStart}
        title={tool.resolved ?? undefined}
        className="flex items-start gap-3 rounded-lg border p-3 text-left hover:bg-accent/50"
      >
        {body}
        <span
          aria-hidden
          className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground"
        >
          <Plus className="size-4" />
        </span>
      </button>
    )
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed p-3">
      {body}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={onInstall}
        className="mt-0.5 h-6 gap-1 px-2 text-xs"
      >
        <Download className="size-3" />
        Install
      </Button>
    </div>
  )
}
