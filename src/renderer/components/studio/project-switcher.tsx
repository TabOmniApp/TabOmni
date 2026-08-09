import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Plus } from "lucide-react"

import { useStudio } from "@/lib/store"

/**
 * The mark standing in for a project that has no logo of its own.
 *
 * Two letters, taken one per word where the name has words — `build-everywhere`
 * reads as BE rather than BU, which is the difference between two projects
 * being told apart at a glance and both showing the same pair. Names are split
 * on the separators a directory name actually uses, since that is what a name
 * usually is here.
 */
function initials(name: string): string {
  const words = name.split(/[\s\-_.]+/).filter(Boolean)
  if (words.length === 0) return "?"
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}

/** The square mark, at the one size it is used in — rail and menu rows alike. */
function ProjectMark({ name }: { name: string }) {
  return (
    <Avatar className="size-9 rounded-lg border">
      {/* No `<AvatarImage>`: `ProjectRecord` carries no logo field, and an
          image with no `src` is a box the fallback then has to sit behind. It
          belongs here, above the fallback, the day that field exists. */}
      <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-semibold text-primary">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

/**
 * Which project the studio is pointed at, as the rail's topmost item.
 *
 * A square rather than the component's default circle, and the only item above
 * the section icons: the shape says "this is what everything below is about"
 * rather than "this is one more section". The name is in the tooltip, because
 * the rail is the same 48px wide here as it is for the icons under it.
 */
export function ProjectSwitcher({
  onAddProject,
}: {
  onAddProject: () => void
}) {
  const projects = useStudio((state) => state.projects)
  const projectId = useStudio((state) => state.projectId)
  const openProject = useStudio((state) => state.openProject)

  const project = projects.find((candidate) => candidate.id === projectId)
  if (!project) return null

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              aria-label={`Project: ${project.name}`}
              className="rounded-lg transition-opacity outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ProjectMark name={project.name} />
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent side="right">{project.name}</TooltipContent>
      </Tooltip>

      {/* Below the mark rather than beside it: the rail is against the window
          edge, and a menu opening to the right covers the panel the project
          was picked to look at. */}
      <DropdownMenuContent side="bottom" align="start" className="w-72">
        <DropdownMenuRadioGroup
          value={projectId ?? ""}
          onValueChange={(value) => {
            if (value && value !== projectId) void openProject(value)
          }}
        >
          {projects.map((candidate) => (
            <DropdownMenuRadioItem
              key={candidate.id}
              value={candidate.id}
              className="gap-2.5 py-1.5"
            >
              <ProjectMark name={candidate.name} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{candidate.name}</span>
                {/* The folder is what tells two projects of the same name
                    apart, and it is the closest thing a project has to the
                    address a workspace would show here. */}
                <span className="truncate text-xs text-muted-foreground">
                  {candidate.sourcePath ?? "Scaffolded here"}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem className="gap-2.5 py-1.5" onClick={onAddProject}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
            <Plus className="size-4" />
          </span>
          Add a project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
