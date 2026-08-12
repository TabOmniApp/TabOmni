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
      {
        label: "Close tab",
        accelerator: "CmdOrCtrl+W",
        /*
         * Shown but not claimed. A registered accelerator is handled here,
         * before the page sees the key at all, and this one has to reach the
         * renderer: which tab is "the current tab" is the strip's answer, and
         * off macOS a terminal has first call on Ctrl+W, where it deletes the
         * word behind the cursor. So the renderer listens for the key and this
         * item is the menu saying so — and the way to it with no keyboard.
         */
        registerAccelerator: false,
        click: () => send("close-tab"),
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
          // ⇧⌘W rather than the role's own ⌘W, which now closes a tab — the
          // same move an editor makes, and for the same reason: a window holds
          // every panel's tabs, and losing it to a keystroke aimed at one of
          // them takes the sessions running in it too.
          IS_MAC
            ? { role: "close", accelerator: "Shift+CmdOrCtrl+W" }
            : { role: "quit" },
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
          // The way out of a paste that keeps too much: a note pastes with the
          // source's own formatting (see `block-editor.tsx`), and copying out
          // of a rendered page is sometimes a request for its words rather than
          // its headings and tables.
          { role: "pasteAndMatchStyle" },
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
