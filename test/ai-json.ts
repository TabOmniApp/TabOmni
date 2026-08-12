import { extractJson } from "../src/main/ai-json"
import { check, finish, section } from "./harness"

/**
 * The JSON out of `claude -p`, which is prose with an object somewhere in it.
 *
 * These are shapes the CLI has actually answered with, not invented ones — the
 * nested fence in particular is what the code reviewer gets every time it
 * quotes the code a comment is about, which is what it is asked to do.
 */

section("an answer with the object in it")

check("bare JSON parses", (extractJson('{"a":1}') as { a: number }).a === 1)

check(
  "a fenced block is unwrapped",
  (extractJson('```json\n{"a":2}\n```') as { a: number }).a === 2
)

check(
  "a sentence before the object is skipped",
  (extractJson('Here you go:\n{"a":3}') as { a: number }).a === 3
)

section("an object that contains a code fence")

// The reviewer is asked to quote code, so its bodies carry fences of their
// own. Matching the first ``` to the next one lands in the middle of the
// object; taking the whole answer instead is what makes this parse.
const review = [
  "```json",
  '{"summary":"one change","comments":[{"path":"a.ts","line":3,',
  '"severity":"blocker","title":"no",',
  '"body":"Gate it instead:\\n\\n```ts\\nconst { ssl } = config()\\n```\\n"}]}',
  "```",
].join("\n")

const parsed = extractJson(review) as {
  summary: string
  comments: { path: string; body: string }[]
}

check("the whole object survives", parsed.summary === "one change")
check("and so does its comment", parsed.comments.length === 1)
check(
  "with the quoted code intact",
  parsed.comments[0]?.body.includes("const { ssl } = config()") === true,
  parsed.comments[0]?.body
)

section("an answer with no object in it")

let threw = ""
try {
  extractJson("I could not do that.")
} catch (error) {
  threw = error instanceof Error ? error.message : String(error)
}
check(
  "says so, and quotes what came back",
  threw.includes("did not answer with JSON") && threw.includes("could not"),
  threw
)

threw = ""
try {
  extractJson('```json\n{"a": oops}\n```')
} catch (error) {
  threw = error instanceof Error ? error.message : String(error)
}
check(
  "an object that is not JSON is reported as that",
  threw.includes("not valid JSON"),
  threw
)

finish()
