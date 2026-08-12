import type { HttpResponseResult } from "@shared/api"

/** What a post-response script is handed, read-only. */
export type ScriptContext = {
  request: {
    method: string
    url: string
    headers: { name: string; value: string }[]
  }
  response: HttpResponseResult
  /** `pm.environment.get()`'s snapshot — the active environment's variables
   * as they stood when the request was sent, not live during the run. */
  variables: Record<string, string>
}

export type ScriptResult = {
  logs: string[]
  error: string | null
  setVariables: { name: string; value: string }[]
}

/** Long enough for real work, short enough that a runaway script fails fast
 * rather than looking hung. */
const TIMEOUT_MS = 5_000

/**
 * Runs a request's post-response script in its own Worker (see
 * `script-worker.ts` for why a Worker and what it strips before the script
 * runs) and resolves with what it logged, whether it threw, and what it
 * asked to save — never rejects, so a bad script is just a bad result to
 * show, not a crash in `send()`.
 */
export function runPostResponseScript(
  script: string,
  context: ScriptContext
): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./script-worker.ts", import.meta.url), {
      type: "module",
    })

    let settled = false
    function finish(result: ScriptResult) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      worker.terminate()
      resolve(result)
    }

    const timeout = setTimeout(() => {
      finish({
        logs: [],
        error: `Script timed out after ${TIMEOUT_MS}ms.`,
        setVariables: [],
      })
    }, TIMEOUT_MS)

    worker.onmessage = (event: MessageEvent<ScriptResult>) => {
      finish(event.data)
    }
    worker.onerror = (event: ErrorEvent) => {
      finish({
        logs: [],
        error: event.message || "Script failed to run.",
        setVariables: [],
      })
    }

    worker.postMessage({ script, context })
  })
}
