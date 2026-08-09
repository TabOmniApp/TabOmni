import { useRef, type PointerEvent as ReactPointerEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  ArrowUpRight,
  Circle,
  ImagePlus,
  Square,
  SquareDashed,
  X,
} from "lucide-react"

import {
  MARKER_KINDS,
  nextNumber,
  type CanvasImage,
  type Marker,
  type MarkerKind,
  type SpecCanvas,
} from "@/lib/spec/schema"
import { useProjectImage } from "@/lib/spec/use-project-image"
import { IconButton } from "../icon-button"
import { CanvasMarker, MARKER_LABELS, vertical } from "./canvas-marker"

/**
 * The screen, drawn as one figure.
 *
 * A canvas rather than a list of screenshots. However many pictures are dropped
 * on it — the screen, a dialog over it, the failed state beside it — what a
 * reader sees is one figure, and the numbers run 1, 2, 3 across the whole of
 * it. That is also what the item table joins to, so there is exactly one
 * sequence to keep straight.
 *
 * Everything is measured in percentages of the canvas *width*, including
 * vertical distances (see `Marker`). One consequence is worth stating: the
 * canvas scales to whatever width the panel has and nothing moves relative to
 * anything else, and making the canvas taller only adds room at the bottom.
 */
export function SpecCanvasEditor({
  canvas,
  nameOf,
  onChange,
  onAddImages,
}: {
  canvas: SpecCanvas
  /** What the item table calls the row a marker's number points at — read from
   * the one place that name is written. */
  nameOf: (no: string) => string
  onChange: (canvas: SpecCanvas) => void
  onAddImages: () => void
}) {
  const boardRef = useRef<HTMLDivElement>(null)

  /** Pointer position as canvas units. */
  function pointAt(event: { clientX: number; clientY: number }) {
    const box = boardRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return null
    return {
      x: ((event.clientX - box.left) / box.width) * 100,
      y: ((event.clientY - box.top) / box.width) * 100,
    }
  }

  /**
   * A drag, in canvas units.
   *
   * Pointer capture rather than HTML5 drag-and-drop: this is a continuous move
   * within one element, and the drag API is built for transfers between them —
   * it reports no coordinates worth having and puts a ghost image under the
   * cursor that would have to be suppressed anyway.
   *
   * `apply` is given the offset from where the drag began, and rebuilds from a
   * snapshot taken at pointer-down. Absolute rather than incremental, so a
   * dropped event or a re-render mid-drag cannot make the thing drift.
   */
  function drag(
    event: ReactPointerEvent<HTMLElement>,
    apply: (dx: number, dy: number) => void
  ) {
    event.preventDefault()
    event.stopPropagation()

    const origin = pointAt(event)
    if (!origin) return

    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)

    const move = (moveEvent: globalThis.PointerEvent) => {
      const point = pointAt(moveEvent)
      if (point) apply(point.x - origin.x, point.y - origin.y)
    }
    const stop = () => {
      target.releasePointerCapture(event.pointerId)
      target.removeEventListener("pointermove", move)
      target.removeEventListener("pointerup", stop)
      target.removeEventListener("pointercancel", stop)
    }

    target.addEventListener("pointermove", move)
    target.addEventListener("pointerup", stop)
    target.addEventListener("pointercancel", stop)
  }

  const setMarkers = (markers: Marker[]) => onChange({ ...canvas, markers })
  const setImages = (images: CanvasImage[]) => onChange({ ...canvas, images })

  const updateMarker = (index: number, changes: Partial<Marker>) =>
    setMarkers(
      canvas.markers.map((mark, at) =>
        at === index ? { ...mark, ...changes } : mark
      )
    )

  const updateImage = (index: number, changes: Partial<CanvasImage>) =>
    setImages(
      canvas.images.map((image, at) =>
        at === index ? { ...image, ...changes } : image
      )
    )

  /**
   * Dropping a marker from the palette.
   *
   * The palette button starts the drag and the marker is created where the
   * pointer is released, so what lands on the canvas is the thing that was
   * dragged rather than one that appears in the middle and has to be moved.
   */
  function dragFromPalette(
    event: ReactPointerEvent<HTMLElement>,
    kind: MarkerKind
  ) {
    event.preventDefault()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)

    const stop = (upEvent: globalThis.PointerEvent) => {
      target.releasePointerCapture(event.pointerId)
      target.removeEventListener("pointerup", stop)
      target.removeEventListener("pointercancel", cancel)

      const point = pointAt(upEvent)
      // Released outside the canvas: nothing was placed, which is how a drag
      // is abandoned.
      if (!point || point.x < 0 || point.x > 100 || point.y < 0) return
      if (point.y > canvas.height) return

      const id = nextNumber(canvas.markers.map((mark) => mark.id))
      setMarkers([
        ...canvas.markers,
        {
          id,
          kind,
          x: point.x,
          y: point.y,
          width: 20,
          height: 12,
          tipX: Math.min(100, point.x + 12),
          tipY: Math.max(0, point.y - 8),
        },
      ])
    }
    const cancel = () => {
      target.releasePointerCapture(event.pointerId)
      target.removeEventListener("pointerup", stop)
      target.removeEventListener("pointercancel", cancel)
    }

    target.addEventListener("pointerup", stop)
    target.addEventListener("pointercancel", cancel)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-card p-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={onAddImages}
        >
          <ImagePlus data-icon="inline-start" />
          Add image
        </Button>
        <span className="mx-1 h-5 w-px bg-border" />
        {MARKER_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            title={`${MARKER_LABELS[kind]} — drag onto the canvas`}
            aria-label={`${MARKER_LABELS[kind]} — drag onto the canvas`}
            onPointerDown={(event) => dragFromPalette(event, kind)}
            className="flex cursor-grab items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
          >
            <PaletteIcon kind={kind} />
            {MARKER_LABELS[kind]}
          </button>
        ))}
      </div>

      <div
        ref={boardRef}
        style={{ paddingBottom: `${canvas.height}%` }}
        className="relative w-full overflow-hidden rounded-xl border bg-muted"
      >
        <div className="absolute inset-0">
          {canvas.images.map((image, index) => (
            <Picture
              key={`${image.src}:${index}`}
              image={image}
              canvasHeight={canvas.height}
              onMove={(dx, dy) => {
                const from = canvas.images[index]!
                updateImage(index, {
                  x: clamp(from.x + dx),
                  y: Math.max(0, from.y + dy),
                })
              }}
              onResize={(dx) => {
                const from = canvas.images[index]!
                updateImage(index, {
                  width: Math.min(120, Math.max(5, from.width + dx)),
                })
              }}
              onCaption={(caption) => updateImage(index, { caption })}
              onRemove={() =>
                setImages(canvas.images.filter((_, at) => at !== index))
              }
              onDragStart={drag}
            />
          ))}

          {/*
            The numbers are a layer of their own, above every picture. A
            picture raised while it is hovered must not bury them, which is
            exactly what happened while the pictures and the markers shared one
            stacking order. `pointer-events-none` because this layer covers the
            whole canvas and would otherwise swallow every click meant for a
            picture underneath it; the grips inside opt back in.
          */}
          <div className="pointer-events-none absolute inset-0 z-20">
            {canvas.markers.map((mark, index) => (
              <Handle
                key={index}
                marker={mark}
                canvasHeight={canvas.height}
                onMove={(dx, dy) => {
                  const from = canvas.markers[index]!
                  updateMarker(index, {
                    x: clamp(from.x + dx),
                    y: Math.max(0, from.y + dy),
                    // The arrow's tip travels with its label, so moving the
                    // number does not swing what it points at.
                    tipX: clamp(from.tipX + dx),
                    tipY: Math.max(0, from.tipY + dy),
                  })
                }}
                onTip={(dx, dy) => {
                  const from = canvas.markers[index]!
                  updateMarker(index, {
                    tipX: clamp(from.tipX + dx),
                    tipY: Math.max(0, from.tipY + dy),
                  })
                }}
                onResize={(dx, dy) => {
                  const from = canvas.markers[index]!
                  updateMarker(index, {
                    width: Math.max(3, from.width + dx),
                    height: Math.max(3, from.height + dy),
                  })
                }}
                onDragStart={drag}
              />
            ))}
          </div>

          {canvas.images.length === 0 && canvas.markers.length === 0 && (
            <button
              type="button"
              onClick={onAddImages}
              className="absolute inset-0 grid place-items-center text-sm text-muted-foreground hover:text-foreground"
            >
              Add a screenshot, or drag a number onto the canvas
            </button>
          )}
        </div>
      </div>

      {/* The canvas's own height. A drag handle under it rather than a number
          box: how much room a figure needs is judged by eye. */}
      <div
        onPointerDown={(event) => {
          const start = canvas.height
          drag(event, (_dx, dy) =>
            onChange({ ...canvas, height: Math.max(20, start + dy) })
          )
        }}
        className="mx-auto h-2 w-24 cursor-ns-resize rounded-full bg-border hover:bg-muted-foreground/40"
        role="separator"
        aria-label="Canvas height"
      />

      {canvas.markers.length > 0 && (
        <div className="space-y-1">
          {canvas.markers.map((mark, index) => (
            <div key={index} className="flex items-center gap-1">
              <Input
                value={mark.id}
                aria-label={`Marker ${index + 1} number`}
                onChange={(event) =>
                  updateMarker(index, { id: event.target.value })
                }
                className="h-7 w-12 text-center text-xs"
              />
              <span className="w-32 shrink-0 text-xs text-muted-foreground">
                {MARKER_LABELS[mark.kind]}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {/* The name lives in the item table, which is the one place it
                    is written. */}
                {nameOf(mark.id) || (
                  <span className="italic">Name it in the table below</span>
                )}
              </span>
              <IconButton
                label="Remove marker"
                onClick={() =>
                  setMarkers(canvas.markers.filter((_, at) => at !== index))
                }
              >
                <X />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PaletteIcon({ kind }: { kind: MarkerKind }) {
  const className = "size-3.5"
  if (kind === "square") return <Square className={className} />
  if (kind === "arrow") return <ArrowUpRight className={className} />
  if (kind === "box") return <SquareDashed className={className} />
  return <Circle className={className} />
}

function Picture({
  image,
  canvasHeight,
  onMove,
  onResize,
  onCaption,
  onRemove,
  onDragStart,
}: {
  image: CanvasImage
  canvasHeight: number
  onMove: (dx: number, dy: number) => void
  onResize: (dx: number) => void
  onCaption: (caption: string) => void
  onRemove: () => void
  onDragStart: (
    event: ReactPointerEvent<HTMLElement>,
    apply: (dx: number, dy: number) => void
  ) => void
}) {
  const source = useProjectImage(image.src)

  return (
    <div
      style={{
        left: `${image.x}%`,
        top: vertical(image.y, canvasHeight),
        width: `${image.width}%`,
      }}
      /*
       * Raised while it is being worked on. The pictures are siblings on one
       * canvas, so a later one paints over an earlier one's controls — which
       * put the remove button behind the picture below it — and the markers,
       * drawn after every picture, cover them too. Lifting the whole group on
       * hover is what makes the controls belong to the picture under the
       * cursor rather than to whatever happens to be last in the document.
       *
       * Only as far as `z-10`, though: the numbers sit at `z-20` and have to
       * stay readable, so raising a picture lifts it over the other pictures
       * and no further.
       */
      className="group absolute focus-within:z-30 hover:z-30"
    >
      <div
        onPointerDown={(event) => onDragStart(event, onMove)}
        className="cursor-move overflow-hidden rounded-md border bg-card shadow-sm"
      >
        {source.dataUrl ? (
          <img
            src={source.dataUrl}
            alt={image.caption || image.src}
            draggable={false}
            className="block w-full select-none"
          />
        ) : (
          <div className="grid min-h-20 place-items-center p-4 text-center text-[0.65rem] text-muted-foreground">
            {source.error ? (
              <span className="font-mono text-destructive">{source.error}</span>
            ) : (
              "Loading…"
            )}
          </div>
        )}
      </div>

      <Input
        value={image.caption}
        placeholder="Caption"
        aria-label="Image caption"
        onChange={(event) => onCaption(event.target.value)}
        onPointerDown={(event) => event.stopPropagation()}
        className="mt-0.5 h-6 border-0 bg-transparent px-1 text-center text-[0.65rem] shadow-none focus-visible:bg-background focus-visible:ring-1"
      />

      {/*
        Only on hover — a picture covered in controls is one nobody can see —
        and inside the picture's own bounds rather than hanging off its corner,
        because the canvas clips what leaves it and a picture sitting against
        the right edge would have had its remove button cut in half.
      */}
      <div className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton label="Remove image" variant="outline" onClick={onRemove}>
          <X />
        </IconButton>
      </div>
      <span
        onPointerDown={(event) => onDragStart(event, (dx) => onResize(dx))}
        aria-hidden
        className="absolute right-1 bottom-7 size-3 cursor-ew-resize rounded-full border-2 border-background bg-foreground/60 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </div>
  )
}

/** A marker plus the grips that move and reshape it. */
function Handle({
  marker,
  canvasHeight,
  onMove,
  onTip,
  onResize,
  onDragStart,
}: {
  marker: Marker
  canvasHeight: number
  onMove: (dx: number, dy: number) => void
  onTip: (dx: number, dy: number) => void
  onResize: (dx: number, dy: number) => void
  onDragStart: (
    event: ReactPointerEvent<HTMLElement>,
    apply: (dx: number, dy: number) => void
  ) => void
}) {
  return (
    <>
      <CanvasMarker marker={marker} canvasHeight={canvasHeight} />

      {/* The grip sits over the drawn marker rather than replacing it, so the
          canvas looks the same here as it does in the preview. */}
      <span
        onPointerDown={(event) => onDragStart(event, onMove)}
        style={{
          left: `${marker.kind === "box" ? marker.x : marker.x}%`,
          top: vertical(marker.y, canvasHeight),
        }}
        aria-label={`Move marker ${marker.id}`}
        className={cn(
          "pointer-events-auto absolute size-6 cursor-move rounded-full",
          marker.kind === "box"
            ? "-translate-x-3 -translate-y-3"
            : "-translate-x-1/2 -translate-y-1/2"
        )}
      />

      {marker.kind === "arrow" && (
        <span
          onPointerDown={(event) => onDragStart(event, onTip)}
          style={{
            left: `${marker.tipX}%`,
            top: vertical(marker.tipY, canvasHeight),
          }}
          aria-label={`Move where marker ${marker.id} points`}
          className="pointer-events-auto absolute size-4 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-background bg-destructive"
        />
      )}

      {marker.kind === "box" && (
        <span
          onPointerDown={(event) => onDragStart(event, onResize)}
          style={{
            left: `${marker.x + marker.width}%`,
            top: vertical(marker.y + marker.height, canvasHeight),
          }}
          aria-label={`Resize marker ${marker.id}`}
          className="pointer-events-auto absolute size-3 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-full border-2 border-background bg-destructive"
        />
      )}
    </>
  )
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value))
}
