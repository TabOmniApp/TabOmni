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

/** Whether the always-mounted terminal is the thing on screen. */
function showsTerminal(section: Section, pane: Pane): boolean {
  return pane === "terminal"
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
  /** Set the first time the terminal pane is shown; see the panel below. */
  const [terminalOpened, setTerminalOpened] = useState(false)

  // Adjusted during the render that first shows the terminal rather than in an
  // effect afterwards: an effect would leave one painted frame with the pane
  // empty, and this is the flag that mounts what belongs in it.
  if (pane === "terminal" && !terminalOpened) setTerminalOpened(true)

  // An empty strip is answered once, by `NothingOpen`, so the terminal steps
  // aside for it too — closing the last session otherwise left the pane on the
  // terminal's own "start a session" line, which is the same notice again in a
  // panel's own words.
  const showTerminal = hasOpenTabs && showsTerminal(section, pane)

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

              <div className="min-h-0 flex-1">
                {/*
                  The terminal sits outside the switch below, hidden rather
                  than unmounted. Its session is a pty with no way to
                  reattach, so taking it off the screen would end the
                  conversation. It is not mounted until the section is first
                  opened: a session nobody asked for is a process nobody is
                  reading.
                */}
                {terminalOpened && (
                  <div className={cn("h-full", !showTerminal && "hidden")}>
                    <TerminalWorkspace />
                  </div>
                )}

                <div className={cn("h-full", showTerminal && "hidden")}>
                  {/* One notice for an empty strip, rather than each panel's
                      own. `pane` is where the last tab was, so with none it is
                      only ever the one a launch starts on — which is how
                      "No table selected" came to be what somebody who opened
                      the app to read captured mail was told. */}
                  {!hasOpenTabs ? (
                    <NothingOpen section={section} />
                  ) : pane === "database" ? (
                    <DatabaseWorkspace />
                  ) : pane === "mail" ? (
                    <CaptureWorkspace server="mail" />
                  ) : pane === "webhook" ? (
                    <CaptureWorkspace server="webhook" />
                  ) : pane === "note" ? (
                    <NoteWorkspace />
                  ) : (
                    <ApiWorkspace />
                  )}
                </div>
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
