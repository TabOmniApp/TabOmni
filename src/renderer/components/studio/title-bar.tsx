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
 * Stops well short of the right edge, which is where the workbench's own header
 * puts the assistant button. macOS is known to keep a drag region after the
 * element that asked for it is gone (electron#20926), and this one is on screen
 * right up until the workbench fades in underneath it — a stale rect over that
 * corner leaves the button taking no clicks, which is a bug that reads as "it
 * works sometimes".
 *
 * 64px against a 44px button: the clearance is deliberately more than the button
 * is wide, because a stale rect is stale in its *coordinates* too — one left
 * behind from another window width can reach further into the corner than the
 * rect that was drawn here ever did.
 */
export function TitleBarDragStrip() {
  return (
    <div
      aria-hidden
      className="drag-region fixed top-0 right-16 left-0 z-50 h-11"
    />
  )
}
