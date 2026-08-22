import { useCallback, useEffect, useState } from "react"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import {
  Columns2,
  Copy,
  ExternalLink,
  FolderTree,
  Pilcrow,
  Rows3,
  Save,
} from "lucide-react"

import { relativeTo } from "@/lib/files/paths"
import { fileRootsOf, rootOfPath } from "@/lib/files/roots"
import { isDirty, useFiles, viewOf, type FileDoc } from "@/lib/files/store"
import { viewersFor, type Viewer } from "@/lib/files/viewers"
import { useSettings } from "@/lib/settings"
import { isStudioShortcut } from "@/lib/shortcuts"
import { useStudio } from "@/lib/store"
import { useWorktrees } from "@/lib/worktree/store"
import { SECTION_ACCENT } from "../section-marks"
import { IconButton } from "../icon-button"
import { FileDiff } from "./file-diff"
import { FileEditor } from "./file-editor"
import { FileImage } from "./file-image"
import { FileMarkdown } from "./file-markdown"
import { FileBlocks } from "./file-blocks"

/**
 * The open files, one editor each.
 *
 * Stacked and hidden rather than mounted one at a time, for the reason the
 * Notes pane stacks its editors: a Monaco rebuilt on every tab click is a lost
 * undo history, a caret back at line 1, the folds reset and the scroll position
 * gone. The text was never the cost — the store has it — the editing state was.
 */
