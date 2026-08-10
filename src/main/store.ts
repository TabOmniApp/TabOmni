import { randomUUID } from "node:crypto"
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import type {
  DatabaseRecord,
  DbEngine,
  DbOrigin,
  HttpCookie,
  HttpEnvironment,
  HttpFolder,
  HttpRequestRecord,
  InboxMessage,
  UpdateDatabaseInput,
  WorkspaceFolder,
  WorkspaceRecord,
} from "../shared/api"
import { dataDir } from "./data-dir"
import { decrypt, encrypt } from "./encryption"

/** A `DatabaseRecord`'s own credential, held only in the manifest file. */
type StoredDatabaseRecord = DatabaseRecord & { encryptedPassword: string }

/** Everything `SqlConnections` needs to open a live connection. */
export type ConnectionInfo = {
  engine: DbEngine
  host: string
  port: number
  user: string
  password: string
  database: string
}

/**
 * Strips the encrypted credential before a record crosses into the renderer.
 *
 * Named field by field rather than a `{ encryptedPassword, ...rest }` spread,
 * so a field added to `StoredDatabaseRecord` later has to be added here too
 * before it can leak across the boundary this exists to guard.
 */
function toPublicRecord(stored: StoredDatabaseRecord): DatabaseRecord {
  return {
    id: stored.id,
    name: stored.name,
    engine: stored.engine,
    origin: stored.origin,
    host: stored.host,
    port: stored.port,
    user: stored.user,
    database: stored.database,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  }
}

/**
 * The id of the workspace every install starts with.
 *
 * A constant rather than a generated id because there is exactly one until
 * sign-in exists: a record whose id nothing can predict would mean reading the
 * manifest to answer "which workspace", for a question with one answer.
 */
export const DEFAULT_WORKSPACE_ID = "default"

/**
 * Where the workspace's own data lives, beside the manifest rather than inside
 * any of the folders it points at.
 *
 * That separation is the whole rule: a folder is somebody's repository, and the
 * studio writes nothing into it that the user did not ask for. Requests,
 * cookies and captured mail are the studio's, so they live here.
 */
export const WORKSPACE_DIR = "workspace"

/**
 * Where the workspace's Docker-managed databases keep their data — see
 * `databaseDataDir`, one subdirectory per database.
 */
export const DB_DIR = "db"

/** The workspace's saved HTTP requests. */
export const REQUESTS_FILE = "requests.json"

/** Cookies picked up from responses. */
export const COOKIES_FILE = "cookies.json"

/** The environments those requests are sent against. Its own file: an
 * environment holds hostnames and tokens, which is not the same kind of thing
 * as the requests themselves. */
export const ENVIRONMENTS_FILE = "environments.json"

/** The groups those requests are filed under. */
export const FOLDERS_FILE = "folders.json"

/**
 * What the Inbox panel's two servers caught.
 *
 * Capped by `InboxServers` before it reaches here — this file is rewritten
 * whole on every capture, and an uncapped one would grow until it was the
 * slowest thing the panel did.
 */
export const INBOX_FILE = "inbox.json"

type Manifest = {
  workspace: WorkspaceRecord
  databases: StoredDatabaseRecord[]
  settings: Record<string, string>
}

function emptyWorkspace(): WorkspaceRecord {
  return { id: DEFAULT_WORKSPACE_ID, name: "Workspace", folders: [] }
}

/**
 * Everything the studio keeps on disk: `manifest.json` for the workspace, its
 * databases and its settings, and a `workspace/` directory beside it for the
 * panels' own files.
 *
 * The folders the workspace points at are *not* under here. They are the user's
 * own repositories, recorded by absolute path and read where they are, which is
 * why there is no per-folder directory of ours to go looking for.
 *
 * Writes are serialised through a promise chain because a manifest update is a
 * read-modify-write: two concurrent `saveFile` calls racing on it would lose
 * one of the two updates.
 */
export class Store {
  private readonly root = dataDir()
  private queue: Promise<unknown> = Promise.resolve()

