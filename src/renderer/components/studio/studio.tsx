import { useEffect, useState } from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { cn } from "@/lib/utils"

import { useDatabases } from "@/lib/db/databases-store"
import { useInbox } from "@/lib/inbox/store"
import { useNotes } from "@/lib/note/store"
import { useTerminal } from "@/lib/terminal/store"
import { useRail } from "@/lib/rail"
import { useStudio, type Pane } from "@/lib/store"
import { ActivityBar, type Section } from "./activity-bar"
import { TerminalSidebar } from "./terminal/terminal-sidebar"
import { TerminalWorkspace } from "./terminal/terminal-workspace"
import { ApiWorkspace } from "./api/api-workspace"
import { RequestList } from "./api/request-list"
import { DatabaseTree } from "./db/database-tree"
import { DatabaseWorkspace } from "./db/database-workspace"
import { AddFolderDialog } from "./add-folder-dialog"
import { CaptureList } from "./inbox/capture-list"
import { CaptureWorkspace } from "./inbox/capture-workspace"
import { NoteList } from "./note/note-list"
import { NoteWorkspace } from "./note/note-workspace"
import { NothingOpen } from "./nothing-open"
import { SystemBar } from "./system-bar"
import {
  Splash,
  splashElapsed,
  SPLASH_ASSEMBLE_MS,
  SPLASH_FADE_MS,
} from "./splash"
import { IS_MAC, TitleBarDragStrip } from "./title-bar"
import { ThemeToggle } from "./theme-toggle"
import { useHasOpenTabs, WorkspaceTabs } from "./workspace-tabs"

/** What each pane on the rail shows. Built here rather than inline so the
 * stack below is a list of panes and nothing else. */
