import {
  app,
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron"

import { IPC, type MenuCommand, type MenuState } from "../shared/api"

const IS_MAC = process.platform === "darwin"

/**
 * The application menu.
 *
 * There was none until the project actions outgrew the header: on macOS the
 * menu bar is there whether the app uses it or not, and a window whose only
 * chrome is a row of unlabelled icons hides "import a folder" from anyone who
 * has not hovered one. Everything here also exists as a dialog in the
 * renderer — the menu sends the intent and the renderer opens it, so there is
 * one implementation rather than two.
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
        label: "Import project…",
        accelerator: "Shift+CmdOrCtrl+O",
        click: () => send("import-project"),
      },
      { type: "separator" },
      {
        label: "Close project",
        enabled: state.projectOpen,
        click: () => send("close-project"),
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

  rebuild = build
  build()
}

/**
 * What the renderer last said about itself.
 *
 * Module state rather than something threaded through `registerIpc`, because
 * the two sides of it start at different times: the menu is built once the app
 * is ready, and the state arrives from the renderer whenever the project list
 * changes.
 */
let state: MenuState = { projectOpen: false }

let rebuild: (() => void) | null = null

/** Called from the IPC handler as the renderer's project changes. */
export function setMenuState(next: MenuState): void {
  // Rebuilt rather than mutated: `MenuItem.enabled` is settable, but finding
  // the item again means matching on its label, which is the kind of coupling
  // a rebuild avoids for a menu this small.
  if (next.projectOpen === state.projectOpen) return
  state = next
  rebuild?.()
}
