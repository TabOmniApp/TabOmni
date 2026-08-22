import { useEffect, useRef } from "react"
import { Eraser, Play, Square } from "lucide-react"

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useRun } from "@/lib/run/store"
import { useStudio } from "@/lib/store"
import { IconButton } from "./icon-button"

/**
 * One command per folder, started and stopped from the dock.
 *
 * Conductor's `Run` tab: the dev server or the test watcher, so that changing
 * something and seeing whether it still builds does not mean leaving for a
 * terminal. It runs through `ProcessManager` in the main process, which has
 * been waiting for a caller since it was written.
 *
 * Per **folder**, and deliberately so: `bun run dev` is a property of a
 * repository rather than of what you happen to be doing in it, so two people
 * working on two branches of one folder still mean one command.
 */
export function RunPanel() {
  const folders = useStudio((state) => state.folders)
  const selected = useRun((state) => state.folderId)
  const select = useRun((state) => state.select)
  const commands = useRun((state) => state.commands)
  const setCommand = useRun((state) => state.setCommand)
  const runs = useRun((state) => state.runs)
  const start = useRun((state) => state.start)
  const stop = useRun((state) => state.stop)
  const clear = useRun((state) => state.clear)

  // The first folder, so the panel has something to point at without anybody
  // choosing — and re-pointed when the one it held is removed.
  const folderId =
    selected && folders.some((folder) => folder.id === selected)
      ? selected
      : (folders[0]?.id ?? null)

  useEffect(() => {
    if (folderId !== selected) select(folderId)
  }, [folderId, selected, select])

  const run = folderId ? runs[folderId] : undefined
  const running = run?.processId != null
  const command = folderId ? (commands[folderId] ?? "") : ""

  if (folders.length === 0) {
    return (
      <Empty>
        Add a folder to the workspace and this will run a command in it.
      </Empty>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-2">
        {/* Only when there is a choice to make: one folder needs no picker, and
            a select with a single option is a control that does nothing. */}
        {folders.length > 1 && (
          <Select
            value={folderId ?? undefined}
            onValueChange={(value) => select(value)}
          >
            <SelectTrigger size="sm" className="h-7 w-28 shrink-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {folders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>
                  {folder.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Input
          value={command}
          placeholder="bun run dev"
          onChange={(event) =>
            folderId && setCommand(folderId, event.target.value)
          }
          onKeyDown={(event) => {
            // Enter starts it, the way a command line does. Only when it is not
            // already running: the second press would otherwise be a no-op that
            // looks like the field is stuck.
            if (event.key === "Enter" && folderId && !running) {
              void start(folderId)
            }
          }}
          className="h-7 min-w-0 flex-1 font-mono text-xs"
        />

        <IconButton
          label={running ? "Stop" : "Start"}
          onClick={() => folderId && void (running ? stop : start)(folderId)}
          disabled={!folderId || (!running && !command.trim())}
          className="size-7 shrink-0"
        >
          {running ? (
            <Square className="size-3.5 text-destructive" />
          ) : (
            <Play className="size-3.5" />
          )}
        </IconButton>

        <IconButton
          label="Clear output"
          onClick={() => folderId && clear(folderId)}
          disabled={!run || run.lines.length === 0}
          className="size-7 shrink-0"
        >
          <Eraser className="size-3.5" />
        </IconButton>
      </div>

      <Output
        lines={run?.lines ?? []}
        ended={run?.ended ?? null}
        running={running}
      />
    </div>
  )
}

/**
 * The log, pinned to the bottom while it is being written to.
 *
 * Follows only when it is already at the bottom, which is what every terminal
 * does: yanking the view back down while somebody is reading further up is the
 * one behaviour that makes a log unusable.
 */
function Output({
  lines,
  ended,
  running,
}: {
  lines: { key: number; stream: "stdout" | "stderr"; text: string }[]
  ended: { code: number | null; signal: string | null } | null
  running: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  useEffect(() => {
    const element = box.current
    if (element && atBottom.current) element.scrollTop = element.scrollHeight
  }, [lines, ended])

  if (lines.length === 0 && !running) {
    return (
      <Empty>
        {ended
          ? "Nothing was printed."
          : "Type a command and press Enter to run it in this folder."}
      </Empty>
    )
  }

  return (
    <div
      ref={box}
      onScroll={(event) => {
        const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
        // A few pixels of slack: a fractional scroll height means an exact
        // comparison is false at the bottom on some zoom levels.
        atBottom.current = scrollHeight - scrollTop - clientHeight < 8
      }}
      className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[0.7rem] leading-relaxed"
    >
      {lines.map((line) => (
        <div
          key={line.key}
          className={cn(
            "break-all whitespace-pre-wrap",
            line.stream === "stderr" && "text-destructive"
          )}
        >
          {line.text}
        </div>
      ))}

      {ended && (
        <div className="pt-1 text-muted-foreground">
          {ended.signal
            ? `Stopped (${ended.signal})`
            : `Exited with ${ended.code ?? 0}`}
        </div>
      )}
    </div>
  )
}

function Empty({ children }: { children: string }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-4">
      <p className="max-w-56 text-center text-xs leading-relaxed text-muted-foreground">
        {children}
      </p>
    </div>
  )
}
