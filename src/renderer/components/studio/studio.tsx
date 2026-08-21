import { useEffect, useState } from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from "@/components/ui/resizable"
import { cn } from "@/lib/utils"
import { MessageSquare } from "lucide-react"

import { useDatabases } from "@/lib/db/databases-store"
import { useFiles } from "@/lib/files/store"
import { useApi } from "@/lib/http/store"
import { watchExpandedDirectories } from "@/lib/files/watch"
import { useNotes } from "@/lib/note/store"
import { useActiveTabId, useHasOpenTabs } from "@/lib/panels"
import { isEditingRichText, isStudioShortcut } from "@/lib/shortcuts"
import { useTerminal } from "@/lib/terminal/store"
import { useAssistant } from "@/lib/assistant/store"
import { useRail } from "@/lib/rail"
import { useSettings } from "@/lib/settings"
import { useStudio, type Pane } from "@/lib/store"
import { ActivityBar } from "./activity-bar"
import { AssistantPanel } from "./assistant/assistant-panel"
import { NewTerminalDialog } from "./terminal/new-terminal-dialog"
import { TerminalWorkspace } from "./terminal/terminal-workspace"
import { ApiWorkspace } from "./api/api-workspace"
import { FileTree } from "./files/file-tree"
import { FileWorkspace } from "./files/file-workspace"
import { RequestList } from "./api/request-list"
import { DatabaseTree } from "./db/database-tree"
import { DatabaseWorkspace } from "./db/database-workspace"
import { AddFolderDialog } from "./add-folder-dialog"
import { CommandPalette } from "./command-palette"
import { NoteList } from "./note/note-list"
import { NoteWorkspace } from "./note/note-workspace"
import { IconButton } from "./icon-button"
import { NothingOpen } from "./nothing-open"
import { SettingsDialog } from "./settings-dialog"
import { SystemBar } from "./system-bar"
import {
  Splash,
  splashElapsed,
  SPLASH_ASSEMBLE_MS,
  SPLASH_FADE_MS,
} from "./splash"
import { TitleBarDragStrip } from "./title-bar"
import { WorkspaceTabs } from "./workspace-tabs"

/** What each pane on the rail shows. Built here rather than inline so the
 * stack below is a list of panes and nothing else. */
function paneView(pane: Pane) {
  switch (pane) {
    case "files":
      return <FileWorkspace />
    case "database":
      return <DatabaseWorkspace />
    case "api":
      return <ApiWorkspace />
    case "note":
      return <NoteWorkspace />
    case "terminal":
      return <TerminalWorkspace />
  }
}

/** How far the launch screen has got: still assembling, fading out over the
 * workbench, or gone. */
type Launch = "splash" | "closing" | "done"

export function Studio() {
  const loaded = useStudio((state) => state.loaded)
  const storageError = useStudio((state) => state.storageError)

  const [launch, setLaunch] = useState<Launch>("splash")

  // Everything the studio holds belongs to the one workspace, so this is the
  // only moment it is read. The ones here rather than in their own panels are
  // the ones that matter before the panel is opened: the databases feed the
  // tree the app starts on, and a note or a file is the kind of thing whose
  // *tab* can be restored onto a pane whose sidebar is not the one showing —
  // the strip cannot draw a tab for something it has never read.
  useEffect(() => {
    void useStudio.getState().init()
    void useSettings.getState().restore()
    void useTerminal.getState().restore()
    void useRail.getState().restore()
    void useDatabases.getState().refresh()
    void useNotes.getState().refresh()
    void useFiles.getState().restore()
  }, [])

  // The assistant's turn belongs to the main process, so the panel is only a
  // view of it — subscribed here rather than in the panel, which is unmounted
  // whenever the chat is closed and would miss the end of a turn it started.
  useEffect(() => useAssistant.getState().listen(), [])

  /*
   * The manifest is a small file on a local disk and usually lands well inside
   * the time the launch screen takes to draw itself, so the wait here is the
   * opposite of the usual one: the workbench is held to the end of the
   * sequence rather than the sequence being held open for the workbench. A
   * splash cut off a third of the way through does not read as a fast app, it
   * reads as a glitch.
   *
   * Two states rather than one because this is a crossfade and not a cut: the
   * workbench mounts when the fade starts and is on screen behind the last of
   * it.
   */
  useEffect(() => {
    if (!loaded || launch !== "splash") return

    const left = Math.max(0, SPLASH_ASSEMBLE_MS - splashElapsed())
    const toClosing = setTimeout(() => setLaunch("closing"), left)
    const toDone = setTimeout(() => setLaunch("done"), left + SPLASH_FADE_MS)
    return () => {
      clearTimeout(toClosing)
      clearTimeout(toDone)
    }
  }, [loaded, launch])

  // A failure has nothing to wait for and nothing to celebrate: it replaces
  // the launch screen outright rather than fading in behind it.
  if (storageError) return <StorageError message={storageError} />

  return (
    <>
      {launch !== "splash" && <Workbench />}
      {launch !== "done" && <Splash closing={launch === "closing"} />}
    </>
  )
}

