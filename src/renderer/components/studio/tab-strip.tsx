import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { Copy, X } from "lucide-react"

/** The insertion marker shown while a tab is being dragged. Which edge it is
 * drawn on is the strip's axis: the boundary between two tabs is vertical in a
 * row and horizontal in a column. */
function DropLine({ side }: { side: "left" | "right" | "top" | "bottom" }) {
  const alongRow = side === "left" || side === "right"
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-10 bg-primary",
        alongRow ? "inset-y-0 w-0.5" : "inset-x-0 h-0.5",
        side === "left" && "left-0",
        side === "right" && "right-0",
        side === "top" && "top-0",
        side === "bottom" && "bottom-0"
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
  /** A colour for the label, where the panel has something to say about the
   * thing itself — a file's git state, say. A class, since the palette belongs
   * to whoever built the tab and not to the strip. */
  tone?: string
  /** A word after the label, for a state the colour alone cannot carry:
   * `deleted` on a file that is no longer on disk. */
  note?: string
  /** What the menu's copy item puts on the clipboard, when it differs from
   * the label. */
  copyText?: string
  /** Overrides the strip's own copy label — one strip can hold tabs whose
   * copyable thing is not the same sort of thing. */
  copyLabel?: string
}

/**
 * A row — or, laid out the other way, a column — of editor tabs: what is open,
 * which one is on screen, and how to close them.
 *
 * Shared by the editor's files and the database panel's tables, which want
 * the same thing down to the middle-click. Everything about *what* a tab is
 * stays with the caller; this only knows how a strip of them behaves.
 *
 * The two orientations are one component rather than two because everything
 * that makes a tab strip a tab strip — the drag, the middle-click, the menu,
 * the dirty dot, scrolling the active tab back into view — is the same either
 * way. What differs is the axis: which edge the drop line is drawn on, which
 * way the tabs stack, and the scrolling, since a column is scrolled by the
 * wheel already and needs none of the sideways-scroll machinery below.
 */
