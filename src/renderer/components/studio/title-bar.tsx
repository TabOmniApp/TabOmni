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
 *
 * Stops short of the right edge, which is where the workbench's own header puts
 * the theme toggle. macOS is known to keep a drag region after the element that
 * asked for it is gone (electron#20926), and this one is on screen right up
 * until the workbench fades in underneath it — a stale rect over that corner
 * would leave the toggle taking no clicks.
 */
export function TitleBarDragStrip() {
  return (
    <div
      aria-hidden
      className="drag-region fixed top-0 right-12 left-0 z-50 h-11"
    />
  )
}
