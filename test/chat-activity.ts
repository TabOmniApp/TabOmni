import type { AssistantMessage } from "../src/shared/api"
import {
  blocksOf,
  countsOf,
  summaryOf,
} from "../src/renderer/lib/worktree-chat/activity"
import { changeOf, describeCall, resultLine } from "../src/main/claude-agent"
import { check, finish, section } from "./harness"

/**
 * A turn's working, folded — and the two halves that fill the rows inside it.
 *
 * `blocksOf` is worth a test because every case it has is a shape of transcript
 * rather than anything on screen: a turn still running has no answer to keep out
 * of the fold, a turn that only talked has nothing to fold, and a chat read back
 * off disk is several turns in a row with lines from builds that wrote fewer
 * fields. `describeCall` and `resultLine` are worth one because they read what
 * the CLI sends, which is the other thing this app does not own.
 */

let next = 0
const id = () => `l${(next += 1)}`

const user = (text: string): AssistantMessage => ({
  id: id(),
  role: "user",
  text,
})
const said = (text: string): AssistantMessage => ({
  id: id(),
  role: "assistant",
  text,
})
const thought = (text: string): AssistantMessage => ({
  id: id(),
  role: "thinking",
  text,
})
const tool = (name: string, summary = ""): AssistantMessage => ({
  id: id(),
  role: "tool",
  name,
  summary,
})
const failed = (text: string): AssistantMessage => ({
  id: id(),
  role: "error",
  text,
})
const decided = (text: string): AssistantMessage => ({
  id: id(),
  role: "ask",
  text,
})

section("one turn, folded")

const turn = blocksOf([
  user("where is the composer"),
  thought("I should look at the file"),
  said("Let me read it first."),
  tool("Read", "/a/chat-composer.tsx"),
  tool("Bash", "rg composer"),
  said("It is in `chat-composer.tsx`."),
])

check("the prompt is its own block", turn[0]?.kind === "line", turn[0])

check(
  "everything before the last word is one fold",
  turn[1]?.kind === "activity" && turn[1].lines.length === 4,
  turn[1]
)

// The whole argument for the fold: the answer is what somebody came back for,
// so it is the one thing that is never behind it.
check(
  "the last word is not folded",
  turn[2]?.kind === "line" &&
    turn[2].line.role === "assistant" &&
    turn[2].line.text.includes("chat-composer"),
  turn[2]
)

check("three blocks and no more", turn.length === 3, turn.length)

section("a turn still being answered")

// Nothing has been said last yet, so there is no answer to keep out — a fold
// that closed over the reply the moment it arrived would be the pane hiding
// what it had just written.
const running = blocksOf([
  user("refactor it"),
  thought("starting"),
  tool("Read", "/a/b.ts"),
])
check(
  "everything so far is working",
  running[1]?.kind === "activity" && running[1].lines.length === 2,
  running[1]
)
check("and nothing is drawn as an answer", running.length === 2)

// The shape that made this a bug: the turn narrated and then carried on
// working, so its sentence was not the last word after all. Everything after it
// was landing outside the fold, one row at a time, under a summary that was not
// counting them.
const narrated = blocksOf([
  user("refactor it"),
  thought("starting"),
  said("Now the renderer store:"),
  tool("Edit", "/a/store.ts"),
])
check(
  "a sentence the turn worked on past is folded with the rest",
  narrated.length === 2 &&
    narrated[1]?.kind === "activity" &&
    narrated[1].lines.length === 3,
  narrated
)

section("a turn with nothing to fold")

const chatty = blocksOf([user("hello"), said("Hello.")])
check(
  "no fold is made for a turn that only talked",
  chatty.every((block) => block.kind === "line"),
  chatty
)

section("what is never folded")

const refused = blocksOf([
  user("delete the request"),
  thought("it is refused"),
  decided("Refused Bash: rm -rf /"),
  tool("Read", "/a/b.ts"),
  said("I could not."),
])

check(
  "a refusal stays on screen",
  refused.some((block) => block.kind === "line" && block.line.role === "ask"),
  refused
)
// It breaks the run in two rather than being pulled to one end: where it
// happened is the thing being said.
check(
  "and splits the working around it",
  refused.filter((block) => block.kind === "activity").length === 2,
  refused.filter((block) => block.kind === "activity").length
)

const broke = blocksOf([user("go"), tool("Bash", "false"), failed("Exit 1")])
check(
  "an error stays on screen",
  broke.some((block) => block.kind === "line" && block.line.role === "error"),
  broke
)

section("several turns")

const two = blocksOf([
  user("one"),
  tool("Read", "/a"),
  said("done one"),
  user("two"),
  tool("Read", "/b"),
  said("done two"),
])
check("each turn folds on its own", two.length === 6, two.length)
check(
  "and neither fold reaches into the other",
  two.every((block) => block.kind !== "activity" || block.lines.length === 1)
)

section("lines from a build that wrote fewer fields")

// A chat on disk can open with lines that follow no prompt: a turn retried as a
// resume writes its own, and the prompt was written by the attempt before.
const orphaned = blocksOf([tool("Read", "/a"), said("hi")])
check("lines before any prompt still draw", orphaned.length === 2, orphaned)

check("an empty chat is no blocks", blocksOf([]).length === 0)

