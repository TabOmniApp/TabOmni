/**
 * Whether the window is leaving its title bar to the app.
 *
 * macOS hides the bar and insets the traffic lights into whatever is drawn at
 * the top (see `titleBarStyle` in electron/main.ts); Windows and Linux keep
 * their own frame, and need none of this.
 */
export const IS_MAC = window.desktop.platform === "darwin"

/**
 * An invisible strip standing in for the title bar the window does not have.
 *
 * The workbench's own header is the drag handle in the normal case; this is
 * for the screens shown before it, or over it — the splash, a storage
 * failure, the setup overlay — where there would otherwise be nothing left to
 * drag the window by.
 *
 * Not `pointer-events-none`: a drag region has to be able to take the press.
 * Only use it where the top of the screen holds nothing clickable.
 */
export function TitleBarDragStrip() {
  return (
    <div aria-hidden className="drag-region fixed inset-x-0 top-0 z-50 h-11" />
  )
}
