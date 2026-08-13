import { create } from "zustand"

import type { FileEntry, FileIndexEntry } from "@shared/api"
import { useStudio } from "../store"
import { isRememberedTabs, recall, remember } from "../tab-memory"
import { useConversations } from "../terminal/conversations"
import { isInside, movedPath, parentOf } from "./paths"
import { defaultViewer, type Viewer } from "./viewers"

/** Which files were open in the strip, and which was on screen. */
const OPEN_TABS_KEY = "files.tabs"

/**
 * A file as the pane holds it.
 *
 * `saved` is what is on disk as far as this app knows, and `text` is what the
 * editor has: the difference between them is the dirty dot, and there is no
 * third place recording it. Reading them apart is also what makes an undo back
 * to the original mark the tab clean again, the way an editor does.
 *
 * The two refusals and the failure are documents too, so the pane always has
 * something to draw for a tab that is open — the alternative was a tab whose
 * pane was blank while a read failed.
 */
export type FileDoc =
  | { kind: "loading" }
  | { kind: "text"; text: string; saved: string }
  | { kind: "binary" }
  | { kind: "too-large"; size: number }
  | { kind: "error"; message: string }

/**
 * A file being shown as a picture.
 *
 * Its own record rather than another `FileDoc` kind, because an SVG can be
 * both at once: switching an open SVG to the text editor and back must not
 * re-read either half, and one slot per path could only hold whichever was
 * asked for last.
 */
export type ImageDoc =
  | { kind: "loading" }
  | { kind: "image"; src: string }
  | { kind: "error"; message: string }

