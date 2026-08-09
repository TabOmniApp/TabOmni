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

  listProjects: () => ipcRenderer.invoke(IPC.listProjects),
  renameProject: (id, name) => ipcRenderer.invoke(IPC.renameProject, id, name),
  deleteProject: (id) => ipcRenderer.invoke(IPC.deleteProject, id),

  pickDirectory: () => ipcRenderer.invoke(IPC.pickDirectory),
  pickImages: () => ipcRenderer.invoke(IPC.pickImages),
  // Never leaves this script: `webUtils` only resolves a real path for a
  // `File` from inside the preload's own privileged context.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  readImageDataUrl: (path) => ipcRenderer.invoke(IPC.readImageDataUrl, path),
  importProject: (input) => ipcRenderer.invoke(IPC.importProject, input),

  onMenuCommand: (listener) =>
    subscribe<MenuCommand>(IPC.menuCommand, listener),
  setMenuState: (state) => ipcRenderer.invoke(IPC.menuState, state),

  dockerStatus: () => ipcRenderer.invoke(IPC.dockerStatus),

  aiFilter: (projectId, request, columns) =>
    ipcRenderer.invoke(IPC.aiFilter, projectId, request, columns),
  aiImportApi: (projectId) => ipcRenderer.invoke(IPC.aiImportApi, projectId),
  listDatabases: (projectId) =>
    ipcRenderer.invoke(IPC.listDatabases, projectId),
  createDatabase: (input) => ipcRenderer.invoke(IPC.createDatabase, input),
  updateDatabase: (id, input) =>
    ipcRenderer.invoke(IPC.updateDatabase, id, input),
  deleteDatabase: (id) => ipcRenderer.invoke(IPC.deleteDatabase, id),
  testDatabaseConnection: (input) =>
    ipcRenderer.invoke(IPC.testDatabaseConnection, input),

  listFiles: (projectId) => ipcRenderer.invoke(IPC.listFiles, projectId),
  readFile: (projectId, path) =>
    ipcRenderer.invoke(IPC.readFile, projectId, path),
  writeFile: (projectId, path, content) =>
    ipcRenderer.invoke(IPC.writeFile, projectId, path, content),
  importProjectFile: (projectId, sourcePath, directory) =>
    ipcRenderer.invoke(IPC.importProjectFile, projectId, sourcePath, directory),
  readProjectImage: (projectId, path) =>
    ipcRenderer.invoke(IPC.readProjectImage, projectId, path),
  deletePath: (projectId, path) =>
    ipcRenderer.invoke(IPC.deletePath, projectId, path),
  createDirectory: (projectId, path) =>
    ipcRenderer.invoke(IPC.createDirectory, projectId, path),
  movePath: (projectId, from, to) =>
    ipcRenderer.invoke(IPC.movePath, projectId, from, to),
  copyPath: (projectId, from, to) =>
    ipcRenderer.invoke(IPC.copyPath, projectId, from, to),

  gitBranch: (projectId) => ipcRenderer.invoke(IPC.gitBranch, projectId),

  getSetting: (key) => ipcRenderer.invoke(IPC.getSetting, key),
  setSetting: (key, value) => ipcRenderer.invoke(IPC.setSetting, key, value),

  dbQuery: (databaseId, sql, params) =>
    ipcRenderer.invoke(IPC.dbQuery, databaseId, sql, params),
  dbExec: (databaseId, sql, params, options) =>
    ipcRenderer.invoke(IPC.dbExec, databaseId, sql, params, options),
  dbReset: (databaseId) => ipcRenderer.invoke(IPC.dbReset, databaseId),

  listRequests: (projectId) => ipcRenderer.invoke(IPC.listRequests, projectId),
  saveRequests: (projectId, requests) =>
    ipcRenderer.invoke(IPC.saveRequests, projectId, requests),
  listEnvironments: (projectId) =>
    ipcRenderer.invoke(IPC.listEnvironments, projectId),
  saveEnvironments: (projectId, environments) =>
    ipcRenderer.invoke(IPC.saveEnvironments, projectId, environments),
  listFolders: (projectId) => ipcRenderer.invoke(IPC.listFolders, projectId),
  saveFolders: (projectId, folders) =>
    ipcRenderer.invoke(IPC.saveFolders, projectId, folders),
  listCookies: (projectId) => ipcRenderer.invoke(IPC.listCookies, projectId),
  saveCookies: (projectId, cookies) =>
    ipcRenderer.invoke(IPC.saveCookies, projectId, cookies),
  httpSend: (input) => ipcRenderer.invoke(IPC.httpSend, input),

  inboxStart: (projectId, server, port) =>
    ipcRenderer.invoke(IPC.inboxStart, projectId, server, port),
  inboxStop: (projectId, server) =>
    ipcRenderer.invoke(IPC.inboxStop, projectId, server),
  inboxStatus: (projectId) => ipcRenderer.invoke(IPC.inboxStatus, projectId),
  inboxMessages: (projectId) =>
    ipcRenderer.invoke(IPC.inboxMessages, projectId),
  inboxMarkRead: (projectId, id) =>
    ipcRenderer.invoke(IPC.inboxMarkRead, projectId, id),
  inboxDelete: (projectId, id) =>
    ipcRenderer.invoke(IPC.inboxDelete, projectId, id),
  inboxClear: (projectId, server) =>
    ipcRenderer.invoke(IPC.inboxClear, projectId, server),
  inboxReplay: (projectId, id, url) =>
    ipcRenderer.invoke(IPC.inboxReplay, projectId, id, url),

  onInboxMessage: (listener) =>
    subscribe<InboxEvent>(IPC.inboxMessage, listener),
  onInboxStatus: (listener) =>
    subscribe<InboxStatusEvent>(IPC.inboxStatusChanged, listener),

  startProcess: (projectId, command, args) =>
    ipcRenderer.invoke(IPC.startProcess, projectId, command, args),
  stopProcess: (processId) => ipcRenderer.invoke(IPC.stopProcess, processId),

  onProcessOutput: (listener) =>
    subscribe<ProcessOutput>(IPC.processOutput, listener),
  onProcessExit: (listener) =>
    subscribe<ProcessExit>(IPC.processExit, listener),

  agentTools: () => ipcRenderer.invoke(IPC.agentTools),
  agentInstall: (cols, rows, kind) =>
    ipcRenderer.invoke(IPC.agentInstall, cols, rows, kind),
  claudeCommands: (projectId) =>
    ipcRenderer.invoke(IPC.claudeCommands, projectId),

  terminalCreate: (projectId, cols, rows, kind, claudeSessionId) =>
    ipcRenderer.invoke(
      IPC.terminalCreate,
      projectId,
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

  transcriptWatch: (mirrorId, projectId, claudeSessionId) =>
    ipcRenderer.invoke(
      IPC.transcriptWatch,
      mirrorId,
      projectId,
      claudeSessionId
    ),
  transcriptUnwatch: (mirrorId) =>
    ipcRenderer.invoke(IPC.transcriptUnwatch, mirrorId),
  claudeListSessions: (projectId) =>
    ipcRenderer.invoke(IPC.claudeListSessions, projectId),
  claudeUsageLimits: () => ipcRenderer.invoke(IPC.claudeUsageLimits),

  onTranscriptEvent: (listener) =>
    subscribe<TranscriptEvent>(IPC.transcriptEvent, listener),

  systemUsage: () => ipcRenderer.invoke(IPC.systemUsage),
}

contextBridge.exposeInMainWorld("desktop", api)
