import { cn } from "@/lib/utils"

import type { Marker, MarkerKind } from "@/lib/spec/schema"

/**
 * A marker, drawn.
 *
 * Shared by the canvas editor and the read-only preview so a spec looks the
 * same either side of the Edit button — the editor adds handles around what
 * this draws rather than drawing its own version of it.
 *
 * Everything is positioned in the canvas's own width-relative units (see
 * `Marker`), which reach CSS as percentages: `left` and `width` are already
 * percentages of the width, and `top` and `height` are converted through the
 * canvas's aspect so that a unit is the same distance in both directions.
 */
export type Geometry = {
  /** The canvas's height in those same units, for converting the vertical. */
  height: number
}

/** A vertical unit as a percentage of the canvas box. */
export function vertical(value: number, canvasHeight: number): string {
  return `${(value / canvasHeight) * 100}%`
}

export const MARKER_LABELS: Record<MarkerKind, string> = {
  circle: "Number",
  square: "Number in a square",
  arrow: "Number with an arrow",
  box: "Region",
}

/** The label itself — the part that carries the number, common to every kind. */
export function MarkerBadge({
  kind,
  children,
  className,
}: {
  kind: MarkerKind
  children: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex size-6 items-center justify-center bg-destructive text-[0.65rem] font-bold text-white ring-4 ring-destructive/25",
        kind === "square" || kind === "box" ? "rounded-md" : "rounded-full",
        className
      )}
    >
      {children}
    </span>
  )
}

/**
 * One marker on the canvas, without any editing affordance.
 *
 * `box` draws its region and hangs the number on the region's corner; `arrow`
 * draws a line from the number to wherever it points, with the head at the
 * pointing end. The other two are the number alone.
 */
export function CanvasMarker({
  marker,
  canvasHeight,
}: {
  marker: Marker
  canvasHeight: number
}) {
  const top = vertical(marker.y, canvasHeight)

  if (marker.kind === "box") {
    return (
      <div
        style={{
          left: `${marker.x}%`,
          top,
          width: `${marker.width}%`,
          height: vertical(marker.height, canvasHeight),
        }}
        className="pointer-events-none absolute rounded-md border-2 border-destructive/80"
      >
        <MarkerBadge kind="box" className="absolute -top-3 -left-3">
          {marker.id}
        </MarkerBadge>
      </div>
    )
  }

  if (marker.kind === "arrow") {
    return (
      <>
        <Leader marker={marker} canvasHeight={canvasHeight} />
        <span
          style={{ left: `${marker.x}%`, top }}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
        >
          <MarkerBadge kind="arrow">{marker.id}</MarkerBadge>
        </span>
      </>
    )
  }

  return (
    <span
      style={{ left: `${marker.x}%`, top }}
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
    >
      <MarkerBadge kind={marker.kind}>{marker.id}</MarkerBadge>
    </span>
  )
}

/**
 * The line from an arrow's number to what it points at.
 *
 * An SVG stretched over the whole canvas rather than a rotated div: the two
 * ends are independent points, and `viewBox="0 0 100 <height>"` lets them be
 * given in the canvas's own units with no trigonometry at all. Non-scaling
 * strokes keep the line the same weight whatever width the panel is.
 */
function Leader({
  marker,
  canvasHeight,
}: {
  marker: Marker
  canvasHeight: number
}) {
  const id = `arrow-${marker.id}-${Math.round(marker.tipX)}-${Math.round(marker.tipY)}`
  return (
    <svg
      viewBox={`0 0 100 ${canvasHeight}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      <defs>
        <marker
          id={id}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-destructive" />
        </marker>
      </defs>
      <line
        x1={marker.x}
        y1={marker.y}
        x2={marker.tipX}
        y2={marker.tipY}
        markerEnd={`url(#${id})`}
        vectorEffect="non-scaling-stroke"
        className="stroke-destructive"
        strokeWidth={2}
      />
    </svg>
  )
}
