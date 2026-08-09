import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { Copy, X } from "lucide-react"

/** The insertion marker shown while a tab is being dragged. */
function DropLine({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-primary",
        side === "left" ? "left-0" : "right-0"
      )}
    />
  )
}

export type TabStripItem = {
  /** Stable identity: a file path, a schema-qualified table name. */
  id: string
  label: string
  icon?: ReactNode
  title?: string
  /** Marks a tab with work in flight — a dot in place of its close button,
   * the way an editor marks a buffer that is not on disk yet. */
  dirty?: boolean
  /** What the menu's copy item puts on the clipboard, when it differs from
   * the label. */
  copyText?: string
  /** Overrides the strip's own copy label — one strip can hold tabs whose
   * copyable thing is not the same sort of thing. */
  copyLabel?: string
}

/**
 * A row of editor tabs: what is open, which one is on screen, and how to
 * close them.
 *
 * Shared by the editor's files and the database panel's tables, which want
 * the same thing down to the middle-click. Everything about *what* a tab is
 * stays with the caller; this only knows how a strip of them behaves.
 */
export function TabStrip({
  label,
  items,
  activeId,
  copyLabel = "Copy name",
  trailing,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseAll,
  onReorder,
}: {
  /** Names the tablist for assistive tech, e.g. "Open files". */
  label: string
  items: TabStripItem[]
  activeId: string | null
  copyLabel?: string
  /** Rendered at the strip's trailing edge, e.g. a "new tab" button. Shown
   * even with no tabs open, so the strip doesn't vanish along with them. */
  trailing?: ReactNode
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseOthers: (id: string) => void
  onCloseAll: () => void
  /** Hands back every id in its new order. Omit to pin the strip's order. */
  onReorder?: (ids: string[]) => void
}) {
  const [menuTarget, setMenuTarget] = useState<TabStripItem | null>(null)
  /** The tab being dragged, or null. Also the guard that keeps a file dragged
   * in from the desktop from being treated as a reorder. */
  const [dragId, setDragId] = useState<string | null>(null)
  /**
   * Which gap the tab would land in, counted in boundaries rather than tabs:
   * 0 is before the first, `items.length` after the last. Nothing moves until
   * the drop — the strip only draws a line where it would go.
   */
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const activeRef = useRef<HTMLDivElement>(null)

  function endDrag() {
    setDragId(null)
    setDropIndex(null)
  }

  function commitDrop() {
    const ids = items.map((item) => item.id)
    const from = dragId === null ? -1 : ids.indexOf(dragId)
    if (onReorder && from !== -1 && dropIndex !== null) {
      // Pulling the tab out first shifts every later boundary left by one.
      const to = dropIndex > from ? dropIndex - 1 : dropIndex
      if (to !== from) {
        const [moved] = ids.splice(from, 1)
        ids.splice(to, 0, moved!)
        onReorder(ids)
      }
    }
    endDrag()
  }

  // A tab activated from elsewhere — a tree, a jump-to-file — can be scrolled
  // out of sight in a long strip.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activeId])

  if (items.length === 0) {
    if (!trailing) return null
    return (
      <div className="flex h-8 shrink-0 items-stretch border-b bg-muted/40">
        <div className="ml-auto flex items-center pr-1">{trailing}</div>
      </div>
    )
  }

  return (
    <ContextMenu>
      <div
        role="tablist"
        aria-label={label}
        onDragOver={(event) => {
          if (dragId === null) return
          event.preventDefault()
          // Only ever the empty space past the last tab: a tab of its own
          // stops the event before it reaches here.
          setDropIndex(items.length)
        }}
        onDragLeave={(event) => {
          if (dragId === null) return
          if (event.currentTarget.contains(event.relatedTarget as Node | null))
            return
          setDropIndex(null)
        }}
        onDrop={(event) => {
          if (dragId === null) return
          event.preventDefault()
          commitDrop()
        }}
        className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b bg-muted/40"
      >
        {/* The trigger covers the tabs only: a right-click on the empty strip
            past the last one belongs to no tab. */}
        <ContextMenuTrigger render={<div className="flex items-stretch" />}>
          {items.map((item, index) => {
            const active = item.id === activeId

            return (
              <div
                key={item.id}
                ref={active ? activeRef : undefined}
                role="tab"
                tabIndex={0}
                aria-selected={active}
                title={item.title ?? item.label}
                draggable={onReorder !== undefined}
                onDragStart={(event) => {
                  setDragId(item.id)
                  event.dataTransfer.effectAllowed = "move"
                  // Something has to be on the transfer for a drag to start at
                  // all in Chromium; the id is the honest thing to put there.
                  event.dataTransfer.setData("text/plain", item.id)
                }}
                onDragOver={(event) => {
                  if (dragId === null) return
                  event.preventDefault()
                  // Kept from the strip below, which would otherwise overwrite
                  // this with "past the last tab".
                  event.stopPropagation()
                  event.dataTransfer.dropEffect = "move"
                  const rect = event.currentTarget.getBoundingClientRect()
                  const pastMiddle = event.clientX > rect.left + rect.width / 2
                  setDropIndex(pastMiddle ? index + 1 : index)
                }}
                onDrop={(event) => {
                  if (dragId === null) return
                  event.preventDefault()
                  event.stopPropagation()
                  commitDrop()
                }}
                onDragEnd={endDrag}
                onClick={() => onSelect(item.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  onSelect(item.id)
                }}
                // Middle-click closes. The mousedown guard is what stops the
                // browser's own scroll-anchor from taking the click instead.
                onMouseDown={(event) => {
                  if (event.button === 1) event.preventDefault()
                }}
                onAuxClick={(event) => {
                  if (event.button === 1) onClose(item.id)
                }}
                onContextMenu={() => setMenuTarget(item)}
                className={cn(
                  "group relative flex max-w-52 shrink-0 cursor-default items-center gap-1.5 border-r px-2.5 text-xs outline-none",
                  active
                    ? "border-t-2 border-t-primary bg-background pb-0.5 text-foreground"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                  dragId === item.id && "opacity-60"
                )}
              >
                {/* Where the drop would land. The tabs themselves stay put
                    until then, so nothing shuffles under the pointer. */}
                {dropIndex === index && <DropLine side="left" />}
                {dropIndex === items.length && index === items.length - 1 && (
                  <DropLine side="right" />
                )}
                {item.icon}
                <span className="truncate font-mono">{item.label}</span>

                {item.dirty && (
                  <span
                    aria-label="Unsaved"
                    className="-mr-1 inline-flex size-4 shrink-0 items-center justify-center group-hover:hidden"
                  >
                    <span className="size-1.5 rounded-full bg-current" />
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Close ${item.label}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onClose(item.id)
                  }}
                  className={cn(
                    "-mr-1 inline-flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-accent hover:text-accent-foreground",
                    item.dirty
                      ? "hidden group-hover:inline-flex"
                      : active
                        ? "opacity-70"
                        : "opacity-0 group-hover:opacity-100"
                  )}
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
        </ContextMenuTrigger>

        {trailing && (
          <div className="ml-auto flex shrink-0 items-center pr-1">
            {trailing}
          </div>
        )}
      </div>

      {menuTarget && (
        <ContextMenuContent className="w-44">
          <ContextMenuItem onClick={() => onClose(menuTarget.id)}>
            <X />
            Close
          </ContextMenuItem>
          <ContextMenuItem
            disabled={items.length < 2}
            onClick={() => onCloseOthers(menuTarget.id)}
          >
            Close others
          </ContextMenuItem>
          <ContextMenuItem onClick={onCloseAll}>Close all</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() =>
              void navigator.clipboard.writeText(
                menuTarget.copyText ?? menuTarget.label
              )
            }
          >
            <Copy />
            {menuTarget.copyLabel ?? copyLabel}
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
}
