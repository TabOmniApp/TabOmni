import { cn } from "@/lib/utils"

/**
 * A swordsman flicking his katana skyward, and the gust it throws crossing left
 * to right — the chat's "a turn is running" indicator.
 *
 * **Every moving part is in `styles/motion.css`**, under the `yasuo-*` names
 * this file applies. The keyframes were inline here while this was a sketch, on
 * the grounds that `motion.css` served the launch screen alone; that stopped
 * being true when it became a real loading state, and an inline `<style>` inside
 * the SVG is a duplicate tag per mounted instance. The two couplings between
 * this file and that one — ring perimeters, and the offset that puts the gust on
 * the blade — are written down at the head of the `yasuo` block there.
 *
 * The figure is a **silhouette**, one flat tone plus a red sash, and that is a
 * legibility decision rather than a stylistic one: at the 28px the chat draws it
 * at, a shaded face is four pixels. It is also why it is a generic swordsman and
 * not Yasuo himself — the character is Riot's, and an app shipping him is
 * shipping their IP, whereas a silhouette with a topknot is a silhouette with a
 * topknot.
 *
 * **Nothing here is a fixed colour.** It was drawn against a dark background
 * with hex literals, and the blade — a light grey gradient — was invisible on
 * the light theme. So the blade is `fill-foreground`, the figure the dimmer
 * `fill-muted-foreground`, and the two stay distinguishable whichever way round
 * the theme puts them. Losing the gradient also loses a per-instance gradient
 * `id`, which four mounted copies would have collided over.
 *
 * The spin is **stroke dashes travelling around each ring**, not a rotation. A
 * rotated ellipse tilts rather than turns — the first attempt did that and read
 * as a hovering UFO — whereas a dash walking the ring's own circumference is the
 * projection of a point going round the cone. That is also why every
 * `strokeDasharray` below is a fraction of the ring's *measured* perimeter: any
 * other number leaves a seam where the pattern wraps.
 *
 * The four rings descend in y and shrink in rx, which is what makes a funnel out
 * of them; concentric rings at one y do not. They sit low in the frame so the
 * narrow end meets the ground rather than hanging in the air.
 *
 * The travel and that spin are **two animations on two elements**, nested: the
 * gust's `translateX` is on a wrapping `<g>`, the dashes on the ellipses inside
 * it. One element cannot carry both — a transform is a single property, and the
 * dash walk is not a transform at all, so it has nothing to be composed with.
 */

/** Ramanujan's ellipse perimeter, per ring, so the dashes close on themselves. */
const RINGS = [
  { cy: 66, rx: 42, perimeter: 191.4, width: 4.4 },
  { cy: 84, rx: 32, perimeter: 145.8, width: 3.9 },
  { cy: 100, rx: 22, perimeter: 100.2, width: 3.4 },
  { cy: 114, rx: 13, perimeter: 59.2, width: 2.9 },
]

/**
 * The frame is **wide, and only to the right**: the figure and the blade keep the
 * coordinates they were drawn on, and every unit past 130 is road for the gust
 * to cross. At 130 the crossing was over before it read as one.
 *
 * The cost is that the drawing is not square, so the default class is
 * `h-16 w-auto` rather than `size-16`: an SVG with a viewBox takes its width from
 * the aspect ratio, whereas a square box letterboxes this and throws away a
 * third of the height. `cn` is tailwind-merge, which treats `size-*` as
 * conflicting with both `h-*` and `w-*`, so a caller passing `size-10` still
 * wins — it just gets the letterboxing back.
 */
const FRAME_W = 184

function YasuoTornadoLoader({
  className,
  label = "Loading",
}: {
  className?: string
  label?: string
}) {
  return (
    <svg
      viewBox={`0 0 ${FRAME_W} 136`}
      role="status"
      aria-label={label}
      className={cn("h-16 w-auto", className)}
    >
      {/* figure, then blade, then gust — and the gust being last is load-bearing
          now that it is born at the blade: painted underneath, its first frames
          are hidden behind the very thing they are supposed to come off */}
      <g className="yasuo-lunge fill-muted-foreground">
        {/* topknot before the head, so the head's edge cuts it off cleanly */}
        <path d="M45 50 C41.5 44 46 39.5 51.5 40.5 C47 44 46 47 47.5 51 Z" />
        <circle cx="52" cy="58" r="9" />
        <path d="M40 70 C43 66 61 66 64 70 L67 96 L39 96 Z" />
        {/* the coat, trailing the way he came — the one shape carrying speed
            while the body itself is nearly still */}
        <path d="M39 96 C28 101 17 110 11 121 C24 115 34 111 45 109 Z" />
        <path d="M44 96 L38 124 L47 126.5 L53 98 Z" />
        <path d="M58 96 L66 121 L74 119 L66 96 Z" />
        {/* both arms to the same grip, so the two-handed hold is readable as a
            single wedge rather than two strokes */}
        <path
          d="M45 73 C50 82 57 88 63 91"
          className="fill-none stroke-muted-foreground"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="M61 73 C63 81 64 87 65 91"
          className="fill-none stroke-muted-foreground"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="M39.5 87 L66.5 87 L67 92.5 L39 92.5 Z"
          className="fill-red-500"
        />
      </g>

      <g className="yasuo-slash">
        <path
          d="M60.4 11 C66.8 31 69.2 55 67.6 77 L62.8 79 C62.6 55 60.8 31 57 14 L58.4 11 Z"
          className="fill-foreground"
        />
        {/* hamon — the temper line, the one detail that says katana and not
            sword. Drawn in the background colour rather than white: on the light
            theme a white line down a near-black blade is the only way round that
            reads as tempered steel */}
        <path
          d="M60.2 15 C65 33 66.4 55 65.4 75"
          className="fill-none stroke-background"
          strokeOpacity="0.45"
          strokeWidth="1.1"
        />
        <ellipse
          cx="65.2"
          cy="79.5"
          rx="7.2"
          ry="2.8"
          className="fill-muted-foreground"
        />
        <path
          d="M62.2 81 L68.4 81 L67 99 L61.8 99 Z"
          className="fill-muted-foreground"
        />
        <path
          d="M64.4 99 C63.4 104 60.6 107 57 108"
          className="fill-none stroke-red-500"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </g>

      <g className="yasuo-gust">
        <g className="fill-none" strokeLinecap="round">
          {RINGS.map((r, i) => (
            <ellipse
              key={r.cy}
              className={cn(
                `yasuo-wind-${i}`,
                i % 2 ? "stroke-sky-300" : "stroke-sky-400"
              )}
              cx="60"
              cy={r.cy}
              rx={r.rx}
              ry={r.rx * 0.38}
              strokeWidth={r.width}
              strokeDasharray={`${(r.perimeter / 2) * 0.68} ${
                (r.perimeter / 2) * 0.32
              }`}
              opacity={0.95 - i * 0.06}
            />
          ))}
        </g>
      </g>
    </svg>
  )
}

export { YasuoTornadoLoader }