export function FileWorkspace() {
  const openIds = useFiles((state) => state.openIds)
  const selectedId = useFiles((state) => state.selectedId)

  /*
   * Whether this panel is the one on screen at all.
   *
   * The workbench stacks every panel it has built and hides the rest with
   * `invisible` (see `studio.tsx`), so a file tab can be the active *file* tab
   * while the pane showing is a chat's. Both halves are needed here: "the tab
   * somebody is looking at" is the active tab **of the panel being looked at**,
   * and a panel that assumes the first implies the second has editors behaving
   * as though they were on screen when they are not.
   *
   * What that cost: a Monaco **diff** editor left live in the hidden panel went
   * on painting its own line numbers and its red and green bands through the
   * chat drawn over it. It also had a note editor in a hidden panel answering
   * the drawing event that only the visible one may answer.
   */
  const paneShown = useStudio((state) => state.pane) === "files"

  const activeId =
    selectedId && openIds.includes(selectedId) ? selectedId : null

  /*
   * ⌘S saves the file on screen.
   *
   * Monaco takes the key for itself while the editor has focus, which is most
   * of the time and not all of it: the tree, the tab strip and this panel's own
   * header can each hold focus with a file open behind them. Claimed on the
   * capture phase and with `preventDefault`, the way the palette claims ⌘P —
   * unclaimed, Chromium reads it as "save this page" and offers to write the
   * studio to disk as HTML.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isStudioShortcut(event, "s")) return
      // Only while this panel is the one showing. The listener is on the window
      // and the panel is hidden rather than unmounted, so without this ⌘S typed
      // into a chat's composer wrote a file tab nobody could see.
      if (!activeId || !paneShown) return

      event.preventDefault()
      void useFiles.getState().save(activeId)
    }

    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true })
    }
  }, [activeId, paneShown])

  return (
    <div className="relative h-full">
      {openIds.map((filePath) => (
        <div
          key={filePath}
          className={cn(
            "absolute inset-0",
            filePath !== activeId && "invisible"
          )}
        >
          <FilePane
            path={filePath}
            visible={filePath === activeId && paneShown}
          />
        </div>
      ))}

      {activeId === null && (
        <Empty className="absolute inset-0 size-full border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon" style={{ color: SECTION_ACCENT.files }}>
              <FolderTree />
            </EmptyMedia>
            <EmptyTitle>No file open</EmptyTitle>
            <EmptyDescription>
              Pick one from the tree on the left.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}

/**
 * One open file: the header row and whichever viewer it is being shown with.
 *
 * Exported for the `Changes` tab, which draws the selected file with exactly
 * this — the same header, the same diff controls, the same ⌘S. A second copy of
 * it there would be two toolbars to keep in step, and a review view whose Save
 * button behaved slightly differently from the one on a file tab.
 *
 * `visible` is "this is the pane on screen **and** the tab it is showing", not
 * merely the latter: see `FileWorkspace`.
 */
export function FilePane({
  path,
  visible,
}: {
  path: string
  visible: boolean
}) {
  const doc = useFiles((state) => state.docs[path])
  const image = useFiles((state) => state.images[path])
  const viewer = useFiles((state) => viewOf(state, path))

  /*
   * Ask for what this pane is about to draw.
   *
   * Opening a file from the tree already reads it, but a tab can reach the
   * screen without that: restored from the last run, or picked up by `close` as
   * the neighbour of the tab that went. The pane is the one place that knows
   * which half it needs, and asking twice costs nothing — the store hands back
   * what it already holds.
   */
  useEffect(() => {
    void useFiles.getState().ensureLoaded(path, viewer)
  }, [path, viewer])
  const setText = useFiles((state) => state.setText)
  const save = useFiles((state) => state.save)

  /** A failed write, shown against the file it belongs to — a read-only file,
   * or one whose directory has gone since it was opened. */
  const [failure, setFailure] = useState<string | null>(null)

  const dirty = isDirty(doc)

  /* Which root this file is in, subscribed rather than read: a checkout removed
   * under an open tab has to fall back to the absolute path rather than keep
   * drawing a name relative to a root that has gone. */
  const folders = useStudio((state) => state.folders)
  const worktrees = useWorktrees((state) => state.worktrees)
  const root = rootOfPath(fileRootsOf(folders, worktrees), path)
  const label = (root && relativeTo(root.path, path)) || path

  const write = useCallback(
    (text: string) => {
      setText(path, text)
      // The previous failure was about text that has since been typed over;
      // leaving it up would have it outlive what it was about.
      setFailure(null)
    },
    [path, setText]
  )

  const commit = useCallback(() => {
    void save(path).then(setFailure)
  }, [path, save])

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        {/* The path **in the checkout's own terms**, and the whole of it only
            on the hover line. A worktree lives under
            `~/.tabomni/workspace/worktrees/<uuid>/<branch>/`, so the absolute
            path spent forty characters on where this app keeps its checkouts
            before reaching anything about the file — and truncating from the
            left is what put `…/hhh/bbb.txt` in a header that had room for
            `bbb.txt`. Copy path and Reveal still deal in the absolute one,
            since that is what the OS and a terminal want. */}
        <span
          title={path}
          className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
        >
          {label}
        </span>

        {dirty && (
          <span className="shrink-0 text-[0.65rem] text-muted-foreground">
            Unsaved
          </span>
        )}

        {/* The diff's own controls, in the row that already holds this file's:
            how the two sides are laid out and whether whitespace is drawn are
            questions about the thing on screen, and a second strip under this
            one would be two toolbars for one pane. */}
        {viewer === "diff" && <DiffControls />}

        {/* Only between these two, and only when one of them is showing. A `.md`
            can also be a preview or a block editor, and a segmented pair cannot
            say which of three is on without lying about the other two — that
            menu is the tree's right-click, which offers all of them. */}
        {(viewer === "diff" || viewer === "text") &&
          viewersFor(path).includes("diff") && (
            <ViewerSwitch path={path} viewer={viewer} />
          )}

        {/* Shown for every document, including the ones with no editor: a
            picture still has a path worth copying and a place in Finder worth
            opening. Save stays put rather than disappearing in the image
            view — a control that moves between viewers is one the eye has to
            find again. */}
        <IconButton
          label="Save"
          disabled={!dirty}
          onClick={commit}
          className="shrink-0"
        >
          <Save />
        </IconButton>
        <IconButton
          label="Copy path"
          onClick={() => void navigator.clipboard.writeText(path)}
          className="shrink-0"
        >
          <Copy />
        </IconButton>
        <IconButton
          label="Reveal in file manager"
          onClick={() => void window.desktop.revealPath(path)}
          className="shrink-0"
        >
          <ExternalLink />
        </IconButton>
      </div>

      {failure && (
        <p className="shrink-0 border-b bg-destructive/10 px-3 py-1.5 font-mono text-xs text-destructive">
          {failure}
        </p>
      )}

      <div className="min-h-0 flex-1">
        {viewer === "image" ? (
          <FileImage image={image ?? { kind: "loading" }} alt={path} />
        ) : (
          <Body
            path={path}
            doc={doc}
            viewer={viewer}
            visible={visible}
            onChange={write}
            onSave={commit}
          />
        )}
      </div>
    </div>
  )
}

