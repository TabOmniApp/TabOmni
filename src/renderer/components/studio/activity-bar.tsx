import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useEffect, useMemo, useState, type ComponentType } from "react"
import {
  Database,
  FileText,
  Mail,
  Send,
  SquareTerminal,
  Webhook,
} from "lucide-react"

import { unreadCount, useInbox } from "@/lib/inbox/store"
import { useRail } from "@/lib/rail"
import { ProjectSwitcher } from "./project-switcher"

/** Top-level areas of the workbench. */
export type Section =
  "database" | "api" | "mail" | "webhook" | "spec" | "terminal"

/**
 * Ordered the way the work goes: the data and the endpoints behind it, then
 * what those endpoints send back out and what arrives unasked, then the specs
 * they are built against, then the terminal.
 *
 * Mail and Webhooks are two sections rather than one because they replace two
 * applications and are read in two different frames of mind — a rendered email
 * and a signature header have nothing to say to each other. What they share is
 * a pair of servers and a store, not a panel.
 *
 * `Icon` is typed by the one prop the rail passes rather than as a Lucide icon,
 * so a hand-drawn mark could sit beside the glyphs.
 */
const SECTIONS: {
  id: Section
  label: string
  Icon: ComponentType<{ className?: string }>
}[] = [
  { id: "database", label: "Database", Icon: Database },
  { id: "api", label: "API", Icon: Send },
  { id: "mail", label: "Mail", Icon: Mail },
  { id: "webhook", label: "Webhooks", Icon: Webhook },
  { id: "spec", label: "Specs", Icon: FileText },
  { id: "terminal", label: "Terminal", Icon: SquareTerminal },
]

/**
 * The hue each section is known by, defined in `globals.css`.
 *
 * Read through `style` rather than composed into a class name — Tailwind scans
 * for whole literals, so a `text-section-${id}` would never be generated.
 */
export const SECTION_ACCENT: Record<Section, string> = {
  database: "var(--section-database)",
  api: "var(--section-api)",
  mail: "var(--section-mail)",
  webhook: "var(--section-webhook)",
  spec: "var(--section-spec)",
  terminal: "var(--section-terminal)",
}

/** The rail's own order, which a remembered one is reconciled against. */
const DEFAULT_ORDER = SECTIONS.map(({ id }) => id)

/**
 * The sections in the order they should be shown, and which of those are on
 * the rail.
 *
 * A remembered order is a preference, not the list: ids it does not name are
 * appended in the rail's own order (so a section added by a later build appears
 * rather than disappearing), and ids it names that no longer exist are dropped.
 * If everything is somehow hidden the rail shows all of it — a bar with no way
 * into any panel is not a state worth honouring.
 */
function arrange(
  order: string[],
  hidden: string[]
): { ordered: Section[]; visible: Section[] } {
  const known = new Set<string>(DEFAULT_ORDER)
  const ranked = order.filter((id): id is Section => known.has(id))
  const ordered = [
    ...ranked,
    ...DEFAULT_ORDER.filter((id) => !ranked.includes(id)),
  ]

  const visible = ordered.filter((id) => !hidden.includes(id))
  return { ordered, visible: visible.length > 0 ? visible : ordered }
}

/**
 * Moves one section so it sits before `before` — or last, when that is null.
 *
 * Over the full order rather than the visible one, so a hidden section keeps
 * the neighbours it had and does not jump when it is shown again.
 */
function moveSection(
  ordered: Section[],
  id: Section,
  before: Section | null
): Section[] {
  const next = ordered.filter((candidate) => candidate !== id)
  const at = before === null ? -1 : next.indexOf(before)
  next.splice(at === -1 ? next.length : at, 0, id)
  return next
}

