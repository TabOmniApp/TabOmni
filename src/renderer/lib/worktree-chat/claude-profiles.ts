import { create } from "zustand"

import type { ClaudeProfile } from "@shared/api"

/**
 * The workspace's `CLAUDE_CONFIG_DIR` profiles — see `ClaudeProfile`.
 *
 * A view of `store.ts`'s own file, the same relationship `useApi`'s
 * `environments` has to `environments.json`: this holds the list, Settings'
 * Claude section edits it, and the composer's profile picker reads it. Loaded
 * once at launch (`studio.tsx`, beside `useWorktreeChats.refresh`) rather than
 * per composer mount, since several chats' toolbars read the same list.
 */
type ClaudeProfilesState = {
  profiles: ClaudeProfile[]
  loading: boolean

  refresh: () => Promise<void>
  /** A new, unnamed-for-a-directory profile — `configDir` starts empty, since
   * there is no honest default for somebody else's `CLAUDE_CONFIG_DIR`. */
  create: (name: string) => void
  rename: (id: string, name: string) => void
  setConfigDir: (id: string, configDir: string) => void
  remove: (id: string) => void
}

export const useClaudeProfiles = create<ClaudeProfilesState>((set, get) => ({
  profiles: [],
  loading: false,

  async refresh() {
    set({ loading: true })
    try {
      set({
        profiles: await window.desktop.listClaudeProfiles(),
        loading: false,
      })
    } catch (error) {
      console.error("Could not read the Claude profiles", error)
      set({ loading: false })
    }
  },

  create(name) {
    save(set, [
      ...get().profiles,
      { id: crypto.randomUUID(), name, configDir: "" },
    ])
  },

  rename(id, name) {
    save(
      set,
      get().profiles.map((profile) =>
        profile.id === id ? { ...profile, name } : profile
      )
    )
  },

  setConfigDir(id, configDir) {
    save(
      set,
      get().profiles.map((profile) =>
        profile.id === id ? { ...profile, configDir } : profile
      )
    )
  },

  remove(id) {
    save(
      set,
      get().profiles.filter((profile) => profile.id !== id)
    )
  },
}))

/**
 * Written here and then to the record, rather than waiting on the write — the
 * same trade `setOptions` and `rename` make on `useWorktreeChats`: a field that
 * only moved once a file had been written would lag behind the keystroke that
 * changed it, and the failure it trades against does not outlive the launch.
 */
function save(
  set: (partial: Partial<ClaudeProfilesState>) => void,
  profiles: ClaudeProfile[]
) {
  set({ profiles })
  void window.desktop.saveClaudeProfiles(profiles).catch((error: unknown) => {
    console.error("Could not save the Claude profiles", error)
  })
}

/** A new profile's name, the same way `nextEnvironmentName` picks one. */
export function nextProfileName(count: number): string {
  return count === 0 ? "Profile" : `Profile ${count + 1}`
}
