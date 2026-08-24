import { chatEfforts, CHAT_MODEL_FALLBACK } from "../src/shared/api"
import { readModel } from "../src/main/agent-models"
import { mergeModels, orderedModels } from "../src/renderer/lib/worktree-chat/models"
import { check, finish, section } from "./harness"

/**
 * The model list, which is the CLI's answer rather than this app's list.
 *
 * Worth a test for the reason `chat-activity.ts` is: all three of these read
 * something this app does not own. `readModel` narrows a row the CLI sent — and
 * the case that matters is a level this app has no word for, since the value
 * crosses into the renderer typed as one it does. `chatEfforts` decides what to
 * offer over a model nobody could ask about, and it has to decide *for*
 * offering: refusing a level the CLI would have taken is worse than offering one
 * it ignores. `orderedModels` is the menu's order, and the row that has to stay
 * put is `default`.
 */

const row = (over: Record<string, unknown> = {}) => ({
  value: "opus",
  displayName: "Opus",
  description: "Opus 5 · Best for everyday, complex tasks",
  supportsEffort: true,
  supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  ...over,
})

section("readModel: one row of the CLI's answer")
{
  const opus = readModel(row())
  check("keeps what --model is given", opus.value === "opus", opus)
  check("the CLI's own name", opus.label === "Opus", opus)
  check("and its own sentence", opus.description.startsWith("Opus 5 · "), opus)
  check("with every level it named", opus.efforts?.length === 5, opus)

  const haiku = readModel(
    row({
      value: "haiku",
      displayName: "Haiku",
      supportsEffort: undefined,
      supportedEffortLevels: undefined,
    })
  )
  check("a model with no effort has none", haiku.efforts?.length === 0, haiku)

  // `supportsEffort: false` with levels beside it: the flag is the answer.
  const off = readModel(row({ supportsEffort: false }))
  check("and a model that says no is believed", off.efforts?.length === 0, off)

  const odd = readModel(row({ supportedEffortLevels: ["low", "colossal"] }))
  check(
    "a level this app has no word for is dropped",
    odd.efforts?.join() === "low",
    odd
  )
}

section("chatEfforts: what to offer over a model")
{
  const models = [
    readModel(row()),
    readModel(row({ value: "haiku", supportsEffort: false })),
  ]
  check("the model's own levels", chatEfforts(models, "opus").length === 5)
  check("none where it takes none", chatEfforts(models, "haiku").length === 0)
  check(
    "and all of them for a model nobody knows",
    chatEfforts(models, "claude-something-7").length === 5
  )
  check(
    "including the null a chat inherits with",
    chatEfforts(models, null).length === 5
  )
  check(
    "a fallback row is unknown rather than effortless",
    chatEfforts(CHAT_MODEL_FALLBACK, "opus").length === 5
  )
  check(
    "models have distinct effort counts",
    chatEfforts(CHAT_MODEL_FALLBACK, "sonnet").length === 3 &&
      chatEfforts(CHAT_MODEL_FALLBACK, "haiku").length === 0 &&
      chatEfforts(CHAT_MODEL_FALLBACK, "fable").length === 0 &&
      chatEfforts(CHAT_MODEL_FALLBACK, "sonnet-5-1m").length === 4
  )
}

section("orderedModels: the menu's order")
{
  const answered = [
    readModel(row({ value: "sonnet", displayName: "Sonnet" })),
    readModel(row({ value: "default", displayName: "Default (recommended)" })),
    readModel(row({ value: "opus[1m]", displayName: "Opus (1M context)" })),
    readModel(row({ value: "haiku", displayName: "Haiku" })),
  ]
  const order = orderedModels(answered).map((entry) => entry.label)
  check(
    "the CLI's own recommendation stays first",
    order[0] === "Default (recommended)",
    order
  )
  check(
    "and the rest go by name",
    order.slice(1).join(" | ") === "Haiku | Opus (1M context) | Sonnet",
    order
  )
  check("nothing is dropped", order.length === answered.length)
  check("an empty answer is an empty menu", orderedModels([]).length === 0)

  const fallbackOrder = orderedModels(CHAT_MODEL_FALLBACK).map((e) => e.label)
  check("fallback has 9 models", CHAT_MODEL_FALLBACK.length === 9)
  check(
    "fallback maintains screenshot order",
    fallbackOrder[0] === "Fable 5" &&
      fallbackOrder[1] === "Opus 5" &&
      fallbackOrder[2] === "Opus 4.8 1M" &&
      fallbackOrder[8] === "Haiku 4.5",
    fallbackOrder
  )
  check(
    "badges and favorites are set",
    CHAT_MODEL_FALLBACK[1]?.isNew === true &&
      CHAT_MODEL_FALLBACK[2]?.isFavorite === true
  )
}

section("mergeModels: preserves full list while merging CLI discoveries")
{
  const discovered = [
    readModel(row({ value: "opus", supportsEffort: true, supportedEffortLevels: ["low", "medium"] })),
    readModel(row({ value: "haiku", supportsEffort: false })),
  ]
  const merged = mergeModels(CHAT_MODEL_FALLBACK, discovered)
  check("preserves all 9 preset models", merged.length === 9)
  check(
    "updates effort levels from CLI",
    merged.find((m) => m.value === "opus")?.efforts?.length === 2 &&
      merged.find((m) => m.value === "haiku")?.efforts?.length === 0
  )
  check(
    "empty discovery leaves preset intact",
    mergeModels(CHAT_MODEL_FALLBACK, []).length === 9
  )
}

finish()
