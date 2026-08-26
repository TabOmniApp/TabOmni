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
  HTTP_ENVIRONMENT_KEY,
  IPC,
  MCP_SETTING_KEYS,
  type ChatPlace,
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
  type WorktreeChatAnswer,
  type WorktreeChatOptions,
} from "../shared/api"
import { descendantFolderIds } from "../shared/tree"
import { agentModels } from "./agent-models"
import { WorktreeChats } from "./worktree-chat"
import { SqlConnections } from "./database"
import { DockerRuntime } from "./docker"
import * as files from "./files"
import { MAX_INDEXED_FILES } from "./files"
import { changes, currentBranch, fileAtHead, workingTree } from "./git"
import { sendHttp } from "./http"
import { McpServers } from "./mcp"
import { NotePreview } from "./preview"
import { ProcessManager } from "./process"
import { systemUsage } from "./system-usage"
import { DEFAULT_WORKSPACE_ID, Store } from "./store"
import { TerminalManager } from "./terminal"
import { TsServers } from "./tsserver"
import { DirectoryWatchers } from "./watch"

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
  /** Exposed so a turn in flight can be killed on quit. */
  worktreeChats: WorktreeChats
  sqlConnections: SqlConnections
  docker: DockerRuntime
  terminals: TerminalManager
  preview: NotePreview
  mcp: McpServers
  tsServers: TsServers
  watchers: DirectoryWatchers
  noteFilePath: (fileName: string) => string
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

  // Reads the workspace's own files and nothing else — the preview is a view
  // of what is on disk, so it is handed the four reads it needs rather than
  // the store.
  const preview = new NotePreview({
    notes: () => store.listNotes(),
    folders: () => store.listNoteFolders(),
    body: (id) => store.readNote(id),
    drawingSvg: (id) => store.readDrawingSvg(id),
    // Which of these two a file goes through — inlined into the page, or served
    // on a request of its own — is the preview's decision, not this file's.
    noteFile: (name) => store.readNoteFile(name),
    hasNoteFile: (name) => store.hasNoteFile(name),
  })

  /**
   * The workspace as tools, for an agent session started here.
   *
   * Assembled from the same `store` and the same `sqlConnections` the panels
   * are served from — an agent reads what the window reads, not a copy — and
   * every reach is spelled out here rather than the store being handed over
   * whole, the way the note preview's is.
   */
  const mcp = new McpServers({
    enabled: async (server) =>
      (await store.getSetting(MCP_SETTING_KEYS[server])) === "true",

    databases: () => store.listDatabases(),
    query: (databaseId, sql, params) =>
      sqlConnections.query(databaseId, sql, params),

    requests: () => store.listRequests(),
    requestFolders: () => store.listRequestFolders(),
    environments: () => store.listEnvironments(),
    activeEnvironmentId: async () =>
      (await store.getSetting(HTTP_ENVIRONMENT_KEY)) || null,
    send: (input) => sendHttp(input),
    // Written here rather than in `mcp.ts` for the same reason `createNote` is:
    // the id and the timestamps are the store's to mint, and this is the file
    // that already knows the panel has to be told (`http:changed`). The panel
    // saves the whole collection at once, so a window that never re-read would
    // write its stale list back over this the next time anything was edited.
    createRequest: async (fields) => {
      const now = new Date().toISOString()
      const request: HttpRequestRecord = {
        id: randomUUID(),
        ...fields,
        createdAt: now,
        updatedAt: now,
      }
      await store.saveRequests([...(await store.listRequests()), request])
      send(IPC.requestsChanged, null)
      return request
    },
    updateRequest: async (id, patch) => {
      // Read again rather than patching what the tool call had: the panel may
      // have saved over the collection since the agent listed it.
      const requests = await store.listRequests()
      const existing = requests.find((record) => record.id === id)
      if (!existing) {
        throw new Error("That request is not in this workspace any more.")
      }
      const updated: HttpRequestRecord = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      }
      await store.saveRequests(
        requests.map((record) => (record.id === id ? updated : record))
      )
      send(IPC.requestsChanged, null)
      return updated
    },
    deleteRequest: async (id) => {
      const requests = await store.listRequests()
      if (!requests.some((record) => record.id === id)) {
        throw new Error("That request is not in this workspace any more.")
      }
      await store.saveRequests(requests.filter((record) => record.id !== id))
      // The panel has to hear about this one even more than about a write: a
      // tab onto a request that is gone is a tab that can draw nothing.
      send(IPC.requestsChanged, null)
    },
    createFolder: async (fields) => {
      const now = new Date().toISOString()
      const folder: HttpFolder = {
        id: randomUUID(),
        ...fields,
        createdAt: now,
        updatedAt: now,
      }
      await store.saveRequestFolders([
        ...(await store.listRequestFolders()),
        folder,
      ])
      send(IPC.requestsChanged, null)
      return folder
    },
    updateFolder: async (id, patch) => {
      const folders = await store.listRequestFolders()
      const existing = folders.find((record) => record.id === id)
      if (!existing) {
        throw new Error("That folder is not in this workspace any more.")
      }
      const updated: HttpFolder = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      }
      await store.saveRequestFolders(
        folders.map((record) => (record.id === id ? updated : record))
      )
      send(IPC.requestsChanged, null)
      return updated
    },
    // The same cascade the panel's own delete makes, from the same function
    // (`@shared/tree`): a folder takes its subfolders and their requests with
    // it, and what the panel counts up in its confirmation dialog is what an
    // agent deleting one has to report.
    deleteFolder: async (id) => {
      const folders = await store.listRequestFolders()
      if (!folders.some((record) => record.id === id)) {
        throw new Error("That folder is not in this workspace any more.")
      }
      const gone = descendantFolderIds(id, folders)
      const requests = await store.listRequests()
      const orphaned = requests.filter((request) =>
        gone.has(request.folderId ?? "")
      )

      await store.saveRequestFolders(
        folders.filter((record) => !gone.has(record.id))
      )
      if (orphaned.length > 0) {
        await store.saveRequests(
          requests.filter((request) => !gone.has(request.folderId ?? ""))
        )
      }
      send(IPC.requestsChanged, null)
      return { folders: gone.size, requests: orphaned.length }
    },

    notes: () => store.listNotes(),
    noteFolders: () => store.listNoteFolders(),
    noteBody: (id) => store.readNote(id),
    // Written as markdown rather than as the editor's block model: converting
    // markdown into blocks needs the parser only the renderer has, and the
    // store already hands a markdown body over as it found it — the editor
    // converts it on first open, exactly as it does for a note written by an
    // older build.
    createNote: async ({ name, folderId, markdown }) => {
      const now = new Date().toISOString()
      const note: NoteRecord = {
        id: randomUUID(),
        name: name || "Untitled",
        folderId,
        createdAt: now,
        updatedAt: now,
      }
      await store.writeNote(note.id, { format: "markdown", text: markdown })
      await store.saveNotes([...(await store.listNotes()), note])
      // The Notes panel is holding the listing it read at launch, so a note
      // that appeared underneath it has to be announced or it stays invisible
      // until the next run.
      send(IPC.notesChanged, null)
      return note
    },
  })

  /*
   * A project's chats: one agent turn at a time, in that project's directory.
   *
   * The only `claude` this app spawns. What the old "no second one" rule was
   * about is still refused — a feature calling the CLI as a helper, an AI filter
   * or an import button — because a helper turn is a turn nobody asked for. This
   * is a conversation somebody is having.
   */
  const worktreeChats = new WorktreeChats(
    {
      // The file this app's own three servers are written to, or null when
      // none of them are switched on. No `--strict-mcp-config` goes with it —
      // see the class comment on `WorktreeChats` for why — so the CLI merges
      // it with whatever it would already have found on its own.
      mcpConfig: () => mcp.configPath(),
      // Null rather than a throw for a folder that has left the workspace: the
      // caller turns "nowhere to run" into a line in the chat, and one path
      // through that is easier to be sure of than two.
      folderDir: (folderId) =>
        store.resolveFolderDir(folderId).catch(() => null),
      chats: () => store.listWorktreeChats(),
      saveChats: (chats) => store.saveWorktreeChats(chats),
      readChat: (id) => store.readWorktreeChat(id),
      writeChat: (id, messages) => store.writeWorktreeChat(id, messages),
      deleteChat: (id) => store.deleteWorktreeChat(id),
    },
    (event) => send(IPC.worktreeChatEvent, event)
  )

  // Asked of the user's own `claude` and held for the run — see
  // `agent-models.ts`. Not a handler that touches any of the managers above,
  // which is why it takes no argument and keeps no state here.
  ipcMain.handle(IPC.agentModels, () => agentModels())
  ipcMain.handle(IPC.listWorktreeChats, () => worktreeChats.list())

  ipcMain.handle(IPC.createWorktreeChat, (_event, place: ChatPlace) =>
    worktreeChats.create(place)
  )

  ipcMain.handle(IPC.readWorktreeChat, (_event, id: string) =>
    worktreeChats.read(id)
  )

  ipcMain.handle(IPC.deleteWorktreeChat, (_event, id: string) =>
    worktreeChats.delete(id)
  )

  ipcMain.handle(IPC.renameWorktreeChat, (_event, id: string, title: string) =>
    worktreeChats.rename(id, title)
  )

  ipcMain.handle(
    IPC.setWorktreeChatOptions,
    (_event, id: string, options: WorktreeChatOptions) =>
      worktreeChats.setOptions(id, options)
  )

  ipcMain.handle(
    IPC.answerWorktreeChatAsk,
    (_event, askId: string, answer: WorktreeChatAnswer) => {
      worktreeChats.answer(askId, answer)
    }
  )

  ipcMain.handle(IPC.sendWorktreeChat, (_event, id: string, prompt: string) =>
    worktreeChats.send(id, prompt)
  )

  ipcMain.handle(IPC.stopWorktreeChat, (_event, id: string) => {
    worktreeChats.stop(id)
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

  ipcMain.handle(IPC.pickFiles, async (_event, directory?: string) => {
    const options: OpenDialogOptions = {
      title: "Attach files",
      properties: ["openFile", "multiSelections"],
      // Where it opens, not what it may return: the paths come back from the
      // user's own click, and reading one is still an ordinary `files:*` call
      // through `insideAny`.
      ...(directory ? { defaultPath: expandHome(directory) } : {}),
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

  ipcMain.handle(IPC.gitStatus, async (_event, folderId: string) =>
    workingTree(await store.resolveFolderDir(folderId))
  )

  ipcMain.handle(IPC.gitChanges, async (_event, folderId: string) =>
    changes(await store.resolveFolderDir(folderId))
  )

  /**
   * The committed side of a diff.
   *
   * Through the same gate as every other read of a file, and then run in the
   * root that holds it: `HEAD:` is a path in one repository, so the folder the
   * path lives under is the one to ask.
   */
  ipcMain.handle(IPC.fileAtHead, async (_event, filePath: string) => {
    const target = await inWorkspace(filePath)
    const roots = await fileRoots()

    // The narrowest root that holds it, since one folder can be added inside
    // another — the same rule `rootOf` follows in the renderer.
    const root = roots
      .filter((candidate) => files.insideAny([candidate.path], target))
      .sort((a, b) => b.path.length - a.path.length)[0]
    if (!root) return null

    return fileAtHead(root.path, target)
  })

  /**
   * Every directory the Explorer may read: the workspace's folders.
   *
   * Read fresh on every call, like the workspace itself: a folder removed
   * between one read and the next has to stop being readable at once.
   *
   * Still its own function rather than a `getWorkspace()` at each call site
   * because it is the one list four things are answered from — the gate below,
   * the watchers, the palette's walk and the tsservers.
   */
  async function fileRoots(): Promise<{ path: string; folderId: string }[]> {
    const { folders } = await store.getWorkspace()
    return folders.map((folder) => ({ path: folder.path, folderId: folder.id }))
  }

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
    if (
      !files.insideAny(
        (await fileRoots()).map((root) => root.path),
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

  ipcMain.handle(
    IPC.readImageRelative,
    async (_event, dir: string, relative: string) =>
      // The markdown preview's local pictures: `./logo.png` resolved against
      // the document's own directory — the renderer never joins paths — and
      // read under the same ceiling and the same folders' gate as any other
      // file the studio shows.
      imageDataUrl(await inWorkspace(path.resolve(dir, relative)))
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
  // One server per root, since a root has its own `node_modules` and
  // `tsconfig.json` and resolving one folder's imports against another's copy
  // is how a hover ends up pointing at the wrong source. `serverFor` takes the
  // longest match, and each server is started only when a file in it is opened.
  const tsServers = new TsServers(async () =>
    (await fileRoots()).map((root) => root.path)
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

  /*
   * The tree follows the disk while it is open — see `main/watch.ts` for why
   * this watches the expanded directories and nothing above or below them.
   */
  const watchers = new DirectoryWatchers((dir) =>
    send(IPC.directoryChanged, { dir })
  )

  ipcMain.handle(IPC.watchDirectories, async (_event, dirs: string[]) => {
    const roots = (await fileRoots()).map((root) => root.path)
    watchers.set([
      // Filtered rather than refused: this call carries a whole set, and one
      // directory belonging to a folder removed while the message was in
      // flight would otherwise cost the tree every other watcher it asked for.
      ...dirs.filter((dir) => files.insideAny(roots, dir)),
      // Each root's own `.git`, whatever the renderer asked for. A commit or a
      // checkout in the dock's shell changes the colour of every row and the
      // branch beside the folder, while touching no directory the tree is
      // watching. Added here rather than sent from the renderer because this
      // side is the one that joins a name to a path.
      ...roots.map((root) => path.join(root, ".git")),
    ])
  })

  ipcMain.handle(IPC.listWorkspaceFiles, async () => {
    // Sequential rather than `Promise.all`, so the budget is shared: two roots
    // walked at once would each take the whole cap and hand back twice what
    // the renderer agreed to hold.
    const found: FileIndexEntry[] = []
    for (const root of await fileRoots()) {
      if (found.length >= MAX_INDEXED_FILES) break
      found.push(
        ...(await files.indexFiles(
          root.path,
          root.folderId,
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

  ipcMain.handle(
    IPC.writeNoteFile,
    // A `Uint8Array` on the way in whatever the renderer built it from: an
    // `ArrayBuffer` survives structured clone as one, and writing it as-is
    // would put the string "[object ArrayBuffer]" in the file.
    (_event, fileName: string, bytes: Uint8Array | ArrayBuffer) =>
      store.writeNoteFile(
        fileName,
        bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      )
  )

  ipcMain.handle(IPC.copyNoteFile, (_event, from: string, to: string) =>
    store.copyNoteFile(from, to)
  )

  ipcMain.handle(IPC.deleteNoteFiles, (_event, fileNames: string[]) =>
    store.deleteNoteFiles(fileNames)
  )

  ipcMain.handle(IPC.notePreviewUrl, (_event, id: string) => preview.urlOf(id))

  ipcMain.handle(
    IPC.terminalCreate,
    async (_event, folderId: string, cols: number, rows: number) => {
      const cwd = await store.resolveFolderDir(folderId)
      // No command: the user's own login shell, which is the only thing a pty
      // is started for now. The agent CLIs used to be started here too, with
      // their flags built alongside — what runs one is the agent SDK in
      // `worktree-chat.ts`, which spawns its own process and needs no pty.
      return terminals.create({ cwd }, cols, rows)
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

  ipcMain.handle(IPC.systemUsage, () => systemUsage())

  return {
    processes,
    worktreeChats,
    sqlConnections,
    mcp,
    docker,
    terminals,
    preview,
    tsServers,
    watchers,
    /** For the `note-file://` handler, which is not an IPC call and so cannot
     * reach the store any other way — see `serveNoteFiles`. */
    noteFilePath: (fileName: string) => store.noteFilePath(fileName),
  }
}
