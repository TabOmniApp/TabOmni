import { create } from "zustand"

import { useStudio } from "../store"
import { isInside, movedInto } from "./tree"
import {
  assetsDir,
  blankSpec,
  parseSpec,
  serializeSpec,
  SPEC_SUFFIX,
  withAssetsAt,
  type Spec,
} from "./schema"

/** How long typing settles before the file is written back. Matches the API
 * panel's own delay, so the two panels feel like one application. */
const SAVE_DELAY_MS = 500

/**
 * One open spec.
 *
 * The document is held parsed rather than as text: the panel edits fields, not
 * JSON, so a buffer of characters would mean reparsing the whole file on every
 * keystroke to find out what a checkbox now says. The text form only exists at
 * the two edges — read from disk, written back.
 */
type Draft = {
  spec: Spec | null
  /** The JSON last known to be on disk, which is what makes a tab dirty —
   * `null` until the first read lands. */
  saved: string | null
  loading: boolean
  /** Why the file could not be read, parsed, or written. */
  error: string | null
}

const EMPTY: Draft = { spec: null, saved: null, loading: false, error: null }

export function draftOf(
  drafts: Record<string, Draft>,
  path: string | null
): Draft {
  return (path && drafts[path]) || EMPTY
}

export function isDirty(draft: Draft): boolean {
  if (draft.spec === null || draft.saved === null) return false
  return serializeSpec(draft.spec) !== draft.saved
}

type SpecState = {
  projectId: string | null
  /** Every `*.spec.json` in the project, in path order. Derived from the
   * studio's own file tree rather than a second walk of the disk. */
  paths: string[]
  /** Paths open as tabs, in strip order. */
  openPaths: string[]
  selectedPath: string | null
  drafts: Record<string, Draft>
  /** Re-reads the project's tree and picks the spec files out of it. */
  refresh: () => Promise<void>
  /** Opens a spec as a tab and shows it, reading it if this is the first time. */
  open: (path: string) => void
  select: (path: string) => void
  close: (path: string) => void
  closeOthers: (path: string) => void
  closeAll: () => void
  reorder: (paths: string[]) => void

  /**
   * Applies one edit and schedules the write.
   *
   * An updater rather than a whole document, so a field that changed while a
   * save was in flight cannot be reverted by a caller holding a stale copy.
   */
  edit: (path: string, change: (spec: Spec) => Spec) => void
  /** Writes now rather than on the timer — for ⌘S. */
  save: (path: string) => Promise<void>
  /**
   * Asks for image files, copies them into the spec's asset directory, and
   * appends one entry per image.
   *
   * Here rather than in the component because it is the one edit that touches
   * the disk before it touches the document: the copy has to land, and the
   * paths it lands at are what the document records.
   */
  addImages: (path: string) => Promise<void>
  /**
   * Folders made in this session that hold no spec yet.
   *
   * Git does not track an empty directory, so one cannot be read back out of
   * the file tree — it is real on this machine and invisible to everyone else
   * until a spec is put in it. Kept here so the sidebar can still show where
   * the next spec is going, and deliberately not persisted: on the next launch
   * the truth is whatever is committed.
   */
  emptyFolders: string[]
  /** Creates a folder, and every folder above it. */
  createFolder: (dir: string) => Promise<void>
  /** Renames a folder, carrying its specs — and their open tabs — with it. */
  renameFolder: (from: string, to: string) => Promise<void>
  /** Deletes a folder and everything under it. */
  removeFolder: (dir: string) => Promise<void>

  /**
   * Renames a spec, taking its screenshots with it.
   *
   * A spec and its `<name>.assets/` folder are one document to anyone reading
   * the repository, so the folder moves too — and every image path inside the
   * document is a path into that folder, so those are rewritten as well. The
   * order matters: the pictures move first, then the rewritten document is
   * written under the new name, and only then is the old file removed, so a
   * failure part-way leaves a spec that still opens.
   */
  rename: (path: string, dir: string, name: string) => Promise<void>
  /** Copies a spec and its screenshots to a new name, and opens the copy. */
  duplicate: (path: string, dir: string, name: string) => Promise<void>
  /** Deletes a spec and its screenshots. */
  remove: (path: string) => Promise<void>
  /** Creates `<dir>/<name>.spec.json` and opens it. Rejects if it is there
   * already, so a name collision cannot quietly overwrite someone's spec. */
  create: (dir: string, name: string) => Promise<void>
}

