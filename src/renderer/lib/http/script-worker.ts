import type { ScriptContext, ScriptResult } from "./sandbox"

/**
 * A post-response script's actual sandbox.
 *
 * Runs on its own thread by construction — a script stuck in `while (true)`
 * cannot freeze the app the way it would in a same-thread iframe, and
 * `worker.terminate()` (see `sandbox.ts`) kills it outright regardless of
 * what it is doing. It also never has `window`/DOM access and is never
 * reached by `contextBridge` (that only punches through into the main
 * window's world), so there is no path from here to `window.desktop` at all.
 *
 * The one gap a bare Worker leaves is network access (`fetch` and friends
 * exist here by default). Rather than lean on a page-wide CSP this app
 * doesn't have, every network primitive is deleted below before the user's
 * script ever runs — closing every known egress path without touching
 * anything outside this one file. That also means the script can only run
 * synchronously: once there is nothing left to make a network call with,
 * there is nothing worth awaiting either.
 */

/** The global surface this worker intentionally exposes or removes — typed
 * loosely because the project's `lib` is DOM, not WebWorker, and fighting
 * that mismatch buys nothing for a file this narrow. */
type WorkerScope = {
  fetch?: unknown
  XMLHttpRequest?: unknown
  WebSocket?: unknown
  EventSource?: unknown
  importScripts?: unknown
  Worker?: unknown
  console: unknown
  pm?: unknown
  onmessage: ((event: MessageEvent) => void) | null
  postMessage: (message: ScriptResult) => void
}

const scope = self as unknown as WorkerScope

scope.fetch = undefined
scope.XMLHttpRequest = undefined
scope.WebSocket = undefined
scope.EventSource = undefined
scope.importScripts = undefined
scope.Worker = undefined

const logs: string[] = []

function stringifyArg(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function pushLog(level: string, args: unknown[]) {
  logs.push(`[${level}] ${args.map(stringifyArg).join(" ")}`)
}

// The only way a script's output reaches the UI — nothing here goes to a
// real console, since there is no devtools panel a user would think to open.
scope.console = {
  log: (...args: unknown[]) => pushLog("log", args),
  info: (...args: unknown[]) => pushLog("info", args),
  warn: (...args: unknown[]) => pushLog("warn", args),
  error: (...args: unknown[]) => pushLog("error", args),
}

scope.onmessage = (
  event: MessageEvent<{ script: string; context: ScriptContext }>
) => {
  const { script, context } = event.data
  const text = context.response.isText ? context.response.body : ""

  // Last write wins for a name set more than once in the same run, same as
  // an ordinary object would behave.
  const sets = new Map<string, string>()

  scope.pm = {
    request: { ...context.request },
    response: {
      code: context.response.status,
      status: context.response.statusText,
      responseTime: context.response.timeMs,
      headers: context.response.headers,
      text,
      json(): unknown {
        return JSON.parse(text)
      },
    },
    environment: {
      get: (name: string) => context.variables[name],
      set: (name: string, value: string) => {
        sets.set(name, String(value))
      },
    },
  }

  let error: string | null = null
  try {
    // The only way a plain string of source becomes a running script — it
    // sees this worker's global scope (so `pm`/`console` above resolve as
    // bare identifiers) and nothing else, since everything reachable from
    // here was stripped first.
    new Function(script)()
  } catch (caught) {
    error =
      caught instanceof Error
        ? `${caught.name}: ${caught.message}`
        : String(caught)
  }

  const result: ScriptResult = {
    logs,
    error,
    setVariables: [...sets.entries()].map(([name, value]) => ({ name, value })),
  }
  scope.postMessage(result)
}
