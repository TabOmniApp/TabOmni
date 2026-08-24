import { useCallback, useEffect, useRef } from "react"
import { RotateCw, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useDock } from "@/lib/dock"
import { useShells, type Shell } from "@/lib/shell/store"
import { useStudio } from "@/lib/store"
import { IconButton } from "./icon-button"
import { TerminalView, type TerminalHandle } from "./terminal-view"

/**
 * The dock's Terminal tab: a shell in the project that was last clicked.
 *
 * Conductor's `Setup / Run / Terminal` strip, and this is the third of them — a
 * plain shell beside the work rather than a surface of its own. The agent side
 * of what the Terminal *panel* used to be is a worktree's chat now, which is
 * why a shell can live in a corner of the column without demoting anything: it
 * is somewhere to run `git log`, not somewhere work happens.
 *
 * Every shell stays mounted, hidden rather than unmounted — a pty taken out of
 * the tree would end, not hide, and switching project must not kill the command
 * that was left running in the last one. `invisible` rather than `hidden`,
 * because `display: none` collapses the box xterm measures itself against and
 * the pty would be told a size that is not the one it comes back to.
 */
export function DockTerminal() {
  const shells = useShells((state) => state.shells)
  const activeId = useShells((state) => state.activeId)
  const target = useShells((state) => state.target)

  // The one place a shell is started, and only while this tab is the one on
  // screen: a pty is a process, and clicking a project in the column must not
  // start one behind a dock nobody has opened. Following `target` is what makes
  // a project clicked *while* this is showing switch straight away.
  const showing = useDock((state) => state.open && state.tab === "terminal")
  // The folders too: with nothing clicked yet `ensure` guesses from them, and a
  // tab opened before the workspace had been read would otherwise sit on its
  // empty state until something else happened to change.
  const folders = useStudio((state) => state.folders)
  useEffect(() => {
    if (showing) useShells.getState().ensure()
  }, [showing, target, folders])

  if (shells.length === 0) {
    return (
      <div className="grid h-full place-items-center p-4">
        <p className="max-w-56 text-center text-xs text-muted-foreground">
          Add a folder to the workspace and a shell opens in it here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Where id={activeId} />
      <div className="relative min-h-0 flex-1">
        {shells.map((shell) => (
          <div
            key={shell.id}
            className={cn(
              "absolute inset-0",
              shell.id !== activeId && "invisible"
            )}
          >
            <ShellView shell={shell} />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Which directory the shell on screen is in.
 *
 * Said in the panel rather than left to the prompt: the whole point of this tab
 * is that it follows the project, so the one thing a reader has to be able to
 * check at a glance is which one it followed.
 */
function Where({ id }: { id: string | null }) {
  const shells = useShells((state) => state.shells)
  const folders = useStudio((state) => state.folders)
  const restart = useShells((state) => state.restart)
  const close = useShells((state) => state.close)

  const shell = shells.find((candidate) => candidate.id === id)
  if (!shell) return null

  const project =
    folders.find((folder) => folder.id === shell.folderId)?.name ?? "project"

  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 border-b px-2">
      <span className="min-w-0 truncate text-[0.7rem] text-muted-foreground">
        {project}
      </span>
      {shell.exited && (
        <span className="shrink-0 text-[0.7rem] text-muted-foreground/70">
          exited
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center">
        <IconButton
          label="Restart shell"
          className="size-6"
          onClick={() => restart(shell.id)}
        >
          <RotateCw className="size-3" />
        </IconButton>
        <IconButton
          label="Close shell"
          className="size-6"
          onClick={() => close(shell.id)}
        >
          <X className="size-3" />
        </IconButton>
      </span>
    </div>
  )
}

/**
 * One shell's pty, on the host and in its place's directory.
 *
 * Deliberately outside any sandbox: a shell edits the very files shown in the
 * editor, and it is the machine's own.
 */
function ShellView({ shell }: { shell: Shell }) {
  const setExited = useShells((state) => state.setExited)

  // The id arrives asynchronously, but keystrokes can be typed before it does,
  // so writes go through a ref rather than state.
  const terminalId = useRef<string | null>(null)

  const { id, folderId } = shell

  const onReady = useCallback(
    (terminal: TerminalHandle) => {
      let disposed = false
      let unsubscribeData: (() => void) | undefined
      let unsubscribeExit: (() => void) | undefined

      void window.desktop
        .terminalCreate(folderId, terminal.cols, terminal.rows)
        .then((created) => {
          // The pane unmounted while the shell was starting; it would otherwise
          // be left running with nothing reading it.
          if (disposed) {
            void window.desktop.terminalKill(created)
            return
          }

          terminalId.current = created

          unsubscribeData = window.desktop.onTerminalData((event) => {
            if (event.terminalId !== created) return
            terminal.write(event.chunk)
          })

          unsubscribeExit = window.desktop.onTerminalExit((event) => {
            if (event.terminalId !== created) return
            terminalId.current = null
            setExited(id, true)
            terminal.write(
              `\r\n\x1b[90m[exited with ${event.exitCode}]\x1b[0m\r\n`
            )
          })
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          setExited(id, true)
          terminal.write(`\x1b[31m${message}\x1b[0m\r\n`)
        })

      terminal.onData((data) => {
        const current = terminalId.current
        if (current) void window.desktop.terminalWrite(current, data)
      })

      return () => {
        disposed = true
        unsubscribeData?.()
        unsubscribeExit?.()

        const current = terminalId.current
        terminalId.current = null
        if (current) void window.desktop.terminalKill(current)
      }
    },
    [id, folderId, setExited]
  )

  const onResize = useCallback((size: { cols: number; rows: number }) => {
    const current = terminalId.current
    if (current)
      void window.desktop.terminalResize(current, size.cols, size.rows)
  }, [])

  return (
    <TerminalView
      // Remounting is what starts a shell over, so the key carries the attempt.
      key={`${id}:${shell.attempt}`}
      onReady={onReady}
      onResize={onResize}
    />
  )
}
