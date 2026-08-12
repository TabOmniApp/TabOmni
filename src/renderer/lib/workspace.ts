import type { WorkspaceFolder, WorkspaceRecord } from "@shared/api"

export type { WorkspaceFolder, WorkspaceRecord }

/** The workspace and the folders in it. */
export async function getWorkspace(): Promise<WorkspaceRecord> {
  return window.desktop.getWorkspace()
}

export async function addFolder(input: {
  path: string
  name: string
}): Promise<WorkspaceRecord> {
  return window.desktop.addFolder(input)
}

export async function renameFolder(
  id: string,
  name: string
): Promise<WorkspaceRecord> {
  return window.desktop.renameFolder(id, name)
}

export async function removeFolder(id: string): Promise<WorkspaceRecord> {
  return window.desktop.removeFolder(id)
}

/** Opens the system folder picker. Resolves with null when cancelled. */
export async function pickDirectory(): Promise<string | null> {
  return window.desktop.pickDirectory()
}

/** The branch checked out in a folder, or null when it is not a git
 * repository. */
export async function gitBranch(folderId: string): Promise<string | null> {
  return window.desktop.gitBranch(folderId)
}

export async function getSetting(key: string): Promise<string | null> {
  return window.desktop.getSetting(key)
}

export async function setSetting(key: string, value: string): Promise<void> {
  await window.desktop.setSetting(key, value)
}
