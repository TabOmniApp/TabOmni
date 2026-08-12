/**
 * `AskUserQuestion` — the agent asking the user to choose, as the chat draws
 * it.
 *
 * The CLI records the call like any other tool: a `tool_use` block carrying
 * the whole question, and a `tool_result` carrying what was picked. So the
 * chat already has everything it needs to *show* the question. What it does
 * not have is a way to answer one — the choice is made at the CLI's own
 * prompt, in the terminal view, the same as a permission prompt.
 *
 * That is why this is worth drawing specially rather than leaving as a tool
 * card: a collapsed row labelled `AskUserQuestion` is exactly the case where
 * the chat looks like it has stalled, when in fact the session is waiting on
 * the user in the other view.
 */

/** The tool's name in the transcript, which is the only thing that identifies
 * one of these — the block is a `tool_use` like any other. */
export const ASK_USER_QUESTION = "AskUserQuestion"

export type AskedOption = {
  label: string
  description: string
}

export type AskedQuestion = {
  question: string
  /** The short chip the CLI shows above the option list. */
  header: string
  multiSelect: boolean
  options: AskedOption[]
}

/**
 * The questions a call is asking, or null if the payload is not one this can
 * draw.
 *
 * Checked field by field rather than cast: the input is whatever the model
 * emitted, recorded verbatim by the CLI, and it reaches here without ever
 * having been validated against the tool's schema. Null is not an error —
 * it just means the caller falls back to the ordinary tool card, which shows
 * the raw JSON and is never wrong.
 */
export function parseQuestions(input: unknown): AskedQuestion[] | null {
  if (typeof input !== "object" || input === null) return null

  const questions = (input as { questions?: unknown }).questions
  if (!Array.isArray(questions) || questions.length === 0) return null

  const parsed: AskedQuestion[] = []
  for (const raw of questions) {
    if (typeof raw !== "object" || raw === null) return null
    const record = raw as Record<string, unknown>

    if (typeof record.question !== "string") return null
    if (!Array.isArray(record.options)) return null

    const options: AskedOption[] = []
    for (const option of record.options) {
      if (typeof option !== "object" || option === null) return null
      const fields = option as Record<string, unknown>
      if (typeof fields.label !== "string") return null
      options.push({
        label: fields.label,
        description:
          typeof fields.description === "string" ? fields.description : "",
      })
    }

    parsed.push({
      question: record.question,
      header: typeof record.header === "string" ? record.header : "",
      multiSelect: record.multiSelect === true,
      options,
    })
  }

  return parsed
}

/**
 * What was chosen, read out of the tool result.
 *
 * The CLI writes the answers as one sentence — `Your questions have been
 * answered: "…"="…", "…"="…". You can now continue…` — rather than as
 * anything structured, so this is the only way back to which option won.
 *
 * Matched on the question text this app already has rather than on the shape
 * of the sentence: the wording around the pairs has changed between CLI
 * releases, and an answer can carry a trailing note (`selected preview: …`)
 * that no pattern for the whole sentence survives. A question that cannot be
 * found simply has no answer drawn against it, which is the same as one that
 * has not been answered yet — and the raw result is still there under the
 * tool card.
 */
export function parseAnswers(result: string): Map<string, string> {
  const answers = new Map<string, string>()
  for (const match of result.matchAll(/"([^"]*)"="([^"]*)"/g)) {
    const [, question, answer] = match
    if (question !== undefined && answer !== undefined)
      answers.set(question, answer)
  }
  return answers
}
