import { create } from "zustand"

import type { NoteFolder, NoteRecord } from "@shared/api"
import { useStudio } from "../store"
import { isRememberedTabs, recall, remember } from "../tab-memory"
import { descendantFolderIds, isDescendant } from "../tree"
import { cloneDrawingsIn, deleteDrawings, drawingIdsIn } from "./drawings"
import { useNoteTemplates } from "./templates"

/** How long typing settles before a note is written back. */
const SAVE_DELAY_MS = 400

/** Which notes were open in the strip, and which was on screen. */
const OPEN_TABS_KEY = "note.tabs"

type NoteState = {
  notes: NoteRecord[]
  folders: NoteFolder[]
  loading: boolean

  /**
   * Markdown for every note opened this session, keyed by id.
   *
   * Cached rather than re-read on each tab switch, so going back to a note is
   * instant and — more to the point — cannot lose the last keystrokes to a
   * read that overtakes a write still sitting in the debounce below. Kept for
   * notes whose tab has since closed too: it is text, the number of notes one
   * person opens in a session is small, and the alternative is deciding what
   * to do about a pending save at exactly the wrong moment.
   */
  bodies: Record<string, string>

  /** Notes with a tab open, oldest first. */
  openIds: string[]
  selectedId: string | null

  refresh: () => Promise<void>

  create: (folderId?: string | null) => Promise<void>
  /** A new note starting from a template's text, named after it. */
  createFromTemplate: (
    templateId: string,
    folderId?: string | null
  ) => Promise<void>
  /** Files this note's text away as a template. Returns the new template's id
   * so the caller can open the manage dialog on it. */
  saveAsTemplate: (id: string) => Promise<string | null>
  rename: (id: string, name: string) => void
  duplicate: (id: string) => Promise<void>
  remove: (id: string) => void
  moveToFolder: (id: string, folderId: string | null) => void

  /** The note's markdown, read from disk the first time it is asked for. */
  loadBody: (id: string) => Promise<string>
  /** Records what was typed and writes it back once the typing stops. */
  setBody: (id: string, markdown: string) => void

  createFolder: (parentId: string | null) => NoteFolder
  renameFolder: (id: string, name: string) => void
  /** Deletes the folder and everything nested under it. The caller confirms
   * first; there is no undo. */
  removeFolder: (id: string) => void
  moveFolder: (id: string, parentId: string | null) => void

  select: (id: string) => void
  close: (id: string) => void
  closeOthers: (id: string) => void
  closeAll: () => void
  reorder: (ids: string[]) => void
}

function now(): string {
  return new Date().toISOString()
}

function blankNoteName(index: number): string {
  return index === 0 ? "New note" : `New note ${index + 1}`
}

function blankFolder(parentId: string | null): NoteFolder {
  return {
    id: crypto.randomUUID(),
    name: "New folder",
    parentId,
    createdAt: now(),
    updatedAt: now(),
  }
}

