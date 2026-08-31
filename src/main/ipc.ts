import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  app,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type OpenDialogOptions,
} from "electron"

import {
  IPC,
  isPanelWindowView,
  MCP_DISABLED_TOOLS_KEY,
  type BoardCard,
  type BoardColumn,
  type ChatPlace,
  type ChatSeed,
  type ClaudeProfile,
  type DatabaseConnectionInput,
  type FileDiff,
  type FileIndexEntry,
  type UpdateDatabaseInput,
  type HttpCookie,
  type HttpEnvironment,
  type HttpFolder,
  type HttpRequestRecord,
  type HttpSendInput,
  type NewDatabaseInput,
  type PanelWindowView,
  type ReviewThread,
  type WorktreeChatAnswer,
  type WorktreeChatOptions,
} from "../shared/api"
import { agentCommands } from "./agent-commands"
import { agentModels } from "./agent-models"
import { claudeAccount } from "./claude-auth"
import { WorktreeChats } from "./worktree-chat"
import { SqlConnections } from "./database"
import { DockerRuntime } from "./docker"
import * as files from "./files"
import { MAX_INDEXED_FILES } from "./files"
import {
  changes,
  currentBranch,
  discard,
  discardAll,
  fileAtHead,
  fileDiff,
  stage,
  unstage,
  workingTree,
} from "./git"
import { sendHttp } from "./http"
import { installedMcpServers, removeMcpServer } from "./mcp-servers"
import { ProcessManager } from "./process"
import { reviewChanges, reviewReply } from "./review-agent"
import { expandHome } from "./shell-env"
import { systemUsage } from "./system-usage"
import { DEFAULT_WORKSPACE_ID, Store } from "./store"
import { TerminalManager } from "./terminal"
import { TsServers } from "./tsserver"
import { checkForUpdate, startInstaller } from "./updater"
import { DirectoryWatchers } from "./watch"

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
 * Where `install.sh` puts the app, and so the bundle the updater reopens.
 *
 * Deliberately not this process's own `app.getPath("exe")`: the script installs
 * into `/Applications` whatever directory the running copy was launched from,
 * so reopening where *this* one lives could open the build that was just
 * replaced — or, from a dev run, an Electron binary in `node_modules`.
 */
const APP_DIR = "/Applications/Yasuo.app"

/** The installer, shipped in the bundle (`extraResources`) rather than fetched:
 * a button that runs a script downloaded at the moment it is pressed is a
 * different thing to agree to than one that runs the app's own. */
function installerScript(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "install.sh")
    : path.join(app.getAppPath(), "install.sh")
}

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
 * `tmpdir()` rather than anywhere under `~/.yasuo`: this is a scratch copy of
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

  const file = path.join(tmpdir(), `yasuo-paste-${Date.now()}.png`)
  await writeFile(file, image.toPNG())
  return file
}

/**
 * Wires every renderer-callable method onto `ipcMain`.
 *
 * Handlers are registered once for the whole app rather than per window, and
 * process output is sent to the **studio** window — the one `getWindow`
 * answers with. A panel window (`openPanelWindow`) can call every handler here,
 * since a call and its answer go back to whoever made it, but no push event is
 * sent to it: nothing the Database or API panel draws arrives that way. A
 * window that needed one would need its own manager, which is why these
 * deliberately do not.
 */
