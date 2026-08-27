import { useEffect, useState } from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from "@/components/ui/resizable"
import { cn } from "@/lib/utils"
import { PanelBottom, PanelLeft } from "lucide-react"

import { useDatabases } from "@/lib/db/databases-store"
import { useFiles } from "@/lib/files/store"
import { useApi } from "@/lib/http/store"
import { watchExpandedDirectories } from "@/lib/files/watch"
import { useNotes } from "@/lib/note/store"
import { reconcileScope, useActiveTabId, useHasOpenTabs } from "@/lib/panels"
import { isEditingRichText, isStudioShortcut } from "@/lib/shortcuts"
import { useSettings } from "@/lib/settings"
import { useDock } from "@/lib/dock"
import { useStudio, type Pane } from "@/lib/store"
import { useRun } from "@/lib/run/store"
import { useProjects } from "@/lib/projects"
import { useClaudeProfiles } from "@/lib/worktree-chat/claude-profiles"
import { useWorktreeChats } from "@/lib/worktree-chat/store"
import { Dock } from "./dock"
import { ProjectCrumbs } from "./project/project-crumbs"
import { WorkspaceSidebar } from "./workspace-sidebar"
import { WorktreeChatPane } from "./worktree/chat-pane"
import { ApiWorkspace } from "./api/api-workspace"
import { FileTree } from "./files/file-tree"
import { ChangesPane } from "./files/changes-pane"
import { FileWorkspace } from "./files/file-workspace"
import { DatabaseWorkspace } from "./db/database-workspace"
import { AddFolderDialog } from "./add-folder-dialog"
import { CommandPalette } from "./command-palette"
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
import { IS_MAC, TitleBarDragStrip } from "./title-bar"
import { GroupTabs } from "./group-tabs"
import { WorkspaceTabs } from "./workspace-tabs"

/** What each pane on the rail shows. Built here rather than inline so the
 * stack below is a list of panes and nothing else. */
function paneView(pane: Pane) {
  switch (pane) {
    case "files":
      return <FileWorkspace />
    case "changes":
      return <ChangesPane />
    case "database":
      return <DatabaseWorkspace />
    case "api":
      return <ApiWorkspace />
    case "note":
      return <NoteWorkspace />
    case "worktree":
      return <WorktreeChatPane />
  }
}

/** How far the launch screen has got: still assembling, fading out over the
 * workbench, or gone. */
type Launch = "splash" | "closing" | "done"