/**
 * `<dir>/<name>.spec.json` — where a spec being renamed or copied lands.
 *
 * The folder is given rather than taken from the old path, which is what makes
 * renaming a spec and moving it to another folder the same operation.
 */
function targetPath(dir: string, name: string): string {
  const trimmed = dir.replace(/^\/+|\/+$/g, "")
  return `${trimmed ? `${trimmed}/` : ""}${name}${SPEC_SUFFIX}`
}

/**
 * Whether a spec's asset folder is actually there.
 *
 * Read off the studio's file tree rather than asked of the disk: the tree is
 * already loaded, and a spec whose pictures were never added has no folder to
 * move or delete — asking the main process to move one that does not exist
 * would fail the whole rename over nothing.
 */
function hasAssets(dir: string): boolean {
  const prefix = `${dir}/`
  return useStudio
    .getState()
    .entries.some((entry) => entry.path.startsWith(prefix))
}

export const useSpecs = create<SpecState>((set, get) => {
  const pending: Record<string, ReturnType<typeof setTimeout>> = {}

  async function readSpec(projectId: string, path: string): Promise<Spec> {
    return parseSpec(JSON.parse(await window.desktop.readFile(projectId, path)))
  }

  /** Points everything that named the old path at the new one — the tab strip,
   * the selection, and the draft itself. */
  function retarget(from: string, to: string, spec: Spec) {
    set((state) => {
      const drafts = { ...state.drafts }
      delete drafts[from]
      drafts[to] = {
        spec,
        saved: serializeSpec(spec),
        loading: false,
        error: null,
      }
      return {
        drafts,
        openPaths: state.openPaths.map((open) => (open === from ? to : open)),
        selectedPath: state.selectedPath === from ? to : state.selectedPath,
      }
    })
  }

  function patch(path: string, changes: Partial<Draft>) {
    set((state) => ({
      drafts: {
        ...state.drafts,
        [path]: { ...(state.drafts[path] ?? EMPTY), ...changes },
      },
    }))
  }

  async function read(projectId: string, path: string) {
    patch(path, { loading: true, error: null })
    try {
      const raw = await window.desktop.readFile(projectId, path)
      // Dropped if the project changed while the read was in flight — the
      // draft it would land in belongs to a different repository's file.
      if (get().projectId !== projectId) return

      const spec = parseSpec(JSON.parse(raw))
      // `saved` is the serialization of what was parsed, not the bytes that
      // were read: a file with different spacing — or with the older shape
      // this panel migrates — is otherwise dirty the moment it is opened.
      patch(path, { spec, saved: serializeSpec(spec), loading: false })
    } catch (error) {
      if (get().projectId !== projectId) return
      patch(path, {
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function write(projectId: string, path: string) {
    const spec = get().drafts[path]?.spec
    if (!spec) return

    const text = serializeSpec(spec)
    try {
      await window.desktop.writeFile(projectId, path, text)
      if (get().projectId !== projectId) return
      // Only what was actually written is marked saved: more may have been
      // typed while this was in flight, and that is still dirty.
      patch(path, { saved: text, error: null })
    } catch (error) {
      if (get().projectId !== projectId) return
      patch(path, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Follows the open project, the same way the API and databases stores do.
  useStudio.subscribe((studio) => {
    if (studio.projectId === get().projectId) return
    set({
      projectId: studio.projectId,
      paths: [],
      openPaths: [],
      selectedPath: null,
      drafts: {},
    })
    if (studio.projectId) void get().refresh()
  })

  return {
    projectId: useStudio.getState().projectId,
    paths: [],
    openPaths: [],
    selectedPath: null,
    drafts: {},
    emptyFolders: [],

    async createFolder(dir) {
      const { projectId } = get()
      if (!projectId) throw new Error("No project is open.")

      const trimmed = dir.replace(/^\/+|\/+$/g, "")
      if (!trimmed) throw new Error("A folder needs a name.")

      await window.desktop.createDirectory(projectId, trimmed)
      set((state) => ({
        emptyFolders: state.emptyFolders.includes(trimmed)
          ? state.emptyFolders
          : [...state.emptyFolders, trimmed],
      }))
      await get().refresh()
    },

    async renameFolder(from, to) {
      const { projectId } = get()
      if (!projectId) throw new Error("No project is open.")
      if (from === to) return

      await window.desktop.movePath(projectId, from, to)

      // Everything under it moved with it: the open tabs, the selection and
      // the drafts all still name the old paths, and a draft that kept one
      // would write itself back to a directory that no longer exists.
      set((state) => {
        const drafts: typeof state.drafts = {}
        for (const [path, draft] of Object.entries(state.drafts)) {
          drafts[movedInto(path, from, to)] = draft
        }
        return {
          drafts,
          emptyFolders: state.emptyFolders.map((dir) =>
            movedInto(dir, from, to)
          ),
          openPaths: state.openPaths.map((path) => movedInto(path, from, to)),
          selectedPath: state.selectedPath
            ? movedInto(state.selectedPath, from, to)
            : null,
        }
      })
      await get().refresh()
    },

    async removeFolder(dir) {
      const { projectId } = get()
      if (!projectId) throw new Error("No project is open.")

      await window.desktop.deletePath(projectId, dir)

      for (const path of get().openPaths.filter((open) =>
        isInside(open, dir)
      )) {
        get().close(path)
      }
      set((state) => {
        const drafts = { ...state.drafts }
        for (const path of Object.keys(drafts)) {
          if (isInside(path, dir)) delete drafts[path]
        }
        return {
          drafts,
          emptyFolders: state.emptyFolders.filter(
            (folder) => folder !== dir && !isInside(folder, dir)
          ),
        }
      })
      await get().refresh()
    },

    async refresh() {
      const { projectId } = get()
      if (!projectId) return

      // Through the studio's tree so a spec created here shows up in the file
      // sidebar too, rather than only in this panel's own list.
      await useStudio.getState().refreshEntries()
      if (get().projectId !== projectId) return

      const paths = useStudio
        .getState()
        .entries.map((entry) => entry.path)
        .filter((path) => path.endsWith(SPEC_SUFFIX))
        .sort((left, right) => left.localeCompare(right))

      set((state) => ({
        paths,
        // A remembered folder that now holds a spec is no longer something
        // this has to remember — the files say it exists.
        emptyFolders: state.emptyFolders.filter(
          (dir) => !paths.some((path) => isInside(path, dir))
        ),
      }))
    },

    open(path) {
      const { openPaths, drafts, projectId } = get()
      if (!openPaths.includes(path)) set({ openPaths: [...openPaths, path] })
      set({ selectedPath: path })
      useStudio.getState().showPane("spec")

      if (projectId && !drafts[path]) void read(projectId, path)
    },

    select(path) {
      set({ selectedPath: path })
      useStudio.getState().showPane("spec")
    },

    close(path) {
      const { openPaths, selectedPath } = get()
      const index = openPaths.indexOf(path)
      if (index === -1) return

      const remaining = openPaths.filter((_, at) => at !== index)
      set({ openPaths: remaining })
      if (selectedPath !== path) return
      set({ selectedPath: remaining[index] ?? remaining[index - 1] ?? null })
    },

    closeOthers(path) {
      if (!get().openPaths.includes(path)) return
      set({ openPaths: [path], selectedPath: path })
    },

    closeAll() {
      set({ openPaths: [], selectedPath: null })
    },

    reorder(paths) {
      const current = new Set(get().openPaths)
      const reordered = paths.filter((path) => current.has(path))
      if (reordered.length !== current.size) return
      set({ openPaths: reordered })
    },

    edit(path, change) {
      const { projectId, drafts } = get()
      const spec = drafts[path]?.spec
      if (!spec) return

      patch(path, { spec: change(spec) })
      if (!projectId) return

      clearTimeout(pending[path])
      pending[path] = setTimeout(() => {
        delete pending[path]
        void write(projectId, path)
      }, SAVE_DELAY_MS)
    },

    async save(path) {
      const { projectId } = get()
      if (!projectId) return

      clearTimeout(pending[path])
      delete pending[path]
      await write(projectId, path)
    },

    async addImages(path) {
      const { projectId } = get()
      if (!projectId) return

      const sources = await window.desktop.pickImages()
      if (sources.length === 0) return

      const directory = assetsDir(path)
      const added: string[] = []
      try {
        for (const source of sources) {
          added.push(
            await window.desktop.importProjectFile(projectId, source, directory)
          )
        }
      } catch (error) {
        // Whatever copied before the failure is still on disk and still worth
        // recording; the rest is reported rather than silently dropped.
        patch(path, {
          error: error instanceof Error ? error.message : String(error),
        })
      }

      if (added.length === 0 || get().projectId !== projectId) return

      get().edit(path, (current) => ({
        ...current,
        overview: {
          ...current.overview,
          canvas: {
            ...current.overview.canvas,
            // Stacked down the page rather than piled on the origin: two
            // screenshots dropped on top of each other look like one.
            images: [
              ...current.overview.canvas.images,
              ...added.map((src, at) => ({
                src,
                caption: "",
                x: 2,
                y: 2 + (current.overview.canvas.images.length + at) * 40,
                width: 60,
              })),
            ],
          },
        },
      }))
      // The asset directory is new to the project's tree the first time.
      await get().refresh()
    },

    async rename(from, dir, name) {
      const { projectId, drafts } = get()
      if (!projectId) throw new Error("No project is open.")

      const to = targetPath(dir, name)
      if (to === from) return
      if (get().paths.includes(to)) throw new Error(`${to} already exists.`)

      const fromAssets = assetsDir(from)
      const toAssets = assetsDir(to)
      if (hasAssets(fromAssets)) {
        await window.desktop.movePath(projectId, fromAssets, toAssets)
      }

      // Re-read rather than trusting the open draft: the spec may never have
      // been opened, and the file on disk is what is being renamed.
      const spec = drafts[from]?.spec ?? (await readSpec(projectId, from))
      const moved = withAssetsAt(spec, fromAssets, toAssets)

      await window.desktop.writeFile(projectId, to, serializeSpec(moved))
      await window.desktop.deletePath(projectId, from)

      retarget(from, to, moved)
      await get().refresh()
    },

    async duplicate(from, dir, name) {
      const { projectId, drafts } = get()
      if (!projectId) throw new Error("No project is open.")

      const to = targetPath(dir, name)
      if (get().paths.includes(to)) throw new Error(`${to} already exists.`)

      const fromAssets = assetsDir(from)
      const toAssets = assetsDir(to)
      if (hasAssets(fromAssets)) {
        await window.desktop.copyPath(projectId, fromAssets, toAssets)
      }

      const spec = drafts[from]?.spec ?? (await readSpec(projectId, from))
      const copy = withAssetsAt(spec, fromAssets, toAssets)

      await window.desktop.writeFile(projectId, to, serializeSpec(copy))
      patch(to, { spec: copy, saved: serializeSpec(copy), error: null })

      await get().refresh()
      get().open(to)
    },

    async remove(path) {
      const { projectId } = get()
      if (!projectId) throw new Error("No project is open.")

      await window.desktop.deletePath(projectId, path)
      const assets = assetsDir(path)
      if (hasAssets(assets)) {
        await window.desktop.deletePath(projectId, assets)
      }

      get().close(path)
      set((state) => {
        const drafts = { ...state.drafts }
        delete drafts[path]
        return { drafts }
      })
      await get().refresh()
    },

    async create(dir, name) {
      const { projectId } = get()
      if (!projectId) throw new Error("No project is open.")

      const trimmed = dir.replace(/^\/+|\/+$/g, "")
      const path = `${trimmed ? `${trimmed}/` : ""}${name}${SPEC_SUFFIX}`
      if (get().paths.includes(path)) {
        throw new Error(`${path} already exists.`)
      }

      const spec = blankSpec(name)
      const text = serializeSpec(spec)
      await window.desktop.writeFile(projectId, path, text)
      if (get().projectId !== projectId) return

      patch(path, { spec, saved: text, loading: false, error: null })
      await get().refresh()
      get().open(path)
    },
  }
})
