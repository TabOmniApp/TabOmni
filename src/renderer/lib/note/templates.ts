import { create } from "zustand"

import type { NoteBody, NoteTemplate } from "@shared/api"
import { getSetting, setSetting } from "../workspace"
import { drawingIdsIn, serializeBody } from "./blocks"
import { deleteDrawings } from "./drawings"
import { blocksFromMarkdown, blocksOf } from "./from-markdown"
import { TEMPLATE_PRESETS } from "./template-presets"

/** How long typing settles before a template is written back — the notes
 * store's delay, for the same reason and in the same editor. */
const SAVE_DELAY_MS = 400

/**
 * Set once the presets have been laid down.
 *
 * A flag rather than "is the list empty": deleting every template is a thing
 * someone may mean, and an empty list is the one state that would make the
 * presets come back every launch.
 */
const SEEDED_KEY = "note.templatesSeeded"

type TemplateState = {
  templates: NoteTemplate[]
  bodies: Record<string, string>
  loading: boolean

  /** Reads the listing, seeding the presets the first time it finds none. */
  refresh: () => Promise<void>

  create: (seed?: {
    name?: string
    description?: string
    markdown?: string
  }) => Promise<NoteTemplate>
  rename: (id: string, name: string, description: string) => void
  remove: (id: string) => Promise<void>

  /** The template's body, read from disk the first time it is asked for —
   * blocks, or the markdown an older build wrote. See the note store's
   * `loadBody`, which this is the twin of. */
  loadBody: (id: string) => Promise<NoteBody>
  /** Records what was typed and writes it back once the typing stops. */
  setBody: (id: string, body: string) => void
  /** Takes the blocks a markdown template was converted into, without counting
   * it as an edit. */
  adoptBlocks: (id: string, body: string) => void
  /** Writes what is still waiting — what closing the dialog owes the disk. */
  flush: () => void
}

function now(): string {
  return new Date().toISOString()
}

