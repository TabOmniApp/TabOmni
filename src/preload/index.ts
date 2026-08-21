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
  type AssistantEvent,
  type MenuCommand,
  type ProcessExit,
  type ProcessOutput,
  type TerminalExit,
  type TerminalOutput,
  type TranscriptEvent,
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
  // Never leaves this script: `webUtils` only resolves a real path for a
  // `File` from inside the preload's own privileged context.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  readImageDataUrl: (path) => ipcRenderer.invoke(IPC.readImageDataUrl, path),
  clipboardImagePath: () => ipcRenderer.invoke(IPC.clipboardImagePath),

  onMenuCommand: (listener) =>
    subscribe<MenuCommand>(IPC.menuCommand, listener),
  onNotesChanged: (listener) => subscribe<null>(IPC.notesChanged, listener),
  onRequestsChanged: (listener) =>
    subscribe<null>(IPC.requestsChanged, listener),

  assistantSend: (prompt) => ipcRenderer.invoke(IPC.assistantSend, prompt),
  assistantStop: () => ipcRenderer.invoke(IPC.assistantStop),
  assistantChats: () => ipcRenderer.invoke(IPC.assistantChats),
  assistantOpen: (id) => ipcRenderer.invoke(IPC.assistantOpen, id),
  assistantNew: () => ipcRenderer.invoke(IPC.assistantNew),
  assistantDelete: (id) => ipcRenderer.invoke(IPC.assistantDelete, id),
  onAssistantEvent: (listener) =>
    subscribe<AssistantEvent>(IPC.assistantEvent, listener),

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

  listNotes: () => ipcRenderer.invoke(IPC.listNotes),
  saveNotes: (notes) => ipcRenderer.invoke(IPC.saveNotes, notes),
  listNoteFolders: () => ipcRenderer.invoke(IPC.listNoteFolders),
  saveNoteFolders: (folders) =>
    ipcRenderer.invoke(IPC.saveNoteFolders, folders),
  readNote: (id) => ipcRenderer.invoke(IPC.readNote, id),
  writeNote: (id, body) => ipcRenderer.invoke(IPC.writeNote, id, body),
  deleteNotes: (ids) => ipcRenderer.invoke(IPC.deleteNotes, ids),
  notePreviewUrl: (id) => ipcRenderer.invoke(IPC.notePreviewUrl, id),

  readDrawing: (id) => ipcRenderer.invoke(IPC.readDrawing, id),
  writeDrawing: (id, scene) => ipcRenderer.invoke(IPC.writeDrawing, id, scene),
  deleteDrawings: (ids) => ipcRenderer.invoke(IPC.deleteDrawings, ids),
  writeDrawingSvg: (id, svg) =>
    ipcRenderer.invoke(IPC.writeDrawingSvg, id, svg),

  writeNoteFile: (fileName, bytes) =>
    ipcRenderer.invoke(IPC.writeNoteFile, fileName, bytes),
  copyNoteFile: (from, to) => ipcRenderer.invoke(IPC.copyNoteFile, from, to),
  deleteNoteFiles: (fileNames) =>
    ipcRenderer.invoke(IPC.deleteNoteFiles, fileNames),

  startProcess: (folderId, command, args) =>
    ipcRenderer.invoke(IPC.startProcess, folderId, command, args),
  stopProcess: (processId) => ipcRenderer.invoke(IPC.stopProcess, processId),

  onProcessOutput: (listener) =>
    subscribe<ProcessOutput>(IPC.processOutput, listener),
  onProcessExit: (listener) =>
    subscribe<ProcessExit>(IPC.processExit, listener),

  agentTools: () => ipcRenderer.invoke(IPC.agentTools),
  agentInstall: (cols, rows, kind) =>
    ipcRenderer.invoke(IPC.agentInstall, cols, rows, kind),
  claudeCommands: (folderId) =>
    ipcRenderer.invoke(IPC.claudeCommands, folderId),

  terminalCreate: (folderId, cols, rows, kind, claudeSessionId) =>
    ipcRenderer.invoke(
      IPC.terminalCreate,
      folderId,
      cols,
      rows,
      kind,
      claudeSessionId
    ),
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

  transcriptWatch: (mirrorId, folderId, claudeSessionId) =>
    ipcRenderer.invoke(
      IPC.transcriptWatch,
      mirrorId,
      folderId,
      claudeSessionId
    ),
  transcriptUnwatch: (mirrorId) =>
    ipcRenderer.invoke(IPC.transcriptUnwatch, mirrorId),

  onTranscriptEvent: (listener) =>
    subscribe<TranscriptEvent>(IPC.transcriptEvent, listener),

  systemUsage: () => ipcRenderer.invoke(IPC.systemUsage),
}

contextBridge.exposeInMainWorld("desktop", api)
