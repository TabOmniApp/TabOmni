import type { AssistantMessage, TurnUsage } from "../src/shared/api"
import { usageOf } from "../src/main/claude-agent"
import {
  compact,
  modelLabel,
  money,
  promptOf,
  totalOf,
  usageDetail,
  usageLine,
} from "../src/renderer/lib/worktree-chat/usage"
import { check, finish, section } from "./harness"

/**
 * What a turn cost: the read of it, and the words for it.
 *
 * Worth a test for the reason `chat-activity.ts` is: both halves read something
 * this app does not own. `usageOf` reads the SDK's result line, which reports
 * per-model totals that have to be summed rather than picked from — a turn that
 * ran a subagent spent what the subagent spent — and reports zeroes for a turn
 * that crashed, which must not be drawn as a turn that was free. The renderer's
 * half is a percentage over three numbers, and the case that matters is the one
 * the whole feature exists for: a prompt that was written to the cache rather
 * than read from it.
 *
 * `SDKMessage`'s result type is deliberately not imported: these are the fields
 * this app reads, and a fixture built out of the SDK's own type would be a test
 * that only checks the parts of it we already believed.
 */

type Result = Parameters<typeof usageOf>[0]

const result = (
  models: Record<
    string,
    {
      inputTokens?: number
      cacheCreationInputTokens?: number
      cacheReadInputTokens?: number
      outputTokens?: number
    }
  >,
  extra: { cost?: number; thinking?: number } = {}
): Result =>
  ({
    type: "result",
    subtype: "success",
    total_cost_usd: extra.cost ?? 0,
    usage: {
      output_tokens_details: { thinking_tokens: extra.thinking ?? 0 },
    },
    modelUsage: Object.fromEntries(
      Object.entries(models).map(([name, use]) => [
        name,
        {
          inputTokens: use.inputTokens ?? 0,
          outputTokens: use.outputTokens ?? 0,
          cacheReadInputTokens: use.cacheReadInputTokens ?? 0,
          cacheCreationInputTokens: use.cacheCreationInputTokens ?? 0,
          webSearchRequests: 0,
          costUSD: 0,
          contextWindow: 200_000,
          maxOutputTokens: 32_000,
        },
      ])
    ),
  }) as unknown as Result

const usage = (over: Partial<TurnUsage> = {}): TurnUsage => ({
  model: "claude-opus-5",
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  output: 0,
  thinking: 0,
  costUsd: null,
  ...over,
})

let next = 0
const line = (over: Partial<TurnUsage>): AssistantMessage => ({
  id: `l${(next += 1)}`,
  role: "usage",
  usage: usage(over),
})

section("usageOf: the SDK's result line")
{
  const one = usageOf(
    result(
      {
        "claude-opus-5": {
          inputTokens: 10,
          cacheCreationInputTokens: 1_563,
          cacheReadInputTokens: 37_575,
          outputTokens: 1_904,
        },
      },
      { cost: 0.3103, thinking: 462 }
    )
  )
  check("names the model it ran on", one.model === "claude-opus-5", one)
  check("keeps the cache halves apart", one.cacheWrite === 1_563, one)
  check("reads the cache hit", one.cacheRead === 37_575, one)
  check("takes thinking off `usage`", one.thinking === 462, one)
  check("keeps the estimate", one.costUsd === 0.3103, one)

  // A turn that ran a subagent: the SDK's own `usage` would report the main
  // loop alone, which is the whole reason `modelUsage` is what is read.
  const withAgent = usageOf(
    result({
      "claude-opus-5": { inputTokens: 5, outputTokens: 900 },
      "claude-haiku-4-5-20251001": {
        cacheReadInputTokens: 12_000,
        outputTokens: 100,
      },
    })
  )
  check(
    "sums every model the turn used",
    withAgent.output === 1_000 && withAgent.cacheRead === 12_000,
    withAgent
  )
  check(
    "labels it with the busiest, not the last",
    withAgent.model === "claude-haiku-4-5-20251001",
    withAgent
  )

  const crashed = usageOf(result({}))
  check("a turn that counted nothing has no model", crashed.model === null)
  check(
    "and no cost, rather than a free one",
    crashed.costUsd === null,
    crashed
  )
  check(
    "which the line says out loud",
    usageLine(crashed) === "nothing counted",
    usageLine(crashed)
  )
}