export const useNotes = create<NoteState>((set, get) => {
  let pendingNotesSave: ReturnType<typeof setTimeout> | undefined
  let pendingFolderSave: ReturnType<typeof setTimeout> | undefined
  /** One timer per note being typed into, so two open notes do not cancel
   * each other's save. */
  const pendingBodies = new Map<string, ReturnType<typeof setTimeout>>()
  /** Bodies already read from disk — a note whose file is empty is still
   * "read", which `bodies` alone cannot say. */
  const loaded = new Set<string>()
  /** Whether the strip has already been put back — see `refresh`. */
  let restored = false

  function rememberTabs() {
    const { openIds, selectedId } = get()
    remember(OPEN_TABS_KEY, { openIds, selectedId })
  }

  function persistNotes(notes: NoteRecord[]) {
    void window.desktop.saveNotes(notes).catch((error) => {
      console.error("Could not save notes", error)
    })
  }

  /**
   * Applies a change to the listing and writes it.
   *
   * Structural changes — a note added, renamed, moved, deleted — are written
   * at once; the `updatedAt` bump that follows a keystroke rides the same
   * delay as the body it belongs to, so typing rewrites this file once a
   * pause rather than once a character.
   */
  function commitNotes(next: NoteRecord[], immediate = true) {
    set({ notes: next })

    clearTimeout(pendingNotesSave)
    if (immediate) {
      persistNotes(next)
      return
    }
    pendingNotesSave = setTimeout(() => persistNotes(next), SAVE_DELAY_MS)
  }

  function commitFolders(next: NoteFolder[]) {
    set({ folders: next })
    clearTimeout(pendingFolderSave)
    void window.desktop.saveNoteFolders(next).catch((error) => {
      console.error("Could not save note folders", error)
    })
  }

  /**
   * Adds a note with the text it starts with, and opens it.
   *
   * Blank and from-a-template differ only in that text and that name, so the
   * ordering both depend on lives here once: the body is cached before the
   * listing is committed, so the editor that the `select` below mounts finds
   * the text already there rather than reading a file still being written.
   * `duplicate` keeps its own copy of this because it inserts beside the note
   * it copied rather than at the end.
   */
  async function addNote(
    name: string,
    folderId: string | null,
    markdown: string
  ) {
    const note: NoteRecord = {
      id: crypto.randomUUID(),
      name,
      folderId,
      createdAt: now(),
      updatedAt: now(),
    }

    // The body file is written even when empty rather than left absent, so the
    // note exists on disk as soon as it exists in the list — a note created and
    // never typed into is still a note.
    set((state) => ({ bodies: { ...state.bodies, [note.id]: markdown } }))
    loaded.add(note.id)
    commitNotes([...get().notes, note])
    await window.desktop.writeNote(note.id, markdown).catch((error) => {
      console.error("Could not create the note", error)
    })
    get().select(note.id)
  }

  /** Writes a note's body now, cancelling any save still waiting for it. */
  function flushBody(id: string) {
    const timer = pendingBodies.get(id)
    if (timer === undefined) return
    clearTimeout(timer)
    pendingBodies.delete(id)

    const markdown = get().bodies[id]
    if (markdown === undefined) return
    void window.desktop.writeNote(id, markdown).catch((error) => {
      console.error("Could not save the note", error)
    })
  }

  /** Forgets a deleted note's body and stops any save still in flight for it —
   * a write landing after the delete would put the file back. */
  function forgetBodies(ids: Set<string>) {
    // Before the bodies go: the markdown is the only record of which drawings
    // belonged to this note, so it is read for their ids while it is still
    // here. A note never opened this session has no body cached and no
    // drawings to lose — its file goes either way.
    const drawings = [...ids].flatMap((id) =>
      drawingIdsIn(get().bodies[id] ?? "")
    )

    for (const id of ids) {
      const timer = pendingBodies.get(id)
      if (timer !== undefined) clearTimeout(timer)
      pendingBodies.delete(id)
      loaded.delete(id)
    }
    set((state) => ({
      bodies: Object.fromEntries(
        Object.entries(state.bodies).filter(([id]) => !ids.has(id))
      ),
    }))
    void window.desktop.deleteNotes([...ids]).catch((error) => {
      console.error("Could not delete the notes", error)
    })
    void deleteDrawings(drawings).catch((error) => {
      console.error("Could not delete the drawings", error)
    })
  }

  /**
   * Reopens what the last launch had open, dropping anything that no longer
   * resolves — a note deleted since is an id that names nothing, and a tab
   * with no note behind it is a tab that cannot be shown.
   */
  function restoreTabs(notes: NoteRecord[]) {
    void recall(OPEN_TABS_KEY, isRememberedTabs).then((stored) => {
      if (!stored) return
      // Anything opened while this read was in flight wins: the user is here
      // now, and a stored strip is only a starting point.
      if (get().openIds.length > 0) return

      const openIds = stored.openIds.filter((id) =>
        notes.some((note) => note.id === id)
      )
      if (openIds.length === 0) return
      set({
        openIds,
        selectedId:
          stored.selectedId && openIds.includes(stored.selectedId)
            ? stored.selectedId
            : (openIds[0] ?? null),
      })
    })
  }

  return {
    notes: [],
    folders: [],
    loading: false,
    bodies: {},
    openIds: [],
    selectedId: null,

    async refresh() {
      set({ loading: true })
      const [notes, folders] = await Promise.all([
        window.desktop.listNotes(),
        window.desktop.listNoteFolders(),
      ])
      set({ notes, folders, loading: false })

      // Only on the first read: a later refresh must not reopen what has been
      // closed since.
      if (!restored) {
        restored = true
        restoreTabs(notes)
      }
    },

    async create(folderId = null) {
      await addNote(blankNoteName(get().notes.length), folderId, "")
    },

    async createFromTemplate(templateId, folderId = null) {
      // Read through the store rather than the disk so a template being edited
      // in the manage dialog right now is taken as it stands on screen.
      const templates = useNoteTemplates.getState()
      const template = templates.templates.find(
        (candidate) => candidate.id === templateId
      )
      if (!template) return

      // Each drawing in the template is copied and the new note pointed at the
      // copy — the same reason `duplicate` does it. Sharing them would mean
      // every note made from this template drew on one canvas, and deleting any
      // of them took that canvas from all the others.
      const markdown = await cloneDrawingsIn(
        await templates.loadBody(templateId)
      )
      await addNote(template.name, folderId, markdown)
    },

    async saveAsTemplate(id) {
      const note = get().notes.find((candidate) => candidate.id === id)
      if (!note) return null

      // The list is re-read first: `create` appends to what the store holds and
      // writes the whole thing back, so adding to a list that was never loaded
      // would write this template over every other one.
      const templates = useNoteTemplates.getState()
      await templates.refresh()

      const markdown = await cloneDrawingsIn(await get().loadBody(id))
      const template = await templates.create({
        name: note.name,
        markdown,
      })
      return template.id
    },

    rename(id, name) {
      commitNotes(
        get().notes.map((note) =>
          note.id === id ? { ...note, name, updatedAt: now() } : note
        )
      )
    },

    async duplicate(id) {
      const { notes } = get()
      const source = notes.find((note) => note.id === id)
      if (!source) return

      // Each drawing is copied and the copy's markdown re-pointed at it.
      // Sharing them would mean editing the copy changed the original, and
      // deleting either took the other's diagrams with it.
      const markdown = await cloneDrawingsIn(await get().loadBody(id))
      const copy: NoteRecord = {
        ...source,
        id: crypto.randomUUID(),
        name: `${source.name} copy`,
        createdAt: now(),
        updatedAt: now(),
      }

      set((state) => ({ bodies: { ...state.bodies, [copy.id]: markdown } }))
      loaded.add(copy.id)

      const index = get().notes.findIndex((note) => note.id === id)
      const next = [...get().notes]
      next.splice(index + 1, 0, copy)
      commitNotes(next)
      void window.desktop.writeNote(copy.id, markdown).catch((error) => {
        console.error("Could not duplicate the note", error)
      })
      get().select(copy.id)
    },

    remove(id) {
      commitNotes(get().notes.filter((note) => note.id !== id))
      get().close(id)
      forgetBodies(new Set([id]))
    },

    moveToFolder(id, folderId) {
      commitNotes(
        get().notes.map((note) =>
          note.id === id ? { ...note, folderId, updatedAt: now() } : note
        )
      )
    },

    async loadBody(id) {
      const cached = get().bodies[id]
      if (loaded.has(id) && cached !== undefined) return cached

      const markdown = await window.desktop.readNote(id)
      // Anything typed while the read was in flight wins over what came back:
      // the file is behind the editor, not ahead of it.
      if (pendingBodies.has(id)) return get().bodies[id] ?? markdown

      loaded.add(id)
      set((state) => ({ bodies: { ...state.bodies, [id]: markdown } }))
      return markdown
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

      // Rides the body's own delay rather than writing the listing per
      // keystroke — see `commitNotes`.
      commitNotes(
        get().notes.map((note) =>
          note.id === id ? { ...note, updatedAt: now() } : note
        ),
        false
      )
    },

    createFolder(parentId) {
      const folder = blankFolder(parentId)
      commitFolders([...get().folders, folder])
      return folder
    },

    renameFolder(id, name) {
      commitFolders(
        get().folders.map((folder) =>
          folder.id === id ? { ...folder, name, updatedAt: now() } : folder
        )
      )
    },

    removeFolder(id) {
      const { folders, notes, openIds } = get()
      const removedFolderIds = descendantFolderIds(id, folders)
      const removedNoteIds = new Set(
        notes
          .filter((note) => removedFolderIds.has(note.folderId ?? ""))
          .map((note) => note.id)
      )

      commitFolders(
        folders.filter((folder) => !removedFolderIds.has(folder.id))
      )
      commitNotes(notes.filter((note) => !removedNoteIds.has(note.id)))
      for (const openId of openIds) {
        if (removedNoteIds.has(openId)) get().close(openId)
      }
      if (removedNoteIds.size > 0) forgetBodies(removedNoteIds)
    },

    moveFolder(id, parentId) {
      // A folder can't become its own descendant — `isDescendant` covers
      // `parentId === id` too, a folder being its own descendant of depth zero.
      if (parentId && isDescendant(parentId, id, get().folders)) return
      commitFolders(
        get().folders.map((folder) =>
          folder.id === id ? { ...folder, parentId, updatedAt: now() } : folder
        )
      )
    },

    select(id) {
      useStudio.getState().showPane("note")
      const { openIds } = get()
      set({
        selectedId: id,
        openIds: openIds.includes(id) ? openIds : [...openIds, id],
      })
      rememberTabs()
    },

    close(id) {
      const { openIds, selectedId } = get()
      const index = openIds.indexOf(id)
      if (index === -1) return

      // Before the tab goes: the editor unmounts with this, and whatever it
      // last handed over is still sitting in the debounce.
      flushBody(id)

      const remaining = openIds.filter((_, position) => position !== index)
      set({
        openIds: remaining,
        selectedId:
          selectedId === id
            ? (remaining[index] ?? remaining[index - 1] ?? null)
            : selectedId,
      })
      rememberTabs()
    },

    closeOthers(id) {
      for (const openId of get().openIds) {
        if (openId !== id) flushBody(openId)
      }
      set({ openIds: [id], selectedId: id })
      rememberTabs()
    },

    closeAll() {
      for (const openId of get().openIds) flushBody(openId)
      set({ openIds: [], selectedId: null })
      rememberTabs()
    },

    reorder(ids) {
      const { openIds } = get()
      const reordered = ids.filter((id) => openIds.includes(id))
      if (reordered.length !== openIds.length) return
      set({ openIds: reordered })
      rememberTabs()
    },
  }
})