export function isDirty(doc: FileDoc | undefined): boolean {
  return doc?.kind === "text" && doc.text !== doc.saved
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type FilesState = {
  /**
   * Each directory that has been expanded, and what was in it when it was last
   * read.
   *
   * The tree is a cache of one `readdir` per open folder rather than a walk of
   * the workspace: a repository holds more files than anybody wants listed, and
   * the ones under a folded folder are ones nobody has asked about. Nothing
   * watches these — a session in the Terminal panel writing a file is not
   * reflected here until the folder is refreshed, which is what the Refresh
   * button in the header is for.
   */
  entries: Record<string, FileEntry[]>
  /** Directories drawn open, whether or not their listing has arrived. */
  expanded: string[]
  /** Directories with a read in flight, for the spinner on the row. */
  loading: string[]
  /** Why a directory could not be read — a permissions error, or a folder that
   * has been moved out from under the workspace. */
  errors: Record<string, string>

  docs: Record<string, FileDoc>
  /** Images read for the pane, keyed by path — see `ImageDoc`. */
  images: Record<string, ImageDoc>
  /**
   * How a file is being shown, where that is not what its extension implies.
   *
   * Only the paths somebody has actually changed: everything else follows
   * `defaultViewer`, so a workspace nobody has right-clicked in carries no
   * state at all. Kept for the run rather than written to disk — which viewer
   * an SVG was last opened with is a smaller thing than a tab, and the strip
   * already restores those.
   */
  views: Record<string, Viewer>
  /** Files with a tab open, oldest first. Ids here are absolute paths. */
  openIds: string[]
  selectedId: string | null

  /**
   * Every file in the workspace, for the search palette — empty until it is
   * asked for.
   *
   * The one thing this store holds that is not about a directory somebody
   * opened. `⌘P` has to answer for files no folder in the tree has been
   * expanded to, and nothing else here can: the tree is what has been looked
   * at, and this is what is there.
   */
  index: FileIndexEntry[]
  indexing: boolean

  /**
   * Walks the workspace for the palette, once per run.
   *
   * `force` re-walks: the Explorer's Refresh uses it, since a file created in
   * a terminal since the last walk is exactly the file somebody then cannot
   * find in the palette.
   */
  loadIndex: (force?: boolean) => Promise<void>

  /** Opens every folder above `filePath`, so a file reached from the palette
   * is also where the tree says it is. */
  reveal: (filePath: string) => Promise<void>

  /** Reads a directory and keeps it. Safe to call for one already read — it is
   * also the refresh. */
  read: (dir: string) => Promise<void>
  toggle: (dir: string) => void
  /** Re-reads every directory currently open, and every open file that has no
   * unsaved edits. */
  refresh: () => Promise<void>
  collapseAll: () => void

  /** Opens a file into the pane, reading it the first time. */
  open: (filePath: string) => Promise<void>
  /** Shows an open file another way — the tree's "open with". Reads whichever
   * half of it has not been read yet. */
  setView: (filePath: string, viewer: Viewer) => Promise<void>
  /**
   * Reads what a viewer needs, if it has not been read already.
   *
   * For the pane, which is the one thing that knows what it is about to draw.
   * A tab can reach the screen without having gone through `open` — restored
   * from the last run, or picked up by `close` as the neighbour of the tab that
   * went — and before this, such a tab drew "Reading…" until something else
   * happened to load it.
   */
  ensureLoaded: (filePath: string, viewer: Viewer) => Promise<void>
  select: (filePath: string) => void
  close: (filePath: string) => void
  closeOthers: (filePath: string) => void
  closeAll: () => void
  reorder: (paths: string[]) => void

  /** What the editor typed. Not written until `save`. */
  setText: (filePath: string, text: string) => void
  /** Writes one file back, resolving to why it could not be written, or null. */
  save: (filePath: string) => Promise<string | null>

  create: (dir: string, name: string) => Promise<string>
  createFolder: (dir: string, name: string) => Promise<string>
  rename: (target: string, name: string) => Promise<string>
  /** To the system trash, and closes whatever tabs it took with it. */
  trash: (target: string) => Promise<void>

  /** Restores the strip. Idempotent: Strict Mode mounts twice. */
  restore: () => Promise<void>
}

export const useFiles = create<FilesState>((set, get) => {
  let restorePromise: Promise<void> | null = null
  /** The walk in flight, so two panels asking at once share one. */
  let indexPromise: Promise<void> | null = null

  function rememberTabs() {
    const { openIds, selectedId } = get()
    remember(OPEN_TABS_KEY, { openIds, selectedId })
  }

  /** Adds or replaces one document. */
  function setDoc(filePath: string, doc: FileDoc) {
    set((state) => ({ docs: { ...state.docs, [filePath]: doc } }))
  }

  function setImage(filePath: string, image: ImageDoc) {
    set((state) => ({ images: { ...state.images, [filePath]: image } }))
  }

  /**
   * Reads whichever half a viewer needs, once.
   *
   * Both halves are kept: an SVG switched to the text editor and back is not
   * re-read, and neither is a picture whose tab has been away and come back.
   */
  async function load(filePath: string, viewer: Viewer): Promise<void> {
    if (viewer === "image") {
      if (get().images[filePath] !== undefined) return
      setImage(filePath, { kind: "loading" })
      setImage(filePath, await readImage(filePath))
      return
    }

    if (get().docs[filePath] !== undefined) return
    setDoc(filePath, { kind: "loading" })
    setDoc(filePath, await readDoc(filePath))
  }

  /**
   * Writes a file if it has unsaved edits, and does nothing otherwise.
   *
   * Closing a tab flushes rather than prompting. It is the same bargain the
   * Notes panel makes and for the same reason — the edit was deliberate, and a
   * three-button "save / discard / cancel" is a dialog in the way of the common
   * case — but the file here is somebody's source, so ⌘S is still the way it is
   * normally written and the dot says when it has not been.
   */
  function flush(filePath: string) {
    if (!isDirty(get().docs[filePath])) return
    void get().save(filePath)
  }

  /** Forgets everything read for paths that are no longer in the workspace. */
  function prune(roots: string[]) {
    const inside = (target: string) =>
      roots.some((root) => isInside(root, target))

    const { entries, expanded, openIds, selectedId, docs, images, views } =
      get()
    const keptOpen = openIds.filter(inside)
    if (
      keptOpen.length === openIds.length &&
      expanded.every(inside) &&
      Object.keys(entries).every(inside)
    ) {
      return
    }

    set({
      entries: Object.fromEntries(
        Object.entries(entries).filter(([dir]) => inside(dir))
      ),
      expanded: expanded.filter(inside),
      docs: Object.fromEntries(
        Object.entries(docs).filter(([filePath]) => inside(filePath))
      ),
      images: Object.fromEntries(
        Object.entries(images).filter(([filePath]) => inside(filePath))
      ),
      views: Object.fromEntries(
        Object.entries(views).filter(([filePath]) => inside(filePath))
      ),
      openIds: keptOpen,
      selectedId:
        selectedId && keptOpen.includes(selectedId)
          ? selectedId
          : (keptOpen[0] ?? null),
    })
    rememberTabs()
  }

  // A folder dropped from the workspace takes its files' tabs with it, the way
  // the Terminal store drops that folder's sessions: the panel is not allowed
  // to read there any more, so a tab onto it could only fail.
  useStudio.subscribe((studio) => {
    // Not before the workspace has been read: there is a moment during
    // `init` where the studio is `loaded` and its folders have not arrived,
    // and pruning against an empty list there would close every tab this
    // store had just restored.
    if (!studio.loaded) return
    prune(studio.folders.map((folder) => folder.path))
  })

  return {
    entries: {},
    expanded: [],
    loading: [],
    errors: {},
    docs: {},
    images: {},
    views: {},
    openIds: [],
    selectedId: null,
    index: [],
    indexing: false,

    loadIndex(force = false) {
      if (force) indexPromise = null
      indexPromise ??= (async () => {
        set({ indexing: true })
        try {
          set({ index: await window.desktop.listWorkspaceFiles() })
        } catch (error) {
          // Nothing on screen: the palette still lists everything else, and a
          // walk that failed is a palette missing a group rather than a broken
          // one.
          console.error("Could not index the workspace's files", error)
          indexPromise = null
        } finally {
          set({ indexing: false })
        }
      })()
      return indexPromise
    },

    async reveal(filePath) {
      const root = useStudio
        .getState()
        .folders.map((folder) => folder.path)
        .find((candidate) => isInside(candidate, filePath))
      if (root === undefined) return

      // From the file up to the folder, then opened from the folder down, so
      // each level is drawn under the one that holds it.
      const chain: string[] = []
      let dir = parentOf(filePath)
      while (isInside(root, dir)) {
        chain.unshift(dir)
        if (dir === root) break
        const above = parentOf(dir)
        // A path that is its own parent has nowhere left to go — the guard
        // that keeps a malformed path from spinning here forever.
        if (above === dir) break
        dir = above
      }

      // Only the folders that were shut, and only their listings: revealing
      // runs on every tab click, and re-reading a chain that is already open
      // would be a `readdir` per level per click.
      const shut = chain.filter((entry) => !get().expanded.includes(entry))
      if (shut.length > 0)
        set((state) => ({ expanded: [...state.expanded, ...shut] }))

      for (const entry of chain) {
        if (get().entries[entry] === undefined) await get().read(entry)
      }
    },

    async read(dir) {
      set((state) => ({
        loading: state.loading.includes(dir)
          ? state.loading
          : [...state.loading, dir],
      }))

      try {
        const listing = await window.desktop.listDirectory(dir)
        set((state) => ({
          entries: { ...state.entries, [dir]: listing },
          errors: Object.fromEntries(
            Object.entries(state.errors).filter(([key]) => key !== dir)
          ),
        }))
      } catch (error) {
        set((state) => ({
          errors: { ...state.errors, [dir]: messageOf(error) },
        }))
      } finally {
        set((state) => ({
          loading: state.loading.filter((entry) => entry !== dir),
        }))
      }
    },

    toggle(dir) {
      const { expanded } = get()
      if (expanded.includes(dir)) {
        set({ expanded: expanded.filter((entry) => entry !== dir) })
        return
      }

      // Drawn at once from whatever was read last time and re-read behind it,
      // so a folder opened a second time never blinks through an empty row.
      set({ expanded: [...expanded, dir] })
      void get().read(dir)
    },

    async refresh() {
      const { expanded, openIds, docs } = get()
      await Promise.all([
        // The palette's index goes stale the same way the tree does, and by
        // the same button — but only once there is one. Refresh keeps what has
        // been read up to date; it does not walk the workspace for a palette
        // nobody has opened yet.
        ...(get().index.length > 0 ? [get().loadIndex(true)] : []),
        ...expanded.map((dir) => get().read(dir)),
        // A file with unsaved edits is left exactly as it is: refreshing is
        // asking about the disk, not throwing away what has been typed.
        ...openIds
          .filter((filePath) => !isDirty(docs[filePath]))
          .map(async (filePath) => {
            if (get().docs[filePath] !== undefined) {
              setDoc(filePath, await readDoc(filePath))
            }
            // The picture too, and by the same button: an icon regenerated by
            // a build is the case this is actually for.
            if (get().images[filePath] !== undefined) {
              setImage(filePath, { kind: "loading" })
              set((state) => ({
                images: Object.fromEntries(
                  Object.entries(state.images).filter(
                    ([entry]) => entry !== filePath
                  )
                ),
              }))
              await load(filePath, "image")
            }
          }),
      ])
    },

    collapseAll() {
      set({ expanded: [] })
    },

    async open(filePath) {
      get().select(filePath)
      await load(filePath, viewOf(get(), filePath))
    },

    ensureLoaded(filePath, viewer) {
      return load(filePath, viewer)
    },

    async setView(filePath, viewer) {
      set((state) => ({ views: { ...state.views, [filePath]: viewer } }))
      await load(filePath, viewer)
    },

    select(filePath) {
      useStudio.getState().showPane("files")
      // This pane holds two lists — files, and the conversations opened from
      // the sidebar below the tree — and only one screen. Picking a file is
      // what says the screen is a file's.
      useConversations.getState().blur()
      // The tree follows whatever lands in the pane, wherever it was picked —
      // a tab in the strip, the palette, a definition jumped to. `SideRow`
      // scrolls the row into view once the folders holding it are open, which
      // is what this is for.
      void get().reveal(filePath)
      const { openIds } = get()
      set({
        selectedId: filePath,
        openIds: openIds.includes(filePath) ? openIds : [...openIds, filePath],
      })
      rememberTabs()
    },

    close(filePath) {
      const { openIds, selectedId } = get()
      const index = openIds.indexOf(filePath)
      if (index === -1) return

      // Before the tab goes: the editor unmounts with it, and an unsaved edit
      // would have nowhere left to be written from.
      flush(filePath)

      const remaining = openIds.filter((_, position) => position !== index)
      set({
        openIds: remaining,
        selectedId:
          selectedId === filePath
            ? (remaining[index] ?? remaining[index - 1] ?? null)
            : selectedId,
      })
      rememberTabs()
    },

    closeOthers(filePath) {
      for (const openId of get().openIds) {
        if (openId !== filePath) flush(openId)
      }
      set({ openIds: [filePath], selectedId: filePath })
      rememberTabs()
    },

    closeAll() {
      for (const openId of get().openIds) flush(openId)
      set({ openIds: [], selectedId: null })
      rememberTabs()
    },

    reorder(paths) {
      const { openIds } = get()
      const reordered = paths.filter((filePath) => openIds.includes(filePath))
      if (reordered.length !== openIds.length) return
      set({ openIds: reordered })
      rememberTabs()
    },

    setText(filePath, text) {
      const doc = get().docs[filePath]
      if (doc?.kind !== "text" || doc.text === text) return
      setDoc(filePath, { ...doc, text })
    },

    async save(filePath) {
      const doc = get().docs[filePath]
      if (doc?.kind !== "text") return null

      const { text } = doc
      try {
        await window.desktop.writeTextFile(filePath, text)
      } catch (error) {
        return messageOf(error)
      }

      // Against what was written rather than what the editor holds now: typing
      // continued while the write was in flight is still unsaved, and marking
      // the tab clean would lose it silently.
      const current = get().docs[filePath]
      if (current?.kind === "text") {
        setDoc(filePath, { ...current, saved: text })
      }
      return null
    },

    async create(dir, name) {
      const created = await window.desktop.createFile(dir, name)
      await get().read(dir)
      await get().open(created)
      return created
    },

    async createFolder(dir, name) {
      const created = await window.desktop.createDirectory(dir, name)
      await get().read(dir)
      // Opened, because somebody who just made a folder is about to put
      // something in it.
      if (!get().expanded.includes(created)) get().toggle(created)
      return created
    },

    async rename(target, name) {
      const renamed = await window.desktop.renamePath(target, name)
      await get().read(parentOf(target))

      // The path is the identity here, so a rename is a different file as far
      // as every other part of this store is concerned: the tab, the document
      // and any listing under it are moved across by hand.
      const { openIds, selectedId, docs, images, views, expanded, entries } =
        get()
      const moved = (filePath: string) => movedPath(filePath, target, renamed)

      set({
        openIds: openIds.map(moved),
        selectedId: selectedId === null ? null : moved(selectedId),
        expanded: expanded.map(moved),
        docs: Object.fromEntries(
          Object.entries(docs).map(([filePath, doc]) => [moved(filePath), doc])
        ),
        images: Object.fromEntries(
          Object.entries(images).map(([filePath, image]) => [
            moved(filePath),
            image,
          ])
        ),
        // A rename can change the extension, and with it what the file is by
        // default — but not what the user asked for it, which is why the
        // choice travels rather than being dropped.
        views: Object.fromEntries(
          Object.entries(views).map(([filePath, viewer]) => [
            moved(filePath),
            viewer,
          ])
        ),
        entries: Object.fromEntries(
          Object.entries(entries).map(([dir, listing]) => [
            moved(dir),
            listing.map((entry) => ({ ...entry, path: moved(entry.path) })),
          ])
        ),
      })
      rememberTabs()
      return renamed
    },

    async trash(target) {
      await window.desktop.trashPath(target)
      await get().read(parentOf(target))

      // Everything under it goes too — a directory takes its files' tabs with
      // it, and none of them can be saved back to a path that is now in the
      // trash. Closed without flushing, deliberately: the file is gone, and a
      // write would put half of it back.
      const { openIds, selectedId, expanded, docs, images, views, entries } =
        get()
      const gone = (filePath: string) => isInside(target, filePath)

      const remaining = openIds.filter((filePath) => !gone(filePath))
      set({
        openIds: remaining,
        selectedId:
          selectedId && gone(selectedId) ? (remaining[0] ?? null) : selectedId,
        expanded: expanded.filter((dir) => !gone(dir)),
        docs: Object.fromEntries(
          Object.entries(docs).filter(([filePath]) => !gone(filePath))
        ),
        images: Object.fromEntries(
          Object.entries(images).filter(([filePath]) => !gone(filePath))
        ),
        views: Object.fromEntries(
          Object.entries(views).filter(([filePath]) => !gone(filePath))
        ),
        entries: Object.fromEntries(
          Object.entries(entries).filter(([dir]) => !gone(dir))
        ),
      })
      rememberTabs()
    },

    restore() {
      restorePromise ??= (async () => {
        const stored = await recall(OPEN_TABS_KEY, isRememberedTabs)
        if (!stored || get().openIds.length > 0) return

        /*
         * Every remembered tab is read back: a file deleted or renamed since
         * the last launch is a path that names nothing, and it is the read
         * that says so rather than anything this app kept.
         *
         * Read by the viewer each one will be shown with, not always as text.
         * A restored picture read as text came back "binary" — enough to keep
         * the tab, and nothing the image view could draw, so it sat on
         * "Reading…" until something else went through `open`.
         */
        const read = await Promise.all(
          stored.openIds.map(async (filePath) => {
            const viewer = defaultViewer(filePath)
            return [
              filePath,
              viewer,
              viewer === "image"
                ? await readImage(filePath)
                : await readDoc(filePath),
            ] as const
          })
        )

        const kept = read.filter(([, , result]) => result.kind !== "error")
        const openIds = kept.map(([filePath]) => filePath)
        if (openIds.length === 0) return

        set((state) => ({
          docs: {
            ...state.docs,
            ...Object.fromEntries(
              kept
                // Everything that is not a picture was read as text — the
                // markdown preview draws the same `docs` entry the editor does.
                .filter(([, viewer]) => viewer !== "image")
                .map(([filePath, , result]) => [filePath, result as FileDoc])
            ),
          },
          images: {
            ...state.images,
            ...Object.fromEntries(
              kept
                .filter(([, viewer]) => viewer === "image")
                .map(([filePath, , result]) => [filePath, result as ImageDoc])
            ),
          },
          openIds,
          selectedId:
            stored.selectedId && openIds.includes(stored.selectedId)
              ? stored.selectedId
              : (openIds[0] ?? null),
        }))
      })()
      return restorePromise
    },
  }
})

/** How a file is being shown: what the user chose for it, or what its
 * extension implies. */
export function viewOf(
  state: { views: Record<string, Viewer> },
  filePath: string
): Viewer {
  return state.views[filePath] ?? defaultViewer(filePath)
}

/** One image read into the shape the image view draws — a failure is a
 * document too, for the same reason a failed text read is. */
async function readImage(filePath: string): Promise<ImageDoc> {
  try {
    return { kind: "image", src: await window.desktop.readImageFile(filePath) }
  } catch (error) {
    return { kind: "error", message: messageOf(error) }
  }
}

/** One file read into the shape the pane draws — including the two refusals and
 * the failure, which are documents rather than exceptions here. */
async function readDoc(filePath: string): Promise<FileDoc> {
  try {
    const content = await window.desktop.readTextFile(filePath)
    return content.kind === "text"
      ? { kind: "text", text: content.text, saved: content.text }
      : content
  } catch (error) {
    return { kind: "error", message: messageOf(error) }
  }
}
