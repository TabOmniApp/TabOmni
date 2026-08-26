import { useEffect, useState } from "react"

import { CHAT_MODEL_FALLBACK, type AgentModel } from "@shared/api"

/**
 * The models the user's own `claude` offers, for the composer's toolbar.
 *
 * A hook rather than a store because there is nothing to keep: the list is
 * whatever the CLI said, it does not change while the app is running, and
 * nothing writes to it. Main holds the answer for the run (`agent-models.ts`)
 * and this holds it for the window, so the second composer to mount gets it
 * without a round trip and the picker has its labels before it is opened —
 * which is the reason this runs on mount rather than on the menu opening: the
 * toolbar button draws the *name* of the chosen model, and a button that says
 * `opus` until somebody clicks it is a button that was waiting for nothing.
 *
 * The fallback stands in whenever the ask came back with nothing — a `claude`
 * that is not installed yet, or a spawn that timed out — because a picker with
 * no rows is a chat nobody can change the model of. It is deliberately three
 * aliases and not a guess at this machine's list; see `CHAT_MODEL_FALLBACK`.
 */

/** Shared by every composer in the window: the promise, so two mounting at
 * once make one call, and the answer, so a later one makes none. */
let asked: Promise<AgentModel[]> | null = null
let held: AgentModel[] | null = null

/**
 * What the CLI answered, with the preset's own trimmings where a row matches.
 *
 * **The CLI's list is the list**, and the preset is only what stands in when
 * there is no answer at all. It was the other way round — every preset row kept,
 * the answer used only to correct their effort levels — and what that did was
 * put models on the picker that the account does not have: `Sonnet 5 1M` and
 * five other invented aliases were offered on every machine, and picking one
 * failed the turn on its argument list, because `--model sonnet-5-1m` names
 * nothing. Which models exist is a property of the account and the CLI version
 * behind it (see `AgentModel`), so it is not something this file can hold a copy
 * of.
 *
 * A preset row is still read for the two things the CLI does not send — the
 * picker's `order` and its badges — and only where the `value` matches, so it
 * decorates rather than adds.
 */
export function mergeModels(
  preset: AgentModel[],
  discovered: AgentModel[]
): AgentModel[] {
  if (discovered.length === 0) return preset
  const presets = new Map(preset.map((model) => [model.value, model]))
  return discovered.map((model) => {
    const known = presets.get(model.value)
    if (!known) return model
    return {
      ...model,
      ...(known.order !== undefined ? { order: known.order } : {}),
    }
  })
}

export function useAgentModels(): AgentModel[] {
  const [models, setModels] = useState<AgentModel[]>(
    held ?? CHAT_MODEL_FALLBACK
  )

  useEffect(() => {
    if (held) return
    let mounted = true
    asked ??= window.desktop.agentModels()
    void asked
      .then((answer) => {
        const merged = mergeModels(CHAT_MODEL_FALLBACK, answer)
        held = merged
        if (mounted) setModels(merged)
      })
      .catch((error: unknown) => {
        asked = null
        console.error("Could not read the model list", error)
      })
    return () => {
      mounted = false
    }
  }, [])

  return models
}

/**
 * The order the picker draws them in.
 *
 * The CLI answers in an order of its own — `default`, `sonnet`, `fable`,
 * `opus[1m]`, `haiku`, `opus` on the machine this was written on — which reads
 * as a bug in a menu. So `default` keeps the top, because it is the CLI's own
 * recommendation and the row a new chat is on, and the rest go by name. By name
 * rather than by capability on purpose: this app knows nothing about which model
 * is the strongest, and an order implying it would be a ranking somebody trusts.
 */
export function orderedModels(models: AgentModel[]): AgentModel[] {
  return [...models].sort((left, right) => {
    if (left.value === "default") return -1
    if (right.value === "default") return 1
    if (left.order !== undefined && right.order !== undefined) {
      return left.order - right.order
    }
    if (left.order !== undefined) return -1
    if (right.order !== undefined) return 1
    return left.label.localeCompare(right.label)
  })
}