  /** Serialises a task against every other task on this store. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    // Keep the chain alive: a rejected task must not poison later ones.
    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private get workspaceDir(): string {
    return path.join(this.root, WORKSPACE_DIR)
  }

  private get manifestPath(): string {
    return path.join(this.root, "manifest.json")
  }

  /** One of the workspace's folders, by id. */
  private async folderOf(id: string): Promise<WorkspaceFolder> {
    const { workspace } = await this.readManifest()
    const folder = workspace.folders.find((candidate) => candidate.id === id)
    if (!folder) throw new Error(`No such folder: ${id}`)
    return folder
  }

  private async readManifest(): Promise<Manifest> {
    let raw: string
    try {
      raw = await readFile(this.manifestPath, "utf8")
    } catch (error) {
      if (isNotFound(error)) {
        return { workspace: emptyWorkspace(), databases: [], settings: {} }
      }
      throw error
    }

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("manifest.json is not an object")
    }
    const manifest = parsed as Partial<Manifest>
    const workspace = manifest.workspace
    // Never hand back a nullish collection: the renderer maps over these
    // directly, and `null.map` is a crash rather than an empty studio.
    return {
      workspace: {
        id: workspace?.id ?? DEFAULT_WORKSPACE_ID,
        name: workspace?.name ?? "Workspace",
        folders: workspace?.folders ?? [],
      },
      databases: manifest.databases ?? [],
      settings: manifest.settings ?? {},
    }
  }

  private async writeManifest(manifest: Manifest): Promise<void> {
    // The data directory is created here rather than in the constructor so
    // that merely constructing a Store needs no filesystem access.
    await mkdir(this.root, { recursive: true })
    await writeFile(
      this.manifestPath,
      JSON.stringify(manifest, null, 2),
      "utf8"
    )
  }

  /** The workspace and its folders. */
  getWorkspace(): Promise<WorkspaceRecord> {
    return this.enqueue(async () => (await this.readManifest()).workspace)
  }

  /**
   * Records an existing folder in the workspace, worked on where it is.
   *
   * Nothing is copied and nothing is written into it. The path is resolved
   * through symlinks first, so the duplicate check below sees what will
   * actually be opened.
   */
  addFolder(input: { path: string; name: string }): Promise<WorkspaceRecord> {
    return this.enqueue(async () => {
      let resolved: string
      try {
        resolved = await realpath(input.path)
      } catch {
        throw new Error(`There is no folder at ${input.path}.`)
      }

      const stats = await stat(resolved)
      if (!stats.isDirectory()) {
        throw new Error(`${resolved} is a file, not a folder.`)
      }

      const manifest = await this.readManifest()
      const clash = manifest.workspace.folders.find(
        (folder) => path.resolve(folder.path) === resolved
      )
      if (clash) {
        throw new Error(`This folder is already open as “${clash.name}”.`)
      }

      manifest.workspace.folders.push({
        id: randomUUID(),
        name: input.name.trim() || path.basename(resolved),
        path: resolved,
        addedAt: new Date().toISOString(),
      })
      await this.writeManifest(manifest)
      return manifest.workspace
    })
  }

  renameFolder(id: string, name: string): Promise<WorkspaceRecord> {
    return this.enqueue(async () => {
      const manifest = await this.readManifest()
      const folder = manifest.workspace.folders.find(
        (candidate) => candidate.id === id
      )
      if (!folder) throw new Error(`No such folder: ${id}`)

      folder.name = name
      await this.writeManifest(manifest)
      return manifest.workspace
    })
  }

  /**
   * Drops a folder from the workspace.
   *
   * The directory itself is never touched — the studio only ever held a path to
   * it. Nothing else in the manifest is filed under a folder either, which is
   * the point of keeping databases and requests at the workspace level: closing
   * the frontend does not take the database both halves were using with it.
   */
  removeFolder(id: string): Promise<WorkspaceRecord> {
    return this.enqueue(async () => {
      const manifest = await this.readManifest()
      manifest.workspace.folders = manifest.workspace.folders.filter(
        (folder) => folder.id !== id
      )
      await this.writeManifest(manifest)
      return manifest.workspace
    })
  }

  /** Every database or connection in the workspace. */
  listDatabases(): Promise<DatabaseRecord[]> {
    return this.enqueue(async () => {
      const { databases } = await this.readManifest()
      return databases.map(toPublicRecord)
    })
  }

  /**
   * Rewrites a connection's details. A password left out keeps the stored
   * one: the renderer never received it, so it has nothing to send back.
   */
  updateDatabase(
    id: string,
    input: UpdateDatabaseInput
  ): Promise<DatabaseRecord> {
    return this.enqueue(async () => {
      const manifest = await this.readManifest()
      const record = manifest.databases.find((database) => database.id === id)
      if (!record) throw new Error(`Database not found: ${id}`)
      if (record.origin !== "external") {
        throw new Error(
          "Only a connection to an existing database can be edited."
        )
      }

      record.name = input.name
      record.host = input.host
      record.port = input.port
      record.user = input.user
      record.database = input.database
      if (input.password !== undefined) {
        record.encryptedPassword = encrypt(input.password)
      }
      record.updatedAt = new Date().toISOString()

      await this.writeManifest(manifest)
      return toPublicRecord(record)
    })
  }

  /** One database or connection, or null when it does not exist. */
  databaseById(id: string): Promise<DatabaseRecord | null> {
    return this.enqueue(async () => {
      const { databases } = await this.readManifest()
      const record = databases.find((database) => database.id === id)
      return record ? toPublicRecord(record) : null
    })
  }

  /**
   * Adds a database record under the given id.
   *
   * The id comes from the caller (`ipc.ts`, always the trusted main
   * process — never from the renderer, which sends no id at all) rather than
   * being generated here: for a Docker-managed database, the container has
   * to exist under that id *before* this is called, since only the running
   * container can say what port it ended up on.
   */
  addDatabase(input: {
    id: string
    name: string
    engine: DbEngine
    origin: DbOrigin
    host: string
    port: number
    user: string
    password: string
    database: string
  }): Promise<DatabaseRecord> {
    return this.enqueue(async () => {
      const now = new Date().toISOString()
      const record: StoredDatabaseRecord = {
        id: input.id,
        name: input.name,
        engine: input.engine,
        origin: input.origin,
        host: input.host,
        port: input.port,
        user: input.user,
        database: input.database,
        createdAt: now,
        updatedAt: now,
        encryptedPassword: encrypt(input.password),
      }

      const manifest = await this.readManifest()
      manifest.databases.push(record)
      await this.writeManifest(manifest)
      return toPublicRecord(record)
    })
  }

  /** Removes a database's manifest entry. Its container and data directory are the caller's to remove first. */
  deleteDatabase(id: string): Promise<void> {
    return this.enqueue(async () => {
      const manifest = await this.readManifest()
      manifest.databases = manifest.databases.filter(
        (database) => database.id !== id
      )
      await this.writeManifest(manifest)
    })
  }

  /**
   * Updates the host port a Docker-managed database's container was
   * published on — recorded again each time `dbReset` recreates it, since a
   * fresh container is not guaranteed the same port as the one it replaces.
   */
  setDatabasePort(id: string, port: number): Promise<void> {
    return this.enqueue(async () => {
      const manifest = await this.readManifest()
      const record = manifest.databases.find((database) => database.id === id)
      if (!record) throw new Error(`Database not found: ${id}`)

      record.port = port
      record.updatedAt = new Date().toISOString()
      await this.writeManifest(manifest)
    })
  }

  /**
   * A database's connection details with its password decrypted — the one
   * place that happens. Used only by `SqlConnections` inside the main
   * process; never sent back over IPC.
   */
  connectionInfoOf(id: string): Promise<ConnectionInfo | null> {
    return this.enqueue(async () => {
      const { databases } = await this.readManifest()
      const record = databases.find((database) => database.id === id)
      if (!record) return null

      return {
        engine: record.engine,
        host: record.host,
        port: record.port,
        user: record.user,
        password: decrypt(record.encryptedPassword),
        database: record.database,
      }
    })
  }

  /** A studio-wide setting, or `null` when unset. */
  getSetting(key: string): Promise<string | null> {
    return this.enqueue(async () => {
      const { settings } = await this.readManifest()
      return settings[key] ?? null
    })
  }

  setSetting(key: string, value: string): Promise<void> {
    return this.enqueue(async () => {
      const manifest = await this.readManifest()
      manifest.settings[key] = value
      await this.writeManifest(manifest)
    })
  }

  /**
   * Reads one of the workspace's own JSON files. Missing or unreadable reads
   * as none — a panel that lost its file is empty, not broken.
   */
  private readList<T>(file: string): Promise<T[]> {
    return this.enqueue(async () => {
      let raw: string
      try {
        raw = await readFile(path.join(this.workspaceDir, file), "utf8")
      } catch (error) {
        if (isNotFound(error)) return []
        throw error
      }
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as T[]) : []
    })
  }

  /** Replaces one of those files wholesale — the renderer holds the list it is
   * editing, so a merge here would only be a second opinion about it. */
  private writeList<T>(file: string, items: T[], pretty = true): Promise<void> {
    return this.enqueue(async () => {
      await mkdir(this.workspaceDir, { recursive: true })
      await writeFile(
        path.join(this.workspaceDir, file),
        pretty ? JSON.stringify(items, null, 2) : JSON.stringify(items),
        "utf8"
      )
    })
  }

  listRequests(): Promise<HttpRequestRecord[]> {
    return this.readList(REQUESTS_FILE)
  }

  saveRequests(requests: HttpRequestRecord[]): Promise<void> {
    return this.writeList(REQUESTS_FILE, requests)
  }

  listEnvironments(): Promise<HttpEnvironment[]> {
    return this.readList(ENVIRONMENTS_FILE)
  }

  saveEnvironments(environments: HttpEnvironment[]): Promise<void> {
    return this.writeList(ENVIRONMENTS_FILE, environments)
  }

  listRequestFolders(): Promise<HttpFolder[]> {
    return this.readList(FOLDERS_FILE)
  }

  saveRequestFolders(folders: HttpFolder[]): Promise<void> {
    return this.writeList(FOLDERS_FILE, folders)
  }

  listCookies(): Promise<HttpCookie[]> {
    return this.readList(COOKIES_FILE)
  }

  saveCookies(cookies: HttpCookie[]): Promise<void> {
    return this.writeList(COOKIES_FILE, cookies)
  }

  listInbox(): Promise<InboxMessage[]> {
    return this.readList(INBOX_FILE)
  }

  saveInbox(messages: InboxMessage[]): Promise<void> {
    // Not pretty-printed, unlike its neighbours: nobody reads a captured mail's
    // base64 attachment by hand, and the indentation is a real cost on a file
    // rewritten on every capture.
    return this.writeList(INBOX_FILE, messages, false)
  }

  /** Where a folder's commands and sessions run. */
  resolveFolderDir(folderId: string): Promise<string> {
    return this.enqueue(async () => (await this.folderOf(folderId)).path)
  }

  /** A folder's directory, or null when the workspace has no such folder. */
  folderDirOf(folderId: string): Promise<string | null> {
    return this.enqueue(async () => {
      const { workspace } = await this.readManifest()
      const folder = workspace.folders.find(
        (candidate) => candidate.id === folderId
      )
      return folder?.path ?? null
    })
  }

  /** Where one of the workspace's Docker-managed databases keeps its data. */
  databaseDataDir(databaseId: string): string {
    return path.join(this.workspaceDir, DB_DIR, databaseId)
  }
}

function isNotFound(error: unknown): boolean {
  return errorCode(error) === "ENOENT"
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  return (error as { code?: string }).code ?? null
}
