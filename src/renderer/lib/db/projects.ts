import type { FileEntry, ProjectRecord } from "@shared/api"

export type { FileEntry }

export type Project = {
  id: string
  name: string
  createdAt: Date
  updatedAt: Date
  /** The user's own folder, imported into the studio. */
  sourcePath: string | null
}

/** A project's source tree, flattened: `"src/App.tsx" -> contents`. */
export type FileMap = Record<string, string>

/**
 * Timestamps cross the IPC boundary as ISO strings; the studio works with
 * `Date`s.
 */
function toProject(record: ProjectRecord): Project {
  return {
    id: record.id,
    name: record.name,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    sourcePath: record.sourcePath,
  }
}

export async function listProjects(): Promise<Project[]> {
  const records = await window.desktop.listProjects()
  return records.map(toProject)
}

export async function renameProject(id: string, name: string): Promise<void> {
  await window.desktop.renameProject(id, name)
}

export async function deleteProject(id: string): Promise<void> {
  await window.desktop.deleteProject(id)
}

/** Opens the system folder picker. Resolves with null when cancelled. */
export async function pickDirectory(): Promise<string | null> {
  return window.desktop.pickDirectory()
}

export async function importProject(input: {
  path: string
  name: string
}): Promise<Project> {
  return toProject(await window.desktop.importProject(input))
}

/** A project's tree, without contents — see `readFile` for those. */
export async function listFiles(projectId: string): Promise<FileEntry[]> {
  return window.desktop.listFiles(projectId)
}

export async function readFile(
  projectId: string,
  path: string
): Promise<string> {
  return window.desktop.readFile(projectId, path)
}

/** The branch checked out in a project's directory, or null when it is not a
 * git repository. */
export async function gitBranch(projectId: string): Promise<string | null> {
  return window.desktop.gitBranch(projectId)
}

export async function getSetting(key: string): Promise<string | null> {
  return window.desktop.getSetting(key)
}

export async function setSetting(key: string, value: string): Promise<void> {
  await window.desktop.setSetting(key, value)
}