section("the line somebody reads")
{
  const cold = usage({
    input: 10,
    cacheWrite: 38_782,
    cacheRead: 0,
    output: 46,
    costUsd: 0.0788,
  })
  const warm = usage({
    input: 10,
    cacheWrite: 0,
    cacheRead: 38_797,
    output: 108,
    costUsd: 0.0054,
  })

  check("the same prompt either way", promptOf(cold) === 38_792, promptOf(cold))
  check(
    "a cold turn says so",
    usageLine(cold).includes("0% cached"),
    usageLine(cold)
  )
  check(
    "a warm one says so",
    usageLine(warm).includes("100% cached"),
    usageLine(warm)
  )
  // The two numbers this whole line exists to put next to each other.
  check(
    "and the estimate keeps its digits under a cent",
    usageLine(warm).endsWith("$0.0054") && usageLine(cold).endsWith("$0.08"),
    [usageLine(cold), usageLine(warm)]
  )
  check(
    "the breakdown splits the prompt three ways",
    usageDetail(cold).startsWith("38,792 prompt = 10 new + 38,782 written"),
    usageDetail(cold)
  )
  check(
    "thinking is only in the breakdown",
    !usageLine(usage({ output: 100, thinking: 40 })).includes("thinking") &&
      usageDetail(usage({ output: 100, thinking: 40 })).includes(
        "40 of it thinking"
      )
  )
}

section("a chat's total")
{
  check("nothing to total is null", totalOf([]) === null)
  check(
    "and so is a chat written before there were usage lines",
    totalOf([{ id: "l0", role: "assistant", text: "done" }]) === null
  )

  const total = totalOf([
    { id: "u", role: "user", text: "hello" },
    line({ cacheWrite: 40_000, output: 100, costUsd: 0.5 }),
    line({ cacheRead: 40_000, output: 200, costUsd: 0.05 }),
  ])
  check("counts the turns", total?.turns === 2, total)
  check("adds the halves up", total?.cacheWrite === 40_000, total)
  check("adds the cost up", total?.costUsd === 0.55, total)
  check(
    "and keeps the model while they agree",
    total?.model === "claude-opus-5",
    total
  )

  const mixed = totalOf([
    line({ model: "claude-opus-5" }),
    line({ model: "claude-haiku-4-5-20251001" }),
  ])
  check(
    "a chat that changed model claims neither",
    mixed?.model === null,
    mixed
  )

  // A turn that crashed reported no cost; the ones around it still did.
  const partial = totalOf([line({ costUsd: null }), line({ costUsd: 0.2 })])
  check("an uncounted turn is skipped, not zeroed", partial?.costUsd === 0.2)
  check(
    "and a chat where none of them counted has no cost",
    totalOf([line({ costUsd: null })])?.costUsd === null
  )
}

section("the model's name, and the numbers")
{
  check("Opus 5", modelLabel("claude-opus-5") === "Opus 5")
  check(
    "a dated id is the same model",
    modelLabel("claude-haiku-4-5-20251001") === "Haiku 4.5"
  )
  check(
    "so is a provider-qualified one",
    modelLabel("us.anthropic.claude-opus-4-1-20250805-v1:0") === "Opus 4.1"
  )
  check("an alias is drawn as it stands", modelLabel("opus") === "Opus")
  check("and nothing is nothing", modelLabel(null) === null)

  check("under a thousand is itself", compact(946) === "946")
  check("a thousand gets a digit", compact(38_797) === "38.8k")
  check("and loses it once it says nothing", compact(410_400) === "410k")
  check("millions too", compact(4_180_000) === "4.2M")
  check("a cent is two places", money(0.31) === "$0.31")
  check("under one is four", money(0.0049) === "$0.0049")
}

finish()
