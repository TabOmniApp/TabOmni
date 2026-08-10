import { DRAWING_LANGUAGE } from "@shared/api"

/**
 * The drawings a note's fenced blocks point at.
 *
 * Not a zustand store, unlike everything else in `lib/`: the things that read a
 * drawing are ProseMirror node views, which are plain DOM objects created by
 * Milkdown rather than React components, and a hook is not something they can
 * call. So this is a cache and two subscriptions, and the React side (the
 * editor dialog) uses the same functions the node views do.
 */

/** What Excalidraw's own `.excalidraw` file holds. Only the fields this app
 * passes back and forth are named; the rest travel with them. */
export type DrawingScene = {
  type: "excalidraw"
  version: number
  source: string
  elements: unknown[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

/** A drawing nobody has drawn in yet. */
export function emptyScene(): DrawingScene {
  return {
    type: "excalidraw",
    version: 2,
    source: "tabula",
    elements: [],
    appState: {},
    files: {},
  }
}

/**
 * Scenes already read this session, so a note with a drawing in it does not go
 * back to disk every time the block is re-rendered — a theme change alone
 * re-renders every preview in the document.
 */
const cache = new Map<string, DrawingScene>()

/** Called when a drawing's scene changes, so previews of it redraw. */
const changed = new Set<(id: string) => void>()

/** Called when something asks for a drawing to be opened for editing. */
const opened = new Set<(id: string) => void>()

export function onDrawingChanged(listener: (id: string) => void): () => void {
  changed.add(listener)
  return () => changed.delete(listener)
}

/**
 * Subscribes to edit requests — what a block's Edit button raises and the
 * Notes panel answers by opening the dialog.
 *
 * An event rather than a callback passed down: the button is inside a node view
 * that Milkdown built, several layers below any React component that could have
 * handed it one.
 */
export function onDrawingOpened(listener: (id: string) => void): () => void {
  opened.add(listener)
  return () => opened.delete(listener)
}

export function openDrawing(id: string): void {
  for (const listener of opened) listener(id)
}

export function newDrawingId(): string {
  return crypto.randomUUID()
}

/** A drawing's scene, read once and then remembered. */
export async function loadDrawing(id: string): Promise<DrawingScene> {
  const cached = cache.get(id)
  if (cached) return cached

  let scene = emptyScene()
  try {
    const raw = await window.desktop.readDrawing(id)
    if (raw.trim()) scene = { ...emptyScene(), ...(JSON.parse(raw) as object) }
  } catch (error) {
    // A scene that will not parse is a file somebody edited by hand or a write
    // that was cut short. An empty canvas is recoverable — refusing to open the
    // note is not — and the next save replaces the file.
    console.error("Could not read the drawing", error)
  }

  cache.set(id, scene)
  return scene
}

/** What is already known about a drawing, without going to disk. */
export function peekDrawing(id: string): DrawingScene | undefined {
  return cache.get(id)
}

export async function saveDrawing(
  id: string,
  scene: DrawingScene
): Promise<void> {
  cache.set(id, scene)
  for (const listener of changed) listener(id)
  await window.desktop.writeDrawing(id, JSON.stringify(scene))
}

/**
 * The drawings a note's markdown refers to.
 *
 * Read back out of the text rather than tracked alongside it, because the text
 * is the record: a block deleted with backspace, an undo that brings it back,
 * a note whose markdown was edited outside this app — all of them are answered
 * by looking at what the note actually says now.
 */
export function drawingIdsIn(markdown: string): string[] {
  const fence = new RegExp(
    `^[ \\t]*\`{3,}[ \\t]*${DRAWING_LANGUAGE}[ \\t]*\\r?\\n([^\\n]*)`,
    "gm"
  )
  const ids: string[] = []
  for (const match of markdown.matchAll(fence)) {
    const id = match[1]?.trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * Copies every drawing a note refers to and rewrites the note to point at the
 * copies — what duplicating a note has to do.
 *
 * Without it the copy and the original would share scenes, so editing the copy
 * would change the original and deleting either would take the other's drawings
 * with it.
 */
export async function cloneDrawingsIn(markdown: string): Promise<string> {
  const ids = drawingIdsIn(markdown)
  if (ids.length === 0) return markdown

  let copy = markdown
  for (const id of ids) {
    const scene = await loadDrawing(id)
    const cloneId = newDrawingId()
    await saveDrawing(cloneId, scene)
    copy = copy.split(id).join(cloneId)
  }
  return copy
}

/** Forgets what is cached for drawings that have been deleted. */
export async function deleteDrawings(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  for (const id of ids) cache.delete(id)
  await window.desktop.deleteDrawings(ids)
}