export function Studio() {
  const workspaceLoaded = useStudio((state) => state.loaded)
  const storageError = useStudio((state) => state.storageError)
  const loaded = workspaceLoaded

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
    void useDatabases.getState().refresh()
    void useNotes.getState().refresh()
    void useFiles.getState().restore()
    void useProjects.getState().restore()
    void useRun.getState().restore()
    void useWorktreeChats.getState().refresh()
    void useClaudeProfiles.getState().refresh()
  }, [])

  // A run outlives the dock being closed and the tab being switched away from,
  // so its output is subscribed to here rather than in the panel.
  useEffect(() => useRun.getState().listen(), [])

  // A chat's turn runs in the main process and outlives the
  // pane being switched away from, so its lines are subscribed to here.
  useEffect(() => useWorktreeChats.getState().listen(), [])

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
   *
   * **`loaded` and nothing else.** Both timers are set once here, and `launch`
   * must stay out of the dependencies: it is what the first timer changes, so an
   * effect watching it re-ran on its own `setLaunch("closing")`, cleared the
   * `done` timer it had just been holding, and then returned early because
   * `launch` was no longer `"splash"`. The app sat in `"closing"` for the rest of
   * the run — invisibly, since the splash is transparent by then, except that its
   * drag region stayed over the whole title bar and every button up there stopped
   * taking clicks. Watching the thing you are about to set is the whole of the
   * bug.
   */
  useEffect(() => {
    if (!loaded) return

    const left = Math.max(0, SPLASH_ASSEMBLE_MS - splashElapsed())
    const toClosing = setTimeout(() => setLaunch("closing"), left)
    const toDone = setTimeout(() => setLaunch("done"), left + SPLASH_FADE_MS)
    return () => {
      clearTimeout(toClosing)
      clearTimeout(toDone)
    }
  }, [loaded])

  // A failure has nothing to wait for and nothing to celebrate: it replaces
  // the launch screen outright rather than fading in behind it.
  if (storageError) return <StorageError message={storageError} />

  return (
    <>
      {launch !== "splash" && <Workbench />}
      {launch !== "done" && <Splash closing={launch === "closing"} />}
      {/* The launch screen has nothing clickable, so the top of the window is
          its drag handle. Owned here rather than by the splash because it has to
          outlive it: unmounting a drag region leaves macOS holding it, over the
          crumb bar the workbench draws in the same place — see
          `TitleBarDragStrip`. */}
      <TitleBarDragStrip active={launch !== "done"} />
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
  /** Whether the dock — `Run` and `Terminal` — is on screen: the button in the
   * header, and the chevron in the dock's own strip. */
  const dockOpen = useDock((state) => state.open)
  const toggleDock = useDock((state) => state.toggle)
  /** The left column, and its toggle in the title bar. */
  const projectSidebar = useProjects((state) => state.sidebar)
  const toggleProjectSidebar = useProjects((state) => state.toggleSidebar)
  /** Whether the Explorer panel is showing at all — `⌘B`, the View menu, or
   * dragging its handle shut. */
  const sidebar = useStudio((state) => state.sidebar)
  const toggleSidebar = useStudio((state) => state.toggleSidebar)
  /** The panels built so far, in the order they were first shown; see the
   * stack below. */
  const [mounted, setMounted] = useState<Pane[]>([])

  // The panel on screen — or none, which `NothingOpen` answers for the pane
  // whose tab went.
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
   * The strip is per checkout, so moving the checkout may leave the pane drawing
   * something the strip no longer holds — see `reconcileScope`.
   *
   * Here rather than inside `setActive`, which is where it belongs by rights: a
   * store that reached into `lib/panels.ts` would be a cycle, since that module
   * reads this one's context to work out what is in scope at all. So the
   * workbench watches the field instead, which is the same thing one frame
   * later and in the layer that is allowed to know about both.
   */
  const activeFolderId = useProjects((state) => state.activeFolderId)
  useEffect(() => {
    reconcileScope()
  }, [activeFolderId])

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

  /** The same for the left column, which collapses on its own button. */
  const projectPanel = usePanelRef()
  useEffect(() => {
    if (projectSidebar) projectPanel.current?.expand()
    else projectPanel.current?.collapse()
  }, [projectSidebar, projectPanel])

  /**
   * And the dock, which is collapsed rather than unmounted — the reason being
   * the shell in it. A pty taken out of the tree ends; it does not hide. The
   * dock used to unmount, which was fine while it held a conversation the main
   * process owned and a log, and became a bug the moment closing it would have
   * killed whatever was running in the Terminal tab.
   */
  const dockPanel = usePanelRef()
  useEffect(() => {
    if (dockOpen) dockPanel.current?.expand()
    else dockPanel.current?.collapse()
  }, [dockOpen, dockPanel])

  /*
   * `⌘B` — the editors' shortcut for the sidebar, and the View menu's item.
   *
   * On the capture phase like the studio's other three, so a focused editor
   * cannot swallow it, with the one exception the letter makes: in a rich-text
   * editor `⌘B` is bold and stays bold (`isEditingRichText`). Nothing else on
   * screen wants the key — the code editor has no binding for it, and off macOS a
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
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* The strip inside the tab on screen, when the panel is grouping its
          tabs under the folder each belongs to. Between the workbench's strip
          and the pane in both arrangements — the tabs may be a column beside
          the pane, but a folder's own tabs are still a row above it. */}
      <GroupTabs pane={pane} />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/*
        Every panel is hidden rather than unmounted, and built the first time it
        is shown — a panel nobody has opened is a connection nobody is reading.

        Everything they hold that their store does not is lost on a switch, and
        a panel switched away from is coming back. Leaving Database for Notes
        and returning gave a result grid scrolled back to the top, a SQL editor
        with no undo history and the split at its default height; a note came
        back as a fresh ProseMirror over the same text, with the caret at the
        start.

        `invisible`, not `hidden`: `display: none` destroys the scrolling boxes
        inside, which would put that grid back at the top by another route —
        and it is what the dock stacks its own shells with.
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
            <NothingOpen pane={pane} hasOpenTabs={hasOpenTabs} />
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      {/*
        The window is a row, not a column.

        The left column runs the full height, from under the traffic lights to
        the status bar, and the bar carrying the crumb sits above the *work*
        only — the pane and the Explorer — rather than across the whole window.
        Conductor's shape, and the reason is what each of the two is about: the
        column is the workspace and does not change when you switch checkout,
        while everything to the right of it is one checkout's, which is exactly
        what the crumb names. A bar spanning both would be labelling the column
        too, and mislabelling it.

        The cost is that the two strips at the top are two boxes to keep the
        same height (`h-11` in both), and that the traffic lights now land in
        whichever of them is at the window's left edge — see `WindowLeftEdge`.
      */}
      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-w-0 flex-1"
        >
          {/*
            The workspace's own column: its projects, and the branches under
            each. `Database`, `Notes` and `API` are hidden for now — see
            `SIDEBAR_SECTIONS` in `lib/projects.ts`.
          */}
          <ResizablePanel
            defaultSize={228}
            minSize={168}
            maxSize={360}
            collapsible
            collapsedSize={0}
            panelRef={projectPanel}
            onResize={(size, _id, previous) => {
              // Undefined on mount is the panel reporting the width it was
              // handed, not a drag — read as one, a launch that remembered a
              // closed column would reopen it. Same trap as the panels' below.
              if (previous === undefined) return

              const shown = size.inPixels > 0
              if (shown !== useProjects.getState().sidebar) {
                toggleProjectSidebar()
              }
            }}
          >
            <div className="flex h-full min-h-0 flex-col">
              <WindowLeftEdge
                projectSidebar={projectSidebar}
                onToggle={toggleProjectSidebar}
              />
              <div className="min-h-0 flex-1">
                <WorkspaceSidebar
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle className={cn(!projectSidebar && "hidden")} />

          {/* Everything about the one checkout: the bar that names it, the pane,
              and the Explorer with the dock under it. Its minimum is the two
              columns inside it added up. */}
          <ResizablePanel minSize={560}>
            <div className="flex h-full min-h-0 flex-col">
              <header className="flex h-11 shrink-0 items-center gap-1 border-b">
                {/* The window's left edge when the column is shut, which is the
                    other half of `WindowLeftEdge` — the lights and the toggle
                    have to be somewhere, and with no column there they are
                    here. */}
                {!projectSidebar && (
                  <WindowLeftEdge
                    projectSidebar={projectSidebar}
                    onToggle={toggleProjectSidebar}
                    bare
                  />
                )}

                {/*
                  `project › branch`, and the `…` that acts on it.

                  This bar was deliberately bare for a long while, and the
                  reason was sound: the workspace holds several folders, each on
                  a branch of its own, so one line could only be about one of
                  them. What changed is that one of them *is* the one being
                  worked in — clicking a row in the column moves the tree, the
                  shell and the chat together, and so does selecting a tab from
                  another checkout — and this bar is over exactly the part of
                  the window that follows it. A `Home › task` crumb took this
                  end once before and went with the tasks; this one is about a
                  place rather than a layer that no longer exists.
                */}
                <ProjectCrumbs />

                {/*
                  The drag handle — this part of the bar and not the whole of
                  it. A clickable thing inside a `-webkit-app-region: drag` box
                  has to opt back out with `no-drag`, and on macOS that
                  subtraction is unreliable: the theme toggle that used to sit
                  here took no clicks at all while its `d` shortcut still
                  worked. So the region is what is left over between the
                  controls rather than something punched through them.
                */}
                <div className="drag-region h-full min-w-0 flex-1" />

                {/*
                  The dock, which is the only way back to it once it is shut: its
                  own chevron hides it, and the tab strip that switches between
                  `Run` and `Terminal` goes with it. There was an assistant
                  button here — a workspace chat that was the dock's first tab —
                  and this is what is left in its corner.

                  Two things are about clicks landing rather than looks, and
                  neither is why this button once took every other press — that
                  was its own tooltip, see `ui/tooltip.tsx` and `side` below.

                  It fills the bar's height instead of being a 24px square
                  floating in a 44px strip, which is what a title-bar control is
                  everywhere else. And `no-drag` is claimed even though the
                  button sits outside the drag region: macOS keeps a stale drag
                  rect after the element that asked for it has gone
                  (electron#20926), and the launch screen draws one across this
                  very corner on every run.
                */}
                {/* Wider than the button it holds, on purpose: this is the rect
                    that says "not draggable", and it has to cover more than the
                    button in case a stale drag rect reaches past where any live
                    one ends. */}
                <div className="no-drag flex h-full shrink-0 items-center pl-3">
                  <IconButton
                    label={
                      dockOpen ? "Hide the panel" : "Show run and terminal"
                    }
                    pressed={dockOpen}
                    onClick={toggleDock}
                    // Below, because there is no "above" here: this button's top
                    // edge is the top of the window, and a tooltip with nowhere
                    // to go is what made this button unclickable every other
                    // press — see the comment in `ui/tooltip.tsx`.
                    side="bottom"
                    className="h-11 w-11 rounded-none"
                  >
                    <PanelBottom />
                  </IconButton>
                </div>
              </header>

              {/* No screen of its own for an empty workspace. A folder is what
                  Explorer lists and what the dock opens a shell in, and nothing
                  else here is about one — the databases, the requests and the
                  notes belong to the workspace — so a studio held shut until one
                  is added would be holding back panels that had nothing to wait
                  for. Adding one is a button in Explorer's own header, and the
                  File menu. */}
              <div className="flex min-h-0 flex-1">
                <ResizablePanelGroup
                  orientation="horizontal"
                  className="min-w-0 flex-1"
                >
                  <ResizablePanel minSize={280}>
                    {/*
                      The strip beside the pane rather than above it, and the
                      boundary between them draggable like every other one in
                      the workbench: a column of tabs is a list of file names,
                      and how much of a name fits is exactly what somebody with
                      a deep tree wants to set for themselves.

                      A nested group rather than a width this component holds,
                      for the reason the columns either side are panels too —
                      the drag, the keyboard handle and the minimum all come
                      with it.
                    */}
                    {verticalTabs ? (
                      <ResizablePanelGroup orientation="horizontal">
                        <ResizablePanel minSize={240}>
                          {paneContent}
                        </ResizablePanel>

                        <ResizableHandle />

                        {/* Wide enough for a name and its icon, and capped
                            where a column of tabs would start costing the
                            editor more than the names are worth. */}
                        <ResizablePanel
                          defaultSize={224}
                          minSize={140}
                          maxSize={420}
                        >
                          <WorkspaceTabs pane={pane} orientation="vertical" />
                        </ResizablePanel>
                      </ResizablePanelGroup>
                    ) : (
                      <div className="flex h-full min-w-0 flex-col">
                        {/* Outside the panel rather than inside one, which is
                            what keeps a table open on screen while the API
                            panel is the one being looked at. */}
                        <WorkspaceTabs pane={pane} orientation="horizontal" />
                        {paneContent}
                      </div>
                    )}
                  </ResizablePanel>

                  <ResizableHandle className={cn(!sidebar && "hidden")} />

                  {/*
                    The Explorer, with the dock under it — as Conductor stacks
                    its file list over its Run/Terminal. Two stacked panels: the
                    tree is the contents of the checkout being worked in, and
                    the dock is what is *about* what is on screen rather than a
                    thing that was opened.
                  */}
                  <ResizablePanel
                    defaultSize={320}
                    minSize={240}
                    maxSize={520}
                    // Dragging the handle past the minimum closes it too, which
                    // is the other half of what `⌘B` does — so the state
                    // follows the panel as well as driving it, or a column
                    // dragged shut would leave `⌘B` needing two presses to
                    // bring it back.
                    collapsible
                    collapsedSize={0}
                    panelRef={sidebarPanel}
                    onResize={(size, _id, previous) => {
                      if (previous === undefined) return

                      const shown = size.inPixels > 0
                      if (shown !== useStudio.getState().sidebar) {
                        toggleSidebar()
                      }
                    }}
                  >
                    <ResizablePanelGroup orientation="vertical">
                      <ResizablePanel minSize={140}>
                        {/* The Explorer, and nothing else — so no tabs above
                            it. The other three lists are sections of the left
                            column (hidden for now), and a strip of four tabs
                            with one tab on it is a row of chrome that answers
                            nothing. */}
                        <FileTree onAddFolder={() => setAdding(true)} />
                      </ResizablePanel>

                      <ResizableHandle className={cn(!dockOpen && "hidden")} />
                      <ResizablePanel
                        defaultSize={320}
                        minSize={160}
                        collapsible
                        collapsedSize={0}
                        panelRef={dockPanel}
                      >
                        <Dock />
                      </ResizablePanel>
                    </ResizablePanelGroup>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </div>
            </div>
          </ResizablePanel>
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
    </div>
  )
}

