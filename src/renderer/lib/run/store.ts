import { create } from "zustand"

import type { ProcessExit, ProcessOutput } from "@shared/api"
import { getSetting, setSetting } from "../workspace"

/**
 * The run script each folder has, and what it printed.
 *
 * `ProcessManager` in `src/main/process.ts` has been in the app since before
 * this panel: its own comment says "nothing calls `start` yet — this is the
 * seam". This is the thing that calls it. The whole contract was already there
 * (`startProcess` takes a folder id and resolves the cwd in main), so nothing
 * about the bridge had to change.
 *
 * A run script is deliberately **not** a session. A session is a pty with a
 * conversation in it and a pane of its own; this is one command per folder,
 * started and stopped from a dock, whose output is a log to glance at. The
 * distinction is the same one Conductor draws between its `Run` tab and a
 * terminal, and it is why this is a few hundred lines rather than a second
 * terminal implementation.
 */

/** Where the per-folder commands live — one settings key holding a map, rather
 * than a key per folder, so reading them is one call at launch. */
const COMMANDS_KEY = "run.commands"

/**
 * How many lines of output are kept per folder.
 *
 * A dev server left running for a day prints more than anybody scrolls back
 * through, and all of it would be held in a renderer that never drops it. The
 * oldest go first, which is the right end to lose: what matters in a log like
 * this is the last thing it said.
 */
const MAX_LINES = 2000

export type RunLine = {
  /** Monotonic within a folder, for React keys — two lines can be identical. */
  key: number
  stream: "stdout" | "stderr"
  text: string
}

type FolderRun = {
  /** The id `startProcess` gave us, or null when nothing is running. */
  processId: string | null
  lines: RunLine[]
  /** How the last run ended, for the line the panel prints after it. Null
   * while running, and before the first run. */
  ended: { code: number | null; signal: string | null } | null
}

const BLANK: FolderRun = { processId: null, lines: [], ended: null }

type RunState = {
  /** Which folder the panel is pointed at. Null until one is picked, or when
   * the workspace has no folders. */
  folderId: string | null
  select: (folderId: string | null) => void

  /** The command each folder runs, keyed by folder id. */
  commands: Record<string, string>
  setCommand: (folderId: string, command: string) => void

  runs: Record<string, FolderRun>

  restore: () => Promise<void>
  start: (folderId: string) => Promise<void>
  stop: (folderId: string) => Promise<void>
  clear: (folderId: string) => void

  /** Subscribes to the main process's output and exit events. Returns the
   * unsubscribe, and is called once from the workbench. */
  listen: () => () => void
}

/**
 * The command as `spawn` wants it: a program and a list of arguments.
 *
 * Split on whitespace, and nothing cleverer. `ProcessManager` runs with
 * `shell: false` on purpose — a shell would make a project's path part of a
 * command line — so there is no shell here to do quoting for us, and writing a
 * quote-aware tokeniser would be inventing a shell in the renderer. What this
 * handles is what a run script actually is: `bun run dev`, `npm start`,
 * `make watch`. A command that genuinely needs a quoted argument wants a script
 * in the repository, which is a thing this can then run.
 */
function parseCommand(command: string): { program: string; args: string[] } {
  const [program = "", ...args] = command.trim().split(/\s+/).filter(Boolean)
  return { program, args }
}

function isCommands(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  return Object.values(value).every((entry) => typeof entry === "string")
}

export const useRun = create<RunState>((set, get) => {
  let nextKey = 0
  let restorePromise: Promise<void> | null = null

  /** Replaces one folder's run, leaving every other folder's alone. */
  function patch(folderId: string, change: Partial<FolderRun>) {
    const runs = get().runs
    set({
      runs: {
        ...runs,
        [folderId]: { ...(runs[folderId] ?? BLANK), ...change },
      },
    })
  }

  /** Which folder a process id belongs to, or null once it has been forgotten
   * — an exit arriving after the folder was cleared is not an error. */
  function folderOf(processId: string): string | null {
    const entry = Object.entries(get().runs).find(
      ([, run]) => run.processId === processId
    )
    return entry?.[0] ?? null
  }

  function append(folderId: string, line: RunLine) {
    const run = get().runs[folderId] ?? BLANK
    const lines = [...run.lines, line]
    patch(folderId, {
      lines: lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines,
    })
  }

  /** Fire-and-forget, like every other settings write in the renderer: typing a
   * command is not worth blocking on disk, and a lost write costs the command
   * next launch and nothing else. */
  function persist(commands: Record<string, string>) {
    void setSetting(COMMANDS_KEY, JSON.stringify(commands)).catch((error) => {
      console.error("Could not save the run commands", error)
    })
  }

  return {
    folderId: null,
    commands: {},
    runs: {},

    select(folderId) {
      set({ folderId })
    },

    setCommand(folderId, command) {
      const commands = { ...get().commands, [folderId]: command }
      set({ commands })
      persist(commands)
    },

    restore() {
      restorePromise ??= (async () => {
        let raw: string | null = null
        try {
          raw = await getSetting(COMMANDS_KEY)
        } catch (error) {
          console.error("Could not read the run commands", error)
        }
        if (!raw) return

        try {
          const parsed: unknown = JSON.parse(raw)
          if (isCommands(parsed)) set({ commands: parsed })
        } catch {
          // A settings value is a file on disk; a half-written one is not a
          // crash, and the next change overwrites it.
        }
      })()
      return restorePromise
    },

    async start(folderId) {
      // Already running is a no-op rather than a second process: two dev
      // servers on one port is a confusing failure to have caused with a
      // double click.
      if (get().runs[folderId]?.processId) return

      const command = get().commands[folderId]?.trim()
      if (!command) return

      const { program, args } = parseCommand(command)
      if (!program) return

      // Cleared on start rather than kept: the log is about this run, and a
      // failure scrolled up behind a previous success is a failure nobody sees.
      patch(folderId, { lines: [], ended: null })

      try {
        const processId = await window.desktop.startProcess(
          folderId,
          program,
          args
        )
        patch(folderId, { processId })
      } catch (error) {
        // A folder that cannot be resolved, or a main process that refused.
        // Reported in the log, where the rest of the failures are.
        nextKey += 1
        append(folderId, {
          key: nextKey,
          stream: "stderr",
          text: error instanceof Error ? error.message : String(error),
        })
        patch(folderId, { ended: { code: null, signal: null } })
      }
    },

    async stop(folderId) {
      const processId = get().runs[folderId]?.processId
      if (!processId) return

      // `processId` is left in place: the exit event is what clears it, so the
      // panel keeps saying "running" until the process has actually gone.
      await window.desktop.stopProcess(processId).catch((error) => {
        console.error("Could not stop the run", error)
      })
    },

    clear(folderId) {
      patch(folderId, { lines: [], ended: null })
    },

    listen() {
      const offOutput = window.desktop.onProcessOutput(
        (event: ProcessOutput) => {
          const folderId = folderOf(event.processId)
          if (!folderId) return
          nextKey += 1
          append(folderId, {
            key: nextKey,
            stream: event.stream,
            text: event.line,
          })
        }
      )

      const offExit = window.desktop.onProcessExit((event: ProcessExit) => {
        const folderId = folderOf(event.processId)
        if (!folderId) return
        patch(folderId, {
          processId: null,
          ended: { code: event.code, signal: event.signal },
        })
      })

      return () => {
        offOutput()
        offExit()
      }
    },
  }
})

/** Whether anything at all is running — what the dock's tab shows a dot for. */
export function anyRunning(runs: Record<string, FolderRun>): boolean {
  return Object.values(runs).some((run) => run.processId !== null)
}
