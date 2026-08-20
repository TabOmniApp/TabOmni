import { useCallback, useEffect, useState } from "react"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import { Copy, ExternalLink, FolderTree, Save } from "lucide-react"

import { isDirty, useFiles, viewOf, type FileDoc } from "@/lib/files/store"
import type { Viewer } from "@/lib/files/viewers"
import { isStudioShortcut } from "@/lib/shortcuts"
import { SECTION_ACCENT } from "../activity-bar"
import { IconButton } from "../icon-button"
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
      if (!activeId) return

      event.preventDefault()
      void useFiles.getState().save(activeId)
    }

    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true })
    }
  }, [activeId])

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
          <FilePane path={filePath} visible={filePath === activeId} />
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

function FilePane({ path, visible }: { path: string; visible: boolean }) {
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
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {path}
        </span>

        {dirty && (
          <span className="shrink-0 text-[0.65rem] text-muted-foreground">
            Unsaved
          </span>
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