/**
 * The window's top-left corner: the traffic lights' clearance, and the toggle.
 *
 * Written once and drawn in two places, because the corner belongs to whichever
 * box is at the window's left edge — the left column's own top row while it is
 * showing, the crumb bar when it is not. The alternative was leaving it in one
 * of them and having the lights land on the column's first project row, or the
 * toggle disappear with the column it collapses.
 *
 * What is draggable here is the space either side of the button rather than the
 * whole strip with a `no-drag` hole punched in it. macOS drops that hole often
 * enough that the toggle inside it was another control that "worked sometimes";
 * a button that was never in a drag region has nothing to be dropped. The
 * `5.25rem` is what clears the traffic lights at `x: 18`, since macOS insets its
 * own buttons into whatever the app draws up here (`titleBarStyle` and
 * `trafficLightPosition` in `main/main.ts`).
 */
function WindowLeftEdge({
  projectSidebar,
  onToggle,
  bare = false,
}: {
  projectSidebar: boolean
  onToggle: () => void
  /** In the crumb bar rather than being a row of its own, so it brings no
   * height and no border with it. */
  bare?: boolean
}) {
  return (
    <div className={cn("flex h-11 shrink-0 items-center", !bare && "border-b")}>
      {IS_MAC && <div className="drag-region h-full w-[5.25rem] shrink-0" />}
      <div className="no-drag flex h-full shrink-0 items-center">
        {/*
          The left column's own toggle, and not the panels' `⌘B`: the two
          columns are about different things — one is the workspace, one is the
          contents of what is being worked on — and one key taking both would
          leave the workbench with no edges at all.
        */}
        <IconButton
          label={projectSidebar ? "Hide projects" : "Show projects"}
          pressed={projectSidebar}
          onClick={onToggle}
          side="bottom"
          className="size-7 shrink-0"
        >
          <PanelLeft />
        </IconButton>
      </div>

      {/* The rest of the column's top row, so it can still drag the window.
          Not in the crumb bar, where the header has a spacer of its own after
          the crumb and one here would push the crumb across. */}
      {!bare && <div className="drag-region h-full flex-1" />}
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
