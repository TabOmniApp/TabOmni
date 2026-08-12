import { check, finish, section } from "./harness"

/**
 * `AskUserQuestion` as the chat draws it.
 *
 * Both halves of this read another program's output: the question is whatever
 * the model emitted, recorded by the CLI without ever being checked against
 * the tool's schema, and the answer is a sentence the CLI writes for a human
 * rather than anything structured. So what is worth testing is not the happy
 * path — it is that a payload which is not the expected shape falls back to
 * the ordinary tool card instead of taking the pane down with it.
 */
const { parseQuestions, parseAnswers } =
  await import("../src/renderer/lib/terminal/question")

const oneQuestion = {
  questions: [
    {
      question: "Which database?",
      header: "Database",
      multiSelect: false,
      options: [
        { label: "Postgres", description: "The default" },
        { label: "MySQL", description: "Also fine" },
      ],
    },
  ],
}

// ---------------------------------------------------------------------
section("parseQuestions")

const parsed = parseQuestions(oneQuestion)
check("reads a well-formed call", parsed?.length === 1, parsed)
check(
  "reads the question, header and options",
  parsed?.[0]?.question === "Which database?" &&
    parsed[0].header === "Database" &&
    parsed[0].options.length === 2 &&
    parsed[0].options[0]?.label === "Postgres" &&
    parsed[0].options[0]?.description === "The default",
  parsed?.[0]
)
check(
  "multiSelect is false unless it is exactly true",
  parsed?.[0]?.multiSelect === false &&
    parseQuestions({
      questions: [{ ...oneQuestion.questions[0], multiSelect: "yes" }],
    })?.[0]?.multiSelect === false
)
check(
  "a missing description is empty rather than absent",
  parseQuestions({
    questions: [{ question: "q", options: [{ label: "only a label" }] }],
  })?.[0]?.options[0]?.description === "",
  parseQuestions({
    questions: [{ question: "q", options: [{ label: "only a label" }] }],
  })
)
check(
  "a missing header is empty rather than absent",
  parseQuestions({
    questions: [{ question: "q", options: [{ label: "a" }] }],
  })?.[0]?.header === ""
)

// Everything below is a payload the card cannot draw. Null is the answer in
// each case, because the caller falls back to the tool card — which shows the
// raw JSON and so is never wrong about what was asked.
check("null input yields null", parseQuestions(null) === null)
check("a string yields null", parseQuestions("questions") === null)
check("no questions field yields null", parseQuestions({}) === null)
check(
  "an empty question list yields null",
  parseQuestions({ questions: [] }) === null
)
check(
  "a question with no text yields null",
  parseQuestions({ questions: [{ options: [{ label: "a" }] }] }) === null
)
check(
  "a question with no options yields null",
  parseQuestions({ questions: [{ question: "q" }] }) === null
)
check(
  "an option with no label yields null",
  parseQuestions({
    questions: [{ question: "q", options: [{ description: "no label" }] }],
  }) === null
)
check(
  "a null option yields null",
  parseQuestions({ questions: [{ question: "q", options: [null] }] }) === null
)

// ---------------------------------------------------------------------
section("parseAnswers")

// The sentence the CLI actually writes back, taken from a real transcript.
const twoAnswers = parseAnswers(
  'Your questions have been answered: "Mỗi project sẽ có bao nhiêu database?"="Nhiều database per project", "Lưu credentials ở đâu?"="Trong manifest.json". You can now continue with these answers in mind.'
)
check("reads every pair in the sentence", twoAnswers.size === 2, [
  ...twoAnswers,
])
check(
  "maps a question to the label that was chosen",
  twoAnswers.get("Lưu credentials ở đâu?") === "Trong manifest.json",
  [...twoAnswers]
)

// An answer can carry a trailing note the CLI appends after the pair, which is
// why this matches pairs rather than the shape of the whole sentence.
const withNote = parseAnswers(
  'Your questions have been answered: "Where?"="At the bottom" selected preview:\n┌ Chat │ Terminal ┐'
)
check(
  "an answer with a trailing note still reads",
  withNote.get("Where?") === "At the bottom",
  [...withNote]
)

check(
  "a result that is not an answer sentence yields nothing",
  parseAnswers("The user cancelled.").size === 0
)
check("an empty result yields nothing", parseAnswers("").size === 0)

finish()