function Workbench() {
  const pane = useStudio((state) => state.pane)
  const hasOpenTabs = useHasOpenTabs()
  const activeTabId = useActiveTabId(pane)

  const [adding, setAdding] = useState(false)
  /** The Settings dialog — the application menu's ⌘, and nothing else, since
   * a preference is not a thing the workspace holds a row for. */
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Which side the tab strip is on, which is the one preference the workbench
   * itself has to lay out for. */
  const tabsPlacement = useSettings((state) => state.tabsPlacement)
  /** Whether the assistant chat is on screen — the button in the header, and
   * the `X` in the panel's own. */
  const assistantOpen = useAssistant((state) => state.open)
  const toggleAssistant = useAssistant((state) => state.toggle)
  /** The New session picker, asked for by the Explorer sidebar — the `+` on its
   * Sessions list, or a folder's own menu — and mounted here rather than in
   * either, since a dialog held by a sidebar goes when the rail moves. */
  const picking = useTerminal((state) => state.picking)
  const closePicker = useTerminal((state) => state.closePicker)
  /*
   * Which sidebar is showing.
   *
   * On the studio store rather than here, because picking something moves it:
   * a note opened from the tab strip brings the Notes list with it, or the
   * sidebar would be marking a row in a list nobody is looking at. The rail
   * still moves it on its own, which is the half that does *not* touch the
   * pane — a sidebar can be read while another panel's tab stays on screen.
   */
  const section = useStudio((state) => state.section)
  const setSection = useStudio((state) => state.setSection)
  /** Whether the sidebar is showing at all — `⌘B`, the View menu, or a click on
   * the rail icon that is already current. */
  const sidebar = useStudio((state) => state.sidebar)
  const toggleSidebar = useStudio((state) => state.toggleSidebar)
  /** The panels built so far, in the order they were first shown; see the
   * stack below. */
  const [mounted, setMounted] = useState<Pane[]>([])

  // The panel on screen — or none, which `NothingOpen` answers for whichever
  // sidebar is showing.
  //
  // A panel is drawn only when it has a tab to draw: each one used to answer
  // "nothing selected" for itself, which meant whoever opened the app to read
  // a note was told to pick a table, because `database` is the pane a fresh
  // launch starts on. Now the workbench says it once, in terms of the strip,
  // which is what the user is actually looking at.
  const shown = hasOpenTabs && activeTabId ? pane : null

  // Adjusted during the render that first shows a panel rather than in an
  // effect afterwards: an effect would leave one painted frame with the pane
  // empty, and this is the list that mounts what belongs in it.
  if (shown && !mounted.includes(shown)) setMounted([...mounted, shown])

  // The column is drawn only when there is something in it: an empty strip
  // takes no room at the top of the pane, and a preference for tabs on the
  // right should not turn that into a blank band down the side. With nothing
  // open the strip falls back to the row, which is where its "new query tab"
  // button already lives.
  const verticalTabs = tabsPlacement === "right" && hasOpenTabs

  // The File menu is a second way to reach the same dialog — and the only one
  // left when Explorer is taken off the rail. It runs in the main process and
  // cannot open a dialog itself, so it names the command instead.
  useEffect(
    () =>
      window.desktop.onMenuCommand((command) => {
        if (command === "add-folder") setAdding(true)
        if (command === "open-settings") setSettingsOpen(true)
        if (command === "toggle-sidebar") toggleSidebar()
      }),
    [toggleSidebar]
  )

  // A note written by an agent through the MCP server lands in `notes.json`
  // underneath the panel, which is holding the listing it read at launch. The
  // main process says so; this is the panel finding out.
  useEffect(
    () =>
      window.desktop.onNotesChanged(() => void useNotes.getState().refresh()),
    []
  )

  // The same for a request an agent wrote or changed — and it matters more
  // there, because the API panel saves the whole collection at once. `reread`
  // rather than `refresh`: a panel that has never read it has nothing stale to
  // put back.
  useEffect(
    () =>
      window.desktop.onRequestsChanged(() => void useApi.getState().reread()),
    []
  )

  // The tree follows the disk for as long as the workbench is up — here rather
  // than in the Explorer panel, which the rail unmounts every time somebody
  // reads another one.
  useEffect(() => watchExpandedDirectories(), [])

  /*
   * The sidebar's own panel, collapsed rather than unmounted.
   *
   * `collapse()` is the only way to take a `ResizablePanel`'s space back — it
   * has no `collapsed` prop — and it is the right one here anyway: the panel
   * remembers the width it was dragged to and gives it back on `expand()`,
   * where a sidebar taken out of the group would come back at its default. The
   * sidebar it holds is one of five lists, and unmounting is the rail's
   * business, not this.
   */
  const sidebarPanel = usePanelRef()
  useEffect(() => {
    if (sidebar) sidebarPanel.current?.expand()
    else sidebarPanel.current?.collapse()
  }, [sidebar, sidebarPanel])

  /*
   * `⌘B` — the editors' shortcut for the sidebar, and the View menu's item.
   *
   * On the capture phase like the studio's other three, so a focused editor
   * cannot swallow it, with the one exception the letter makes: in a rich-text
   * editor `⌘B` is bold and stays bold (`isEditingRichText`). Nothing else on
   * screen wants the key — Monaco has no binding for it, and off macOS a
   * terminal is refused by `isStudioShortcut` itself, where `Ctrl+B` is tmux's
   * prefix and readline's backward-char.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isStudioShortcut(event, "b")) return
      if (isEditingRichText(event.target)) return

      event.preventDefault()
      toggleSidebar()
    }

    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true })
    }
  }, [toggleSidebar])

  /*
   * The panel on screen, and the notice that stands in for it.
   *
   * A value rather than JSX written twice: the tab strip's two placements are
   * two different boxes around this — a column in a resizable group, or a row
   * above it — and the pane itself is the same either way. `h-full` rather than
   * `flex-1` for that reason: it is a whole panel in one arrangement and a flex
   * child in the other, and the height it wants is its parent's in both.
   *
   * `overflow-hidden` because the panels below are absolutely positioned and so
   * do not clip: a panel that forgot to scroll its own content would otherwise
   * spill past this box and be scrolled by an ancestor, which takes the tab
   * strip off the edge of the window with it.
   */
  const paneContent = (
    <div className="relative h-full min-h-0 min-w-0 overflow-hidden">
      {/*
        Every panel is hidden rather than unmounted, and built the first time it
        is shown — a panel nobody has opened is a connection nobody is reading,
        and the terminal's is a process.

        The terminal had to be kept: its session is a pty with no way to
        reattach, so taking it off the screen would end the conversation. The
        other five want the same for a smaller reason — everything they hold
        that their store does not is lost on a switch, and a panel switched away
        from is coming back. Leaving Database for Notes and returning gave a
        result grid scrolled back to the top, a SQL editor with no undo history
        and the split at its default height; a note came back as a fresh
        ProseMirror over the same text, with the caret at the start.

        `invisible`, not `hidden`: `display: none` destroys the scrolling boxes
        inside, which would put that grid back at the top by another route — and
        it is what the terminal already stacks its own sessions with.
      */}
      {mounted.map((name) => (
        <div
          key={name}
          className={cn("absolute inset-0", name !== shown && "invisible")}
        >
          {paneView(name)}
        </div>
      ))}

      {/* One notice for the whole workbench, rather than each panel's own:
          nothing open at all, or tabs open with none of them on screen. */}
      {!shown && (
        <div className="absolute inset-0">
          <NothingOpen section={section} hasOpenTabs={hasOpenTabs} />
        </div>
      )}
    </div>
  )

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      {/* Doubles as the window's title bar on macOS, where there is no other. */}
      <header className="flex h-11 shrink-0 items-center border-b">
        {/*
          The drag handle — this part of the header and not the whole of it. A
          clickable thing inside a `-webkit-app-region: drag` box has to opt
          back out with `no-drag`, and on macOS that subtraction is unreliable:
          the theme toggle that used to sit here took no clicks at all while its
          `d` shortcut still worked. So the region ends before the button rather
          than being punched through, and nothing clickable is inside it.

          It starts at the window's left edge, under the traffic lights, since
          there is nothing here to clear them: deliberately bare, because the
          workspace holds several folders and each one has a branch of its own,
          so a single line here could only be about one of them — they are
          listed, with their branches, in Explorer.
        */}
        <div className="drag-region h-full min-w-0 flex-1" />

        {/*
          The one thing in the title bar, because it is the one thing that is
          about the whole workspace rather than about a panel: the assistant
          answers with the workspace's own tools, so it has no sidebar to be
          reached from and no folder to belong to.

          Two things here are about clicks landing rather than about looks, and
          neither is why this button once took every other press — that was its
          own tooltip, see `ui/tooltip.tsx` and `side` below.

          It fills the bar's height instead of being a 24px square floating in a
          44px strip, which is what a title-bar control is everywhere else. And
          `no-drag` is claimed even though the button sits outside the drag
          region: macOS keeps a stale drag rect after the element that asked for
          it has gone (electron#20926), and the launch screen draws one across
          this very corner on every run.
        */}
        {/* Wider than the button it holds, on purpose: this is the rect that
            says "not draggable", and it has to cover more than the button in
            case a stale drag rect reaches past where any live one ends. */}
        <div className="no-drag flex h-full shrink-0 items-center pl-3">
          <IconButton
            label={
              assistantOpen ? "Hide assistant" : "Ask about this workspace"
            }
            pressed={assistantOpen}
            onClick={toggleAssistant}
            // Below, because there is no "above" here: this button's top edge is
            // the top of the window, and a tooltip with nowhere to go is what
            // made this button unclickable every other press — see the comment
            // in `ui/tooltip.tsx`.
            side="bottom"
            className="h-11 w-11 rounded-none"
          >
            <MessageSquare />
          </IconButton>
        </div>
      </header>

      {/* No screen of its own for an empty workspace. A folder is what Explorer
          lists and what the Terminal panel runs sessions in, and nothing else
          here is about one — the databases, the requests and the capture server
          belong to the workspace — so a studio held shut until one is added
          would be holding back four panels that had nothing to wait for. Adding
          one is a button in Explorer's own header, and the File menu. */}
      <div className="flex min-h-0 flex-1">
        <ActivityBar
          section={section}
          open={sidebar}
          onSelect={setSection}
          onToggle={toggleSidebar}
        />

        <ResizablePanelGroup
          orientation="horizontal"
          className="min-w-0 flex-1"
        >
          <ResizablePanel
            defaultSize={224}
            minSize={160}
            maxSize={420}
            // Dragging the handle past the minimum closes it too, which is the
            // other half of what `⌘B` does — so the state follows the panel as
            // well as driving it (`onResize` below), or a sidebar dragged shut
            // would leave the rail still marking a section as showing.
            collapsible
            collapsedSize={0}
            panelRef={sidebarPanel}
            onResize={(size, _id, previous) => {
              // `previous` is undefined on mount, where the panel is reporting
              // the width it was handed rather than a change anybody made — and
              // a launch that remembered a closed sidebar starts here, at 224,
              // one frame before the effect above closes it. Read as a drag,
              // that mount would open the sidebar the user left shut.
              if (previous === undefined) return

              const shown = size.inPixels > 0
              if (shown !== useStudio.getState().sidebar) toggleSidebar()
            }}
          >
            {/* The four rail sections, and no fallback: `section` is a
                `Section`, so this list is exhaustive and a fifth would be a
                type error rather than a sidebar nobody wrote. */}
            {section === "files" ? (
              <FileTree onAddFolder={() => setAdding(true)} />
            ) : section === "database" ? (
              <DatabaseTree />
            ) : section === "api" ? (
              <RequestList />
            ) : (
              <NoteList />
            )}
          </ResizablePanel>

          {/* Hidden while the sidebar is, the way the composer's is: the rail
              already draws a border on that edge, so a handle left behind reads
              as a second one — and there is nothing on its left to resize. */}
          <ResizableHandle className={cn(!sidebar && "hidden")} />

          <ResizablePanel minSize={280}>
            {/*
              The strip beside the pane rather than above it, and the boundary
              between them draggable like every other one in the workbench: a
              column of tabs is a list of file names, and how much of a name
              fits is exactly what somebody with a deep tree wants to set for
              themselves.

              A nested group rather than a width this component holds, for the
              reason the sidebar's is a panel too — the drag, the keyboard
              handle and the minimum all come with it. The width is the panel's
              own for the run and is not written down, again like the sidebar's.
            */}
            {verticalTabs ? (
              <ResizablePanelGroup orientation="horizontal">
                <ResizablePanel minSize={240}>{paneContent}</ResizablePanel>

                <ResizableHandle />

                {/* Wide enough for a name and its icon, and capped where a
                    column of tabs would start costing the editor more than the
                    names are worth. */}
                <ResizablePanel defaultSize={224} minSize={140} maxSize={420}>
                  <WorkspaceTabs pane={pane} orientation="vertical" />
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <div className="flex h-full min-w-0 flex-col">
                {/* Outside the panel rather than inside one, which is what keeps
                    a table open on screen while the API panel is the one being
                    looked at. */}
                <WorkspaceTabs pane={pane} orientation="horizontal" />
                {paneContent}
              </div>
            )}
          </ResizablePanel>
          {/* Outside the pane and its tab strip, at the window's right edge: the
              conversation is about the workspace, so it is not one of the
              things the strip holds tabs for. Resizable and collapsible like
              the sidebar opposite it, and unmounted when closed — a chat panel
              nobody has opened is a column of nothing, and the conversation it
              would draw is held by the main process anyway. */}
          {assistantOpen && (
            <>
              <ResizableHandle />
              <ResizablePanel defaultSize={360} minSize={260} maxSize={640}>
                <AssistantPanel />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      <SystemBar />

      {/* Mounted rather than opened from anywhere: the palette is a shortcut
          (⌘P) and owns it, so nothing here has to hold a piece of it. */}
      <CommandPalette />

      {adding && <AddFolderDialog onClose={() => setAdding(false)} />}

      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} />
      )}

      {picking && (
        <NewTerminalDialog
          preferredFolderId={picking.folderId}
          onClose={closePicker}
        />
      )}
    </div>
  )
}

/**
 * Shown when the workspace could not be read.
 *
 * There is deliberately nothing to click: this means `manifest.json` could not
 * be read, and no button the studio could offer would fix a permissions problem
 * or a corrupt file — while a "reset" that deleted the manifest would throw away
 * the workspace, which is the one thing worth keeping. So it says where to look
 * instead.
 */
function StorageError({ message }: { message: string }) {
  return (
    <div className="grid h-svh place-items-center p-6">
      <TitleBarDragStrip />
      <div className="max-w-md space-y-3 text-center">
        <h1 className="font-heading font-medium">
          Could not open your workspace
        </h1>
        <p className="font-mono text-xs text-destructive">{message}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Your workspace is <code className="font-mono">manifest.json</code>{" "}
          under <code className="font-mono">~/.tabomni</code>, listing the
          folders it points at. Those folders are untouched — check that the
          manifest is readable.
        </p>
      </div>
    </div>
  )
}
