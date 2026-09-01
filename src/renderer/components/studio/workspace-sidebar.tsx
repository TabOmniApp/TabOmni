import { Database, Plus, Search, Send, Settings } from "lucide-react"

import { usePalette } from "@/lib/palette"
import {
  SIDEBAR_SECTIONS,
  useProjects,
  type SidebarSection,
} from "@/lib/projects"
import { RequestList } from "./api/request-list"
import { DatabaseTree } from "./db/database-tree"
import { IconButton } from "./icon-button"
import { PanelHeader, type Fold } from "./panel-header"
import { ProjectsSection } from "./project/projects-section"
import { SideRow } from "./side-row"

/**
 * The window's left column: `Search`, then whatever `SIDEBAR_SECTIONS` lists.
 *
 * **Projects, and nothing under it right now.** The column stacked three —
 * `Projects` / `Database` / `API`, each folding — and `Database` and `API` are
 * hidden for the moment, so this is Conductor's left column: the projects and
 * their branches with the whole height to themselves. Hidden, not removed. Both
 * panels, their stores, their panes and their tabs are untouched, `⌘P` still
 * finds every table and request, the footer opens either in a window of its
 * own, and bringing one back into the column is a line in `SIDEBAR_SECTIONS`.
 *
 * The Explorer was never one of them, and that is the asymmetry worth stating:
 * a file tree is the contents of the thing being worked on rather than a list of
 * what the workspace holds, so it kept the right-hand panel — which needs no
 * tabs, having one thing in it.
 *
 * Each section is the panel's own component, unchanged, under its own
 * `PanelHeader`. The fold (`open`/`onToggle`) is handed in only while there is
 * more than one of them: a lone section with a chevron is a chevron whose only
 * use is emptying the column.
 */
export function WorkspaceSidebar({
  onOpenSettings,
  onAddFolder,
}: {
  /** The Settings dialog is the workbench's, mounted there — this is the
   * footer asking for it, the way Explorer's header asks for Add folder. */
  onOpenSettings: () => void
  /** The same dialog Explorer's tree asks for, and asked for the same way: it
   * is mounted in the workbench, so both columns ask rather than open. */
  onAddFolder: () => void
}) {
  const shut = useProjects((state) => state.shutSections)
  /** Whether there is anything to fold *against* — see `Section`. */
  const alone = SIDEBAR_SECTIONS.length === 1

  return (
    <nav
      aria-label="Workspace"
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      {/* `pr-9` because the column's collapse button is positioned over the
          right of this row (`project-rail.tsx`) and takes no width of its own —
          without it, the row's hover highlight ran under the button. */}
      <div className="shrink-0 py-2 pr-9">
        <SideRow onClick={() => usePalette.getState().setOpen(true)}>
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">Search</span>
        </SideRow>
      </div>

      {/*
        Open sections share what is left over, each scrolling inside itself.

        Even shares rather than sized to their contents: a column cannot both
        fit its contents and fill its height, and of the two answers this is the
        one where a long list of requests cannot push the projects off the
        bottom. A folded section is its header and nothing else, so folding two
        of them gives the third the column — which is also what one section on
        its own gets, for free.
      */}
      <div className="flex min-h-0 flex-1 flex-col">
        {SIDEBAR_SECTIONS.map((section) => (
          <Section
            key={section}
            id={section}
            onAddFolder={onAddFolder}
            // Folding is only meaningful against a neighbour. On its own a
            // section is always open, whatever a previous run left in
            // `shutSections` — a column that came back empty because the one
            // list in it had been folded months ago is a column that reads as
            // broken.
            open={alone || !shut.includes(section)}
            fold={!alone}
          />
        ))}
      </div>

      {/* The bar Conductor closes its sidebar with. Settings rather than a plan
          badge and a help link: this app has no account, and `⌘,` was the only
          way to the dialog — a preference nobody can find is a preference
          nobody changes. */}
      {/* The panels at the left end, Settings at the right: they are unrelated,
          and all three sitting together would read as one group of controls
          over the same thing. */}
      <div className="flex h-8 shrink-0 items-center justify-between border-t px-3">
        {/* The way to the two panels this column no longer draws: a window
            each, which is also where they are least in the way of the
            projects. */}
        <div className="flex items-center gap-1">
          <IconButton
            label="Database window"
            onClick={() => void window.desktop.openPanelWindow("database")}
            className="size-5 shrink-0"
          >
            <Database className="size-3.5" />
          </IconButton>
          <IconButton
            label="API window"
            onClick={() => void window.desktop.openPanelWindow("api")}
            className="size-5 shrink-0"
          >
            <Send className="size-3.5" />
          </IconButton>
        </div>
        <IconButton
          label="Settings"
          onClick={onOpenSettings}
          className="size-5 shrink-0"
        >
          <Settings className="size-3.5" />
        </IconButton>
      </div>
    </nav>
  )
}

/** What each section is called, in the column and in its own header. */
const TITLES: Record<SidebarSection, string> = {
  projects: "Projects",
  database: "Database",
  api: "API",
}

/**
 * One section: its panel, or — folded — the panel's header on its own.
 *
 * The panel is **unmounted** while folded, unlike the dock, and it can be: none
 * of these holds anything a remount would lose — no pty, no turn in flight, no
 * editor. What they hold is a store each, which outlives the component. So a
 * folded section is a header this column draws instead, which is also why the
 * panel's own buttons are not on it: `New request` belongs to the list, and the
 * list is not there.
 *
 * `fold` off is the header without a chevron — the shape every panel's header
 * had before this column stacked them, and the shape it goes back to while
 * `Projects` is the only section drawn.
 */
function Section({
  id,
  open,
  fold: folds,
  onAddFolder,
}: {
  id: SidebarSection
  open: boolean
  fold: boolean
  /** Only `projects` has anything to do with this — see `ProjectsSection`. */
  onAddFolder: () => void
}) {
  const toggleSection = useProjects((state) => state.toggleSection)
  const fold: Fold | undefined = folds
    ? { open, onToggle: () => toggleSection(id) }
    : undefined

  if (!open) return <PanelHeader title={TITLES[id]} {...fold} />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {id === "projects" ? (
        <>
          {/* Projects has no panel component of its own to hand the fold to —
              it is this column's own list — so its header is drawn here. */}
          <PanelHeader title={TITLES.projects} {...fold}>
            {/* The `+` every other section's header carries, doing the same
                thing: `Add a database` opens that panel's dialog, this opens
                the workbench's Add folder one — the same dialog the Explorer's
                tree and the File menu ask for, because a project *is* a folder
                in the workspace and two ways in that behaved differently would
                be two ideas of what adding one means.

                Only on the open header. A folded section is a header this
                column draws instead, and a button that adds to a list nobody
                can see is a button that answers nothing. */}
            <IconButton label="Add project" onClick={onAddFolder}>
              <Plus />
            </IconButton>
          </PanelHeader>
          <div className="min-h-0 flex-1">
            <ProjectsSection />
          </div>
        </>
      ) : id === "database" ? (
        <DatabaseTree fold={fold} />
      ) : (
        <RequestList fold={fold} />
      )}
    </div>
  )
}
