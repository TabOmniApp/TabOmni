import type {
  AiFilterColumn,
  Filter,
  FilterOperator,
  FilterSet,
} from "../shared/api"
import { askClaude } from "./ai-cli"
import { extractJson } from "./ai-json"

/**
 * Turns a sentence into filter conditions, by asking the agent that is already
 * installed.
 *
 * `claude -p` rather than an API of our own: the CLI is on the machine and
 * signed in — it is what the Agent panel runs — so this costs the user no key
 * to paste and no account to connect. The price is that it is a subprocess
 * with a startup cost, which is why this is a button and not something that
 * runs as you type.
 *
 * Nothing that comes back is trusted. The model is asked for JSON and answers
 * with whatever it likes; every condition is checked against the columns that
 * actually exist and the operators this app can build, and anything else is
 * dropped. The worst a bad answer can do is produce fewer conditions than
 * asked for — never a clause nobody wrote.
 */

/** Long enough for a cold CLI start, short enough to give up on. */
const TIMEOUT_MS = 60_000

const OPERATORS = new Set<FilterOperator>([
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "contains",
  "not contains",
  "starts with",
  "ends with",
  "is null",
  "is not null",
])

function promptFor(request: string, columns: AiFilterColumn[]): string {
  const schema = columns
    .map((column) => `- ${column.name} (${column.type})`)
    .join("\n")

  return [
    "Translate a request into filter conditions on one SQL table.",
    "",
    "Columns:",
    schema,
    "",
    `Request: ${request}`,
    "",
    'Answer with JSON only, no prose and no code fences, shaped as {"join":"and"|"or","conditions":[{"column":"…","operator":"…","value":"…"}]}.',
    `Allowed operators: ${[...OPERATORS].join(", ")}.`,
    'Use "is null"/"is not null" with an empty value. Dates and numbers are compared as plain strings, e.g. "2026-01-01" or "10".',
    'Use only the columns listed above. If the request names nothing that matches, answer {"join":"and","conditions":[]}.',
  ].join("\n")
}

/** Keeps only what this app can actually build, against columns that exist. */
function validate(parsed: unknown, columns: AiFilterColumn[]): FilterSet {
  const known = new Set(columns.map((column) => column.name))
  const source = parsed as {
    join?: unknown
    conditions?: unknown
  }

  const conditions: Filter[] = []
  for (const raw of Array.isArray(source.conditions) ? source.conditions : []) {
    const item = raw as Record<string, unknown>
    const column = typeof item.column === "string" ? item.column : ""
    const operator = item.operator as FilterOperator
    if (!known.has(column) || !OPERATORS.has(operator)) continue

    conditions.push({
      column,
      operator,
      value:
        item.value === undefined || item.value === null
          ? ""
          : String(item.value),
    })
  }

  return { join: source.join === "or" ? "or" : "and", conditions }
}

export async function aiFilter(options: {
  command: string
  env: NodeJS.ProcessEnv
  cwd: string
  request: string
  columns: AiFilterColumn[]
}): Promise<FilterSet> {
  const stdout = await askClaude({
    command: options.command,
    env: options.env,
    cwd: options.cwd,
    prompt: promptFor(options.request, options.columns),
    timeoutMs: TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  })

  return validate(extractJson(stdout), options.columns)
}
