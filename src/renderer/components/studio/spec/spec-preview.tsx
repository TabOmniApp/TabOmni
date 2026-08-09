import { cn } from "@/lib/utils"

import {
  PROCESSING_SECTIONS,
  type CanvasImage,
  type Spec,
  type SpecCanvas,
} from "@/lib/spec/schema"
import { controlTone, stateTone, statusTone } from "@/lib/spec/tones"
import { useProjectImage } from "@/lib/spec/use-project-image"
import { MarkdownView } from "../terminal/markdown-view"
import { CanvasMarker, vertical } from "./canvas-marker"
import { COLUMNS } from "./columns"

/**
 * A spec as it is read rather than written.
 *
 * The view a spec is opened in, because a spec is read far more often than it
 * is changed — by whoever is building the screen, by whoever is testing it —
 * and a page of input boxes is a worse thing to read than a page. `Edit` in the
 * toolbar swaps in the form; nothing else differs, deliberately, so the two are
 * recognisably the same document.
 *
 * The markdown sections go through `MarkdownView`, the same static renderer the
 * chat transcript uses. Its `html` node renders raw markup as text rather than
 * as markup, which is what makes it safe to point at a file that arrived over
 * git — see `lib/terminal/markdown.ts`.
 */
export function SpecPreview({ spec }: { spec: Spec }) {
  const { meta, overview, items } = spec

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-6 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-5">
        <div className="min-w-0">
          <h1 className="font-heading text-lg font-medium">
            {meta.title || "Untitled spec"}
          </h1>
          {meta.project && (
            <p className="text-xs text-muted-foreground">{meta.project}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {meta.status && (
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                statusTone(meta.status).badge
              )}
            >
              {meta.status}
            </span>
          )}
          {meta.date && (
            <span className="text-xs text-muted-foreground">{meta.date}</span>
          )}
        </div>
      </header>

      <Section no={1} title="Screen Overview">
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Card label="Description">{overview.description}</Card>
            <Card label="Pre-data condition">{overview.preCondition}</Card>
          </div>
          <Card label="Routing" mono>
            {overview.routing}
          </Card>

          {overview.navigatesTo.length > 0 && (
            <div className="rounded-xl border bg-card p-3.5">
              <h3 className="mb-2 text-[0.65rem] font-medium tracking-wider text-muted-foreground uppercase">
                Navigates to
              </h3>
              <div className="space-y-1 text-sm">
                {overview.navigatesTo.map((route, index) => (
                  <div key={index} className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1">{route.condition}</span>
                    <span className="text-muted-foreground">→</span>
                    {/* Tinted so a screen id is picked out of the sentence
                        beside it — the two are read as a pair. */}
                    <code className="shrink-0 rounded border border-info/30 bg-info/10 px-1.5 py-0.5 font-mono text-xs text-info">
                      {route.target}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(overview.canvas.images.length > 0 ||
            overview.canvas.markers.length > 0) && (
            <Canvas canvas={overview.canvas} />
          )}
        </div>
      </Section>

      <Section no={2} title="Item Description">
        {items.length === 0 ? (
          <Blank>No items.</Blank>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b bg-muted/50 text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                  <th className="w-12 px-3 py-2 text-center font-medium">
                    No.
                  </th>
                  {COLUMNS.map(([key, label]) => (
                    <th key={key} className="px-3 py-2 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.no}
                    className="border-b align-top last:border-0"
                  >
                    <td className="px-3 py-2 text-center">
                      <span className="inline-flex size-5 items-center justify-center rounded-full bg-destructive/10 text-[0.6rem] font-bold text-destructive">
                        {item.no}
                      </span>
                    </td>
                    {COLUMNS.map(([key]) => (
                      <td
                        key={key}
                        className={cn(
                          "px-3 py-2",
                          key === "itemName"
                            ? "font-medium"
                            : "text-muted-foreground",
                          // The two that hold sentences wrap; the rest are
                          // short enough that wrapping them would make a
                          // taller table, not a narrower one.
                          key === "description" || key === "constraints"
                            ? "min-w-48"
                            : "whitespace-nowrap"
                        )}
                      >
                        {key === "control" && item.control ? (
                          <span
                            className={cn(
                              "rounded-md border px-1.5 py-0.5",
                              controlTone(item.control).badge
                            )}
                          >
                            {item.control}
                          </span>
                        ) : (
                          item[key]
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section no={3} title="Detail Processing">
        <div className="space-y-4">
          {PROCESSING_SECTIONS.map(([key, no, title]) => (
            <div key={key}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <span className="rounded-md border bg-muted px-2 py-0.5 text-xs font-semibold">
                  {no}
                </span>
                {title}
              </h3>
              <Prose source={spec.processing[key]} />
            </div>
          ))}
        </div>
      </Section>

      <Section no={4} title="Link API">
        <Prose source={spec.api} />
      </Section>

      <Section no={5} title="Screen states">
        {spec.states.length === 0 ? (
          <Blank>No states listed.</Blank>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b bg-muted/50 text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                  <th className="w-36 px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">The screen shows</th>
                </tr>
              </thead>
              <tbody>
                {spec.states.map((state, index) => (
                  <tr key={index} className="border-b align-top last:border-0">
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 font-medium",
                          stateTone(state.name).badge
                        )}
                      >
                        {state.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {state.when}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {state.shows}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}

/**
 * The canvas as a reader sees it — the same figure the editor draws, without
 * the grips. Markers come from `CanvasMarker`, shared with the editor, so the
 * two cannot drift into drawing a spec differently.
 */
function Canvas({ canvas }: { canvas: SpecCanvas }) {
  return (
    <div
      style={{ paddingBottom: `${canvas.height}%` }}
      className="relative w-full overflow-hidden rounded-xl border bg-muted"
    >
      <div className="absolute inset-0">
        {canvas.images.map((image, index) => (
          <Picture
            key={`${image.src}:${index}`}
            image={image}
            canvasHeight={canvas.height}
          />
        ))}
        {canvas.markers.map((mark, index) => (
          <CanvasMarker
            key={index}
            marker={mark}
            canvasHeight={canvas.height}
          />
        ))}
      </div>
    </div>
  )
}

function Picture({
  image,
  canvasHeight,
}: {
  image: CanvasImage
  canvasHeight: number
}) {
  const source = useProjectImage(image.src)

  return (
    <figure
      style={{
        left: `${image.x}%`,
        top: vertical(image.y, canvasHeight),
        width: `${image.width}%`,
      }}
      className="absolute"
    >
      <div className="overflow-hidden rounded-md border bg-card shadow-sm">
        {source.dataUrl ? (
          <img
            src={source.dataUrl}
            alt={image.caption || image.src}
            className="block w-full"
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
      {image.caption && (
        <figcaption className="mt-0.5 text-center text-[0.65rem] text-muted-foreground">
          {image.caption}
        </figcaption>
      )}
    </figure>
  )
}

function Prose({ source }: { source: string }) {
  if (!source.trim()) return <Blank>Nothing written yet.</Blank>
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <MarkdownView source={source} />
    </div>
  )
}

function Section({
  no,
  title,
  children,
}: {
  no: number
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2.5 border-b pb-2.5 font-heading text-base font-medium">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-xs text-primary">
          {no}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Card({
  label,
  mono = false,
  children,
}: {
  label: string
  mono?: boolean
  children: string
}) {
  return (
    <div className="rounded-xl border bg-card p-3.5">
      <h3 className="mb-1.5 text-[0.65rem] font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </h3>
      {children.trim() ? (
        <p
          className={cn(
            "text-sm whitespace-pre-wrap",
            mono && "font-mono text-xs break-all text-primary"
          )}
        >
          {children}
        </p>
      ) : (
        <Blank>Not stated.</Blank>
      )}
    </div>
  )
}

function Blank({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground italic">{children}</p>
}
