/**
 * The JSON out of an agent's answer that may be wrapped in prose or a code
 * fence — shared by every feature that asks the Claude Code CLI for JSON,
 * since `claude -p` does not guarantee a bare JSON stdout.
 */

/** The text between the first `{` and the last `}`, or null when there is no
 * pair to take. Braces inside JSON strings are safely spanned by this: they
 * are between the outer pair, not outside it. */
function braced(text: string): string | null {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

export function extractJson(output: string): unknown {
  /*
   * The fenced block first, then the whole answer.
   *
   * Taking the fence is right when the model wraps its object in one, and
   * wrong when the object *contains* one: the code review asks for JSON whose
   * bodies quote code, so a ```ts sample inside a string ends the match early
   * and leaves half an object. Trying both, in that order, means a nested
   * fence costs one failed parse rather than a feature that only works until
   * the model quotes something.
   */
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(output)
  const candidates = [
    ...(fenced ? [braced(fenced[1]!)] : []),
    braced(output),
  ].filter((candidate): candidate is string => candidate !== null)

  if (candidates.length === 0) {
    throw new Error(`The agent did not answer with JSON:\n${output.trim()}`)
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // The next candidate, or the error below once they are spent.
    }
  }

  throw new Error(`The agent's answer was not valid JSON:\n${output.trim()}`)
}