function paneView(pane: Pane) {
  switch (pane) {
    case "database":
      return <DatabaseWorkspace />
    case "api":
      return <ApiWorkspace />
    case "mail":
      return <CaptureWorkspace server="mail" />
    case "webhook":
      return <CaptureWorkspace server="webhook" />
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
  // only moment it is read. The three here rather than in their own panels are
  // the ones that matter before the panel is opened: the rail's unread badges
  // come from the inbox, the databases feed the tree the app starts on, and a
  // note is the one thing whose *tab* can be restored onto a pane whose sidebar
  // is not the one showing — the strip cannot draw a tab for a note it has
  // never read.
  useEffect(() => {
    void useStudio.getState().init()
    void useTerminal.getState().restore()
    void useRail.getState().restore()
    void useDatabases.getState().refresh()
    void useInbox.getState().refresh()
    void useNotes.getState().refresh()
  }, [])

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

  const [adding, setAdding] = useState(false)
  /** Which sidebar the rail is showing — and only that; the pane beside it
   * follows the tab strip. */
  const [section, setSection] = useState<Section>("database")
  /** The panels built so far, in the order they were first shown; see the
   * stack below. */
  const [mounted, setMounted] = useState<Pane[]>([])

  // The panel on screen — or none, because an empty strip is answered once, by
  // `NothingOpen`, and every panel steps aside for it. Closing the last
  // session otherwise left the pane on the terminal's own "start a session"
  // line, which is the same notice again in a panel's own words.
  const shown = hasOpenTabs ? pane : null

  // Adjusted during the render that first shows a panel rather than in an
  // effect afterwards: an effect would leave one painted frame with the pane
  // empty, and this is the list that mounts what belongs in it.
  if (shown && !mounted.includes(shown)) setMounted([...mounted, shown])

  // The File menu is a second way to reach the same dialog — and the only one
  // left when the Terminal section is taken off the rail. It runs in the main
  // process and cannot open a dialog itself, so it names the command instead.
  useEffect(
    () =>
      window.desktop.onMenuCommand((command) => {
        if (command === "add-folder") setAdding(true)
      }),
    []
  )

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      {/* Doubles as the window's title bar on macOS, where there is no other:
          draggable, and inset far enough to clear the traffic lights. */}
      <header
        className={cn(
          "drag-region flex h-11 shrink-0 items-center gap-2 border-b px-3",
          IS_MAC && "pl-24"
        )}
      >
        {/* Deliberately bare. The workspace holds several folders and each
            one has a branch of its own, so a single line here could only be
            about one of them — they are listed, with their branches, in the
            Terminal panel, which is the one panel that works in a folder. */}
        <div className="min-w-0 flex-1" />

        <ThemeToggle />
      </header>

      {/* No screen of its own for an empty workspace. A folder is what the
          Terminal panel works in, and nothing else here is about one — the
          databases, the requests and the two capture servers belong to the
          workspace — so a studio held shut until one is added would be holding
          back four panels that had nothing to wait for. Adding one is a button
          in the Terminal panel's own header, and the File menu. */}
      <div className="flex min-h-0 flex-1">
        <ActivityBar section={section} onSelect={setSection} />

        <ResizablePanelGroup
          orientation="horizontal"
          className="min-w-0 flex-1"
        >
          <ResizablePanel defaultSize={224} minSize={160} maxSize={420}>
            {section === "database" ? (
              <DatabaseTree />
            ) : section === "api" ? (
              <RequestList />
            ) : section === "mail" ? (
              <CaptureList server="mail" />
            ) : section === "webhook" ? (
              <CaptureList server="webhook" />
            ) : section === "note" ? (
              <NoteList />
            ) : (
              <TerminalSidebar onAddFolder={() => setAdding(true)} />
            )}
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel minSize={280}>
            <div className="flex h-full min-w-0 flex-col">
              {/* Above the panel rather than inside one, which is what keeps
                  a table open on screen while the API panel is the one being
                  looked at. */}
              <WorkspaceTabs pane={pane} />

              {/* `overflow-hidden` because the panels below are absolutely
                  positioned and so do not clip: a panel that forgot to scroll
                  its own content would otherwise spill past this box and be
                  scrolled by an ancestor, which takes the tab strip off the top
                  of the window with it. The strip is `shrink-0`, so that is the
                  only way it can move. */}
              <div className="relative min-h-0 flex-1 overflow-hidden">
                {/*
                  Every panel is hidden rather than unmounted, and built the
                  first time it is shown — a panel nobody has opened is a
                  connection nobody is reading, and the terminal's is a process.

                  The terminal had to be kept: its session is a pty with no way
                  to reattach, so taking it off the screen would end the
                  conversation. The other five want the same for a smaller
                  reason — everything they hold that their store does not is
                  lost on a switch, and a panel switched away from is coming
                  back. Leaving Database for Mail and returning gave a result
                  grid scrolled back to the top, a SQL editor with no undo
                  history and the split at its default height; a note came back
                  as a fresh ProseMirror over the same text, with the caret at
                  the start.

                  `invisible`, not `hidden`: `display: none` destroys the
                  scrolling boxes inside, which would put that grid back at the
                  top by another route — and it is what the terminal already
                  stacks its own sessions with.
                */}
                {mounted.map((name) => (
                  <div
                    key={name}
                    className={cn(
                      "absolute inset-0",
                      name !== shown && "invisible"
                    )}
                  >
                    {paneView(name)}
                  </div>
                ))}

                {/* One notice for an empty strip, rather than each panel's
                    own. `pane` is where the last tab was, so with none it is
                    only ever the one a launch starts on — which is how
                    "No table selected" came to be what somebody who opened
                    the app to read captured mail was told. */}
                {!hasOpenTabs && (
                  <div className="absolute inset-0">
                    <NothingOpen section={section} />
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <SystemBar />

      {adding && <AddFolderDialog onClose={() => setAdding(false)} />}
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
          under <code className="font-mono">~/.tabula</code>, listing the
          folders it points at. Those folders are untouched — check that the
          manifest is readable.
        </p>
      </div>
    </div>
  )
}