/** What the pane draws for a document — the editor, the rendered markdown, or
 * the reason there is neither. The notices below are shared by both: a file too
 * large to edit is one no preview could render either. */
function Body({
  path,
  doc,
  viewer,
  visible,
  onChange,
  onSave,
}: {
  path: string
  doc: FileDoc | undefined
  viewer: Viewer
  /** Whether this pane is the one on screen — the note editor needs it, since
   * the stacked editors share the drawing event and only the visible one may
   * answer it. */
  visible: boolean
  onChange: (text: string) => void
  onSave: () => void
}) {
  if (doc === undefined || doc.kind === "loading") {
    return <Notice title="Reading…" />
  }

  if (doc.kind === "binary") {
    return (
      <Notice
        title="Not a text file"
        detail="There is nothing here an editor could show without corrupting it on the way back out. Reveal it to open it in whatever does read this format."
      />
    )
  }

  if (doc.kind === "too-large") {
    return (
      <Notice
        title="Too large to open"
        detail={`${(doc.size / (1024 * 1024)).toFixed(1)} MB. Files this size are the ones that hang an editor rather than the ones somebody reads, so the studio leaves them on disk.`}
      />
    )
  }

  /*
   * Above the error below, and deliberately.
   *
   * A **deleted** file cannot be read and is exactly the file whose diff
   * somebody wants: it is a row in the Changes list, it has no row in the tree
   * at all, and "could not open this file" is the least useful thing to say
   * about it. So the right-hand side is empty and the left is what was
   * committed, which is what its diff *is*.
   *
   * Nothing to guard there any more: **the diff is read-only whatever it is
   * showing** (`monaco-diff.tsx`), so a deleted file is a diff of a file that is
   * gone rather than a pane taking keystrokes the store would drop. Writing one
   * back would be a way to undelete it — a different feature, and not one to
   * arrive at by typing.
   *
   * Not above `binary` or `too-large`, which are honest for a diff too: two
   * versions of a megabyte of one line is not a thing to render.
   */
  if (viewer === "diff") {
    /*
     * Unmounted while it is off screen, unlike every other editor here.
     *
     * The stacking exists to keep editing state — an undo history, a caret, the
     * folds — and a diff has none of that worth keeping: the right-hand side is
     * the file's own path-keyed model, which the text editor holds either way,
     * so what is lost by rebuilding is a scroll position. Set against that, a
     * diff editor that is merely `invisible` was drawing its line numbers and
     * its bands over whatever pane was actually showing.
     */
    if (!visible) return null

    return (
      <FileDiff
        // Same key rule as the editor below: the path is the identity.
        key={path}
        path={path}
        initialText={doc.kind === "text" ? doc.text : ""}
        onChange={onChange}
        onSave={onSave}
      />
    )
  }

  if (doc.kind === "error") {
    return <Notice title="Could not open this file" detail={doc.message} />
  }

  if (viewer === "markdown") return <FileMarkdown text={doc.text} />

  if (viewer === "blocks") {
    return (
      <FileBlocks
        // The path is the identity here too — a renamed file is a fresh editor
        // rather than one holding a document from a name that has moved.
        key={path}
        path={path}
        // What was read, not what has been typed: the editor takes its document
        // once, and `text` is what it will be writing back.
        text={doc.text}
        onChange={onChange}
        visible={visible}
      />
    )
  }

  return (
    <FileEditor
      // The path is the identity, so a renamed file gets a new editor rather
      // than one pointed at a name that no longer exists — and with it the
      // highlighting its new extension asks for.
      key={path}
      path={path}
      // `text`, not `saved`: on the one path where an open editor is rebuilt
      // — a rename, which changes the key — what is in the buffer is what
      // should come back, not what the file held before it was typed into.
      initialText={doc.text}
      onChange={onChange}
      onSave={onSave}
    />
  )
}

