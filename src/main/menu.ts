import {
  app,
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron"

import { IPC, type MenuCommand } from "../shared/api"

const IS_MAC = process.platform === "darwin"

/**
 * The application menu.
 *
 * There was none until adding a folder outgrew the header: on macOS the menu
 * bar is there whether the app uses it or not, and a window whose only chrome
 * is a row of unlabelled icons hides "add a folder" from anyone who has not
 * hovered one. Everything here also exists as a dialog in the renderer — the
 * menu sends the intent and the renderer opens it, so there is one
 * implementation rather than two.
 *
 * Replacing Electron's default menu means the editing and window roles it
 * provided have to be restated: without them ⌘C and ⌘V stop working in the
 * renderer, since those shortcuts are the menu's, not the page's.
 */
export function installMenu(getWindow: () => BrowserWindow | null): void {
  function send(command: MenuCommand): void {
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(IPC.menuCommand, command)
  }

  function build(): void {
    const fileItems: MenuItemConstructorOptions[] = [
      {
        label: "Add folder…",
        accelerator: "Shift+CmdOrCtrl+O",
        click: () => send("add-folder"),
      },
    ]

    const template: MenuItemConstructorOptions[] = [
      ...(IS_MAC
        ? ([
            {
              label: app.name,
              submenu: [
                { role: "about" },
                { type: "separator" },
                { role: "services" },
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit" },
              ],
            },
          ] satisfies MenuItemConstructorOptions[])
        : []),
      {
        label: "File",
        submenu: [
          ...fileItems,
          { type: "separator" },
          IS_MAC ? { role: "close" } : { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Window",
        submenu: IS_MAC
          ? [
              { role: "minimize" },
              { role: "zoom" },
              { type: "separator" },
              { role: "front" },
            ]
          : [{ role: "minimize" }, { role: "close" }],
      },
    ]

    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  build()
}
