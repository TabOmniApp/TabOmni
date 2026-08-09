import { useEffect, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { cn } from "@/lib/utils"
import { FolderInput, GitBranch } from "lucide-react"

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
import { ImportProjectDialog } from "./import-project-dialog"
import { CaptureList } from "./inbox/capture-list"
import { CaptureWorkspace } from "./inbox/capture-workspace"
import { SpecList } from "./spec/spec-list"
import { SpecWorkspace } from "./spec/spec-workspace"
import { SystemBar } from "./system-bar"
import { ProjectSetupOverlay } from "./project-setup-overlay"
import { IS_MAC, TitleBarDragStrip } from "./title-bar"
import { ThemeToggle } from "./theme-toggle"
import { WorkspaceTabs } from "./workspace-tabs"

/** Whether the always-mounted terminal is the thing on screen. */
function showsTerminal(section: Section, pane: Pane): boolean {
  return pane === "terminal"
}

export function Studio() {
  const loaded = useStudio((state) => state.loaded)
  const storageError = useStudio((state) => state.storageError)

  useEffect(() => {
    void useStudio.getState().init()
    void useTerminal.getState().restore()
    void useRail.getState().restore()
  }, [])

  if (storageError) return <StorageError message={storageError} />
  if (!loaded) return <Splash />

  return <Workbench />
}

function Workbench() {
  const projects = useStudio((state) => state.projects)
  const projectId = useStudio((state) => state.projectId)
  const gitBranch = useStudio((state) => state.gitBranch)
  const deleteProject = useStudio((state) => state.deleteProject)

  const pane = useStudio((state) => state.pane)

  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  /** Which sidebar the rail is showing — and only that; the pane beside it
   * follows the tab strip. */
  const [section, setSection] = useState<Section>("database")
  /** Set the first time the terminal pane is shown; see the panel below. */
  const [terminalOpened, setTerminalOpened] = useState(false)

  // Adjusted during the render that first shows the terminal rather than in an
  // effect afterwards: an effect would leave one painted frame with the pane
  // empty, and this is the flag that mounts what belongs in it.
  if (pane === "terminal" && !terminalOpened) setTerminalOpened(true)

  const project = projects.find((candidate) => candidate.id === projectId)

  // The File menu is where importing, settings and closing live — the header
  // is a project picker and nothing else. The menu runs in the main process
  // and cannot open a dialog, so it names the command and this opens the same
  // dialog the buttons used to.
  useEffect(
    () =>
      window.desktop.onMenuCommand((command) => {
        if (command === "import-project") setImporting(true)
        else if (command === "close-project") setDeleting(true)
      }),
    []
  )

  // Two of those items act on the open project, so the menu is told when
  // there is one. Nothing opens if it is wrong, but a menu that offers
  // "Close project" with none open is a menu that lies.
  useEffect(() => {
    void window.desktop.setMenuState({ projectOpen: Boolean(project) })
  }, [project])

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
        {/* The project is picked from the top of the activity rail now — see
            `project-switcher.tsx`. The header keeps only what describes the
            project rather than what selects it. */}
        {gitBranch && (
          <span
            title={`Branch: ${gitBranch}`}
            className="flex min-w-0 shrink items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground"
          >
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{gitBranch}</span>
          </span>
        )}

        <div className="min-w-0 flex-1" />

        <ThemeToggle />
      </header>

      {/* With nothing imported yet there is no tree, no rail item and no
          header button to find: the File menu is the only way in, and a first
          run must not depend on someone thinking to look there. */}
      {projects.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderInput />
              </EmptyMedia>
              <EmptyTitle>No project yet</EmptyTitle>
              <EmptyDescription>
                Open a folder from this machine to work on it here.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setImporting(true)}>
                <FolderInput data-icon="inline-start" />
                Import a project
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ActivityBar
            section={section}
            onSelect={setSection}
            onAddProject={() => setImporting(true)}
          />

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
              ) : section === "spec" ? (
                <SpecList />
              ) : (
                <TerminalSidebar />
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
                    <div
                      className={cn(
                        "h-full",
                        !showsTerminal(section, pane) && "hidden"
                      )}
                    >
                      <TerminalWorkspace />
                    </div>
                  )}

                  <div
                    className={cn(
                      "h-full",
                      showsTerminal(section, pane) && "hidden"
                    )}
                  >
                    {pane === "database" ? (
                      <DatabaseWorkspace />
                    ) : pane === "spec" ? (
                      <SpecWorkspace />
                    ) : pane === "mail" ? (
                      <CaptureWorkspace server="mail" />
                    ) : pane === "webhook" ? (
                      <CaptureWorkspace server="webhook" />
                    ) : (
                      <ApiWorkspace />
                    )}
                  </div>
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}

      <SystemBar />

      {importing && <ImportProjectDialog onClose={() => setImporting(false)} />}
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {project?.sourcePath ? "Close project?" : "Delete project?"}
            </AlertDialogTitle>
            {/*
              An imported project's files are the user's own folder, and this
              dialog must not claim otherwise: what goes is the studio's copy
              of its database and its place in the project list.
            */}
            <AlertDialogDescription>
              {project?.sourcePath ? (
                <>
                  “{project.name}” is removed from the studio, along with the
                  database it kept here. The folder itself —{" "}
                  <code className="font-mono">{project.sourcePath}</code> — is
                  left exactly as it is.
                </>
              ) : (
                <>
                  This will permanently delete “{project?.name}” and all of its
                  files. This can&apos;t be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (project) void deleteProject(project.id)
                setDeleting(false)
              }}
            >
              {project?.sourcePath ? "Close" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProjectSetupOverlay />
    </div>
  )
}

function Splash() {
  return (
    <div className="grid h-svh place-items-center">
      <TitleBarDragStrip />
      <p className="animate-pulse text-sm text-muted-foreground">
        Starting the studio…
      </p>
    </div>
  )
}

/**
 * Shown when the project list could not be read.
 *
 * There is deliberately nothing to click: this means `manifest.json` could not
 * be read, and no button the studio could offer would fix a permissions problem
 * or a corrupt file — while a "reset" that deleted the manifest would throw away
 * the list of projects, which is the one thing worth keeping. So it says where
 * to look instead.
 */
function StorageError({ message }: { message: string }) {
  return (
    <div className="grid h-svh place-items-center p-6">
      <TitleBarDragStrip />
      <div className="max-w-md space-y-3 text-center">
        <h1 className="font-heading font-medium">
          Could not open your projects
        </h1>
        <p className="font-mono text-xs text-destructive">{message}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Your projects are folders under{" "}
          <code className="font-mono">~/.tabula/projects</code>, listed in{" "}
          <code className="font-mono">manifest.json</code> beside them. The
          files themselves are untouched — check that both are readable.
        </p>
      </div>
    </div>
  )
}
