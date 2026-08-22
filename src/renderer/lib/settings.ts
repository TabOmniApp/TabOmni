import { create } from "zustand"

import {
  MCP_SERVER_NAMES,
  MCP_SETTING_KEYS,
  type McpServerName,
} from "@shared/api"
import { recall, remember } from "./tab-memory"
import { getSetting, setSetting } from "./workspace"

/** Where the studio's own preferences live, beside the strip's arrangement. */
const SETTINGS_KEY = "workbench.settings"

/**
 * Under the key a chat view that no longer exists wrote it to — the choice
 * somebody already made is theirs, and renaming a key would quietly hand it
 * back to the default. There was a second, `claudeGui.showThinking`, for the
 * model's reasoning blocks: nothing draws those any more (a `claude -p` turn
 * reports messages and tool calls and nothing else), so the switch went and the
 * key is left where it lies.
 */
const SHOW_TOOL_CALLS_KEY = "claudeGui.showToolCalls"

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

/** Every MCP server's switch, by name. */
export type McpEnabled = Record<McpServerName, boolean>

type SettingsState = Stored & {
  /** Read from disk yet. The dialog waits on it rather than showing the
   * default for a frame and correcting itself. */
  loaded: boolean

  /** Whether a turn's tool calls are drawn in a worktree's chat
   * (`ChatMessage`). */
  showToolCalls: boolean

  /**
   * Which of the workspace's panels an agent session may reach as MCP tools.
   *
   * Off unless somebody turned it on, and stored under the keys in
   * `@shared/api` because the main process reads the same three — it writes
   * the config a starting session is pointed at, and answers every tool call
   * against them.
   */
  mcp: McpEnabled

  setTabsPlacement: (placement: TabsPlacement) => void
  setGroupTabs: (group: boolean) => void
  setDiffSideBySide: (sideBySide: boolean) => void
  setDiffWhitespace: (show: boolean) => void
  setMcpEnabled: (server: McpServerName, enabled: boolean) => void
  setShowToolCalls: (show: boolean) => void
  /** Reads the stored preferences. Called once, at launch. */
  restore: () => Promise<void>
}

/** A stored `"true"`/`"false"`, or the default when nothing is stored. */
function storedFlag(raw: string | null, fallback: boolean): boolean {
  return raw === null ? fallback : raw === "true"
}

/**
 * The preferences the Settings dialog edits.
 *
 * Separate from `lib/store.ts`, which holds what the workbench *is* doing —
 * the pane on screen, the folders, the strip's order. What is here is what the
 * user asked the studio to be like, which outlives any of that and is the list
 * the dialog is built from.
 *
 * The chat view's two switches are here rather than in a hook of their own for
 * the reason they were moved out of one: the same two settings are now shown in
 * two places at once — the chat view's header and the dialog — and a `useState`
 * per component read the file once at mount, so one of the two would have gone
 * on drawing the value it started with.
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
    showToolCalls: true,
    mcp: { database: false, api: false, notes: false },
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

    setMcpEnabled(server, enabled) {
      set((state) => ({ mcp: { ...state.mcp, [server]: enabled } }))
      void setSetting(MCP_SETTING_KEYS[server], String(enabled))
    },

    setShowToolCalls(showToolCalls) {
      set({ showToolCalls })
      void setSetting(SHOW_TOOL_CALLS_KEY, String(showToolCalls))
    },

    restore() {
      restorePromise ??= (async () => {
        const [stored, toolCalls, ...servers] = await Promise.all([
          recall(SETTINGS_KEY, isStored),
          getSetting(SHOW_TOOL_CALLS_KEY).catch(() => null),
          ...MCP_SERVER_NAMES.map((server) =>
            getSetting(MCP_SETTING_KEYS[server]).catch(() => null)
          ),
        ])

        set({
          // Nothing stored is the default, not a failure: the spread of a null
          // leaves the initial state as it stands.
          ...stored,
          showToolCalls: storedFlag(toolCalls, true),
          // Off unless it says otherwise — the one default here that is a
          // decision rather than an obvious value: what an agent can reach is
          // something somebody has to have said yes to.
          mcp: Object.fromEntries(
            MCP_SERVER_NAMES.map((server, index) => [
              server,
              storedFlag(servers[index] ?? null, false),
            ])
          ) as McpEnabled,
          loaded: true,
        })
      })()
      return restorePromise
    },
  }
})