export function ActivityBar({
  section,
  onSelect,
  onAddProject,
}: {
  section: Section
  onSelect: (section: Section) => void
  /** Passed through to the switcher above the rail, which offers it as a menu
   * item. The dialog it opens belongs to the workbench, not to the rail. */
  onAddProject: () => void
}) {
  // The two sections with something to say while they are closed: mail and
  // callbacks arrive whether or not anybody is looking, and an inbox nobody is
  // told about is a log. Counted per section — a badge on Webhooks that
  // included unread mail would send the user to the wrong panel.
  const unreadMail = useInbox((state) => unreadCount(state.messages, "mail"))
  const unreadHooks = useInbox((state) =>
    unreadCount(state.messages, "webhook")
  )

  const order = useRail((state) => state.order)
  const hidden = useRail((state) => state.hidden)
  const setOrder = useRail((state) => state.setOrder)
  const setHidden = useRail((state) => state.setHidden)
  const reset = useRail((state) => state.reset)

  // Memoised for the effect below rather than for the cost: `visible` is one
  // of its dependencies, and a fresh array every render would re-run it every
  // render.
  const { ordered, visible } = useMemo(
    () => arrange(order, hidden),
    [order, hidden]
  )

  /** The section being dragged, or null. */
  const [dragId, setDragId] = useState<Section | null>(null)
  /**
   * Which gap it would land in, counted in boundaries rather than icons: 0 is
   * above the first, `visible.length` below the last. Nothing moves until the
   * drop — the rail only draws a line where it would go.
   */
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  // The section on screen can be taken off the rail — by this menu, or by a
  // layout remembered from a launch where it was hidden — and a sidebar with
  // nothing selecting it is a sidebar the user cannot get back from.
  useEffect(() => {
    if (!visible.includes(section)) onSelect(visible[0]!)
  }, [section, visible, onSelect])

  function endDrag() {
    setDragId(null)
    setDropIndex(null)
  }

  function commitDrop() {
    if (dragId !== null && dropIndex !== null) {
      const next = moveSection(ordered, dragId, visible[dropIndex] ?? null)
      if (next.join() !== ordered.join()) setOrder(next)
    }
    endDrag()
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <nav
            aria-label="Sections"
            className="flex w-12 shrink-0 flex-col items-center gap-1 border-r py-2"
            onDragOver={(event) => {
              if (dragId === null) return
              event.preventDefault()
              // Only ever the empty space below the last icon: an icon of its
              // own stops the event before it reaches here.
              setDropIndex(visible.length)
            }}
            onDragLeave={(event) => {
              if (
                dragId === null ||
                event.currentTarget.contains(event.relatedTarget as Node | null)
              )
                return
              setDropIndex(null)
            }}
            onDrop={(event) => {
              if (dragId === null) return
              event.preventDefault()
              commitDrop()
            }}
          />
        }
      >
        {/* Above the divider because it is not a section: it chooses what the
            sections below are looking at. */}
        <ProjectSwitcher onAddProject={onAddProject} />
        <Separator className="my-1.5 w-6" />

        {visible.map((id, index) => {
          const { label, Icon } = SECTIONS.find((entry) => entry.id === id)!
          const active = section === id
          const unread =
            id === "mail" ? unreadMail : id === "webhook" ? unreadHooks : 0
          return (
            <div
              key={id}
              draggable
              onDragStart={(event) => {
                setDragId(id)
                event.dataTransfer.effectAllowed = "move"
                // Something has to be on the transfer for a drag to start at
                // all in Chromium; the id is the honest thing to put there.
                event.dataTransfer.setData("text/plain", id)
              }}
              onDragOver={(event) => {
                if (dragId === null) return
                event.preventDefault()
                // Kept from the rail below, which would otherwise overwrite
                // this with "past the last icon".
                event.stopPropagation()
                event.dataTransfer.dropEffect = "move"
                const rect = event.currentTarget.getBoundingClientRect()
                const pastMiddle = event.clientY > rect.top + rect.height / 2
                setDropIndex(pastMiddle ? index + 1 : index)
              }}
              onDrop={(event) => {
                if (dragId === null) return
                event.preventDefault()
                event.stopPropagation()
                commitDrop()
              }}
              onDragEnd={endDrag}
              className={cn("relative", dragId === id && "opacity-40")}
            >
              {/* Where the drop would land. The icons themselves stay put
                  until then, so nothing shuffles under the pointer. */}
              {dropIndex === index && <DropLine edge="top" />}
              {dropIndex === visible.length && index === visible.length - 1 && (
                <DropLine edge="bottom" />
              )}

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-lg"
                      variant="ghost"
                      onClick={() => onSelect(id)}
                      aria-label={label}
                      aria-current={active ? "page" : undefined}
                      style={active ? { color: SECTION_ACCENT[id] } : undefined}
                      className={cn(
                        "relative transition-colors",
                        active
                          ? "hover:bg-transparent"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {/* The rail is too narrow for labels, so the active
                          section is marked the way editors do it: a bar on the
                          outer edge — carrying the section's own hue, so which
                          panel is open reads before the icon is identified. */}
                      {active && (
                        <>
                          <span className="absolute inset-y-1.5 left-[-0.625rem] w-0.5 rounded-full bg-current" />
                          {/* Its own element rather than a `/10` on the
                              button's background: the tint has to follow
                              `currentColor`, and a background cannot inherit
                              it. */}
                          <span
                            aria-hidden
                            className="absolute inset-0 rounded-md bg-current opacity-10"
                          />
                        </>
                      )}
                      <Icon className="relative size-4.5" />

                      {/* Ringed in the rail's own background so the count still
                          reads where it overlaps the glyph, and carrying the
                          section's own hue so two badges are never confused for
                          each other. */}
                      {unread > 0 && (
                        <span
                          style={{ backgroundColor: SECTION_ACCENT[id] }}
                          className="absolute -top-0.5 right-0.5 min-w-3.5 rounded-full px-1 text-[0.55rem] leading-3.5 font-medium text-white ring-2 ring-background"
                        >
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </Button>
                  }
                />
                <TooltipContent side="right">
                  {label}
                  {unread > 0 && ` — ${unread} unread`}
                </TooltipContent>
              </Tooltip>
            </div>
          )
        })}
      </ContextMenuTrigger>

      {/* Right-clicking the rail is how a hidden section comes back, so the
          menu lists every section rather than only the ones on it. */}
      <ContextMenuContent className="w-44">
        {/* The label sits inside the group it names — Base UI's `GroupLabel`
            throws anywhere else. */}
        <ContextMenuGroup>
          <ContextMenuLabel>Sections</ContextMenuLabel>
          {ordered.map((id) => {
            const { label, Icon } = SECTIONS.find((entry) => entry.id === id)!
            const shown = visible.includes(id)
            return (
              <ContextMenuCheckboxItem
                key={id}
                checked={shown}
                // The last one standing cannot be hidden: the rail is the only
                // way into a panel, and an empty one strands the workbench.
                disabled={shown && visible.length === 1}
                onCheckedChange={(next) =>
                  setHidden(
                    next
                      ? hidden.filter((entry) => entry !== id)
                      : [...hidden.filter((entry) => entry !== id), id]
                  )
                }
              >
                <Icon className="text-muted-foreground" />
                {label}
              </ContextMenuCheckboxItem>
            )
          })}
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={reset}>Reset rail</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** The insertion marker shown while a section is being dragged. */
function DropLine({ edge }: { edge: "top" | "bottom" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary",
        edge === "top" ? "-top-0.5" : "-bottom-0.5"
      )}
    />
  )
}
