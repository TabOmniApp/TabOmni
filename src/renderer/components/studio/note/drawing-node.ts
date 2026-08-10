import type { Ctx } from "@milkdown/kit/ctx"
import { editorViewCtx } from "@milkdown/kit/core"
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark"
import type { Node as ProseNode } from "@milkdown/kit/prose/model"
import type { EditorView, NodeView } from "@milkdown/kit/prose/view"
import { $nodeSchema, $view } from "@milkdown/kit/utils"

import { DRAWING_LANGUAGE } from "@shared/api"
import {
  loadDrawing,
  onDrawingChanged,
  openDrawing,
  peekDrawing,
  type DrawingScene,
} from "@/lib/note/drawings"

/**
 * A drawing in a note: an Excalidraw scene, held in the document as one atom
 * block that knows only the scene's id.
 *
 * The scene itself is a file of its own (`lib/note/drawings.ts`), and this node
 * carries the id because that is all markdown can be asked to hold — see
 * `DRAWING_LANGUAGE`. The block draws the scene as an exported SVG rather than
 * mounting a live canvas per drawing: Excalidraw takes the wheel for zoom, so
 * an editable canvas inside a scrolling document is a scroll trap, and a note
 * with five diagrams would be five editors running at once.
 */
export const drawingSchema = $nodeSchema("drawing", () => ({
  group: "block",
  atom: true,
  // The block is one thing, not a container: a selection must not reach into it
  // and a backspace at its edge should take the whole drawing.
  isolating: true,
  selectable: true,
  draggable: true,
  marks: "",
  attrs: { drawingId: { default: "", validate: "string" } },
  parseDOM: [
    {
      tag: "div[data-drawing-id]",
      getAttrs: (dom) => ({
        drawingId: (dom as HTMLElement).dataset.drawingId ?? "",
      }),
    },
  ],
  toDOM: (node) => [
    "div",
    { "data-drawing-id": node.attrs.drawingId as string },
  ],
  parseMarkdown: {
    match: (node) =>
      node.type === "code" &&
      (node as { lang?: string }).lang === DRAWING_LANGUAGE,
    runner: (state, node, type) => {
      state.addNode(type, { drawingId: String(node.value ?? "").trim() })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "drawing",
    runner: (state, node) => {
      state.addNode("code", undefined, node.attrs.drawingId as string, {
        lang: DRAWING_LANGUAGE,
      })
    },
  },
}))

/**
 * Stops the commonmark code block from claiming a ```drawing fence.
 *
 * The parser asks every node in the schema which mdast node it matches and
 * takes the first that says yes, in schema order — and `code_block` says yes to
 * every `code` node, including this one, whichever order the two are registered
 * in. So the general one is narrowed rather than the specific one raced.
 *
 * A config rather than `codeBlockSchema.extendSchema`, which builds a second
 * plugin under the same id: Crepe registers the commonmark preset itself, and
 * there is no swapping its copy out from here.
 */
export function keepDrawingFencesOutOfCodeBlocks(ctx: Ctx): void {
  ctx.update(codeBlockSchema.key, (prev) => (inner) => {
    const schema = prev(inner)
    const matchesCode = schema.parseMarkdown.match
    return {
      ...schema,
      parseMarkdown: {
        ...schema.parseMarkdown,
        match: (node) =>
          matchesCode(node) &&
          (node as { lang?: string }).lang !== DRAWING_LANGUAGE,
      },
    }
  })
}

/**
 * Whether the app is in its dark theme, and who to tell when that changes.
 *
 * A drawing is exported with its own light or dark rendering — Excalidraw
 * inverts the strokes rather than tinting them — so every preview in the
 * document has to be redrawn when the toggle is hit. One observer for all of
 * them: `next-themes` writes the class onto `<html>`, and a node view is a
 * plain object with no way to subscribe to React state.
 */
const themeListeners = new Set<() => void>()
let themeObserver: MutationObserver | null = null

function isDark(): boolean {
  return document.documentElement.classList.contains("dark")
}

function onThemeChanged(listener: () => void): () => void {
  themeListeners.add(listener)
  themeObserver ??= new MutationObserver(() => {
    for (const notify of themeListeners) notify()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })

  return () => {
    themeListeners.delete(listener)
    if (themeListeners.size === 0) {
      themeObserver?.disconnect()
      themeObserver = null
    }
  }
}

/** Whether a scene has anything in it — an inserted drawing nobody has drawn
 * in yet gets a prompt rather than a blank rectangle. */
function isEmpty(scene: DrawingScene): boolean {
  return scene.elements.length === 0
}

class DrawingNodeView implements NodeView {
  readonly dom: HTMLElement
  private readonly canvas: HTMLElement
  private readonly toolbar: HTMLElement
  private node: ProseNode
  private readonly stopWatchingTheme: () => void
  private readonly stopWatchingScene: () => void
  /** Bumped on every render so a slow export cannot overwrite a newer one. */
  private generation = 0

  constructor(
    node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined
  ) {
    this.node = node

    this.dom = document.createElement("div")
    this.dom.className = "note-drawing"
    this.dom.dataset.drawingId = this.drawingId

    this.canvas = document.createElement("div")
    this.canvas.className = "note-drawing-canvas"
    this.canvas.addEventListener("click", () => openDrawing(this.drawingId))

    this.toolbar = document.createElement("div")
    this.toolbar.className = "note-drawing-toolbar"
    this.toolbar.append(
      this.button("Edit", () => openDrawing(this.drawingId)),
      this.button("Remove", () => this.remove())
    )

    this.dom.append(this.canvas, this.toolbar)

    this.stopWatchingTheme = onThemeChanged(() => void this.render())
    this.stopWatchingScene = onDrawingChanged((id) => {
      if (id === this.drawingId) void this.render()
    })

    void this.render()
  }

  private get drawingId(): string {
    return this.node.attrs.drawingId as string
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = label
    button.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      onClick()
    })
    return button
  }

  /** Takes the block out of the note. The scene file is left alone: this has to
   * be undoable, and a delete that had already removed the file would come back
   * as an empty drawing. */
  private remove(): void {
    const pos = this.getPos()
    if (pos === undefined) return
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize))
    this.view.focus()
  }

  private async render(): Promise<void> {
    const id = this.drawingId
    const generation = ++this.generation

    // Straight from the cache when it is there, so a theme change redraws in
    // one frame instead of flashing a placeholder in every block at once.
    const scene = peekDrawing(id) ?? (await loadDrawing(id))
    if (generation !== this.generation) return

    if (isEmpty(scene)) {
      this.canvas.replaceChildren(placeholder())
      return
    }

    // Only ever reached for a drawing that has something in it, which is what
    // keeps Excalidraw — a megabyte of editor — out of the initial bundle and
    // out of a session that never opens one.
    const { exportToSvg } = await import("@excalidraw/excalidraw")
    if (generation !== this.generation) return

    try {
      const svg = await exportToSvg({
        elements: scene.elements as Parameters<
          typeof exportToSvg
        >[0]["elements"],
        appState: { ...scene.appState, exportWithDarkMode: isDark() },
        files: scene.files as Parameters<typeof exportToSvg>[0]["files"],
        exportPadding: 8,
      })
      if (generation !== this.generation) return

      // Its own intrinsic size is the scene's bounding box in pixels; the block
      // is as wide as the note, so the drawing scales to it rather than
      // overflowing a narrow pane.
      svg.removeAttribute("width")
      svg.removeAttribute("height")
      this.canvas.replaceChildren(svg)
    } catch (error) {
      console.error("Could not draw the preview", error)
      this.canvas.replaceChildren(
        placeholder("This drawing could not be drawn")
      )
    }
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false
    const changed = node.attrs.drawingId !== this.node.attrs.drawingId
    this.node = node
    this.dom.dataset.drawingId = this.drawingId
    if (changed) void this.render()
    return true
  }

  selectNode(): void {
    this.dom.classList.add("is-selected")
  }

  deselectNode(): void {
    this.dom.classList.remove("is-selected")
  }

  /** The toolbar's buttons are this view's own; everything else — a click that
   * selects the block, a drag by its handle — still belongs to ProseMirror. */
  stopEvent(event: Event): boolean {
    return this.toolbar.contains(event.target as globalThis.Node | null)
  }

  /** The preview is drawn into this DOM asynchronously, and none of it is the
   * document — without this, ProseMirror tries to read the SVG back as content. */
  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.generation += 1
    this.stopWatchingTheme()
    this.stopWatchingScene()
  }
}

function placeholder(text = "Empty drawing — click to start"): HTMLElement {
  const element = document.createElement("p")
  element.className = "note-drawing-placeholder"
  element.textContent = text
  return element
}

export const drawingView = $view(
  drawingSchema.node,
  (ctx) => (node, _view, getPos) =>
    new DrawingNodeView(node, ctx.get(editorViewCtx), getPos)
)
