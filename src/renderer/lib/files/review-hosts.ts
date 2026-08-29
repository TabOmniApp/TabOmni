/**
 * One DOM node per review thread, for drawing a React component inside a
 * CodeMirror block widget.
 *
 * **The problem this solves, and why it is not solved the obvious way.** A thread
 * is drawn under the lines it is about, which means a block widget in the diff;
 * a thread is also a React component with buttons, a reply box and a spinner,
 * which means React has to own its rendering. The two want the same node, and
 * neither can be asked to give it up: CodeMirror decides where the node goes and
 * destroys the view wholesale on every file, layout and theme change, while React
 * decides what is inside it and re-renders on every keystroke in the reply box.
 *
 * So they split it. **This module owns the node**, keyed by thread id and stable
 * for as long as the thread exists. CodeMirror's widget hands the same node back
 * from `toDOM` every time, so a view rebuild moves it rather than replacing it —
 * which is what a `WidgetType` is allowed to do, and what makes the widget cheap.
 * React reaches it with `createPortal`, which does not care where in the document
 * the node currently is, or whether it is in the document at all.
 *
 * That last part is what makes this tiny rather than a subscription: a thread in
 * a file the pane is not showing has a node nobody attached, and its portal
 * renders into a node that is not in the document. Nothing is drawn, nothing
 * errors, and no bookkeeping was needed to work out which threads are on screen —
 * the editor already decided by attaching some nodes and not others.
 *
 * It was a plain-DOM widget once, before there was React on this side of the
 * line, and that is what `docs/design.md` records as the reason the threads went
 * to a strip at the foot of the pane. The strip is what came back out; this is
 * how the widget got to keep the component.
 */

const hosts = new Map<string, HTMLElement>()

/**
 * The node this thread is drawn in, made the first time it is asked for.
 *
 * Called from two places that must agree — the widget's `toDOM` and the portal —
 * and the whole contract is that they get the same object.
 */
export function threadHost(id: string): HTMLElement {
  const held = hosts.get(id)
  if (held) return held

  const host = document.createElement("div")
  // The widget's own wrapper carries the layout; this is only somewhere for
  // React to land, so it stays out of the way.
  host.className = "cm-reviewThreadHost"
  hosts.set(id, host)
  return host
}

/**
 * Forgets a thread's node.
 *
 * Called when the thread goes, which is the only time it is safe: a node dropped
 * while its widget still refers to it would be replaced by a fresh one on the
 * next redraw, and the portal into the old one would go on rendering into
 * nothing. A review is a sitting and the map lives as long as one, so nothing
 * here is a leak worth chasing beyond this.
 */
export function dropThreadHost(id: string): void {
  hosts.delete(id)
}
