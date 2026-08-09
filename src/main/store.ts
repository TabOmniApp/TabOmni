import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import type {
  DatabaseRecord,
  DbEngine,
  DbOrigin,
  FileEntry,
  HttpCookie,
  HttpEnvironment,
  HttpFolder,
  HttpRequestRecord,
  InboxMessage,
  ProjectRecord,
  UpdateDatabaseInput,
} from "../shared/api"
import { dataDir } from "./data-dir"
import { decrypt, encrypt } from "./encryption"
import {
  isEditable,
  MAX_DEPTH,
  MAX_ENTRIES,
  SKIPPED_DIRS,
  toPosix,
} from "./project-files"

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
    projectId: stored.projectId,
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

/** The pre-rename data directory name, migrated from on first run. */
const LEGACY_DATA_DIR_NAME = ".build-everywhere"

/** A project's own files, inside its directory. */
export const SOURCE_DIR = "source"

/**
 * Where a project's Docker-managed databases keep their data, beside its
 * files rather than inside them — see `databaseDataDir`, one subdirectory
 * per database since a project can have more than one.
 */
export const DB_DIR = "db"

/** A project's saved HTTP requests, beside its files rather than inside them. */
export const REQUESTS_FILE = "requests.json"

/** Cookies picked up from responses, kept per project. */
export const COOKIES_FILE = "cookies.json"

/** The environments those requests are sent against. Its own file: an
 * environment holds hostnames and tokens, which is not the same kind of thing
 * as the requests themselves. */
export const ENVIRONMENTS_FILE = "environments.json"

/** The folders those requests are grouped into. */
export const FOLDERS_FILE = "folders.json"

/**
 * What the Inbox panel's two servers caught.
 *
 * Kept beside the project rather than in the repository for the same reason
 * the requests are: a mail a development server sent is not something to
 * commit. Capped by `InboxServers` before it reaches here — this file is
 * rewritten whole on every capture, and an uncapped one would grow until it
 * was the slowest thing the panel did.
 */
export const INBOX_FILE = "inbox.json"

/**
 * Where the scheduled-tasks feature used to keep a project's tasks. The
 * feature is gone; the name is kept only so that converting a project to the
 * source layout leaves any leftover file where it is instead of sweeping it
 * into `source/` as if the user had written it.
 */
const LEGACY_TASKS_FILE = "tasks.json"

/** Where a project's files are, read from the manifest. */
export type RunConfig = {
  /** The project's files on the host — an imported folder, or ours. */
  dir: string
}

type Manifest = {
  projects: ProjectRecord[]
  databases: StoredDatabaseRecord[]
  settings: Record<string, string>
}

/**
 * Project storage on the real filesystem: one directory per project under
 * `~/.tabula/projects`, plus a `manifest.json` holding the project
 * list and studio-wide settings.
 *
 * Writes are serialised through a promise chain because a manifest update is a
 * read-modify-write: two concurrent `saveFile` calls racing on it would lose
 * one of the two updates.
 */
export class Store {
  private readonly root = dataDir()
  private queue: Promise<unknown> = Promise.resolve()
  private rootReady: Promise<void> | null = null

  /** Serialises a task against every other task on this store. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const wrapped = () => this.ensureRoot().then(task)
    const run = this.queue.then(wrapped, wrapped)
    // Keep the chain alive: a rejected task must not poison later ones.
    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /**
   * Renames the pre-rename data directory into place the first time this
   * store touches the filesystem, so projects created before the app was
   * renamed are not orphaned. Memoized: after the first call there is either
   * nothing left to move, or a `root` already in place.
   */
  private ensureRoot(): Promise<void> {
    if (!this.rootReady) this.rootReady = this.migrateRoot()
    return this.rootReady
  }

  private async migrateRoot(): Promise<void> {
    if (await exists(this.root)) return
    const legacy = path.join(homedir(), LEGACY_DATA_DIR_NAME)
    if (await exists(legacy)) await rename(legacy, this.root)
  }

  private get projectsRoot(): string {
    return path.join(this.root, "projects")
  }

  private get manifestPath(): string {
    return path.join(this.root, "manifest.json")
  }

