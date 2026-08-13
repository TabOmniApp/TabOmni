import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"

import {
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type OpenDialogOptions,
} from "electron"

import {
  CLAUDE_MODEL_KEY,
  CLAUDE_PERMISSION_MODE_KEY,
  IPC,
  type AgentKind,
  type ClaudeModel,
  type ClaudePermissionMode,
  type DatabaseConnectionInput,
  type FileIndexEntry,
  type UpdateDatabaseInput,
  type HttpCookie,
  type HttpEnvironment,
  type HttpFolder,
  type HttpRequestRecord,
  type HttpSendInput,
  type NewDatabaseInput,
  type NoteBody,
  type NoteFolder,
  type NoteRecord,
  type NoteTemplate,
} from "../shared/api"
import {
  agentCommandWith,
  agentInstallCommand,
  agentToolStatuses,
} from "./agent-tools"
import { claudeSlashCommands } from "./claude-commands"
import { SqlConnections } from "./database"
import { DockerRuntime } from "./docker"
import * as files from "./files"
import { MAX_INDEXED_FILES } from "./files"
import { currentBranch } from "./git"
import { sendHttp } from "./http"
import { InboxServers } from "./inbox"
import { NotePreview } from "./preview"
import { ProcessManager } from "./process"
import { claudeUsageLimits } from "./claude-usage"
import { systemUsage } from "./system-usage"
import { hasTranscript, listSessions, TranscriptMirrors } from "./transcript"
import { DEFAULT_WORKSPACE_ID, Store } from "./store"
import { TerminalManager } from "./terminal"
import { TsServers } from "./tsserver"

/**
 * Resolves a path the user typed, expanding a leading `~`.
 *
 * The picker hands back absolute paths, but the field beside it accepts typing —
 * and `~/code/app` failing with "there is no folder at ~/code/app" is a poor
 * answer when the folder is plainly there.
 */
function expandHome(target: string): string {
  const trimmed = target.trim()
  if (trimmed === "~") return homedir()
  if (trimmed.startsWith("~/")) return path.join(homedir(), trimmed.slice(2))
  return trimmed
}

/** What `readImageDataUrl` will actually recognize — the same extensions
 * `pickImages`'s dialog filter offers. */
const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
}

/** A thumbnail is all this is for — never worth holding a huge image whole
 * in memory just to preview it. */
const MAX_IMAGE_PREVIEW_BYTES = 20 * 1024 * 1024

/**
 * An image on disk as a data URL.
 *
 * Shared by the two handlers that need one — the composer's attachments, which
 * name a file anywhere, and the Spec panel's screenshots, which name one inside
 * a folder — so that "too large" and "which types are pictures" are answered
 * once. The renderer's origin is not `file://` and Chromium will not load a
 * `file://` subresource from any other origin, which is why either of them
 * needs bytes rather than a path.
 */
async function imageDataUrl(filePath: string): Promise<string> {
  const stats = await stat(filePath)
  if (stats.size > MAX_IMAGE_PREVIEW_BYTES) {
    const megabytes = (stats.size / (1024 * 1024)).toFixed(1)
    throw new Error(
      `${path.basename(filePath)} is too large to preview (${megabytes} MB).`
    )
  }
  const mime = IMAGE_MIME_TYPES[path.extname(filePath).toLowerCase()]
  const data = await readFile(filePath)
  return `data:${mime ?? "application/octet-stream"};base64,${data.toString("base64")}`
}

/**
 * The clipboard's image spilled to a file, so a terminal can paste a path.
 *
 * `tmpdir()` rather than anywhere under `~/.tabomni`: this is a scratch copy of
 * something the user still holds in their clipboard, the OS already knows to
 * clean the directory out, and it is where the system terminals put the same
 * file — the `/var/folders/…` path a pasted screenshot turns into there.
 *
 * PNG whatever came in, because that is the one encoding `NativeImage` can be
 * asked for without knowing what the clipboard's own format was.
 */
async function clipboardImagePath(): Promise<string | null> {
  const image = clipboard.readImage()
  if (image.isEmpty()) return null

  const file = path.join(tmpdir(), `tabomni-paste-${Date.now()}.png`)
  await writeFile(file, image.toPNG())
  return file
}

