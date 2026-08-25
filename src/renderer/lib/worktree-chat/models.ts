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
 * Merge discovered models from the CLI with the preset full model list.
 *
 * Keeps all preset models intact while updating their supported effort levels
 * based on what the local CLI actually answers.
 */
export function mergeModels(
  preset: AgentModel[],
  discovered: AgentModel[]
): AgentModel[] {
  if (!discovered || discovered.length === 0) return preset
  const map = new Map<string, AgentModel>()
  for (const model of preset) {
    map.set(model.value, { ...model })
  }
  for (const model of discovered) {
    const existing = map.get(model.value)
    if (existing) {
      if (model.efforts !== null) existing.efforts = model.efforts
    }
  }
  return Array.from(map.values())
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

/** One row of the DeepSeek group in a chat's model picker. */
export type DeepseekModelOption = {
  value: string
  label: string
  /** The reasoning levels the model accepts, when it has any — the gateway's
   * own ids and words, which a picker's effort submenu shows. */
  efforts?: { id: string; name: string }[]
}

let deepseekAsked: Promise<DeepseekModelOption[]> | null = null
let deepseekHeld: DeepseekModelOption[] | null = null

/**
 * The models the gateway serves, for the model picker's DeepSeek group.
 *
 * Cached for the run like `useAgentModels` — the catalog does not change while
 * the app is running, and a picker opening is not a reason to ask again. Empty
 * when the gateway could not be reached, which is when the group is not worth
 * showing.
 */
export function useDeepseekModels(): DeepseekModelOption[] {
  const [models, setModels] = useState<DeepseekModelOption[]>(
    deepseekHeld ?? []
  )

  useEffect(() => {
    if (deepseekHeld) return
    let mounted = true
    deepseekAsked ??= window.desktop.dshModelCatalog().then((groups) =>
      groups.flatMap((group) =>
        group.models.map((model) => ({
          value: model.id,
          label: model.name,
          ...(model.efforts === undefined ? {} : { efforts: model.efforts }),
        }))
      )
    )
    void deepseekAsked
      .then((answer) => {
        deepseekHeld = answer
        if (mounted) setModels(answer)
      })
      .catch((error: unknown) => {
        deepseekAsked = null
        console.error("Could not read the DeepSeek model list", error)
      })
    return () => {
      mounted = false
    }
  }, [])

  return models
}