  /**
   * Resolves a project id to the directory holding everything about it — its
   * sources and its database — rejecting any id that would escape the projects
   * root.
   */
  private projectRoot(id: string): string {
    if (!id || id.includes("/") || id.includes("\\") || id.includes("\0")) {
      throw new Error(`Invalid project id: ${JSON.stringify(id)}`)
    }
    const base = path.resolve(this.projectsRoot)
    const dir = path.resolve(base, id)
    if (dir !== base && !dir.startsWith(base + path.sep)) {
      throw new Error(`Invalid project id: ${JSON.stringify(id)}`)
    }
    return dir
  }

  /**
   * Where a scaffolded project's own files live.
   *
   * A subdirectory rather than the project root so the database can sit beside
   * the sources instead of inside them: only this directory is mounted into the
   * sandbox, which means code the project runs cannot read its own database
   * files.
   */
  private ownedSourceDir(id: string): string {
    return path.join(this.projectRoot(id), SOURCE_DIR)
  }

  /**
   * Where a project's files are, wherever that is.
   *
   * Asynchronous because the answer is in the manifest: an imported project's
   * files are the user's own folder, and only the record knows which projects
   * those are. Everything that touches a project's files goes through here, so
   * this one seam is what makes importing work at all.
   */
  private async sourceDir(id: string): Promise<string> {
    return (await this.sourcePathOf(id)) ?? this.ownedSourceDir(id)
  }

  /** The imported folder a project lives in, or null when the studio owns it. */
  private async sourcePathOf(id: string): Promise<string | null> {
    const { projects } = await this.readManifest()
    const project = projects.find((candidate) => candidate.id === id)
    return project?.sourcePath ?? null
  }

  /**
   * Resolves a project-relative path, rejecting anything that would escape the
   * project's source directory (e.g. via `../`).
   */
  private async filePath(projectId: string, relPath: string): Promise<string> {
    const dir = await this.sourceDir(projectId)
    if (relPath.includes("\0")) {
      throw new Error(`Invalid path: ${JSON.stringify(relPath)}`)
    }
    const full = path.resolve(dir, relPath)
    if (full !== dir && !full.startsWith(dir + path.sep)) {
      throw new Error(`Path escapes the project directory: ${relPath}`)
    }
    return full
  }

  /**
   * Moves a pre-`source/` project's files into place.
   *
   * The first projects were written directly into the project root. Running
   * twice is harmless: the presence of `source/` is what marks a project as
   * already laid out this way. An imported project is never touched — nothing
   * about the user's own folder is the studio's to rearrange — which is why this
   * works on the owned path rather than on `sourceDir`.
   */
  private async migrateLayout(id: string): Promise<boolean> {
    if ((await this.sourcePathOf(id)) !== null) return false

    const root = this.projectRoot(id)
    const source = this.ownedSourceDir(id)

    if (await exists(source)) return false

    let entries
    try {
      entries = await readdir(root)
    } catch (error) {
      if (isNotFound(error)) return false
      throw error
    }

    // Nothing to move: a brand new project, or one whose directory is gone.
    const movable = entries.filter(
      (entry) =>
        entry !== SOURCE_DIR &&
        entry !== DB_DIR &&
        entry !== REQUESTS_FILE &&
        entry !== ENVIRONMENTS_FILE &&
        entry !== COOKIES_FILE &&
        entry !== LEGACY_TASKS_FILE
    )
    if (movable.length === 0) return false

    await mkdir(source, { recursive: true })
    for (const entry of movable) {
      await rename(path.join(root, entry), path.join(source, entry))
    }
    return true
  }

  private async readManifest(): Promise<Manifest> {
    let raw: string
    try {
      raw = await readFile(this.manifestPath, "utf8")
    } catch (error) {
      if (isNotFound(error))
        return { projects: [], databases: [], settings: {} }
      throw error
    }

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("manifest.json is not an object")
    }
    const manifest = parsed as Partial<Manifest>
    // Never hand back a nullish collection: the renderer maps over these
    // directly, and `null.map` is a crash rather than an empty studio.
    return {
      // `sourcePath` was added after the first projects were written — it
      // predates importing, when the studio owned every folder — so it is
      // filled in on read rather than by rewriting the file.
      projects: (manifest.projects ?? []).map((project) => ({
        ...project,
        sourcePath: project.sourcePath ?? null,
      })),
      // `databases` predates this field entirely: a manifest written before
      // it existed simply has none.
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

  /** Every project, most recently updated first. */
  listProjects(): Promise<ProjectRecord[]> {
    return this.enqueue(async () => {
      const { projects } = await this.readManifest()
      return [...projects].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      )
    })
  }

