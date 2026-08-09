import type {
  ApiImportFolder,
  ApiImportRequest,
  ApiImportResult,
} from "../shared/api"
import { askClaude } from "./ai-cli"
import { extractJson } from "./ai-json"

/**
 * Reads a project's own source with the Claude Code CLI and proposes API
 * folders/requests to add to the collection — the same "ask the agent
 * already on the machine" approach as `aiFilter`, and the same rule: nothing
 * that comes back is trusted before every field is checked.
 *
 * Unlike `aiFilter`'s one-shot text transform, this points the CLI at the
 * whole project and lets it explore with its own Read/Grep/Glob tools rather
 * than this module gathering file contents itself — that exploration is the
 * reason to shell out to the CLI instead of calling a model API directly.
 * `--allowedTools` is scoped to exactly those three (with `--disallowedTools`
 * spelling out the same thing the other way), so the scan cannot
 * Bash/Write/Edit anything: strictly read-only against the user's source,
 * with no permission prompt to answer since there is no TTY.
 */

/** A full project scan is much slower than `aiFilter`'s one-shot answer. */
const TIMEOUT_MS = 5 * 60_000

/** A bad answer can produce fewer rows than asked for, never more than this. */
const MAX_FOLDERS = 50
const MAX_REQUESTS_PER_FOLDER = 100
const MAX_LOOSE_REQUESTS = 100

const METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
])

/** Forbidden by HTTP on GET/HEAD — a suggested body for either is dropped. */
const BODYLESS = new Set(["GET", "HEAD"])

/** A bad answer can produce fewer headers than asked for, never a wall of them. */
const MAX_HEADERS_PER_REQUEST = 20

const PROMPT = [
  "Explore this project's source code and find its HTTP API surface: REST",
  "routes and controllers, OpenAPI/Swagger specs, GraphQL schemas — whatever",
  "it actually has. Do not guess at endpoints that are not backed by code.",
  "",
  "Group endpoints the way they are grouped in the code — by controller, by",
  "route file, by resource — one flat group per such unit, no sub-groups.",
  "",
  "For each endpoint, also look for what the code implies about headers (auth,",
  "content-type — anything a middleware or decorator requires) and, for a",
  "method that takes one, a sample request body shaped like what the handler",
  "actually reads (a DTO, an interface, a validation schema). Leave either out",
  "rather than guess when the source does not suggest one.",
  "",
  "Answer with JSON only, no prose and no code fences, shaped as:",
  '{"folders":[{"name":"…","requests":[{"name":"…","method":"GET","url":"…","headers":[{"name":"…","value":"…"}],"body":"…"}]}],"requests":[{"name":"…","method":"GET","url":"…"}]}',
  "",
  '"headers" and "body" are optional on every request — include them only when',
  "the source actually implies something. A body is a JSON string (or the",
  "literal shape the endpoint reads, if not JSON), never present for GET/HEAD.",
  "",
  '"requests" at the top level is for endpoints that do not belong to any',
  'group. A url may be a path ("/users/:id") or, for an external API, a full',
  "URL. If nothing that looks like an HTTP endpoint exists in this project,",
  'answer {"folders":[],"requests":[]}.',
].join("\n")

/** Only what this app can actually build from headers the agent suggested. */
function validHeaders(raw: unknown): ApiImportRequest["headers"] {
  const out: { name: string; value: string }[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    if (out.length >= MAX_HEADERS_PER_REQUEST) break
    const record = item as Record<string, unknown>
    const name = typeof record.name === "string" ? record.name.trim() : ""
    if (!name) continue
    const value = typeof record.value === "string" ? record.value : ""
    out.push({ name, value })
  }
  return out.length > 0 ? out : undefined
}

/** Only what this app can actually build from an endpoint the agent found. */
function validRequests(raw: unknown, cap: number): ApiImportRequest[] {
  const out: ApiImportRequest[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    if (out.length >= cap) break
    const record = item as Record<string, unknown>
    const method =
      typeof record.method === "string" ? record.method.toUpperCase() : ""
    const url = typeof record.url === "string" ? record.url.trim() : ""
    if (!METHODS.has(method) || !url) continue

    const name =
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : url
    const headers = validHeaders(record.headers)
    const body =
      !BODYLESS.has(method) && typeof record.body === "string" && record.body
        ? record.body
        : undefined

    out.push({
      name,
      method,
      url,
      ...(headers && { headers }),
      ...(body && { body }),
    })
  }
  return out
}

/** Keeps only what this app can actually build, capped against a runaway answer. */
function validate(parsed: unknown): ApiImportResult {
  const source = parsed as { folders?: unknown; requests?: unknown }

  const folders: ApiImportFolder[] = []
  for (const item of Array.isArray(source.folders) ? source.folders : []) {
    if (folders.length >= MAX_FOLDERS) break
    const record = item as Record<string, unknown>
    const name = typeof record.name === "string" ? record.name.trim() : ""
    const requests = validRequests(record.requests, MAX_REQUESTS_PER_FOLDER)
    if (!name || requests.length === 0) continue
    folders.push({ name, requests })
  }

  return {
    folders,
    requests: validRequests(source.requests, MAX_LOOSE_REQUESTS),
  }
}

export async function aiImportApi(options: {
  command: string
  env: NodeJS.ProcessEnv
  cwd: string
}): Promise<ApiImportResult> {
  const stdout = await askClaude({
    command: options.command,
    env: options.env,
    cwd: options.cwd,
    prompt: PROMPT,
    tools: ["Read", "Grep", "Glob"],
    timeoutMs: TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  })

  return validate(extractJson(stdout))
}
