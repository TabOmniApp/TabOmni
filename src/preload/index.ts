import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from "electron"

import {
  IPC,
  type DesktopApi,
  type InboxEvent,
  type InboxStatusEvent,
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

  dockerStatus: () => ipcRenderer.invoke(IPC.dockerStatus),

  aiFilter: (request, columns) =>
    ipcRenderer.invoke(IPC.aiFilter, request, columns),
  aiImportApi: (folderId) => ipcRenderer.invoke(IPC.aiImportApi, folderId),
  listDatabases: () => ipcRenderer.invoke(IPC.listDatabases),
  createDatabase: (input) => ipcRenderer.invoke(IPC.createDatabase, input),
  updateDatabase: (id, input) =>
    ipcRenderer.invoke(IPC.updateDatabase, id, input),
  deleteDatabase: (id) => ipcRenderer.invoke(IPC.deleteDatabase, id),
  testDatabaseConnection: (input) =>
    ipcRenderer.invoke(IPC.testDatabaseConnection, input),

  gitBranch: (folderId) => ipcRenderer.invoke(IPC.gitBranch, folderId),

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
  writeNote: (id, markdown) => ipcRenderer.invoke(IPC.writeNote, id, markdown),
  deleteNotes: (ids) => ipcRenderer.invoke(IPC.deleteNotes, ids),

  readDrawing: (id) => ipcRenderer.invoke(IPC.readDrawing, id),
  writeDrawing: (id, scene) => ipcRenderer.invoke(IPC.writeDrawing, id, scene),
  deleteDrawings: (ids) => ipcRenderer.invoke(IPC.deleteDrawings, ids),

  inboxStart: (server, port) =>
    ipcRenderer.invoke(IPC.inboxStart, server, port),
  inboxStop: (server) => ipcRenderer.invoke(IPC.inboxStop, server),
  inboxStatus: () => ipcRenderer.invoke(IPC.inboxStatus),
  inboxMessages: () => ipcRenderer.invoke(IPC.inboxMessages),
  inboxMarkRead: (id) => ipcRenderer.invoke(IPC.inboxMarkRead, id),
  inboxDelete: (id) => ipcRenderer.invoke(IPC.inboxDelete, id),
  inboxClear: (server) => ipcRenderer.invoke(IPC.inboxClear, server),
  inboxReplay: (id, url) => ipcRenderer.invoke(IPC.inboxReplay, id, url),

  onInboxMessage: (listener) =>
    subscribe<InboxEvent>(IPC.inboxMessage, listener),
  onInboxStatus: (listener) =>
    subscribe<InboxStatusEvent>(IPC.inboxStatusChanged, listener),

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
  claudeListSessions: (folderId) =>
    ipcRenderer.invoke(IPC.claudeListSessions, folderId),
  claudeUsageLimits: () => ipcRenderer.invoke(IPC.claudeUsageLimits),

  onTranscriptEvent: (listener) =>
    subscribe<TranscriptEvent>(IPC.transcriptEvent, listener),

  systemUsage: () => ipcRenderer.invoke(IPC.systemUsage),
}

contextBridge.exposeInMainWorld("desktop", api)
