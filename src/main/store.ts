import { randomUUID } from "node:crypto"
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import path from "node:path"

import type {
  AssistantMessage,
  ClaudeProfile,
  DatabaseRecord,
  DbEngine,
  DbOrigin,
  HttpCookie,
  HttpEnvironment,
  HttpFolder,
  HttpRequestRecord,
  NoteBody,
  NoteFolder,
  NoteRecord,
  WorktreeChat,
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
 * cookies and notes are the studio's, so they live here.
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

/** The workspace's `CLAUDE_CONFIG_DIR` profiles — see `ClaudeProfile`. */
export const CLAUDE_PROFILES_FILE = "claude-profiles.json"

/** The groups those requests are filed under. */
export const FOLDERS_FILE = "folders.json"

/**
 * The chats held in the workspace's projects — their listing; each chat's lines
 * are a file of its own, the split the notes have and for the same reason: a
 * turn rewrites one chat rather than all of them.
 *
 * The file is still called `worktree-chats.json`: chats lived in `git worktree`
 * checkouts once, and renaming the file would lose every chat already written.
 */
export const WORKTREE_CHATS_FILE = "worktree-chats.json"

/** Where each of those chats' lines live, one `<id>.json` per chat. */
export const WORKTREE_CHATS_DIR = "worktree-chats"

/** The workspace's notes — their listing; each body is a file of its own. */
export const NOTES_FILE = "notes.json"

/** The groups those notes are filed under. */
export const NOTE_FOLDERS_FILE = "note-folders.json"

/**
 * Where each note's markdown is kept, one `<id>.md` per note.
 *
 * Apart from the listing so that typing into a note rewrites only that note:
 * a body inline in `notes.json` would mean rewriting every note's text on
 * every keystroke in one of them. It also leaves a directory of plain markdown
 * that grep, an editor or git can read without going through this app.
 */
export const NOTES_DIR = "notes"

/**
 * Where a note's drawings are kept, one `<id>.excalidraw` per drawing.
 *
 * Beside the notes rather than under one of them: the file is Excalidraw's own
 * format, and a flat directory of them is something the editor's own app can
 * open. The note keeps only the id, in a fenced block.
 */
export const DRAWINGS_DIR = "drawings"

/**
 * Where the pictures dropped into notes are kept, one file per upload.
 *
 * Flat and named by id rather than filed under the note that holds one: a
 * picture can be cut from one note and pasted into another, and a directory per
 * note would leave the file under a note that no longer mentions it. What owns a
 * file is the document that points at it — see `shared/note-files.ts`.
 */
export const NOTE_FILES_DIR = "note-files"

/**
 * A note file's name, checked before it becomes a filename.
 *
 * The same guard `ownId` is, and it has to be its own because this name carries
 * an extension: the renderer makes it out of a UUID and the type of the file
 * that was dropped, and the extension is the one part derived from something the
 * user's filesystem named. So it is spelled out — a UUID, a dot, and a short run
 * of letters and digits — and anything else is refused rather than sanitised.
 */
function noteFileName(name: string): string {
  if (!/^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i.test(name)) {
    throw new Error(`Not a note file: ${name}`)
  }
  return name
}

/**
 * A renderer-generated id, checked before it becomes a filename.
 *
 * Notes and drawings are both created with `crypto.randomUUID()`, and anything
 * that is not that shape is refused — which is what keeps a `../` in an id from
 * naming a file outside the workspace. An id is not a name the user typed, and
 * it must not be able to become one.
 */
function ownId(id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`Not an id: ${id}`)
  return id
}

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

  listClaudeProfiles(): Promise<ClaudeProfile[]> {
    return this.readList(CLAUDE_PROFILES_FILE)
  }

  saveClaudeProfiles(profiles: ClaudeProfile[]): Promise<void> {
    return this.writeList(CLAUDE_PROFILES_FILE, profiles)
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

  listWorktreeChats(): Promise<WorktreeChat[]> {
    return this.readList(WORKTREE_CHATS_FILE)
  }

  saveWorktreeChats(chats: WorktreeChat[]): Promise<void> {
    return this.writeList(WORKTREE_CHATS_FILE, chats)
  }

  /** Empty for a chat with nothing said in it, and for a half-written file: a
   * chat is a log, not a document, so a broken one is worth an empty pane
   * rather than an error in front of every other chat. */
  async readWorktreeChat(id: string): Promise<AssistantMessage[]> {
    const raw = await this.readOwnFile(this.worktreeChatPath(id))
    if (!raw.trim()) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as AssistantMessage[]) : []
    } catch {
      return []
    }
  }

  writeWorktreeChat(id: string, messages: AssistantMessage[]): Promise<void> {
    return this.writeOwnFile(
      this.worktreeChatPath(id),
      JSON.stringify(messages)
    )
  }

  deleteWorktreeChat(id: string): Promise<void> {
    return this.deleteOwnFiles([this.worktreeChatPath(id)])
  }

  private worktreeChatPath(id: string): string {
    return path.join(this.workspaceDir, WORKTREE_CHATS_DIR, `${ownId(id)}.json`)
  }

  listNotes(): Promise<NoteRecord[]> {
    return this.readList(NOTES_FILE)
  }

  saveNotes(notes: NoteRecord[]): Promise<void> {
    return this.writeList(NOTES_FILE, notes)
  }

  listNoteFolders(): Promise<NoteFolder[]> {
    return this.readList(NOTE_FOLDERS_FILE)
  }

  saveNoteFolders(folders: NoteFolder[]): Promise<void> {
    return this.writeList(NOTE_FOLDERS_FILE, folders)
  }

  /** A note's blocks, the markdown an older build left, or "" for one that has
   * never been written to — see `NoteBody`. */
  readNote(id: string): Promise<NoteBody> {
    return this.readBody(this.noteBodyPath(id), this.legacyNotePath(id))
  }

  /** Blocks land in `<id>.json`; markdown lands where an older build would
   * have put it, so a note copied before anything converted it stays a note
   * this store can read back rather than JSON that is not JSON. */
  writeNote(id: string, body: NoteBody): Promise<void> {
    return this.writeOwnFile(
      body.format === "blocks"
        ? this.noteBodyPath(id)
        : this.legacyNotePath(id),
      body.text
    )
  }

  /** Removes those notes' bodies. A body that was never written is not an
   * error — a note deleted before anything was typed into it has no file. The
   * markdown an older build wrote goes too: it is this note's text, and a
   * deleted note should not leave half of itself behind. */
  deleteNotes(ids: string[]): Promise<void> {
    return this.deleteOwnFiles(
      ids.flatMap((id) => [this.noteBodyPath(id), this.legacyNotePath(id)])
    )
  }

  /**
   * A body, preferring the blocks and falling back to what an older build
   * wrote.
   *
   * The fallback is a read of a second file that is almost never there, which
   * is the cheap half of the trade: the alternative is a migration pass over
   * the whole directory at startup, which would have to be right about every
   * note before the user has opened any of them.
   */
  private async readBody(
    blocksPath: string,
    legacyPath: string
  ): Promise<NoteBody> {
    const blocks = await this.readOwnFile(blocksPath)
    if (blocks) return { format: "blocks", text: blocks }

    const markdown = await this.readOwnFile(legacyPath)
    return markdown
      ? { format: "markdown", text: markdown }
      : { format: "blocks", text: "" }
  }

  /** A drawing's scene, or "" for one that has never been saved. */
  readDrawing(id: string): Promise<string> {
    return this.readOwnFile(this.drawingPath(id))
  }

  writeDrawing(id: string, scene: string): Promise<void> {
    return this.writeOwnFile(this.drawingPath(id), scene)
  }

  /** The drawing as a picture, or "" for one the studio has not exported since
   * the preview server was added. */
  readDrawingSvg(id: string): Promise<string> {
    return this.readOwnFile(this.drawingSvgPath(id))
  }

  writeDrawingSvg(id: string, svg: string): Promise<void> {
    return this.writeOwnFile(this.drawingSvgPath(id), svg)
  }

  /** The scene and the picture of it go together: the export is derived from
   * the scene and means nothing without it. */
  deleteDrawings(ids: string[]): Promise<void> {
    return this.deleteOwnFiles(
      ids.flatMap((id) => [this.drawingPath(id), this.drawingSvgPath(id)])
    )
  }

  /**
   * Where one of a note's files is, for the protocol handler that serves it.
   *
   * Public, and the only path this class hands out, because the handler is not
   * IPC: it answers Chromium's own request for an `img` src and so runs outside
   * everything in `ipc.ts`. It is a name being turned into a path, which is
   * exactly what `noteFileName` is there to refuse — so the check happens here
   * rather than at the one call site.
   */
  noteFilePath(fileName: string): string {
    return path.join(this.workspaceDir, NOTE_FILES_DIR, noteFileName(fileName))
  }

  /** One note file's bytes, or null for a name nothing was written under —
   * a note pointing at a file somebody removed from the workspace by hand. */
  readNoteFile(fileName: string): Promise<Buffer | null> {
    const file = this.noteFilePath(fileName)
    return this.enqueue(async () => {
      try {
        return await readFile(file)
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    })
  }

  /**
   * Whether the workspace still holds this file, without reading it.
   *
   * For the preview server's render pass: a video is fetched on a request of its
   * own, so the page only needs to know the file is there to put a player
   * around it — and reading a 60 MB file to find that out would happen on every
   * render of the page.
   */
  hasNoteFile(fileName: string): Promise<boolean> {
    const file = this.noteFilePath(fileName)
    return this.enqueue(async () => {
      try {
        return (await stat(file)).isFile()
      } catch (error) {
        if (isNotFound(error)) return false
        throw error
      }
    })
  }

  writeNoteFile(fileName: string, bytes: Uint8Array): Promise<void> {
    const file = this.noteFilePath(fileName)
    return this.enqueue(async () => {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, bytes)
    })
  }

  /** Copied here rather than read and written back through the renderer: the
   * bytes have no business crossing the bridge twice to end up in a second file
   * of ours. */
  copyNoteFile(fromName: string, toName: string): Promise<void> {
    const from = this.noteFilePath(fromName)
    const to = this.noteFilePath(toName)
    return this.enqueue(async () => {
      await mkdir(path.dirname(to), { recursive: true })
      try {
        await copyFile(from, to)
      } catch (error) {
        // A duplicate of a note whose picture is already missing is still a
        // duplicate. The copy has nothing to point at, which is the state the
        // original was in.
        if (!isNotFound(error)) throw error
      }
    })
  }

  deleteNoteFiles(fileNames: string[]): Promise<void> {
    return this.deleteOwnFiles(fileNames.map((name) => this.noteFilePath(name)))
  }

  /** One note's blocks. */
  private noteBodyPath(id: string): string {
    return path.join(this.workspaceDir, NOTES_DIR, `${ownId(id)}.json`)
  }

  /** Where the same note's text was kept when a note was markdown. */
  private legacyNotePath(id: string): string {
    return path.join(this.workspaceDir, NOTES_DIR, `${ownId(id)}.md`)
  }

  /** One drawing's scene, in Excalidraw's own file format. */
  private drawingPath(id: string): string {
    return path.join(this.workspaceDir, DRAWINGS_DIR, `${ownId(id)}.excalidraw`)
  }

  /** The same drawing as a picture, beside its scene. Written by the renderer,
   * which is the only side with an Excalidraw to export from, and read by the
   * preview server, which has none — see `preview.ts`. */
  private drawingSvgPath(id: string): string {
    return path.join(this.workspaceDir, DRAWINGS_DIR, `${ownId(id)}.svg`)
  }

  /** One of the workspace's own per-record files, or "" when it does not
   * exist yet — which is every one of them until something is written. */
  private readOwnFile(file: string): Promise<string> {
    return this.enqueue(async () => {
      try {
        return await readFile(file, "utf8")
      } catch (error) {
        if (isNotFound(error)) return ""
        throw error
      }
    })
  }

  private writeOwnFile(file: string, contents: string): Promise<void> {
    return this.enqueue(async () => {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, contents, "utf8")
    })
  }

  /** A file that was never written is not an error — a note deleted before
   * anything was typed into it has none. */
  private deleteOwnFiles(files: string[]): Promise<void> {
    return this.enqueue(async () => {
      await Promise.all(
        files.map(async (file) => {
          try {
            await rm(file)
          } catch (error) {
            if (!isNotFound(error)) throw error
          }
        })
      )
    })
  }

  /** Where a folder's commands and sessions run. */
  resolveFolderDir(folderId: string): Promise<string> {
    return this.enqueue(async () => (await this.folderOf(folderId)).path)
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