  /**
   * Records an existing folder as a project, edited and run where it is.
   *
   * Nothing is copied and nothing is written into the folder: the studio's own
   * directory for this project holds its database, and the user's
   * files stay theirs. The path is resolved through symlinks first, so the
   * duplicate check and the guard below both see what will actually be opened.
   */
  importProject(input: { path: string; name: string }): Promise<ProjectRecord> {
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

      // The studio's own storage is refused: those projects are already in the
      // manifest, and importing one would leave the same files with two
      // records — two databases, and a delete that surprises.
      //
      // Both sides are resolved through symlinks before comparing. `resolved` is
      // already, and comparing it against an unresolved root is a check that
      // quietly passes anything reached through a link — on macOS, /tmp is one.
      const root = await realpath(this.root).catch(() =>
        path.resolve(this.root)
      )
      if (resolved === root || resolved.startsWith(root + path.sep)) {
        throw new Error(
          "That folder is inside the studio's own storage; it is already a project."
        )
      }

      const manifest = await this.readManifest()
      const clash = manifest.projects.find(
        (project) =>
          project.sourcePath !== null &&
          path.resolve(project.sourcePath) === resolved
      )
      if (clash) {
        throw new Error(`This folder is already open as “${clash.name}”.`)
      }

      const now = new Date().toISOString()
      const project: ProjectRecord = {
        id: randomUUID(),
        name: input.name.trim() || path.basename(resolved),
        createdAt: now,
        updatedAt: now,
        sourcePath: resolved,
      }

      manifest.projects.push(project)
      await this.writeManifest(manifest)
      return project
    })
  }

  renameProject(id: string, name: string): Promise<void> {
    return this.enqueue(async () => {
      const manifest = await this.readManifest()
      const project = manifest.projects.find((candidate) => candidate.id === id)
      if (!project) throw new Error(`Project not found: ${id}`)

      project.name = name
      project.updatedAt = new Date().toISOString()
      await this.writeManifest(manifest)
    })
  }

  /**
   * Removes a project's manifest entry and the directory the studio keeps for
   * it — its database, and for a scaffolded project its sources.
   *
   * An imported project's own folder is never touched. That is not a special
   * case here but a consequence of the layout: what is deleted is
   * `~/.tabula/projects/<id>`, and an imported project's files were
   * never inside it.
   */
  deleteProject(id: string): Promise<void> {
    return this.enqueue(async () => {
      await rm(this.projectRoot(id), { recursive: true, force: true })

      const manifest = await this.readManifest()
      manifest.projects = manifest.projects.filter(
        (project) => project.id !== id
      )
      // A Docker-managed database's data directory goes with the project root
      // above; its container is the caller's to remove first (see `ipc.ts`'s
      // `deleteProject` handler) — this is only the manifest entry.
      manifest.databases = manifest.databases.filter(
        (database) => database.projectId !== id
      )
      await this.writeManifest(manifest)
    })
  }

  /** Every database or connection attached to a project. */
  listDatabases(projectId: string): Promise<DatabaseRecord[]> {
    return this.enqueue(async () => {
      const { databases } = await this.readManifest()
      return databases
        .filter((database) => database.projectId === projectId)
        .map(toPublicRecord)
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
    projectId: string
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
        projectId: input.projectId,
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

  /**
   * A project's file tree — paths and sizes, no contents.
   *
   * Contents are left to `readFile`, one file at a time. A template has ten
   * files and could be read whole; an imported repository cannot, and the
   * difference is not one the rest of the studio should have to know about.
   */
  listFiles(projectId: string): Promise<FileEntry[]> {
    return this.enqueue(async () => {
      // Opening a project is where an older layout gets moved into place: it is
      // the first thing that reads a project's files.
      await this.migrateLayout(projectId)

      const dir = await this.sourceDir(projectId)
      const files: FileEntry[] = []

      const walk = async (current: string, depth: number): Promise<void> => {
        if (files.length >= MAX_ENTRIES) return

        let entries
        try {
          entries = await readdir(current, { withFileTypes: true })
        } catch (error) {
          // A project recorded in the manifest but missing on disk — or an
          // imported folder that has since been moved — reads as empty rather
          // than blowing up the studio on open. A directory the user cannot
          // read is the same story.
          if (isNotFound(error) || isPermission(error)) return
          throw error
        }

        for (const entry of entries) {
          if (files.length >= MAX_ENTRIES) return

          const full = path.join(current, entry.name)
          if (entry.isDirectory()) {
            if (SKIPPED_DIRS.has(entry.name)) continue
            if (depth >= MAX_DEPTH) continue
            await walk(full, depth + 1)
            continue
          }
          // Symlinks are skipped rather than followed: one pointing outside the
          // project would put a path the editor could write to somewhere the
          // project's own guard rails do not reach.
          if (!entry.isFile()) continue

          const stats = await stat(full).catch(() => null)
          if (!stats) continue

          const relPath = toPosix(path.relative(dir, full))
          files.push({
            path: relPath,
            size: stats.size,
            editable: isEditable(relPath, stats.size),
          })
        }
      }

      await walk(dir, 0)
      // Sorted here rather than in the renderer: the tree is built from this
      // order, and `readdir` gives whatever the filesystem happens to hold.
      return files.sort((a, b) => a.path.localeCompare(b.path))
    })
  }

  /** One file's contents, as text. */
  readProjectFile(projectId: string, relPath: string): Promise<string> {
    return this.enqueue(async () => {
      const full = await this.filePath(projectId, relPath)
      const stats = await stat(full)
      if (!isEditable(relPath, stats.size)) {
        throw new Error(
          `${relPath} is not editable text (${formatBytes(stats.size)}).`
        )
      }
      return readFile(full, "utf8")
    })
  }

  /**
   * Writes one of a project's files, creating the directories above it.
   *
   * `isEditable` is asked about the path before anything is opened — a size of
   * zero, since what matters here is the extension. An imported project is the
   * user's own repository, and the one thing this must never do is write UTF-8
   * over a `.png` because something upstream mistook it for text.
   */
  writeProjectFile(
    projectId: string,
    relPath: string,
    content: string
  ): Promise<void> {
    return this.enqueue(async () => {
      if (!isEditable(relPath, 0)) {
        throw new Error(`${relPath} is not editable text.`)
      }
      const full = await this.filePath(projectId, relPath)
      await mkdir(path.dirname(full), { recursive: true })
      await writeFile(full, content, "utf8")
    })
  }

  /**
   * Copies a file from anywhere on disk into `directory` inside the project.
   *
   * The name is deduplicated rather than overwritten: two specs importing a
   * screenshot each called `screen.png` is the ordinary case, and the second
   * one silently replacing the first would be a spec quietly changing what it
   * illustrates. Resolves with the project-relative path, which is what the
   * document records.
   */
  importProjectFile(
    projectId: string,
    sourcePath: string,
    directory: string
  ): Promise<string> {
    return this.enqueue(async () => {
      const dir = directory.replace(/^\/+|\/+$/g, "")
      const base = path.basename(sourcePath)
      const extension = path.extname(base)
      const stem = extension ? base.slice(0, -extension.length) : base

      // `filePath` is asked about each candidate rather than only the first, so
      // a `..` smuggled in through `directory` is refused however many
      // suffixes it takes to find a free name.
      for (let suffix = 0; suffix < 1000; suffix += 1) {
        const name = suffix === 0 ? base : `${stem}-${suffix}${extension}`
        const relPath = dir ? `${dir}/${name}` : name
        const full = await this.filePath(projectId, relPath)

        await mkdir(path.dirname(full), { recursive: true })
        try {
          // `COPYFILE_EXCL` is what makes the check and the write one step: a
          // name found free and then written to is a race, however unlikely.
          await copyFile(sourcePath, full, constants.COPYFILE_EXCL)
          return toPosix(relPath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        }
      }
      throw new Error(`Could not find a free name for ${base} in ${dir}.`)
    })
  }

  /**
   * A project-relative path as an absolute one, refusing anything that would
   * escape the project.
   *
   * The only guarded path handed out rather than used here, so that reading a
   * project's image can go through the same code as reading any other image
   * (`ipc.ts`) instead of this class growing a second, slightly different
   * answer to "what is a picture".
   */
  resolveProjectFile(projectId: string, relPath: string): Promise<string> {
    return this.enqueue(() => this.filePath(projectId, relPath))
  }

  /** Creates a directory in the project, and every directory above it. */
  createProjectDirectory(projectId: string, relPath: string): Promise<void> {
    return this.enqueue(async () => {
      await mkdir(await this.filePath(projectId, relPath), { recursive: true })
    })
  }

  /** Deletes a project path, or a directory and everything under it. */
  deleteProjectPath(projectId: string, relPath: string): Promise<void> {
    return this.enqueue(async () => {
      const full = await this.filePath(projectId, relPath)
      // The project's own directory is not a path within it to delete; a
      // caller that worked one out has a bug, and this is the last place it
      // could still be somebody's repository.
      if (full === (await this.sourceDir(projectId))) {
        throw new Error("Refusing to delete the project directory.")
      }
      await rm(full, { recursive: true, force: true })
    })
  }

  /**
   * Moves a project path, refusing to overwrite.
   *
   * `rename` on its own would replace the destination silently, and the
   * callers here are rename and duplicate, where landing on a name that is
   * taken means replacing somebody's spec.
   */
  moveProjectPath(
    projectId: string,
    fromPath: string,
    toPath: string
  ): Promise<void> {
    return this.enqueue(async () => {
      const from = await this.filePath(projectId, fromPath)
      const to = await this.filePath(projectId, toPath)
      if (await exists(to)) throw new Error(`${toPath} already exists.`)
      await mkdir(path.dirname(to), { recursive: true })
      await rename(from, to)
    })
  }

  /** Copies a file, or a directory and everything under it. */
  copyProjectPath(
    projectId: string,
    fromPath: string,
    toPath: string
  ): Promise<void> {
    return this.enqueue(async () => {
      const from = await this.filePath(projectId, fromPath)
      const to = await this.filePath(projectId, toPath)
      if (await exists(to)) throw new Error(`${toPath} already exists.`)
      await mkdir(path.dirname(to), { recursive: true })
      await cp(from, to, { recursive: true, errorOnExist: true, force: false })
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

  private requestsPath(projectId: string): string {
    return path.join(this.projectRoot(projectId), REQUESTS_FILE)
  }

  /** A project's saved requests. Missing or unreadable reads as none. */
  listRequests(projectId: string): Promise<HttpRequestRecord[]> {
    return this.enqueue(async () => {
      let raw: string
      try {
        raw = await readFile(this.requestsPath(projectId), "utf8")
      } catch (error) {
        if (isNotFound(error)) return []
        throw error
      }
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as HttpRequestRecord[]) : []
    })
  }

  /** Replaces the collection wholesale — the renderer holds the list it is
   * editing, so a merge here would only be a second opinion about it. */
  saveRequests(
    projectId: string,
    requests: HttpRequestRecord[]
  ): Promise<void> {
    return this.enqueue(async () => {
      await mkdir(this.projectRoot(projectId), { recursive: true })
      await writeFile(
        this.requestsPath(projectId),
        JSON.stringify(requests, null, 2),
        "utf8"
      )
    })
  }

  private environmentsPath(projectId: string): string {
    return path.join(this.projectRoot(projectId), ENVIRONMENTS_FILE)
  }

  listEnvironments(projectId: string): Promise<HttpEnvironment[]> {
    return this.enqueue(async () => {
      let raw: string
      try {
        raw = await readFile(this.environmentsPath(projectId), "utf8")
      } catch (error) {
        if (isNotFound(error)) return []
        throw error
      }
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as HttpEnvironment[]) : []
    })
  }

  saveEnvironments(
    projectId: string,
    environments: HttpEnvironment[]
  ): Promise<void> {
    return this.enqueue(async () => {
      await mkdir(this.projectRoot(projectId), { recursive: true })
      await writeFile(
        this.environmentsPath(projectId),
        JSON.stringify(environments, null, 2),
        "utf8"
      )
    })
  }

  private foldersPath(projectId: string): string {
    return path.join(this.projectRoot(projectId), FOLDERS_FILE)
  }

  listFolders(projectId: string): Promise<HttpFolder[]> {
    return this.enqueue(async () => {
      let raw: string
      try {
        raw = await readFile(this.foldersPath(projectId), "utf8")
      } catch (error) {
        if (isNotFound(error)) return []
        throw error
      }
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as HttpFolder[]) : []
    })
  }

  saveFolders(projectId: string, folders: HttpFolder[]): Promise<void> {
    return this.enqueue(async () => {
      await mkdir(this.projectRoot(projectId), { recursive: true })
      await writeFile(
        this.foldersPath(projectId),
        JSON.stringify(folders, null, 2),
        "utf8"
      )
    })
  }

  private inboxPath(projectId: string): string {
    return path.join(this.projectRoot(projectId), INBOX_FILE)
  }

  /** A project's captured mail and webhooks. Missing or unreadable reads as
   * none: an inbox that lost its file is empty, not broken. */
  listInbox(projectId: string): Promise<InboxMessage[]> {
    return this.enqueue(async () => {
      let raw: string
      try {
        raw = await readFile(this.inboxPath(projectId), "utf8")
      } catch (error) {
        if (isNotFound(error)) return []
        throw error
      }
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as InboxMessage[]) : []
    })
  }

  saveInbox(projectId: string, messages: InboxMessage[]): Promise<void> {
    return this.enqueue(async () => {
      await mkdir(this.projectRoot(projectId), { recursive: true })
      // Not pretty-printed, unlike its neighbours: nobody reads a captured
      // mail's base64 attachment by hand, and the indentation is a real cost
      // on a file rewritten on every capture.
      await writeFile(
        this.inboxPath(projectId),
        JSON.stringify(messages),
        "utf8"
      )
    })
  }

  private cookiesPath(projectId: string): string {
    return path.join(this.projectRoot(projectId), COOKIES_FILE)
  }

  listCookies(projectId: string): Promise<HttpCookie[]> {
    return this.enqueue(async () => {
      let raw: string
      try {
        raw = await readFile(this.cookiesPath(projectId), "utf8")
      } catch (error) {
        if (isNotFound(error)) return []
        throw error
      }
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as HttpCookie[]) : []
    })
  }

  saveCookies(projectId: string, cookies: HttpCookie[]): Promise<void> {
    return this.enqueue(async () => {
      await mkdir(this.projectRoot(projectId), { recursive: true })
      await writeFile(
        this.cookiesPath(projectId),
        JSON.stringify(cookies, null, 2),
        "utf8"
      )
    })
  }

  /**
   * Where a project's commands run: its sources, not the directory that also
   * holds its database.
   */
  resolveProjectDir(projectId: string): Promise<string> {
    return this.enqueue(() => this.sourceDir(projectId))
  }

  /** A project's directory, or null when there is no such project. */
  runConfigOf(projectId: string): Promise<RunConfig | null> {
    return this.enqueue(async () => {
      const { projects } = await this.readManifest()
      const project = projects.find((candidate) => candidate.id === projectId)
      if (!project) return null

      return { dir: project.sourcePath ?? this.ownedSourceDir(projectId) }
    })
  }

  /** Where one of a project's Docker-managed databases keeps its data. */
  databaseDataDir(projectId: string, databaseId: string): string {
    return path.join(this.projectRoot(projectId), DB_DIR, databaseId)
  }

  /**
   * Brings a project's directory up to the current layout. Exposed so opening a
   * project can migrate it before anything else touches its paths.
   */
  ensureLayout(projectId: string): Promise<boolean> {
    return this.enqueue(() => this.migrateLayout(projectId))
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function isNotFound(error: unknown): boolean {
  return errorCode(error) === "ENOENT"
}

/**
 * Whether a directory was simply not ours to read. Imported folders can contain
 * anything, including directories the user's account has no access to.
 */
function isPermission(error: unknown): boolean {
  const code = errorCode(error)
  return code === "EACCES" || code === "EPERM"
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  return (error as { code?: string }).code ?? null
}

/** For a message explaining why a file will not open. */
function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