export function TabStrip({
  label,
  items,
  activeId,
  copyLabel = "Copy name",
  orientation = "horizontal",
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
  /** `horizontal` is the row above the pane; `vertical` the column beside it. */
  orientation?: "horizontal" | "vertical"
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
  const vertical = orientation === "vertical"

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
  const stripRef = useRef<HTMLDivElement>(null)
  /**
   * Where the strip's own thumb sits, in px, or null while everything fits.
   *
   * Drawn rather than styled: a `::-webkit-scrollbar-thumb` whose colour comes
   * from an ancestor's `:hover` is re-resolved when something invalidates the
   * scrollbar — a scroll does, hover ending does not — so the reveal lit up and
   * then stayed lit. An ordinary element's opacity has none of that problem.
   */
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(
    null
  )

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

  const measureThumb = useCallback(() => {
    const strip = stripRef.current
    if (!strip) return
    // A column scrolls the way the platform already draws a scrollbar for.
    if (vertical) return
    const { scrollWidth, clientWidth, scrollLeft } = strip
    // A hair of slack: a fractional layout width shouldn't conjure a thumb.
    if (scrollWidth - clientWidth < 1) {
      setThumb(null)
      return
    }
    const width = Math.max(24, (clientWidth / scrollWidth) * clientWidth)
    const travel = clientWidth - width
    // Clamped, and not out of tidiness: `scrollWidth` and `clientWidth` are
    // whole pixels while the real end of the scroll is not, so at the far end
    // the ratio comes out just over 1 and the thumb lands a fraction of a pixel
    // past the strip's right edge. An absolutely positioned box counts towards
    // its ancestors' scrollable overflow, so that fraction was enough to grow a
    // scrollbar on whatever scrolls above — appearing only once the strip was
    // scrolled all the way, which is exactly when the ratio can exceed 1.
    const progress = Math.min(1, scrollLeft / (scrollWidth - clientWidth))
    setThumb({ left: progress * travel, width })
  }, [vertical])

  // A tab activated from elsewhere — a tree, a jump-to-file — can be scrolled
  // out of sight in a long strip.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activeId])

  // Opening or closing a tab changes the scrollable width without scrolling.
  useEffect(measureThumb, [measureThumb, items])

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const observer = new ResizeObserver(measureThumb)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [measureThumb, items.length])

  // Chromium only turns a vertical wheel into a sideways scroll on a scroller
  // that could also scroll vertically, so the strip would sit still under the
  // wheel and hand the notch to whatever scrolls behind it. React binds `wheel`
  // passively, hence the native listener: preventDefault is the whole point.
  // Re-bound per tab count because an empty strip renders a different element.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip || vertical) return

    const onWheel = (event: WheelEvent) => {
      // Leave a trackpad's own horizontal gesture alone.
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      if (strip.scrollWidth <= strip.clientWidth) return
      event.preventDefault()
      strip.scrollLeft += event.deltaY
    }

    strip.addEventListener("wheel", onWheel, { passive: false })
    return () => strip.removeEventListener("wheel", onWheel)
  }, [items.length, vertical])

  if (items.length === 0) {
    if (!trailing) return null
    return (
      <div
        className={cn(
          "flex shrink-0 bg-muted/40",
          vertical
            ? "h-full w-full flex-col items-stretch border-l p-1"
            : "h-9 items-stretch border-b"
        )}
      >
        <div
          className={cn(
            "flex items-center",
            vertical ? "justify-end" : "ml-auto pr-1"
          )}
        >
          {trailing}
        </div>
      </div>
    )
  }

  return (
    <ContextMenu>
      {/* `overflow-hidden` so the thumb can never reach an ancestor's
          scrollable overflow, whatever the arithmetic above rounds to: the
          strip scrolls itself, and nothing here is meant to escape it. */}
      <div
        className={cn(
          "group/strip relative shrink-0 overflow-hidden",
          // The whole of whatever it was given: a column is handed a resizable
          // panel of its own (`studio.tsx`), so the width is the user's drag
          // rather than a number picked here.
          vertical && "flex h-full w-full flex-col"
        )}
      >
        <div
          ref={stripRef}
          role="tablist"
          aria-label={label}
          onScroll={measureThumb}
          onDragOver={(event) => {
            if (dragId === null) return
            event.preventDefault()
            // Only ever the empty space past the last tab: a tab of its own
            // stops the event before it reaches here.
            setDropIndex(items.length)
          }}
          onDragLeave={(event) => {
            if (dragId === null) return
            if (
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
          // A row scrolls sideways only: a tab is as tall as the strip, so a
          // vertical scrollbar would only ever be Chromium rounding against us.
          // The horizontal one is hidden outright — the thumb below stands in
          // for it, which also gives the tabs back the row of height it was
          // taking. A column is the other way round, and keeps the scrollbar the
          // platform draws: it is a list, and a list is expected to have one.
          className={cn(
            "flex items-stretch bg-muted/40",
            vertical
              ? "min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto border-l"
              : "h-9 scrollbar-none overflow-x-auto overflow-y-hidden border-b"
          )}
        >
          {/* The trigger covers the tabs only: a right-click on the empty strip
            past the last one belongs to no tab. */}
          <ContextMenuTrigger
            render={
              <div
                className={cn(
                  "flex items-stretch",
                  vertical && "min-w-0 flex-col"
                )}
              />
            }
          >
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
                    // Along whichever axis the strip runs: past the middle of a
                    // tab is past it, sideways in a row and downwards in a
                    // column.
                    const pastMiddle = vertical
                      ? event.clientY > rect.top + rect.height / 2
                      : event.clientX > rect.left + rect.width / 2
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
                    "group relative flex shrink-0 cursor-default items-center gap-1.5 px-2.5 text-xs outline-none",
                    vertical ? "border-b py-1.5" : "max-w-52 border-r",
                    active
                      ? vertical
                        ? // The accent on the edge the pane is on, pointing at
                          // what the row is showing — where a row of tabs marks
                          // its outer edge, a column beside the editor reads
                          // better marking the one against it. `pl-2` gives the
                          // 2px back so the label does not shift on selection.
                          "border-l-2 border-l-primary bg-background pl-2 text-foreground"
                        : "border-t-2 border-t-primary bg-background pb-0.5 text-foreground"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                    dragId === item.id && "opacity-60"
                  )}
                >
                  {/* Where the drop would land. The tabs themselves stay put
                    until then, so nothing shuffles under the pointer. */}
                  {dropIndex === index && (
                    <DropLine side={vertical ? "top" : "left"} />
                  )}
                  {dropIndex === items.length && index === items.length - 1 && (
                    <DropLine side={vertical ? "bottom" : "right"} />
                  )}
                  {item.icon}
                  <span className={cn("truncate font-mono", item.tone)}>
                    {item.label}
                  </span>
                  {item.note && (
                    <span
                      className={cn(
                        "shrink-0 text-[0.65rem] tracking-wide uppercase opacity-80",
                        item.tone
                      )}
                    >
                      {item.note}
                    </span>
                  )}

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
            <div
              className={cn(
                "flex shrink-0 items-center",
                vertical ? "justify-end p-1" : "ml-auto pr-1"
              )}
            >
              {trailing}
            </div>
          )}
        </div>

        {/* Sits over the strip's bottom edge, clear of the border. */}
        {thumb && (
          <span
            aria-hidden
            style={{ left: thumb.left, width: thumb.width }}
            className="pointer-events-none absolute bottom-0.5 h-[3px] rounded-full bg-muted-foreground opacity-0 transition-opacity duration-150 group-hover/strip:opacity-100"
          />
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
