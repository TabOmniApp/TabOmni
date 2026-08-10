import { useEffect, useRef, useState } from "react"
import { LanguageDescription } from "@codemirror/language"
import { Crepe } from "@milkdown/crepe"
import { commandsCtx } from "@milkdown/kit/core"
import {
  addBlockTypeCommand,
  clearTextInCurrentBlockCommand,
} from "@milkdown/kit/preset/commonmark"
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { NotebookPen } from "lucide-react"

import type { NoteRecord } from "@shared/api"
import { newDrawingId, onDrawingOpened, openDrawing } from "@/lib/note/drawings"
import { useNotes } from "@/lib/note/store"
import { SECTION_ACCENT } from "../activity-bar"
import { DrawingEditor } from "./drawing-editor"
import {
  drawingSchema,
  drawingView,
  keepDrawingFencesOutOfCodeBlocks,
} from "./drawing-node"
import "@milkdown/crepe/theme/common/style.css"
import "../milkdown-theme.css"
import "./note-editor.css"

const PLACEHOLDER = "Write something…"

/** The `/drawing` item's mark in the block menu. Crepe's menu takes an SVG
 * string, not a component, so this is lucide's `shapes` written out. */
const DRAWING_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/></svg>`

/**
 * The languages a note's code block can be set to.
 *
 * Built from the `@codemirror/lang-*` packages this app already depends on for
 * its SQL console and body editors, rather than pulling in
 * `@codemirror/language-data`: that package's list is every language CodeMirror
 * has a grammar for, and its value here would be a longer dropdown, not a
 * better one. Loaded on demand, so a note with no code block costs nothing.
 */
const CODE_LANGUAGES = [
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts", "tsx", "js", "jsx", "javascript"],
    load: () =>
      import("@codemirror/lang-javascript").then((module) =>
        module.javascript({ jsx: true, typescript: true })
      ),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json"],
    load: () => import("@codemirror/lang-json").then((module) => module.json()),
  }),
  LanguageDescription.of({
    name: "SQL",
    alias: ["sql"],
    load: () => import("@codemirror/lang-sql").then((module) => module.sql()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html"],
    load: () => import("@codemirror/lang-html").then((module) => module.html()),
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["css"],
    load: () => import("@codemirror/lang-css").then((module) => module.css()),
  }),
  LanguageDescription.of({
    name: "Markdown",
    alias: ["md", "markdown"],
    load: () =>
      import("@codemirror/lang-markdown").then((module) => module.markdown()),
  }),
]

/**
 * One note, edited as rich text and stored as markdown.
 *
 * Crepe — Milkdown's batteries-included editor, already here for the chat
 * composer — rather than the bare core, so the toolbar, the `/` block menu and
 * the drag handles come with it instead of being hand-built. It reads as part
 * of the studio and follows the theme toggle because `milkdown-theme.css` maps
 * its `--crepe-*` variables onto the app's own tokens; there is no second
 * palette to keep in step, and nothing here has to know which theme is on.
 */
export function NoteWorkspace() {
  const notes = useNotes((state) => state.notes)
  const openIds = useNotes((state) => state.openIds)
  const selectedId = useNotes((state) => state.selectedId)

  const note =
    selectedId && openIds.includes(selectedId)
      ? notes.find((candidate) => candidate.id === selectedId)
      : undefined

  if (!note) {
    return (
      <Empty className="size-full border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon" style={{ color: SECTION_ACCENT.note }}>
            <NotebookPen />
          </EmptyMedia>
          <EmptyTitle>No note selected</EmptyTitle>
          <EmptyDescription>
            Pick one from the list on the left, or create one.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  // Keyed on the note, so switching tabs builds a fresh editor rather than
  // trying to swap a document under a live ProseMirror state — Crepe takes its
  // content once, at construction, and has no "load this instead".
  return <NotePane key={note.id} note={note} />
}

function NotePane({ note }: { note: NoteRecord }) {
  const loadBody = useNotes((state) => state.loadBody)
  const [initial, setInitial] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadBody(note.id).then((markdown) => {
      if (!cancelled) setInitial(markdown)
    })
    return () => {
      cancelled = true
    }
  }, [note.id, loadBody])

  // Held back rather than mounted empty and filled in: an editor built with ""
  // and then replaced would put a document the user never typed through
  // ProseMirror's history, so one undo would empty the note.
  if (initial === null) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    )
  }

  return (
    <MilkdownProvider>
      <NoteEditor id={note.id} initial={initial} />
      <DrawingHost />
    </MilkdownProvider>
  )
}

/**
 * Opens the drawing editor when a block in the note asks for it.
 *
 * The asking is an event rather than a prop, because what raises it is a
 * ProseMirror node view — a plain DOM object Milkdown constructs, several
 * layers below any component that could have been handed a callback.
 */
function DrawingHost() {
  const [drawingId, setDrawingId] = useState<string | null>(null)

  useEffect(() => onDrawingOpened(setDrawingId), [])

  if (drawingId === null) return null
  return (
    <DrawingEditor drawingId={drawingId} onClose={() => setDrawingId(null)} />
  )
}

function NoteEditor({ id, initial }: { id: string; initial: string }) {
  const setBody = useNotes((state) => state.setBody)

  // The editor is built once and never rebuilt (see the empty dependency list
  // below), so it reaches the store through a ref rather than closing over a
  // `setBody` that a later render would have replaced.
  const write = useRef((markdown: string) => setBody(id, markdown))
  useEffect(() => {
    write.current = (markdown: string) => setBody(id, markdown)
  }, [id, setBody])

  useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue: initial,
      features: {
        [Crepe.Feature.Toolbar]: true,
        // On, unlike the chat composer's: there a `/` belongs to the CLI on
        // the other end, and here it is the block menu — headings, lists,
        // tables, a code block — which is most of what writing a note is.
        [Crepe.Feature.BlockEdit]: true,
        [Crepe.Feature.Placeholder]: true,
        [Crepe.Feature.LinkTooltip]: true,
        [Crepe.Feature.Cursor]: true,
        [Crepe.Feature.ListItem]: true,
        [Crepe.Feature.Table]: true,
        [Crepe.Feature.CodeMirror]: true,
        /*
         * Off, and not an oversight: Crepe's image block hands an inserted
         * file back as a `blob:` URL — a reference to bytes held in this
         * window's memory, which is gone the next time the app opens. A note
         * is a markdown file on disk, so that URL would be a broken image in
         * the one place it has to keep working. An `![alt](https://…)` typed
         * or pasted in still renders; what is missing is dropping a file in,
         * and a dead link is a worse answer than none.
         */
        [Crepe.Feature.ImageBlock]: false,
        // Needs KaTeX's own stylesheet, which is not a dependency this app
        // declares — an unstyled formula is worse than a literal `$x$`.
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.TopBar]: false,
        [Crepe.Feature.AI]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: PLACEHOLDER },
        [Crepe.Feature.CodeMirror]: { languages: CODE_LANGUAGES },
        [Crepe.Feature.BlockEdit]: {
          // Appended to Crepe's own menu rather than replacing it: `buildMenu`
          // runs after the defaults are built, so everything else in Advanced
          // — code, table — is still there.
          buildMenu: (builder) => {
            builder.getGroup("advanced").addItem("drawing", {
              label: "Drawing",
              icon: DRAWING_ICON,
              onRun: (ctx) => {
                const commands = ctx.get(commandsCtx)
                const id = newDrawingId()

                commands.call(clearTextInCurrentBlockCommand.key)
                commands.call(addBlockTypeCommand.key, {
                  nodeType: drawingSchema.type(ctx),
                  attrs: { drawingId: id },
                })
                // Straight into the canvas: picking "Drawing" from the menu is
                // a request to draw, not to place an empty box and then find
                // the way into it.
                openDrawing(id)
              },
            })
          },
        },
      },
    })

    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown) => write.current(markdown))
    })

    crepe.editor
      .config(keepDrawingFencesOutOfCodeBlocks)
      .use(drawingSchema)
      .use(drawingView)

    return crepe
    // Built once: `initial` is this editor's starting document and `id` is
    // fixed for as long as the pane exists (`NoteWorkspace` keys on it), so a
    // rebuild could only throw away what is being typed.
  }, [])

  return (
    <div className="note-prose h-full overflow-y-auto">
      <Milkdown />
    </div>
  )
}