export const useNoteTemplates = create<TemplateState>((set, get) => {
  let pendingListSave: ReturnType<typeof setTimeout> | undefined
  /** One timer per template being typed into, so editing two in a sitting
   * cannot cancel each other's save. */
  const pendingBodies = new Map<string, ReturnType<typeof setTimeout>>()
  /** Bodies already read — a template whose file is empty is still "read",
   * which `bodies` alone cannot say. */
  const loaded = new Set<string>()
  /** The read in flight, so two panels mounting at once do not both seed. */
  let reading: Promise<void> | null = null

  function persist(templates: NoteTemplate[]) {
    void window.desktop.saveNoteTemplates(templates).catch((error) => {
      console.error("Could not save the note templates", error)
    })
  }

  /** Structural changes are written at once; the `updatedAt` bump behind a
   * keystroke rides the body's own delay, as the notes store's does. */
  function commit(next: NoteTemplate[], immediate = true) {
    set({ templates: next })
    clearTimeout(pendingListSave)
    if (immediate) {
      persist(next)
      return
    }
    pendingListSave = setTimeout(() => persist(next), SAVE_DELAY_MS)
  }

  function flushBody(id: string) {
    const timer = pendingBodies.get(id)
    if (timer === undefined) return
    clearTimeout(timer)
    pendingBodies.delete(id)

    const text = get().bodies[id]
    if (text === undefined) return
    void window.desktop
      .writeNoteTemplate(id, { format: "blocks", text })
      .catch((error) => {
        console.error("Could not save the template", error)
      })
  }

  async function seed(): Promise<NoteTemplate[]> {
    const seeded: NoteTemplate[] = []
    const bodies: Record<string, string> = {}

    for (const preset of TEMPLATE_PRESETS) {
      const template: NoteTemplate = {
        id: crypto.randomUUID(),
        name: preset.name,
        description: preset.description,
        createdAt: now(),
        updatedAt: now(),
      }
      seeded.push(template)
      // The presets are authored as markdown in `template-presets.ts` — a
      // heading and a list read better there than a block tree would — and are
      // converted the once, here, on the way to disk.
      const text = serializeBody(blocksFromMarkdown(preset.markdown))
      bodies[template.id] = text
      loaded.add(template.id)
      await window.desktop.writeNoteTemplate(template.id, {
        format: "blocks",
        text,
      })
    }

    set((state) => ({ bodies: { ...state.bodies, ...bodies } }))
    await window.desktop.saveNoteTemplates(seeded)
    await setSetting(SEEDED_KEY, "true")
    return seeded
  }

  return {
    templates: [],
    bodies: {},
    loading: false,

    async refresh() {
      // Two panels can mount in the same frame; without this they would both
      // see an unseeded workspace and lay the presets down twice.
      reading ??= (async () => {
        set({ loading: true })
        try {
          let templates = await window.desktop.listNoteTemplates()
          if (templates.length === 0 && !(await getSetting(SEEDED_KEY))) {
            templates = await seed()
          }
          set({ templates })
        } catch (error) {
          console.error("Could not read the note templates", error)
        } finally {
          set({ loading: false })
        }
      })()

      try {
        await reading
      } finally {
        reading = null
      }
    },

    async create(seedWith = {}) {
      const markdown = seedWith.markdown ?? ""
      const template: NoteTemplate = {
        id: crypto.randomUUID(),
        name: seedWith.name ?? "New template",
        description: seedWith.description ?? "",
        createdAt: now(),
        updatedAt: now(),
      }

      // Written even when empty, so the template exists on disk as soon as it
      // exists in the list — the same reason a new note's body file is.
      set((state) => ({
        bodies: { ...state.bodies, [template.id]: markdown },
      }))
      loaded.add(template.id)
      commit([...get().templates, template])
      await window.desktop.writeNoteTemplate(template.id, {
        format: "blocks",
        text: markdown,
      })
      return template
    },

    rename(id, name, description) {
      // Debounced, unlike a note's rename: this one is bound to a text field
      // being typed into rather than a dialog that is confirmed once, and the
      // listing is rewritten whole. `flush` is what closing the dialog owes it.
      commit(
        get().templates.map((template) =>
          template.id === id
            ? { ...template, name, description, updatedAt: now() }
            : template
        ),
        false
      )
    },

    async remove(id) {
      // Read before it goes: the body is the only record of which drawings
      // belong to this template, and after the delete there is nothing to ask.
      const drawings = drawingIdsIn(blocksOf(await get().loadBody(id)))

      const timer = pendingBodies.get(id)
      if (timer !== undefined) clearTimeout(timer)
      pendingBodies.delete(id)
      loaded.delete(id)

      commit(get().templates.filter((template) => template.id !== id))
      set((state) => ({
        bodies: Object.fromEntries(
          Object.entries(state.bodies).filter(([key]) => key !== id)
        ),
      }))

      await window.desktop.deleteNoteTemplates([id]).catch((error) => {
        console.error("Could not delete the template", error)
      })
      await deleteDrawings(drawings).catch((error) => {
        console.error("Could not delete the template's drawings", error)
      })
    },

    async loadBody(id) {
      const cached = get().bodies[id]
      if (loaded.has(id) && cached !== undefined) {
        return { format: "blocks", text: cached }
      }

      const body = await window.desktop.readNoteTemplate(id)
      // Anything typed while the read was in flight wins over what came back:
      // the file is behind the editor, not ahead of it.
      const racing = pendingBodies.has(id) ? get().bodies[id] : undefined
      if (racing !== undefined) return { format: "blocks", text: racing }

      // Left uncached and unmarked: this is what an older build wrote, and the
      // blocks it becomes are the editor's to produce — `adoptBlocks` is what
      // brings them back here.
      if (body.format === "markdown") return body

      loaded.add(id)
      set((state) => ({ bodies: { ...state.bodies, [id]: body.text } }))
      return body
    },

    adoptBlocks(id, body) {
      if (get().bodies[id] === body) return

      loaded.add(id)
      set((state) => ({ bodies: { ...state.bodies, [id]: body } }))
      void window.desktop
        .writeNoteTemplate(id, { format: "blocks", text: body })
        .catch((error) => {
          console.error("Could not save the converted template", error)
        })
    },

    setBody(id, markdown) {
      if (get().bodies[id] === markdown) return
      set((state) => ({ bodies: { ...state.bodies, [id]: markdown } }))

      const existing = pendingBodies.get(id)
      if (existing !== undefined) clearTimeout(existing)
      pendingBodies.set(
        id,
        setTimeout(() => flushBody(id), SAVE_DELAY_MS)
      )

      commit(
        get().templates.map((template) =>
          template.id === id ? { ...template, updatedAt: now() } : template
        ),
        false
      )
    },

    flush() {
      for (const id of [...pendingBodies.keys()]) flushBody(id)
      if (pendingListSave !== undefined) {
        clearTimeout(pendingListSave)
        pendingListSave = undefined
        persist(get().templates)
      }
    },
  }
})
