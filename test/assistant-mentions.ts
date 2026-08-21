import {
  insertMention,
  markMentions,
  mentionQuery,
  rankPlainMentions,
  type PlainMention,
} from "../src/renderer/lib/assistant/mention-text"
import { check, finish, section } from "./harness"

/**
 * What `@` does in the assistant's composer.
 *
 * The chat composer's `@` is tested through `expandMentions`, because there the
 * mistake that matters is what reaches the CLI. Here nothing is rewritten — the
 * name typed is the name sent — so what is worth testing is the two things that
 * are silent when they are wrong: which text opens a menu (an email address must
 * not), and which runs are tinted. A tint on the wrong run claims the workspace
 * holds something it does not.
 */

const table = (label: string): PlainMention => ({
  kind: "table",
  label,
  detail: "table in shop",
})
const note = (label: string): PlainMention => ({
  kind: "note",
  label,
  detail: "note",
})
const database = (label: string): PlainMention => ({
  kind: "database",
  label,
  detail: "postgres · shop_dev",
})

section("a query is a word starting with @")

const at = (text: string) => mentionQuery(text, text.length)

check("at the start of the message", at("@us")?.filter === "us")
check("mid-sentence", at("why is @users")?.filter === "users")
check("empty, the moment @ is typed", at("look at @")?.filter === "")
check(
  "dots and dashes belong to a name",
  at("@shop.public.line-items") !== null
)
check("an email address is not a mention", at("mail me@example.com") === null)
check("nothing typed yet", at("hello") === null)
check(
  "the caret is what is read, not the end of the draft",
  mentionQuery("see @us later", "see @us".length)?.filter === "us"
)
check(
  "the caret past the query closes it",
  mentionQuery("see @us later", "see @us later".length) === null
)

section("picking a row replaces what was typed")

const draft = "why is @use slow?"
const caret = "why is @use".length
const query = mentionQuery(draft, caret)
const picked = query
  ? insertMention(draft, query, caret, "shop.public.users")
  : null

check("the @query is gone", picked?.text === "why is shop.public.users slow?")
check(
  "the caret lands at the end of the name",
  picked?.caret === "why is shop.public.users".length
)

const midSentence = mentionQuery("why is @use", "why is @use".length)
check(
  "no second space where the draft already had one",
  midSentence
    ? insertMention(
        "why is @use slow?",
        midSentence,
        "why is @use".length,
        "users"
      ).text === "why is users slow?"
    : false
)

const only = mentionQuery("@", 1)
check(
  "a bare @ becomes the name",
  only ? insertMention("@", only, 1, "Deploy").text === "Deploy " : false
)

section("what is tinted is what the workspace holds")

const known = [table("shop.public.users"), note("Deploy checklist")]
const tinted = (text: string) =>
  markMentions(text, known)
    .filter((segment) => segment.kind !== null)
    .map((segment) => segment.text)

const untouched = markMentions("nothing here", known)
check(
  "the whole text is one run when nothing matches",
  untouched.length === 1 && untouched[0]?.kind === null
)
check(
  "a name in a sentence",
  tinted("is shop.public.users big?").length === 1,
  tinted("is shop.public.users big?")
)
check(
  "a name at the end of a sentence keeps its full stop out of it",
  tinted("look at shop.public.users.")[0] === "shop.public.users"
)
check(
  "a name is not a prefix of a longer word",
  tinted("shop.public.users_old").length === 0
)
check(
  "an unqualified table is not the qualified one",
  tinted("other.public.users").length === 0
)
check(
  "a name with spaces in it",
  tinted("see Deploy checklist first")[0] === "Deploy checklist"
)
check("matching is case-sensitive", tinted("see deploy checklist").length === 0)
check(
  "twice in one line",
  tinted("Deploy checklist, then Deploy checklist").length === 2
)
check(
  "the kind travels with the run",
  markMentions("shop.public.users", known)[0]?.kind === "table"
)

const withDatabase = [database("shop"), table("shop.public.users")]
const tintedIn = (text: string) =>
  markMentions(text, withDatabase)
    .filter((segment) => segment.kind !== null)
    .map((segment) => `${segment.kind}:${segment.text}`)

check(
  "a database is mentionable on its own",
  tintedIn("what is in shop?")[0] === "database:shop"
)
check(
  "a database at the end of a sentence keeps its full stop out",
  tintedIn("connect to shop.")[0] === "database:shop"
)
check(
  "the table wins over the database name inside it",
  tintedIn("shop.public.users")[0] === "table:shop.public.users",
  tintedIn("shop.public.users")
)
check(
  "a database name is not tinted where an unread table hangs off it",
  markMentions("shop.public.orders", [database("shop")]).every(
    (segment) => segment.kind === null
  ),
  markMentions("shop.public.orders", [database("shop")])
)
check(
  "the runs put the text back together",
  markMentions("a shop.public.users b", known)
    .map((segment) => segment.text)
    .join("") === "a shop.public.users b"
)
check(
  "a one-character name would tint every letter, so it does not",
  markMentions("a b c", [note("a")]).length === 1
)
check(
  "the longest name wins where two overlap",
  markMentions("shop.public.users", [
    table("public.users"),
    table("shop.public.users"),
  ]).length === 1
)
check(
  "a name holding regex punctuation is matched as text",
  markMentions("see a+b(c)", [note("a+b(c)")]).some(
    (segment) => segment.text === "a+b(c)" && segment.kind === "note"
  )
)
check("an empty draft is one empty run", markMentions("", known).length === 1)

section("rows are ranked the way the chat composer's are")

const rows = [note("users list"), table("shop.public.users"), note("Deploy")]
const ranked = rankPlainMentions(rows, "users").map((row) => row.label)
check(
  "a name starting with the filter comes first",
  ranked[0] === "users list",
  ranked
)
check(
  "a name containing it comes next",
  ranked[1] === "shop.public.users",
  ranked
)
check("something that matches neither is left out", ranked.length === 2, ranked)
check(
  "an empty filter keeps every row, in order",
  rankPlainMentions(rows, "").length === 3
)
check(
  "the detail is searched too",
  rankPlainMentions(rows, "shop").map((row) => row.label)[0] ===
    "shop.public.users"
)

finish()