section("what the folded line says")

check(
  "a subagent is counted as an agent, not a tool call",
  countsOf([tool("Task", "Explore"), tool("Read", "/a")]).subagents === 1 &&
    countsOf([tool("Task", "Explore"), tool("Read", "/a")]).tools === 1
)

check(
  "thinking and narration are both messages",
  countsOf([thought("a"), said("b")]).messages === 2
)

check(
  "the sentence names what there is",
  summaryOf({ tools: 7, messages: 13, subagents: 1 }) ===
    "7 tool calls, 13 messages, 1 subagent"
)

// A count of zero is dropped rather than drawn: "0 subagents" is a fact nobody
// asked for.
check(
  "a count of zero is left out",
  summaryOf({ tools: 1, messages: 0, subagents: 0 }) === "1 tool call"
)

section("what a tool call says it is")

check(
  "a file is pulled out for the chip",
  describeCall("Read", { file_path: "/a/b/chat-composer.tsx" }).path ===
    "/a/b/chat-composer.tsx"
)

check(
  "a notebook counts as a file too",
  describeCall("NotebookEdit", { notebook_path: "/a/b.ipynb" }).path ===
    "/a/b.ipynb"
)

check(
  "a command keeps its own description",
  describeCall("Bash", {
    command: "bun test",
    description: "Run the test suite",
  }).title === "Run the test suite"
)

check(
  "and the command is still the argument",
  describeCall("Bash", { command: "bun test", description: "Run it" })
    .summary === "bun test"
)

/*
 * The failure this was written against: `Task` carries a description, a whole
 * prompt and a subagent type, none of which the key list names — so every
 * subagent row was 120 characters of the prompt's JSON.
 */
const agent = describeCall("Task", {
  description: "Find chat attachment code",
  subagent_type: "Explore",
  prompt: "a very long prompt ".repeat(40),
})
check("a subagent says which agent ran", agent.summary === "Explore", agent)
check(
  "and leads with its description",
  agent.title === "Find chat attachment code"
)
check("never the prompt", !JSON.stringify(agent).includes("very long prompt"))

check(
  "a call with nothing to say has no extras",
  describeCall("Read", {}).path === undefined &&
    describeCall("Read", {}).title === undefined
)

check(
  "a call with no input at all is safe",
  describeCall("Read", null).summary === ""
)

section("what a tool call came back with")

check(
  "one line of output is shown as it stands",
  resultLine("3 files changed") === "3 files changed"
)

// A `Read` returns the file, and a row that showed it would be the file in the
// transcript.
check("more than a line is counted", resultLine("a\nb\nc\nd") === "4 lines")

check(
  "the SDK's block form is read too",
  resultLine([{ type: "text", text: "one\ntwo" }]) === "2 lines"
)

check("nothing said is nothing shown", resultLine("") === "")
check("blank output is nothing shown", resultLine("   \n  ") === "")
check("a shape this does not know is nothing shown", resultLine(42) === "")

check(
  "a long single line is collapsed rather than wrapping the row",
  resultLine("x".repeat(400)).endsWith("…")
)

section("what an edit did")

/*
 * The row this was written against: `Edit` came back "The file
 * /Users/…/review-panel.tsx has been updated. Here's the result of running
 * `cat -n`…", which was the widest thing in the row and said nothing the chip
 * beside it had not. The call's own input has both sides of the change in it.
 */
const edited = describeCall("Edit", {
  file_path: "/w/a.ts",
  old_string: "const a = 1",
  new_string: "const a = 2\nconst b = 3",
})

check("an edit counts both sides", edited.stat === "+2 −1", edited.stat)

check(
  "and keeps them as the lines they were",
  edited.change === "- const a = 1\n+ const a = 2\n+ const b = 3",
  edited.change
)

check(
  "a write has one side, which is honest — it replaced the file",
  (() => {
    const written = changeOf("Write", { content: "one\ntwo\n" })
    return written.stat === "+2" && written.change === "+ one\n+ two"
  })(),
  "a trailing newline ends the last line rather than starting an empty one"
)

check(
  "a multi-edit is the total of its edits",
  (() => {
    const many = changeOf("MultiEdit", {
      edits: [
        { old_string: "a", new_string: "b" },
        { old_string: "c\nd", new_string: "e" },
      ],
    })
    return many.stat === "+2 −3"
  })()
)

check(
  "deleting a block is a change with nothing on the new side",
  (() => {
    const cut = changeOf("Edit", { old_string: "gone", new_string: "" })
    return cut.stat === "−1" && cut.change === "- gone"
  })(),
  "an empty string is a real side, so the split cannot be guarded on falsiness"
)

check(
  "a tool that is not an edit has nothing to say about one",
  changeOf("Read", { file_path: "/w/a.ts" }).stat === undefined
)

check(
  "and a long one is capped with a line saying how much is left",
  (() => {
    const big = changeOf("Write", {
      content: Array.from({ length: 40 }, (_, at) => `line ${at}`).join("\n"),
    })
    return (
      big.stat === "+40" &&
      big.change?.endsWith("… 24 more") === true &&
      big.change.split("\n").length === 17
    )
  })(),
  "this is a tooltip, not a pane"
)

finish()