/**
 * `Diff` and `Edit`, over the same `views` field the tree's "open with" writes.
 *
 * A pair of buttons rather than a toggle: which of the two is showing has to be
 * readable, and "the one that is not pressed is what you would get" is a thing
 * to work out rather than read. `Edit` goes to `text` rather than to
 * `defaultViewer`, which for a `.md` is the same thing and for a `.note` is the
 * block editor — a control labelled `Edit` beside a diff of a file's text means
 * that text.
 */
function ViewerSwitch({ path, viewer }: { path: string; viewer: Viewer }) {
  return (
    <div className="flex shrink-0 items-center rounded-md border p-0.5">
      <SwitchButton
        label="Diff"
        on={viewer === "diff"}
        onClick={() => void useFiles.getState().setView(path, "diff")}
      />
      <SwitchButton
        label="Edit"
        on={viewer === "text"}
        onClick={() => void useFiles.getState().setView(path, "text")}
      />
    </div>
  )
}

function SwitchButton({
  label,
  on,
  onClick,
}: {
  label: string
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-5 rounded-[0.25rem] px-2 text-[0.7rem] transition-colors",
        on
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  )
}

/**
 * How the diff is drawn: two columns or one, and whitespace or not.
 *
 * Both are `useSettings`, so the choice outlives this tab and this launch — how
 * somebody reads a diff is not a property of the file they happen to have open.
 *
 * The layout pair is segmented with the current one lit, rather than one button
 * that swaps its icon: a single icon has to stand either for the mode you are in
 * or for the mode you would get, and whichever it means, half the people reading
 * it will take it for the other. `pressed` on `IconButton` is only
 * `aria-pressed` — it says so to a screen reader and nothing to the eye — which
 * is why the on state here is drawn.
 */
function DiffControls() {
  const sideBySide = useSettings((state) => state.diffSideBySide)
  const setSideBySide = useSettings((state) => state.setDiffSideBySide)
  const whitespace = useSettings((state) => state.diffWhitespace)
  const setWhitespace = useSettings((state) => state.setDiffWhitespace)

  return (
    <div className="flex shrink-0 items-center gap-1">
      <div className="flex items-center rounded-md border p-0.5">
        <IconButton
          label="Inline"
          pressed={!sideBySide}
          className={cn("size-5", !sideBySide && ON)}
          onClick={() => setSideBySide(false)}
        >
          <Rows3 />
        </IconButton>
        <IconButton
          label="Side by side"
          pressed={sideBySide}
          className={cn("size-5", sideBySide && ON)}
          onClick={() => setSideBySide(true)}
        >
          <Columns2 />
        </IconButton>
      </div>

      <IconButton
        label="Show whitespace"
        pressed={whitespace}
        className={cn("shrink-0", whitespace && ON)}
        onClick={() => setWhitespace(!whitespace)}
      >
        <Pilcrow />
      </IconButton>
    </div>
  )
}

/** What a toggle in this row looks like while it is on. */
const ON = "bg-accent text-accent-foreground"

function Notice({ title, detail }: { title: string; detail?: string }) {
  return (
    <Empty className="size-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon" style={{ color: SECTION_ACCENT.files }}>
          <FolderTree />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {detail && <EmptyDescription>{detail}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  )
}