/**
 * Wires every renderer-callable method onto `ipcMain`.
 *
 * Handlers are registered once for the whole app rather than per window, and
 * process output is sent to whichever window is current — this is a
 * single-window app, and a second window would need its own manager anyway.
 */
export function registerIpc(getWindow: () => BrowserWindow | null): {
  processes: ProcessManager
  sqlConnections: SqlConnections
  docker: DockerRuntime
  transcripts: TranscriptMirrors
  terminals: TerminalManager
  inbox: InboxServers
  preview: NotePreview
  tsServers: TsServers
} {
  const store = new Store()
  const sqlConnections = new SqlConnections(async (databaseId) => {
    const info = await store.connectionInfoOf(databaseId)
    if (!info) throw new Error(`Database not found: ${databaseId}`)
    return info
  })
  const docker = new DockerRuntime()

  const send = (channel: string, payload: unknown): void => {
    const window = getWindow()
    // The window is gone during shutdown; its last output has nowhere to go.
    if (!window || window.isDestroyed()) return
    window.webContents.send(channel, payload)
  }

  const processes = new ProcessManager({
    output: (event) => send(IPC.processOutput, event),
    exit: (event) => send(IPC.processExit, event),
  })

  const terminals = new TerminalManager({
    data: (event) => send(IPC.terminalData, event),
    exit: (event) => send(IPC.terminalExit, event),
  })

  const transcripts = new TranscriptMirrors((event) =>
    send(IPC.transcriptEvent, event)
  )

  const inbox = new InboxServers(
    {
      message: (message) => send(IPC.inboxMessage, { message }),
      status: (status) => send(IPC.inboxStatusChanged, { status }),
    },
    {
      load: () => store.listInbox(),
      save: (messages) => store.saveInbox(messages),
    }
  )

  // Reads the workspace's own files and nothing else — the preview is a view
  // of what is on disk, so it is handed the four reads it needs rather than
  // the store.
  const preview = new NotePreview({
    notes: () => store.listNotes(),
    folders: () => store.listNoteFolders(),
    body: (id) => store.readNote(id),
    drawingSvg: (id) => store.readDrawingSvg(id),
  })

  /** The account a Docker-managed database is created with. */
  const DB_USER = "tabomni"

  function randomDbPassword(): string {
    return randomBytes(18).toString("base64url")
  }

  /**
   * A safe database/schema name derived from what the user typed as the
   * display name — Postgres and MySQL both reject spaces, punctuation, and a
   * leading digit.
   */
  function slugifyDbName(name: string): string {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^[0-9_]+/, "")
      .slice(0, 48)
    return slug || "db"
  }

  ipcMain.handle(IPC.getWorkspace, () => store.getWorkspace())

  ipcMain.handle(IPC.pickDirectory, async () => {
    const options: OpenDialogOptions = {
      title: "Add a folder",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Add",
    }

    // Parented to the window when there is one, so the picker is modal to the
    // studio rather than a sheet the user can lose behind it.
    const window = getWindow()
    const result = await (window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options))

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.pickImages, async () => {
    const options: OpenDialogOptions = {
      title: "Attach images",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"],
        },
      ],
    }

    const window = getWindow()
    const result = await (window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options))

    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(IPC.readImageDataUrl, (_event, filePath: string) =>
    imageDataUrl(filePath)
  )

  ipcMain.handle(IPC.clipboardImagePath, () => clipboardImagePath())

  ipcMain.handle(
    IPC.addFolder,
    (_event, input: { path: string; name: string }) =>
      store.addFolder({ ...input, path: expandHome(input.path) })
  )

  ipcMain.handle(IPC.renameFolder, (_event, id: string, name: string) =>
    store.renameFolder(id, name)
  )

  ipcMain.handle(IPC.removeFolder, (_event, id: string) =>
    store.removeFolder(id)
  )

  ipcMain.handle(IPC.dockerStatus, () => {
    // Re-probe rather than trusting a cached "no": Docker may have been
    // started since the app launched.
    docker.resetCheck()
    return docker.check()
  })

  ipcMain.handle(IPC.gitBranch, async (_event, folderId: string) =>
    currentBranch(await store.resolveFolderDir(folderId))
  )

  /**
   * The one gate in front of the Explorer's reads and writes.
   *
   * Every `files:*` handler goes through this before it touches anything: the
   * renderer sends an absolute path, and an absolute path can name anything on
   * the machine. The workspace's folders are what the user pointed the studio
   * at, so they are what the studio is allowed to open — a rule the renderer
   * cannot be trusted to keep for itself, since the whole point of the check is
   * the case where the renderer is wrong.
   *
   * Read fresh each time rather than cached: a folder removed from the
   * workspace has to stop being writable at once, and the manifest read is a
   * small file behind a queue.
   */
  async function inWorkspace(target: string): Promise<string> {
    const { folders } = await store.getWorkspace()
    if (
      !files.insideAny(
        folders.map((folder) => folder.path),
        target
      )
    ) {
      throw new Error(
        `${path.basename(target)} is outside the workspace's folders.`
      )
    }
    return target
  }

  ipcMain.handle(IPC.listDirectory, async (_event, dirPath: string) =>
    files.listDirectory(await inWorkspace(dirPath))
  )

  ipcMain.handle(IPC.readTextFile, async (_event, filePath: string) =>
    files.readTextFile(await inWorkspace(filePath))
  )

  ipcMain.handle(
    IPC.writeTextFile,
    async (_event, filePath: string, text: string) =>
      files.writeTextFile(await inWorkspace(filePath), text)
  )

  ipcMain.handle(IPC.createFile, async (_event, dir: string, name: string) =>
    files.createFile(await inWorkspace(dir), name)
  )

  ipcMain.handle(
    IPC.createDirectory,
    async (_event, dir: string, name: string) =>
      files.createDirectory(await inWorkspace(dir), name)
  )

  ipcMain.handle(IPC.renamePath, async (_event, target: string, name: string) =>
    files.renamePath(await inWorkspace(target), name)
  )

  ipcMain.handle(IPC.trashPath, async (_event, target: string) => {
    // The OS trash rather than `unlink`: this is somebody's source file, the
    // studio has no undo of its own, and every desktop already has one.
    await shell.trashItem(await inWorkspace(target))
  })

  ipcMain.handle(IPC.revealPath, async (_event, target: string) => {
    shell.showItemInFolder(await inWorkspace(target))
  })

  ipcMain.handle(IPC.readImageFile, async (_event, filePath: string) =>
    // The same reader the composer's attachments use — including its size
    // ceiling, which is what keeps a 40MP photograph from being turned into a
    // base64 string and posted across the bridge.
    imageDataUrl(await inWorkspace(filePath))
  )

  /*
   * One TypeScript server per workspace folder, started the first time a file
   * in that folder is opened — see `main/tsserver.ts`. It is handed a reader
   * for the folders rather than the store, since where the workspace points is
   * the only thing it needs to know.
   *
   * Every path is checked the same way the reads and writes above are: a hover
   * is a file being sent to a process, which is exactly the kind of call the
   * gate exists for.
   */
  const tsServers = new TsServers(async () =>
    (await store.getWorkspace()).folders.map((folder) => folder.path)
  )

  ipcMain.handle(IPC.tsOpen, async (_event, filePath: string, text: string) =>
    tsServers.open(await inWorkspace(filePath), text)
  )

  ipcMain.handle(IPC.tsChange, async (_event, filePath: string, text: string) =>
    tsServers.change(await inWorkspace(filePath), text)
  )

  ipcMain.handle(IPC.tsClose, async (_event, filePath: string) =>
    tsServers.close(await inWorkspace(filePath))
  )

  ipcMain.handle(
    IPC.tsHover,
    async (_event, filePath: string, line: number, column: number) =>
      tsServers.hover(await inWorkspace(filePath), line, column)
  )

  ipcMain.handle(
    IPC.tsDefinition,
    async (_event, filePath: string, line: number, column: number) =>
      // Definitions are deliberately *not* filtered to the workspace on the way
      // back: a symbol imported from a package is declared under
      // `node_modules`, which is inside the folder, but one from a linked
      // package may not be. The renderer opens what it is given through
      // `readTextFile`, which is checked in its own right — so a definition
      // outside the workspace is a tab that refuses to open rather than a read
      // that slipped through.
      tsServers.definition(await inWorkspace(filePath), line, column)
  )

  ipcMain.handle(IPC.listWorkspaceFiles, async () => {
    const { folders } = await store.getWorkspace()

    // Sequential rather than `Promise.all`, so the budget is shared: two
    // folders walked at once would each take the whole cap and hand back twice
    // what the renderer agreed to hold.
    const found: FileIndexEntry[] = []
    for (const folder of folders) {
      if (found.length >= MAX_INDEXED_FILES) break
      found.push(
        ...(await files.indexFiles(
          folder.path,
          folder.id,
          MAX_INDEXED_FILES - found.length
        ))
      )
    }
    return found
  })

  ipcMain.handle(IPC.getSetting, (_event, key: string) => store.getSetting(key))

  ipcMain.handle(IPC.setSetting, (_event, key: string, value: string) =>
    store.setSetting(key, value)
  )

  ipcMain.handle(IPC.listDatabases, () => store.listDatabases())

  ipcMain.handle(
    IPC.createDatabase,
    async (_event, input: NewDatabaseInput) => {
      if (input.origin === "external") {
        return store.addDatabase({
          id: randomUUID(),
          name: input.name,
          engine: input.engine,
          origin: "external",
          host: input.host,
          port: input.port,
          user: input.user,
          password: input.password,
          database: input.database,
        })
      }

      const status = await docker.check()
      if (!status.available) throw new Error(status.reason)

      const id = randomUUID()
      const credentials = {
        user: DB_USER,
        password: randomDbPassword(),
        database: slugifyDbName(input.name),
      }
      const dataDir = store.databaseDataDir(id)
      // Docker will bind-mount a missing host directory into place on most
      // setups, but not reliably on every one — the workspace's own directory
      // is created the same way before anything is written to it.
      await mkdir(dataDir, { recursive: true })
      const port = await docker.ensureDatabase(
        DEFAULT_WORKSPACE_ID,
        id,
        input.engine,
        dataDir,
        credentials
      )

      return store.addDatabase({
        id,
        name: input.name,
        engine: input.engine,
        origin: "docker",
        host: "127.0.0.1",
        port,
        user: credentials.user,
        password: credentials.password,
        database: credentials.database,
      })
    }
  )

  ipcMain.handle(
    IPC.updateDatabase,
    async (_event, id: string, input: UpdateDatabaseInput) => {
      const record = await store.updateDatabase(id, input)
      // The pool was opened against the old address and credentials; the next
      // query should reach the new ones rather than a connection to something
      // this record no longer describes.
      await sqlConnections.close(id)
      return record
    }
  )

  ipcMain.handle(IPC.deleteDatabase, async (_event, id: string) => {
    await sqlConnections.close(id)
    const database = await store.databaseById(id)
    if (database?.origin === "docker") {
      await docker.removeDatabase(id)
      await rm(store.databaseDataDir(id), { recursive: true, force: true })
    }
    await store.deleteDatabase(id)
  })

  ipcMain.handle(
    IPC.testDatabaseConnection,
    (_event, input: DatabaseConnectionInput) =>
      sqlConnections.testConnection(input)
  )

  ipcMain.handle(
    IPC.dbQuery,
    (_event, databaseId: string, sql: string, params?: unknown[]) =>
      sqlConnections.query(databaseId, sql, params)
  )

  ipcMain.handle(
    IPC.dbExec,
    (
      _event,
      databaseId: string,
      sql: string,
      params?: unknown[],
      options?: { resolveSources?: boolean }
    ) => sqlConnections.exec(databaseId, sql, params, options)
  )

  ipcMain.handle(IPC.dbReset, async (_event, databaseId: string) => {
    const database = await store.databaseById(databaseId)
    if (!database) throw new Error(`Database not found: ${databaseId}`)
    if (database.origin !== "docker") {
      throw new Error("Only a database created here can be reset.")
    }

    await sqlConnections.close(databaseId)
    await docker.removeDatabase(databaseId)
    const dataDir = store.databaseDataDir(databaseId)
    await rm(dataDir, { recursive: true, force: true })
    await mkdir(dataDir, { recursive: true })

    const info = await store.connectionInfoOf(databaseId)
    if (!info) throw new Error(`Database not found: ${databaseId}`)
    const port = await docker.ensureDatabase(
      DEFAULT_WORKSPACE_ID,
      databaseId,
      database.engine,
      dataDir,
      {
        user: info.user,
        password: info.password,
        database: info.database,
      }
    )
    await store.setDatabasePort(databaseId, port)
  })

  ipcMain.handle(
    IPC.startProcess,
    async (_event, folderId: string, command: string, args: string[]) =>
      processes.start(await store.resolveFolderDir(folderId), command, args)
  )

  ipcMain.handle(IPC.stopProcess, (_event, processId: string) => {
    processes.stop(processId)
  })

  ipcMain.handle(IPC.listRequests, () => store.listRequests())

  ipcMain.handle(IPC.saveRequests, (_event, requests: HttpRequestRecord[]) =>
    store.saveRequests(requests)
  )

  ipcMain.handle(IPC.listEnvironments, () => store.listEnvironments())

  ipcMain.handle(
    IPC.saveEnvironments,
    (_event, environments: HttpEnvironment[]) =>
      store.saveEnvironments(environments)
  )

  ipcMain.handle(IPC.listRequestFolders, () => store.listRequestFolders())

  ipcMain.handle(IPC.saveRequestFolders, (_event, folders: HttpFolder[]) =>
    store.saveRequestFolders(folders)
  )

  ipcMain.handle(IPC.listCookies, () => store.listCookies())

  ipcMain.handle(IPC.saveCookies, (_event, cookies: HttpCookie[]) =>
    store.saveCookies(cookies)
  )

  ipcMain.handle(IPC.httpSend, (_event, input: HttpSendInput) =>
    sendHttp(input)
  )

  ipcMain.handle(IPC.listNotes, () => store.listNotes())

  ipcMain.handle(IPC.saveNotes, (_event, notes: NoteRecord[]) =>
    store.saveNotes(notes)
  )

  ipcMain.handle(IPC.listNoteFolders, () => store.listNoteFolders())

  ipcMain.handle(IPC.saveNoteFolders, (_event, folders: NoteFolder[]) =>
    store.saveNoteFolders(folders)
  )

  ipcMain.handle(IPC.readNote, (_event, id: string) => store.readNote(id))

  ipcMain.handle(IPC.writeNote, (_event, id: string, body: NoteBody) =>
    store.writeNote(id, body)
  )

  ipcMain.handle(IPC.deleteNotes, (_event, ids: string[]) =>
    store.deleteNotes(ids)
  )

  ipcMain.handle(IPC.listNoteTemplates, () => store.listNoteTemplates())

  ipcMain.handle(IPC.saveNoteTemplates, (_event, templates: NoteTemplate[]) =>
    store.saveNoteTemplates(templates)
  )

  ipcMain.handle(IPC.readNoteTemplate, (_event, id: string) =>
    store.readNoteTemplate(id)
  )

  ipcMain.handle(IPC.writeNoteTemplate, (_event, id: string, body: NoteBody) =>
    store.writeNoteTemplate(id, body)
  )

  ipcMain.handle(IPC.deleteNoteTemplates, (_event, ids: string[]) =>
    store.deleteNoteTemplates(ids)
  )

  ipcMain.handle(IPC.readDrawing, (_event, id: string) => store.readDrawing(id))

  ipcMain.handle(IPC.writeDrawing, (_event, id: string, scene: string) =>
    store.writeDrawing(id, scene)
  )

  ipcMain.handle(IPC.deleteDrawings, (_event, ids: string[]) =>
    store.deleteDrawings(ids)
  )

  ipcMain.handle(IPC.writeDrawingSvg, (_event, id: string, svg: string) =>
    store.writeDrawingSvg(id, svg)
  )

  ipcMain.handle(IPC.notePreviewUrl, (_event, id: string) => preview.urlOf(id))

  ipcMain.handle(IPC.inboxStart, (_event, port: number) => inbox.start(port))

  ipcMain.handle(IPC.inboxStop, () => inbox.stop())

  ipcMain.handle(IPC.inboxStatus, () => inbox.status())

  ipcMain.handle(IPC.inboxMessages, () => inbox.messages())

  ipcMain.handle(IPC.inboxMarkRead, (_event, id: string) => inbox.markRead(id))

  ipcMain.handle(IPC.inboxDelete, (_event, id: string) => inbox.remove(id))

  ipcMain.handle(IPC.inboxClear, () => inbox.clear())

  ipcMain.handle(IPC.agentTools, () => agentToolStatuses())

  ipcMain.handle(IPC.claudeCommands, async (_event, folderId: string) =>
    claudeSlashCommands(await store.resolveFolderDir(folderId))
  )

  ipcMain.handle(
    IPC.agentInstall,
    (_event, cols: number, rows: number, kind: AgentKind) =>
      // The user's own directory, not a folder's: these install globally, and
      // an installer that writes a lockfile into someone's repository because
      // that is where it happened to run would be a bug of its own.
      terminals.create(
        { cwd: homedir(), command: agentInstallCommand(kind) },
        cols,
        rows
      )
  )

  ipcMain.handle(
    IPC.terminalCreate,
    async (
      _event,
      folderId: string,
      cols: number,
      rows: number,
      kind: AgentKind,
      claudeSessionId?: string
    ) => {
      const cwd = await store.resolveFolderDir(folderId)
      // Read here rather than passed in by the renderer: the composer that
      // sets them and the pane that starts a session are different
      // components, and a session started any other way (a restore, a
      // restart) would otherwise quietly lose the workspace's choice.
      const [model, permissionMode] = await Promise.all([
        store.getSetting(CLAUDE_MODEL_KEY),
        store.getSetting(CLAUDE_PERMISSION_MODE_KEY),
      ])
      // A tab that already has a conversation continues it rather than
      // starting another — which is what makes "Restart to apply" cost the
      // settings change and nothing else. Asked of the file rather than of the
      // caller: an id minted for a session that died before the CLI wrote
      // anything is one `--resume` would reject.
      const resume = claudeSessionId
        ? await hasTranscript(cwd, claudeSessionId)
        : false

      const target = {
        cwd,
        command: agentCommandWith(kind, {
          model: model as ClaudeModel | null,
          permissionMode: permissionMode as ClaudePermissionMode | null,
          claudeSessionId,
          resume,
        }),
      }
      return terminals.create(target, cols, rows)
    }
  )

  ipcMain.handle(
    IPC.terminalWrite,
    (_event, terminalId: string, data: string) =>
      terminals.write(terminalId, data)
  )

  ipcMain.handle(
    IPC.terminalResize,
    (_event, terminalId: string, cols: number, rows: number) =>
      terminals.resize(terminalId, cols, rows)
  )

  ipcMain.handle(IPC.terminalKill, (_event, terminalId: string) =>
    terminals.kill(terminalId)
  )

  ipcMain.handle(
    IPC.transcriptWatch,
    async (
      _event,
      mirrorId: string,
      folderId: string,
      claudeSessionId: string
    ) => {
      const cwd = await store.resolveFolderDir(folderId)
      return transcripts.watch(mirrorId, cwd, claudeSessionId)
    }
  )

  ipcMain.handle(IPC.transcriptUnwatch, (_event, mirrorId: string) =>
    transcripts.unwatch(mirrorId)
  )

  ipcMain.handle(IPC.claudeListSessions, async (_event, folderId: string) =>
    listSessions(await store.resolveFolderDir(folderId))
  )

  ipcMain.handle(IPC.claudeUsageLimits, () => claudeUsageLimits())

  ipcMain.handle(IPC.systemUsage, () => systemUsage())

  return {
    processes,
    sqlConnections,
    docker,
    transcripts,
    terminals,
    inbox,
    preview,
    tsServers,
  }
}
