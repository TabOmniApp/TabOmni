import { chatOptions, type WorktreeChatOptions } from "../src/shared/api"
import { check, finish, section } from "./harness"

/**
 * A chat's options as both sides of the contract read them.
 *
 * The one function main builds a turn's argument list out of and the composer
 * draws its toolbar from, which is why it is worth a test of its own: a
 * disagreement between the two is a toolbar saying `Edits` over a turn that ran
 * read-only, and neither side would report it.
 *
 * Everything here is about a record that came off disk — written by an older
 * build, by a newer one, or by nothing at all — since a record written by this
 * build is the uninteresting case.
 */

section("a record with nothing on it")

check(
  "no options at all is whatever a new chat gets",
  chatOptions(undefined).permission === "edits" &&
    chatOptions(undefined).model === "default" &&
    chatOptions(undefined).effort === null
)

/*
 * The one migration here that changes what a turn runs on.
 *
 * A record with no `options` was written before there was a toolbar, so nobody
 * ever chose anything for it — and what "nobody chose" means is now the CLI's
 * own `default` row rather than a `--model` left off entirely. The difference
 * matters because leaving it off runs the turn on whatever
 * `~/.claude/settings.json` says, which is how every chat in the app came to be
 * on Opus without anything on screen saying so. A record that *does* say
 * `model: null` chose to inherit, and keeps it.
 */
check(
  "a record that chose to inherit keeps inheriting",
  chatOptions({ model: null, effort: null, permission: "edits" }).model === null
)

section("the plan toggle this replaced")

check(
  "a chat left in plan mode comes back in it",
  chatOptions({ model: null, effort: null, plan: true } as WorktreeChatOptions)
    .permission === "plan"
)

check(
  "a chat with the toggle off is on the default rather than read-only",
  chatOptions({ model: null, effort: null, plan: false } as WorktreeChatOptions)
    .permission === "edits"
)

check(
  "the legacy field is never handed back, so nothing can read it by accident",
  chatOptions({ model: null, effort: null, plan: true } as WorktreeChatOptions)
    .plan === undefined
)

check(
  "a permission on the record wins over a toggle left beside it",
  chatOptions({
    model: null,
    effort: null,
    permission: "full",
    plan: true,
  }).permission === "full"
)

section("a record this build does not understand")

check(
  "a mode from a newer build falls back rather than drawing a blank",
  chatOptions({
    model: null,
    effort: null,
    permission: "yolo" as WorktreeChatOptions["permission"],
  }).permission === "edits"
)

section("what the toolbar chose")

check(
  "a model and an effort survive untouched",
  chatOptions({ model: "haiku", effort: "low", permission: "read" }).model ===
    "haiku" &&
    chatOptions({ model: "haiku", effort: "low", permission: "read" })
      .effort === "low"
)

finish()
