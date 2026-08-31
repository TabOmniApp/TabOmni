import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from "electron"

import {
  IPC,
  type DesktopApi,
  type DirectoryChange,
  type MenuCommand,
  type ProcessExit,
  type ProcessOutput,
  type ReviewProgressEvent,
  type WorktreeChatEvent,
  type TerminalExit,
  type TerminalOutput,
} from "../shared/api"

/**
 * Subscribes to a main-process event, handing the listener only the payload.
 * The `IpcRendererEvent` is deliberately not passed through: it carries a
 * `sender` the renderer has no business holding.
 */
function subscribe<T>(channel: string, listener: (payload: T) => void) {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.off(channel, handler)
  }
}

const api: DesktopApi = {
  // `process.platform` is one of the few things a sandboxed preload still has.
  platform: process.platform as DesktopApi["platform"],

  getWorkspace: () => ipcRenderer.invoke(IPC.getWorkspace),
  addFolder: (input) => ipcRenderer.invoke(IPC.addFolder, input),
  renameFolder: (id, name) => ipcRenderer.invoke(IPC.renameFolder, id, name),
  removeFolder: (id) => ipcRenderer.invoke(IPC.removeFolder, id),

  pickDirectory: () => ipcRenderer.invoke(IPC.pickDirectory),
  pickImages: () => ipcRenderer.invoke(IPC.pickImages),
  pickFiles: (directory) => ipcRenderer.invoke(IPC.pickFiles, directory),
  // Never leaves this script: `webUtils` only resolves a real path for a
  // `File` from inside the preload's own privileged context.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  readImageDataUrl: (path) => ipcRenderer.invoke(IPC.readImageDataUrl, path),
  clipboardImagePath: () => ipcRenderer.invoke(IPC.clipboardImagePath),

  onMenuCommand: (listener) =>
    subscribe<MenuCommand>(IPC.menuCommand, listener),

  openPanelWindow: (view) => ipcRenderer.invoke(IPC.openPanelWindow, view),

  dockerStatus: () => ipcRenderer.invoke(IPC.dockerStatus),

  listDatabases: () => ipcRenderer.invoke(IPC.listDatabases),
  createDatabase: (input) => ipcRenderer.invoke(IPC.createDatabase, input),
  updateDatabase: (id, input) =>
    ipcRenderer.invoke(IPC.updateDatabase, id, input),
  deleteDatabase: (id) => ipcRenderer.invoke(IPC.deleteDatabase, id),
  testDatabaseConnection: (input) =>
    ipcRenderer.invoke(IPC.testDatabaseConnection, input),

  gitBranch: (folderId) => ipcRenderer.invoke(IPC.gitBranch, folderId),
  gitStatus: (folderId) => ipcRenderer.invoke(IPC.gitStatus, folderId),
  gitChanges: (folderId) => ipcRenderer.invoke(IPC.gitChanges, folderId),
  gitStage: (folderId, paths) =>
    ipcRenderer.invoke(IPC.gitStage, folderId, paths),
  gitUnstage: (folderId, paths) =>
    ipcRenderer.invoke(IPC.gitUnstage, folderId, paths),
  gitDiscard: (folderId, paths) =>
    ipcRenderer.invoke(IPC.gitDiscard, folderId, paths),
  gitDiscardAll: (folderId) => ipcRenderer.invoke(IPC.gitDiscardAll, folderId),
  fileDiff: (filePath) => ipcRenderer.invoke(IPC.fileDiff, filePath),

  listDirectory: (dirPath) => ipcRenderer.invoke(IPC.listDirectory, dirPath),
  readTextFile: (filePath) => ipcRenderer.invoke(IPC.readTextFile, filePath),
  writeTextFile: (filePath, text) =>
    ipcRenderer.invoke(IPC.writeTextFile, filePath, text),
  createFile: (dirPath, name) =>
    ipcRenderer.invoke(IPC.createFile, dirPath, name),
  createDirectory: (dirPath, name) =>
    ipcRenderer.invoke(IPC.createDirectory, dirPath, name),
  renamePath: (target, name) =>
    ipcRenderer.invoke(IPC.renamePath, target, name),
  trashPath: (target) => ipcRenderer.invoke(IPC.trashPath, target),
  revealPath: (target) => ipcRenderer.invoke(IPC.revealPath, target),
  readImageFile: (filePath) => ipcRenderer.invoke(IPC.readImageFile, filePath),
  readImageRelative: (dir, relative) =>
    ipcRenderer.invoke(IPC.readImageRelative, dir, relative),
  listWorkspaceFiles: () => ipcRenderer.invoke(IPC.listWorkspaceFiles),
  watchDirectories: (dirs) => ipcRenderer.invoke(IPC.watchDirectories, dirs),
  onDirectoryChanged: (listener) =>
    subscribe<DirectoryChange>(IPC.directoryChanged, listener),

  tsOpen: (filePath, text) => ipcRenderer.invoke(IPC.tsOpen, filePath, text),
  tsChange: (filePath, text) =>
    ipcRenderer.invoke(IPC.tsChange, filePath, text),
  tsClose: (filePath) => ipcRenderer.invoke(IPC.tsClose, filePath),
  tsHover: (filePath, line, column) =>
    ipcRenderer.invoke(IPC.tsHover, filePath, line, column),
  tsDefinition: (filePath, line, column) =>
    ipcRenderer.invoke(IPC.tsDefinition, filePath, line, column),

  getSetting: (key) => ipcRenderer.invoke(IPC.getSetting, key),
  setSetting: (key, value) => ipcRenderer.invoke(IPC.setSetting, key, value),

  dbQuery: (databaseId, sql, params) =>
    ipcRenderer.invoke(IPC.dbQuery, databaseId, sql, params),
  dbExec: (databaseId, sql, params, options) =>
    ipcRenderer.invoke(IPC.dbExec, databaseId, sql, params, options),
  dbReset: (databaseId) => ipcRenderer.invoke(IPC.dbReset, databaseId),

  listRequests: () => ipcRenderer.invoke(IPC.listRequests),
  saveRequests: (requests) => ipcRenderer.invoke(IPC.saveRequests, requests),
  listEnvironments: () => ipcRenderer.invoke(IPC.listEnvironments),
  saveEnvironments: (environments) =>
    ipcRenderer.invoke(IPC.saveEnvironments, environments),
  listRequestFolders: () => ipcRenderer.invoke(IPC.listRequestFolders),
  saveRequestFolders: (folders) =>
    ipcRenderer.invoke(IPC.saveRequestFolders, folders),
  listCookies: () => ipcRenderer.invoke(IPC.listCookies),
  saveCookies: (cookies) => ipcRenderer.invoke(IPC.saveCookies, cookies),
  httpSend: (input) => ipcRenderer.invoke(IPC.httpSend, input),

  agentModels: () => ipcRenderer.invoke(IPC.agentModels),
  agentCommands: (folderId) => ipcRenderer.invoke(IPC.agentCommands, folderId),
  installedMcpServers: (folderId) =>
    ipcRenderer.invoke(IPC.installedMcpServers, folderId),
  removeMcpServer: (input) => ipcRenderer.invoke(IPC.removeMcpServer, input),
  listClaudeProfiles: () => ipcRenderer.invoke(IPC.listClaudeProfiles),
  saveClaudeProfiles: (profiles) =>
    ipcRenderer.invoke(IPC.saveClaudeProfiles, profiles),
  claudeAccount: (configDir) =>
    ipcRenderer.invoke(IPC.claudeAccount, configDir),
  claudeLogin: (configDir, cols, rows) =>
    ipcRenderer.invoke(IPC.claudeLogin, configDir, cols, rows),
  listWorktreeChats: () => ipcRenderer.invoke(IPC.listWorktreeChats),
  createWorktreeChat: (place, seed) =>
    ipcRenderer.invoke(IPC.createWorktreeChat, place, seed),
  readWorktreeChat: (id) => ipcRenderer.invoke(IPC.readWorktreeChat, id),
  deleteWorktreeChat: (id) => ipcRenderer.invoke(IPC.deleteWorktreeChat, id),
  clearWorktreeChat: (id) => ipcRenderer.invoke(IPC.clearWorktreeChat, id),
  renameWorktreeChat: (id, title) =>
    ipcRenderer.invoke(IPC.renameWorktreeChat, id, title),
  setWorktreeChatOptions: (id, options) =>
    ipcRenderer.invoke(IPC.setWorktreeChatOptions, id, options),
  answerWorktreeChatAsk: (askId, answer) =>
    ipcRenderer.invoke(IPC.answerWorktreeChatAsk, askId, answer),
  sendWorktreeChat: (id, prompt) =>
    ipcRenderer.invoke(IPC.sendWorktreeChat, id, prompt),
  stopWorktreeChat: (id) => ipcRenderer.invoke(IPC.stopWorktreeChat, id),
  onWorktreeChatEvent: (listener) =>
    subscribe<WorktreeChatEvent>(IPC.worktreeChatEvent, listener),
  replyToReviewComment: (cwd, prompt, model, effort, profileId) =>
    ipcRenderer.invoke(
      IPC.replyToReviewComment,
      cwd,
      prompt,
      model,
      effort,
      profileId
    ),
  reviewChanges: (cwd, model, effort, profileId) =>
    ipcRenderer.invoke(IPC.reviewChanges, cwd, model, effort, profileId),
  onReviewProgress: (listener) =>
    subscribe<ReviewProgressEvent>(IPC.reviewProgress, listener),
  listReviewThreads: () => ipcRenderer.invoke(IPC.listReviewThreads),
  saveReviewThreads: (threads) =>
    ipcRenderer.invoke(IPC.saveReviewThreads, threads),
  listBoardCards: () => ipcRenderer.invoke(IPC.listBoardCards),
  saveBoardCards: (cards) => ipcRenderer.invoke(IPC.saveBoardCards, cards),
  listBoardColumns: () => ipcRenderer.invoke(IPC.listBoardColumns),
  saveBoardColumns: (columns) =>
    ipcRenderer.invoke(IPC.saveBoardColumns, columns),

  readDrawing: (id) => ipcRenderer.invoke(IPC.readDrawing, id),
  writeDrawing: (id, scene) => ipcRenderer.invoke(IPC.writeDrawing, id, scene),
  writeDrawingSvg: (id, svg) =>
    ipcRenderer.invoke(IPC.writeDrawingSvg, id, svg),

  writeNoteFile: (fileName, bytes) =>
    ipcRenderer.invoke(IPC.writeNoteFile, fileName, bytes),

  startProcess: (folderId, command, args) =>
    ipcRenderer.invoke(IPC.startProcess, folderId, command, args),
  stopProcess: (processId) => ipcRenderer.invoke(IPC.stopProcess, processId),

  onProcessOutput: (listener) =>
    subscribe<ProcessOutput>(IPC.processOutput, listener),
  onProcessExit: (listener) =>
    subscribe<ProcessExit>(IPC.processExit, listener),

  terminalCreate: (folderId, cols, rows) =>
    ipcRenderer.invoke(IPC.terminalCreate, folderId, cols, rows),
  terminalWrite: (terminalId, data) =>
    ipcRenderer.invoke(IPC.terminalWrite, terminalId, data),
  terminalResize: (terminalId, cols, rows) =>
    ipcRenderer.invoke(IPC.terminalResize, terminalId, cols, rows),
  terminalKill: (terminalId) =>
    ipcRenderer.invoke(IPC.terminalKill, terminalId),

  onTerminalData: (listener) =>
    subscribe<TerminalOutput>(IPC.terminalData, listener),
  onTerminalExit: (listener) =>
    subscribe<TerminalExit>(IPC.terminalExit, listener),

  systemUsage: () => ipcRenderer.invoke(IPC.systemUsage),

  checkForUpdate: () => ipcRenderer.invoke(IPC.checkForUpdate),
  installUpdate: (version) => ipcRenderer.invoke(IPC.installUpdate, version),
}

contextBridge.exposeInMainWorld("desktop", api)
