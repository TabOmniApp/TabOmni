import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import type { Readable } from "node:stream"

import type { ProcessExit, ProcessOutput, ProcessStream } from "../shared/api"

type Emit = {
  output: (event: ProcessOutput) => void
  exit: (event: ProcessExit) => void
}

/**
 * Runs the project's own tooling as real child processes and streams their
 * output back to the renderer.
 *
 * Nothing calls `start` yet: the preview still runs almostnode's in-browser
 * emulation. This is the seam that replaces it with a real `npm`/`vite`/`node`
 * process.
 */
export class ProcessManager {
  private readonly running = new Map<string, ChildProcess>()

  constructor(private readonly emit: Emit) {}

  /**
   * Spawns `command` in `cwd` and returns the id used to identify its output
   * events and to stop it again.
   */
  start(cwd: string, command: string, args: string[]): string {
    const child = spawn(command, args, {
      cwd,
      // No shell: arguments arrive as a list already, and a shell would make
      // project names and paths part of a command line.
      shell: false,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    const processId = randomUUID()
    this.running.set(processId, child)

    this.stream(processId, "stdout", child.stdout)
    this.stream(processId, "stderr", child.stderr)

    // `error` fires instead of `exit` when the binary does not exist, which is
    // the common case on a machine without the toolchain installed. Report it
    // as output so the reason is visible, then as an exit so nothing waits.
    child.on("error", (error) => {
      this.emit.output({
        processId,
        stream: "stderr",
        line: error.message,
      })
    })

    child.on("close", (code, signal) => {
      this.running.delete(processId)
      this.emit.exit({ processId, code, signal })
    })

    return processId
  }

  /** Kills a running process. Unknown ids are ignored: it is already gone. */
  stop(processId: string): void {
    this.running.get(processId)?.kill()
  }

  /** Kills everything still running, so quitting leaves nothing behind. */
  stopAll(): void {
    for (const child of this.running.values()) child.kill()
    this.running.clear()
  }

  /**
   * Forwards a stream line by line. A partial trailing line is held until more
   * arrives, and flushed when the stream ends, so a prompt without a newline is
   * not lost.
   */
  private stream(
    processId: string,
    stream: ProcessStream,
    source: Readable | null
  ): void {
    if (!source) return

    let buffered = ""
    source.setEncoding("utf8")

    source.on("data", (chunk: string) => {
      buffered += chunk
      const lines = buffered.split("\n")
      buffered = lines.pop() ?? ""
      for (const line of lines) {
        this.emit.output({ processId, stream, line })
      }
    })

    source.on("end", () => {
      if (buffered.length > 0) {
        this.emit.output({ processId, stream, line: buffered })
        buffered = ""
      }
    })
  }
}
