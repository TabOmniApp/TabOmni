import { create } from "zustand"

import { MCP_DISABLED_TOOLS_KEY } from "@shared/api"
import { recall, remember } from "./tab-memory"
import { getSetting, setSetting } from "./workspace"

/** Where the studio's own preferences live, beside the strip's arrangement. */
const SETTINGS_KEY = "workbench.settings"

/**
 * Where the workbench's one tab strip sits.
 *
 * `top` is the row above the pane the studio has always drawn. `right` is the
 * same tabs as a column beside it, which is the arrangement that pays off when
 * a strip holds more tabs than a window is wide: a label has a whole row to
 * itself, so a dozen files are read down a list rather than scrolled through.
 * Right rather than left because the rail and the sidebar already own the left
 * edge, and a second list against them would read as part of the sidebar.
 */
export type TabsPlacement = "top" | "right"

type Stored = {
  tabsPlacement: TabsPlacement
  groupTabs: boolean
  /**
   * The diff view's two: the committed side beside the working one or the two
   * interleaved, and whether whitespace is drawn.
   *
   * Here rather than per file, because it is how somebody reads a diff rather
   * than something about a particular one — and here rather than in the Settings
   * dialog, because the control is the toolbar over the diff itself, where the
   * effect of the click is the thing being looked at.
   */
  diffSideBySide: boolean
  diffWhitespace: boolean
}

function isStored(value: unknown): value is Stored {
  const record = value as Partial<Stored> | null
  return (
    (record?.tabsPlacement === "top" || record?.tabsPlacement === "right") &&
    // Absent from anything written before grouping existed, which is read as
    // off — the arrangement somebody already has is the one they chose. The two
    // diff flags are the same story, one feature later.
    (record.groupTabs === undefined || typeof record.groupTabs === "boolean") &&
    (record.diffSideBySide === undefined ||
      typeof record.diffSideBySide === "boolean") &&
    (record.diffWhitespace === undefined ||
      typeof record.diffWhitespace === "boolean")
  )
}

type SettingsState = Stored & {
  /** Read from disk yet. The dialog waits on it rather than showing the
   * default for a frame and correcting itself. */
  loaded: boolean

  /**
   * MCP tools a chat here may not call, as the wire names a turn's tool call
   * carries — see `MCP_DISABLED_TOOLS_KEY`.
   *
   * Not in `Stored` with the rest, and not in `workbench.settings`: the main
   * process reads this one too, on every message, to hand the CLI its
   * `disallowedTools`. So it lives under its own settings key, which is a thing
   * both sides can name, rather than inside a bag only the renderer parses.
   *
   * Empty by default, and empty is a decision the other way from the switches
   * that used to be here: what the user's own `claude` offers is theirs, and
   * this app hiding some of it until somebody found a dialog would be this app
   * deciding.
   */
  mcpDisabledTools: string[]

  setTabsPlacement: (placement: TabsPlacement) => void
  setGroupTabs: (group: boolean) => void
  setDiffSideBySide: (sideBySide: boolean) => void
  setDiffWhitespace: (show: boolean) => void
  /** Replaces the whole list — the pure `with*` helpers in
   * `lib/worktree-chat/mcp-servers.ts` work out what it should be. */
  setMcpDisabledTools: (tools: string[]) => void
  /** Reads the stored preferences. Called once, at launch. */
  restore: () => Promise<void>
}

/**
 * The switched-off tools as stored, or none.
 *
 * Anything that is not an array of strings reads as none rather than throwing —
 * the same call main makes on every message, and for the same reason: a setting
 * this app cannot parse must not take the user's MCP tools away, nor leave the
 * dialog unable to open.
 */
function storedTools(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : []
  } catch {
    return []
  }
}

/**
 * The preferences the Settings dialog edits.
 *
 * Separate from `lib/store.ts`, which holds what the workbench *is* doing —
 * the pane on screen, the folders, the strip's order. What is here is what the
 * user asked the studio to be like, which outlives any of that and is the list
 * the dialog is built from.
 */
export const useSettings = create<SettingsState>((set, get) => {
  /** Strict Mode mounts effects twice, so restoring has to be idempotent. */
  let restorePromise: Promise<void> | null = null

  /**
   * Writes the whole bag, from whatever the store now holds.
   *
   * One writer rather than each setter naming its neighbours: they shared a key,
   * so a setter that listed two of what are now four fields would have written
   * the other two back as absent — and absent reads as the default, which is a
   * preference silently undone by changing an unrelated one.
   */
  const save = () => {
    const { tabsPlacement, groupTabs, diffSideBySide, diffWhitespace } = get()
    remember(SETTINGS_KEY, {
      tabsPlacement,
      groupTabs,
      diffSideBySide,
      diffWhitespace,
    })
  }

  return {
    tabsPlacement: "top",
    groupTabs: false,
    // Side by side is what a diff is for — two columns to compare — and the
    // toolbar is one click away for a pane too narrow to hold them.
    diffSideBySide: true,
    diffWhitespace: false,
    mcpDisabledTools: [],
    loaded: false,

    setTabsPlacement(tabsPlacement) {
      set({ tabsPlacement })
      save()
    },

    setGroupTabs(groupTabs) {
      set({ groupTabs })
      save()
    },

    setDiffSideBySide(diffSideBySide) {
      set({ diffSideBySide })
      save()
    },

    setDiffWhitespace(diffWhitespace) {
      set({ diffWhitespace })
      save()
    },

    setMcpDisabledTools(mcpDisabledTools) {
      set({ mcpDisabledTools })
      // Its own key rather than `save()`'s bag, because main reads it — and
      // written as it stands rather than merged, since the caller was handed the
      // whole list to work from.
      void setSetting(MCP_DISABLED_TOOLS_KEY, JSON.stringify(mcpDisabledTools))
    },

    restore() {
      restorePromise ??= (async () => {
        const [stored, disabled] = await Promise.all([
          recall(SETTINGS_KEY, isStored),
          getSetting(MCP_DISABLED_TOOLS_KEY).catch(() => null),
        ])
        set({
          // Nothing stored is the default, not a failure: the spread of a null
          // leaves the initial state as it stands.
          ...stored,
          mcpDisabledTools: storedTools(disabled),
          loaded: true,
        })
      })()
      return restorePromise
    },
  }
})