export function registerIpc(
  getWindow: () => BrowserWindow | null,
  openPanelWindow: (view: PanelWindowView) => void
): {
  processes: ProcessManager
  /** Exposed so a turn in flight can be killed on quit. */
  worktreeChats: WorktreeChats
  sqlConnections: SqlConnections
  docker: DockerRuntime
  terminals: TerminalManager
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

  /**
   * Settings › MCP's switched-off tools.
   *
   * A malformed or absent setting reads as "nothing switched off" rather than
   * throwing: this decides what a turn may call, and a parse error is not a
   * reason to refuse every MCP tool the user has — nor to refuse none silently,
   * which is why it is logged.
   *
   * Hoisted out of the source object below because a review reply needs the same
   * list (`review-agent.ts`): a tool the workspace turned off has no business
   * being in that model's list either.
   */
  const disabledTools = async (): Promise<string[]> => {
    const raw = await store.getSetting(MCP_DISABLED_TOOLS_KEY)
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string")
        : []
    } catch (error) {
      console.error(`Could not read ${MCP_DISABLED_TOOLS_KEY}`, error)
      return []
    }
  }

  /**
   * A picked `profileId` as a `CLAUDE_CONFIG_DIR`, for a review turn.
   *
   * The same resolve `worktree-chat.ts` does at send time (`profileConfigDir`
   * there), asked here instead because a review reply and a whole-diff review
   * have no chat and no `WorktreeChats` record to resolve it on. Looked up by id
   * rather than trusted from the renderer, same reason: a profile can be
   * renamed or deleted between the picker being drawn and the button being
   * pressed.
   */
  const configDirOf = async (
    profileId: string | null
  ): Promise<string | null> => {
    if (!profileId) return null
    const profile = (await store.listClaudeProfiles()).find(
      (entry) => entry.id === profileId
    )
    return profile ? expandHome(profile.configDir) : null
  }

  /*
   * A project's chats: one agent turn at a time, in that project's directory.
   *
   * The larger of the two `claude`s this app spawns, and the only one that is a
   * conversation. What the old "no second one" rule was about is still refused —
   * a feature calling the CLI as a helper, an AI filter or an import button —
   * because a helper turn is a turn nobody asked for. `replyToReviewComment`
   * below is the one turn beside these, and it is not one of those either: it is
   * a button on a comment, pressed by the person who wrote it. See the top of
   * `review-agent.ts`.
   */
  const worktreeChats = new WorktreeChats(
    {
      // Null rather than a throw for a folder that has left the workspace: the
      // caller turns "nowhere to run" into a line in the chat, and one path
      // through that is easier to be sure of than two.
      folderDir: (folderId) =>
        store.resolveFolderDir(folderId).catch(() => null),
      // Asked per turn rather than held — Settings can add, rename or delete a
      // profile between two messages in the same chat. The same is true of
      // `disabledTools`, which is why both are functions rather than lists.
      claudeProfiles: () => store.listClaudeProfiles(),
      disabledTools,
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

  /*
   * The slash commands that `claude` has, asked in a project's directory — see
   * `agent-commands.ts`. The directory is resolved here for the reason every
   * other `folderId` call resolves it here: a project is an id in the manifest,
   * and the path behind it is the store's to say.
   */
  ipcMain.handle(IPC.agentCommands, async (_event, folderId: unknown) =>
    agentCommands(await folderDirOf(folderId))
  )

  /*
   * The MCP servers that same `claude` has, asked in a project's directory —
   * see `mcp-servers.ts`.
   *
   * The directory is resolved here rather than in the renderer for the reason
   * every other `folderId` call is: a project is an id in the manifest, and the
   * path behind it is the store's to say. A project that has left the workspace
   * reads as null, which asks in the user's home directory — the user-scope
   * servers and nothing repository-specific, which is the honest answer for a
   * project that is no longer there.
   */
  ipcMain.handle(IPC.installedMcpServers, async (_event, folderId: unknown) =>
    installedMcpServers(await folderDirOf(folderId))
  )

  // The CLI's own `mcp remove`, in the same directory the listing was asked in —
  // a `project`-scope server is in that repository's file and nowhere else. The
  // renderer confirms first and re-asks for the listing afterwards; this only
  // does it, and lets the CLI's own error through.
  ipcMain.handle(
    IPC.removeMcpServer,
    async (
      _event,
      input: { name: string; scope: string | null; folderId: string | null }
    ) =>
      removeMcpServer({
        name: input.name,
        scope: input.scope,
        cwd: await folderDirOf(input.folderId),
      })
  )

  /** A project's directory, or null for one that has left the workspace —
   * shared by the two MCP handlers above, which both run `claude` somewhere. */
  async function folderDirOf(folderId: unknown): Promise<string | null> {
    return typeof folderId === "string"
      ? await store.resolveFolderDir(folderId).catch(() => null)
      : null
  }

  ipcMain.handle(IPC.listClaudeProfiles, () => store.listClaudeProfiles())

  ipcMain.handle(IPC.saveClaudeProfiles, (_event, profiles: ClaudeProfile[]) =>
    // `~` expanded here, like `addFolder`'s path field: the SDK spawns
    // `claude` directly rather than through a shell, so nothing else would
    // ever turn a typed `~/.claude-group/hung` into an absolute path before
    // it became `CLAUDE_CONFIG_DIR` — and a literal `~` in that variable is a
    // directory named `~` relative to the turn's cwd, not the user's home.
    store.saveClaudeProfiles(
      profiles.map((profile) => ({
        ...profile,
        configDir: expandHome(profile.configDir),
      }))
    )
  )

  ipcMain.handle(IPC.claudeAccount, (_event, configDir: string) =>
    claudeAccount(configDir)
  )

  ipcMain.handle(IPC.listWorktreeChats, () => worktreeChats.list())

  ipcMain.handle(
    IPC.createWorktreeChat,
    (_event, place: ChatPlace, seed?: ChatSeed) =>
      worktreeChats.create(place, seed)
  )

  ipcMain.handle(IPC.readWorktreeChat, (_event, id: string) =>
    worktreeChats.read(id)
  )

  ipcMain.handle(IPC.deleteWorktreeChat, (_event, id: string) =>
    worktreeChats.delete(id)
  )

  ipcMain.handle(IPC.clearWorktreeChat, (_event, id: string) =>
    worktreeChats.clear(id)
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

  /*
   * One review comment answered, in the checkout it is about.
   *
   * Not `worktreeChats`', and not a chat — see the top of `review-agent.ts` for
   * why a second `claude` is allowed to exist here at all, and why it is not a
   * method on that class.
   *
   * `model`, `effort` and `profileId` are picked from a toolbar of their own in
   * the review pane, mirroring a chat's — see `WorktreeChatOptions` and
   * `configDirOf` above for the profile's resolve.
   */
  ipcMain.handle(
    IPC.replyToReviewComment,
    async (
      _event,
      cwd: string,
      prompt: string,
      model: string | null,
      effort: string | null,
      profileId: string | null
    ) =>
      reviewReply({
        cwd,
        prompt,
        model,
        effort,
        configDir: await configDirOf(profileId),
        disabledTools: await disabledTools(),
      })
  )

  /** The account a Docker-managed database is created with. */
  const DB_USER = "yasuo"

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

  // Checked rather than trusted, and returning nothing on purpose: the window
  // is main's, a handle to it is no use to the renderer, and the string that
  // arrives names a window this process is about to open.
  ipcMain.handle(IPC.openPanelWindow, (_event, view: unknown) => {
    if (!isPanelWindowView(view)) throw new Error(`Unknown panel: ${view}`)
    openPanelWindow(view)
  })

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

  /*
   * The Changes list's three writes.
   *
   * Two gates, not one, and neither is redundant. `inWorkspace` is the same
   * check the eight `files:*` handlers pass through — an absolute path from the
   * renderer can name anything on the machine — and `git.ts` then refuses
   * anything that is not under the folder it was handed, so a path inside
   * *another* of the workspace's folders cannot be staged into this one's
   * repository.
   *
   * What comes back from a discard is the paths git had nothing to restore —
   * new files — and those are trashed here rather than in `git.ts`, which stays
   * free of `electron` so the tests can import it.
   */
  ipcMain.handle(
    IPC.gitStage,
    async (_event, folderId: string, paths: string[]) =>
      stage(
        await store.resolveFolderDir(folderId),
        await Promise.all(paths.map(inWorkspace))
      )
  )

  ipcMain.handle(
    IPC.gitUnstage,
    async (_event, folderId: string, paths: string[]) =>
      unstage(
        await store.resolveFolderDir(folderId),
        await Promise.all(paths.map(inWorkspace))
      )
  )

  ipcMain.handle(
    IPC.gitDiscard,
    async (_event, folderId: string, paths: string[]) => {
      const trash = await discard(
        await store.resolveFolderDir(folderId),
        await Promise.all(paths.map(inWorkspace))
      )
      await trashAll(trash)
    }
  )

  ipcMain.handle(IPC.gitDiscardAll, async (_event, folderId: string) => {
    await trashAll(await discardAll(await store.resolveFolderDir(folderId)))
  })

  /**
   * The new files a discard could not restore, moved to the trash.
   *
   * One at a time and each failure swallowed: `shell.trashItem` refuses on a
   * volume with no trash, and a discard that restored eleven files and then
   * threw on the twelfth would leave the list saying nothing about the ten it
   * did. The row that is still there afterwards is the report.
   */
  async function trashAll(paths: string[]): Promise<void> {
    for (const target of paths) {
      await shell.trashItem(target).catch((error: unknown) => {
        console.error(`Could not trash ${target}`, error)
      })
    }
  }

  /**
   * The committed side of a diff, and git's own patch for it.
   *
   * Through the same gate as every other read of a file, and then run in the
   * root that holds it: `HEAD:` is a path in one repository, so the folder the
   * path lives under is the one to ask.
   *
   * The two run together rather than one after the other — they are two
   * independent `git` processes and the pane waits for both before it draws
   * anything, so serialising them would be a second round trip's wait for the
   * same paint.
   */
  ipcMain.handle(
    IPC.fileDiff,
    async (_event, filePath: string): Promise<FileDiff> => {
      const target = await inWorkspace(filePath)
      const roots = await fileRoots()

      // The narrowest root that holds it, since one folder can be added inside
      // another — the same rule `rootOf` follows in the renderer.
      const root = roots
        .filter((candidate) => files.insideAny([candidate.path], target))
        .sort((a, b) => b.path.length - a.path.length)[0]
      if (!root) return { head: null, patch: null }

      const [head, patch] = await Promise.all([
        fileAtHead(root.path, target),
        fileDiff(root.path, target),
      ])
      return { head, patch }
    }
  )

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

  /*
   * The whole diff, reviewed in one turn — the same `claude` a comment's reply
   * runs on, told to look at everything rather than at one remark. See
   * `review-agent.ts`; the argument for a second CLI covers both. `model`,
   * `effort` and `profileId` are the same three `replyToReviewComment` takes.
   */
  ipcMain.handle(
    IPC.reviewChanges,
    async (
      _event,
      cwd: string,
      model: string | null,
      effort: string | null,
      profileId: string | null
    ) =>
      reviewChanges({
        cwd,
        model,
        effort,
        configDir: await configDirOf(profileId),
        disabledTools: await disabledTools(),
        onProgress: (text) => send(IPC.reviewProgress, { text }),
      })
  )

  ipcMain.handle(IPC.listReviewThreads, () => store.listReviewThreads())

  ipcMain.handle(IPC.saveReviewThreads, (_event, threads: ReviewThread[]) =>
    store.saveReviewThreads(threads)
  )

  ipcMain.handle(IPC.listBoardCards, () => store.listBoardCards())

  ipcMain.handle(IPC.saveBoardCards, (_event, cards: BoardCard[]) =>
    store.saveBoardCards(cards)
  )

  ipcMain.handle(IPC.listBoardColumns, () => store.listBoardColumns())

  ipcMain.handle(IPC.saveBoardColumns, (_event, columns: BoardColumn[]) =>
    store.saveBoardColumns(columns)
  )

  ipcMain.handle(IPC.readDrawing, (_event, id: string) => store.readDrawing(id))

  ipcMain.handle(IPC.writeDrawing, (_event, id: string, scene: string) =>
    store.writeDrawing(id, scene)
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

  ipcMain.handle(IPC.checkForUpdate, () =>
    checkForUpdate(app.getVersion(), process.platform)
  )

  ipcMain.handle(IPC.installUpdate, async (_event, version: string) => {
    if (process.platform !== "darwin") {
      throw new Error(
        "install.sh is a macOS script — open the release page instead."
      )
    }
    // A version reaching a command line, from the renderer, off the network:
    // checked here rather than trusted, even though the only thing that ever
    // sends one is the answer `checkForUpdate` just gave.
    if (!/^[0-9A-Za-z.+-]{1,64}$/.test(version)) {
      throw new Error(`Not a version: ${version}`)
    }
    await startInstaller({
      script: installerScript(),
      version,
      appPath: APP_DIR,
    })
  })

  return {
    processes,
    worktreeChats,
    sqlConnections,
    docker,
    terminals,
    tsServers,
    watchers,
    /** For the `note-file://` handler, which is not an IPC call and so cannot
     * reach the store any other way — see `serveNoteFiles`. */
    noteFilePath: (fileName: string) => store.noteFilePath(fileName),
  }
}
