/**
 * What a screen spec is, and how a file on disk becomes one.
 *
 * A spec is a `*.spec.json` file in the project's own repository — committed
 * beside the code it describes, reviewed in the same pull request. That is the
 * whole reason this panel edits files rather than rows in `~/.tabula`: a
 * spec nobody else on the team can read is a document that has failed at its
 * one job.
 *
 * The document is split by how each part is actually written. The header, the
 * overview and the item table are *fields* — a spec's readers scan them, diff
 * them, and expect the same shape every time, so they are typed here and edited
 * as a form. Detail processing and the API notes are *prose* with structure
 * inside it, which no form ever models without becoming a worse text editor, so
 * they are plain markdown strings.
 *
 * `parseSpec` is total by design. The panel writes the file back as the user
 * types, and a file half-written by hand — or written against the older shape
 * below — has to load as a document with gaps rather than take the panel down.
 */

/**
 * How a marker is drawn. The plain numbered circle is what a spec uses most; a
 * square reads better over dense UI, an arrow points at something too small to
 * sit a label on, and a box frames a whole region rather than a point.
 */
export type MarkerKind = "circle" | "square" | "arrow" | "box"

export const MARKER_KINDS: MarkerKind[] = ["circle", "square", "arrow", "box"]

/**
 * One numbered mark on the canvas.
 *
 * Every measurement on the canvas — `x`, `y`, `width`, `height`, and the canvas
 * height itself — is a percentage of the canvas *width*, the way a CSS
 * percentage padding is. That is what makes the canvas resize as one picture:
 * the panel can be any width and everything scales together, and making the
 * canvas taller adds room at the bottom without moving or stretching anything
 * already on it. A percentage of the height would not do either.
 */
export type Marker = {
  /**
   * The number in the marker — and the row of the item table it means.
   *
   * Numbered across the whole canvas, 1, 2, 3…, however many pictures are on
   * it: the canvas is one figure, so it has one sequence.
   */
  id: string
  kind: MarkerKind
  /** Where the numbered label sits. */
  x: number
  y: number
  /** `box` only: the region it frames, measured from `x`, `y`. */
  width: number
  height: number
  /** `arrow` only: where the arrow points. */
  tipX: number
  tipY: number
}

/** One picture placed on the canvas. */
export type CanvasImage = {
  /**
   * Project-relative path to the image file — `docs/specs/FR_008.assets/…`.
   *
   * A path rather than an embedded data URL: the image is committed beside the
   * spec, so it is reviewable in a pull request and a 300 KB screenshot does
   * not turn the JSON into something no diff can show.
   */
  src: string
  caption: string
  x: number
  y: number
  /** Only the width is stored. The height follows the picture's own
   * proportions, because a squashed screenshot is never what anyone meant. */
  width: number
}

export type SpecMeta = {
  title: string
  project: string
  status: string
  date: string
}

/**
 * The screen, as one picture.
 *
 * Not a list of screenshots each with its own numbering: however many pictures
 * are dropped on it — the screen, a dialog over it, the error state beside it —
 * what a reader sees is one figure with one run of numbers, and what the item
 * table joins to is that run.
 */
export type SpecCanvas = {
  /** The canvas's own height, in the width-relative units described on
   * `Marker`. 62.5 is 16:10. */
  height: number
  images: CanvasImage[]
  markers: Marker[]
}

/**
 * One way out of the screen.
 *
 * The symmetric half of `preCondition`, which says how you arrive. Where a
 * screen leads used to be reachable only by reading four levels into the event
 * prose — "then move to FR_002" — which meant nobody could draw the project's
 * screen map, or check that FR_002 exists, without reading every spec end to
 * end. Two fields, so both questions are a scan rather than a read.
 */
export type SpecRoute = {
  /** What has to happen: "QR is valid and the store exists". */
  condition: string
  /** Where that leads — a screen id, or a description when it leaves the app. */
  target: string
}

export type SpecOverview = {
  description: string
  preCondition: string
  routing: string
  navigatesTo: SpecRoute[]
  canvas: SpecCanvas
}

/**
 * One state the screen can be in.
 *
 * Loading, empty, failed, not allowed. Its own section because a spec that does
 * not list these does not lack them — the screen still has them, they are just
 * decided later and separately by whoever builds it, which is how a project
 * ends up with a different empty state on every screen. Prose can describe a
 * state, but only a list makes a missing one visible.
 */
export type SpecState = {
  /** "Loading", "Empty", "Error", "No permission". */
  name: string
  /** What puts the screen into it. */
  when: string
  /** What the screen shows while it is. */
  shows: string
}

/**
 * One row of the item table — one thing a pin points at.
 *
 * Six fields, down from eleven, and the two that went are worth recording.
 *
 * `logicName` sat beside `itemName` and, in every document this panel has seen,
 * held the same words. The distinction it comes from — internal name versus
 * displayed name — is a real one, but a column that is filled by copying the
 * one next to it is not recording it.
 *
 * `defaultValue`, `length`, `required`, `attribute` and `inOutField` are all
 * properties of an *input*, and most of what a screen shows is not one: on a
 * scanner with a camera and a dialog, all five read "-". Five always-present
 * columns for a minority of rows is what makes a table nobody can see without
 * scrolling. They are now one free-text `constraints`, which costs the ability
 * to diff "required" on its own and buys a table that fits.
 */
export type SpecItem = {
  no: string
  itemName: string
  control: string
  api: string
  /** Whatever holds for this item: "required, max 32, default —". Free text,
   * because a spec writes "1-32" and "○ / —" as readily as a number. */
  constraints: string
  description: string
}

/**
 * Detail processing: two fixed sections, each markdown.
 *
 * Fixed because every screen has both answers — who is allowed in, and what
 * each thing on the screen does when used — and a spec that simply omits one
 * has not decided it, it has forgotten it. A free list of sections lets that
 * happen quietly; two named fields make the gap visible as an empty section.
 */
export type SpecProcessing = {
  checkAuthority: string
  eventBehavior: string
}

export type Spec = {
  meta: SpecMeta
  overview: SpecOverview
  items: SpecItem[]
  processing: SpecProcessing
  /** The API notes, as markdown. */
  api: string
  states: SpecState[]
}

/**
 * The controls the picker offers, roughly in the order a screen is built from
 * them. Open, like `SPEC_STATUSES`: a document naming something else keeps its
 * word rather than being corrected into this list.
 */
export const CONTROL_KINDS = [
  "Label",
  "Input",
  "TextArea",
  "Select",
  "Checkbox",
  "Radio",
  "Button",
  "Link",
  "Image",
  "Table",
  "List",
  "Dialog",
  "Toast",
  "Tab",
  "Camera",
]

/** The states most screens turn out to have, offered when the list is empty. */
export const SUGGESTED_STATES: SpecState[] = [
  { name: "Loading", when: "", shows: "" },
  { name: "Empty", when: "", shows: "" },
  { name: "Error", when: "", shows: "" },
  { name: "No permission", when: "", shows: "" },
]

/** What each fixed section is numbered and called, in the order they are read. */
export const PROCESSING_SECTIONS: [
  key: keyof SpecProcessing,
  no: string,
  title: string,
][] = [
  ["checkAuthority", "3.1", "Check authority"],
  ["eventBehavior", "3.2", "Event behavior handling"],
]

/**
 * Ceilings on what one document may hold.
 *
 * Not validation — a spec with 300 items is unusual but not wrong. These are
 * against a file that is not a spec at all: pointing this panel at a large
 * fixture should show a truncated table, not lock the renderer up laying out a
 * hundred thousand inputs.
 */
const MAX_ITEMS = 500
const MAX_STATES = 40
const MAX_ROUTES = 40
const MAX_IMAGES = 20
const MAX_MARKERS = 100
const DEFAULT_CANVAS_HEIGHT = 62.5

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** A field as text, accepting the number a `no` is usually written as. */
function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return fallback
}

function list(value: unknown, cap: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, cap) : []
}

/** A coordinate on the canvas, kept finite and never negative. */
function unit(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.round(value * 10) / 10)
}

function marker(raw: unknown, index: number): Marker {
  const source = record(raw)
  const kind = source.kind
  const x = unit(source.x, 50)
  const y = unit(source.y, 25)
  return {
    id: text(source.id, String(index + 1)),
    kind: MARKER_KINDS.includes(kind as MarkerKind)
      ? (kind as MarkerKind)
      : "circle",
    x,
    y,
    width: unit(source.width, 20),
    height: unit(source.height, 12),
    // A tip on top of its own label points nowhere, so an arrow with none
    // recorded gets one up and to the right of itself.
    tipX: unit(source.tipX, x + 12),
    tipY: unit(source.tipY, Math.max(0, y - 8)),
  }
}

function canvasImage(raw: unknown, index: number): CanvasImage {
  const source = record(raw)
  return {
    src: text(source.src),
    caption: text(source.caption),
    x: unit(source.x, 2),
    y: unit(source.y, 2 + index * STACK_GAP),
    width: unit(source.width, 60) || 60,
  }
}

/**
 * The canvas a document made of separate screenshots becomes.
 *
 * Until now the mockup was a list of pictures, each with pins positioned as a
 * percentage of *itself*. One canvas cannot keep that: the numbers are now one
 * sequence over one figure, and a pin's position has to be read against the
 * canvas instead. The pictures are stacked down the page and each pin is
 * mapped into the slot its own picture now occupies.
 *
 * The mapping is approximate in one axis and unavoidably so — a picture's
 * height is not knowable without reading the file, which this cannot do — so
 * `STACK_HEIGHT` stands in for it. Every number and every kind survives exactly;
 * what may need nudging is where a mark sits vertically.
 */
const STACK_GAP = 80
const STACK_WIDTH = 60
const STACK_HEIGHT = 70

function legacyCanvas(raw: unknown[]): SpecCanvas {
  const images: CanvasImage[] = []
  const markers: Marker[] = []

  for (const [index, entry] of raw.entries()) {
    const source = record(entry)
    const top = 2 + index * STACK_GAP
    images.push({
      src: text(source.src),
      caption: text(source.caption),
      x: 2,
      y: top,
      width: STACK_WIDTH,
    })

    for (const [at, rawPin] of list(source.pins, MAX_MARKERS).entries()) {
      const pin = record(rawPin)
      const px = typeof pin.x === "number" ? pin.x : 50
      const py = typeof pin.y === "number" ? pin.y : 50
      markers.push(
        marker(
          {
            id: text(pin.id, String(markers.length + 1)),
            kind: "circle",
            x: 2 + (px / 100) * STACK_WIDTH,
            y: top + (py / 100) * STACK_HEIGHT,
          },
          at
        )
      )
    }
  }

  return {
    height: Math.max(DEFAULT_CANVAS_HEIGHT, raw.length * STACK_GAP),
    images,
    markers,
  }
}

/**
 * The flat `hotspots` list the mockup held before it held pictures at all.
 *
 * Its numbered labels are the half worth keeping: they become markers down the
 * middle of an empty canvas, ready to be dragged onto a screenshot once one is
 * added.
 */
function legacyHotspotCanvas(raw: unknown[]): SpecCanvas {
  return {
    height: DEFAULT_CANVAS_HEIGHT,
    images: [],
    markers: raw.map((entry, index) =>
      marker(
        {
          id: text(record(entry).id, String(index + 1)),
          kind: "circle",
          x: 50,
          y: ((index + 1) / (raw.length + 1)) * DEFAULT_CANVAS_HEIGHT,
        },
        index
      )
    ),
  }
}

/**
 * The rows an old document's hotspot labels belong in.
 *
 * A hotspot used to carry its own text; a pin does not, because the row is
 * where that now lives. The label would otherwise be the one thing the
 * migration dropped, so it becomes the item name of the row its number points
 * at — added if there is no such row, and never overwriting one the document
 * already had, which in the format these documents came from is the same text
 * anyway.
 */
function withHotspotLabels(items: SpecItem[], hotspots: unknown[]): SpecItem[] {
  const out = [...items]
  for (const [index, entry] of hotspots.entries()) {
    const source = record(entry)
    const no = text(source.id, String(index + 1))
    const label = text(source.label)
    if (out.some((candidate) => candidate.no === no)) continue
    out.push({ ...blankItem(no), itemName: label })
  }
  return out
}

/** A cell that says nothing — blank, or the dash a spec writes for "n/a". */
function stated(value: string): boolean {
  const trimmed = value.trim()
  return trimmed !== "" && trimmed !== "-" && trimmed !== "—" && trimmed !== "–"
}

/**
 * The five columns that became `constraints`, folded into one line.
 *
 * Labelled rather than run together, so that a row migrated from the old shape
 * still says which property each value was — "1-32" on its own is not something
 * a reader can put back. Cells holding a dash are dropped: the old table used
 * one to mean "not applicable", and carrying that across would fill the new
 * column with the noise it exists to remove.
 */
function legacyConstraints(source: Record<string, unknown>): string {
  const parts: [string, string][] = [
    ["required", text(source.required)],
    ["length", text(source.length)],
    ["default", text(source.defaultValue ?? source.default)],
    ["attribute", text(source.attribute)],
    ["in/out", text(source.inOutField)],
  ]
  return parts
    .filter(([, value]) => stated(value))
    .map(([label, value]) => `${label}: ${value.trim()}`)
    .join(", ")
}

function route(raw: unknown): SpecRoute {
  const source = record(raw)
  return { condition: text(source.condition), target: text(source.target) }
}

function state(raw: unknown): SpecState {
  const source = record(raw)
  return {
    name: text(source.name),
    when: text(source.when),
    shows: text(source.shows),
  }
}

function item(raw: unknown, index: number): SpecItem {
  const source = record(raw)
  const itemName = text(source.itemName)
  const logicName = text(source.logicName)

  return {
    // Numbered from where it sits when the file does not say, so a row added
    // to the middle does not have to be renumbered by hand to show up.
    no: text(source.no, String(index + 1)),
    // `logicName` is gone as a column, but a document that filled only that one
    // still named this item, and the name is the point of the row.
    itemName: itemName || logicName,
    control: text(source.control),
    api: text(source.api),
    constraints: text(source.constraints) || legacyConstraints(source),
    description: text(source.description),
  }
}

/**
 * One section of a legacy `processing` entry, as markdown.
 *
 * The first draft of this panel held detail processing as nested
 * `{no, title, type, content}` sections with `tree` nodes inside, and documents
 * in that shape exist. The heading is left off: where a section lands is now
 * decided by `SECTIONS` below, and its own title would be a second, competing
 * label above the fixed one.
 */
function legacySectionBody(section: Record<string, unknown>): string {
  const lines: string[] = []

  const walk = (nodes: unknown[], depth: number) => {
    for (const entry of nodes) {
      const node = record(entry)
      const id = text(node.id)
      const body = strip(text(node.text))
      if (id || body) {
        lines.push(`${"  ".repeat(depth)}- ${id ? `**${id}** ` : ""}${body}`)
      }
      const children = node.children
      if (Array.isArray(children)) walk(children, depth + 1)
    }
  }

  const content = section.content ?? section.text ?? section.nodes
  if (typeof content === "string") return strip(content)
  if (!Array.isArray(content)) return ""

  const kind = section.kind ?? section.type
  if (kind === "tree") walk(content, 0)
  else {
    for (const entry of content) {
      const bullet = record(entry)
      lines.push(`- ${strip(text(bullet.text))}`)
    }
  }
  return lines.join("\n").trim()
}

/**
 * The inline HTML those documents carried — `<code>`, `<strong>` — as markdown.
 *
 * Every other tag is dropped rather than passed through: what this returns is
 * fed to a markdown editor, and the one thing that must not survive the trip is
 * a tag that becomes a tag again.
 */
function strip(source: string): string {
  return source
    .replace(/<\s*code[^>]*>(.*?)<\s*\/\s*code\s*>/gis, "`$1`")
    .replace(/<\s*(strong|b)[^>]*>(.*?)<\s*\/\s*\1\s*>/gis, "**$2**")
    .replace(/<\s*(em|i)[^>]*>(.*?)<\s*\/\s*\1\s*>/gis, "_$2_")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .trim()
}

/** Which fixed section a heading or an old section's title belongs to. */
const AUTHORITY = /check\s*authority|quyền|phân\s*quyền/i
const EVENT = /event\s*behav|behaviou?r|sự\s*kiện/i

function routeOf(title: string): keyof SpecProcessing | null {
  if (AUTHORITY.test(title)) return "checkAuthority"
  if (EVENT.test(title)) return "eventBehavior"
  return null
}

/** Appends to whichever section is being built, keeping a blank line between. */
function append(into: SpecProcessing, key: keyof SpecProcessing, body: string) {
  const text = body.trim()
  if (!text) return
  into[key] = into[key] ? `${into[key]}\n\n${text}` : text
}

/**
 * Detail processing, however the file happens to hold it.
 *
 * Three shapes reach this. The current one is an object with the two fields.
 * Before that it was a single markdown string, and before that the structured
 * array of `{no, title, type, content}` sections — and both of those carried
 * their own headings, which is what says where each part now goes.
 *
 * A part that matches neither section is kept, with its heading, under
 * `checkAuthority`. That is arbitrary and deliberately so: the alternative is
 * dropping it, and a paragraph in the wrong section is a paragraph someone can
 * see and move, while a dropped one is one nobody knows to look for. The old
 * "Screen initialization" section is the case this is for.
 */
function processing(raw: unknown): SpecProcessing {
  const out: SpecProcessing = { checkAuthority: "", eventBehavior: "" }

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const section = record(entry)
      const title = text(section.title)
      const body = legacySectionBody(section)
      const route = routeOf(title)
      if (route) append(out, route, body)
      else {
        const heading = [text(section.no), title].filter(Boolean).join(" ")
        append(
          out,
          "checkAuthority",
          heading ? `## ${heading}\n\n${body}` : body
        )
      }
    }
    return out
  }

  if (typeof raw === "string") {
    // Split on ATX headings, keeping each with the body under it. A document
    // with no headings at all is one whole part, and unroutable, so it lands in
    // the first section rather than being thrown away.
    const parts = raw.split(/^##+\s+(.*)$/m)
    append(out, "checkAuthority", parts[0] ?? "")
    for (let index = 1; index < parts.length; index += 2) {
      const heading = parts[index] ?? ""
      const body = parts[index + 1] ?? ""
      const route = routeOf(heading)
      if (route) append(out, route, body)
      else append(out, "checkAuthority", `## ${heading}\n\n${body.trim()}`)
    }
    return out
  }

  const source = record(raw)
  return {
    checkAuthority: text(source.checkAuthority),
    eventBehavior: text(source.eventBehavior),
  }
}

/** The API notes, likewise — the older shape was `{required, description}`. */
function apiNotes(raw: unknown): string {
  if (typeof raw === "string") return raw
  const source = record(raw)
  const description = strip(text(source.description))
  const required = list(source.required, 50)
    .map((entry) => text(entry))
    .filter(Boolean)

  if (required.length === 0) return description
  const line = `API required: ${required.map((name) => `\`${name}\``).join(", ")}`
  return description ? `${description}\n\n${line}` : line
}

export function parseSpec(raw: unknown): Spec {
  const source = record(raw)
  const meta = record(source.meta)
  const overview = record(source.overview)
  const mockup = record(overview.mockup)

  const raw_canvas = record(overview.canvas)
  const modern =
    Array.isArray(raw_canvas.markers) || Array.isArray(raw_canvas.images)
  const legacyImages = Array.isArray(mockup.images)
  const hotspots =
    !modern && !legacyImages ? list(mockup.hotspots, MAX_MARKERS) : []

  const rows = list(source.items, MAX_ITEMS).map(item)
  const written = hotspots.length > 0 ? withHotspotLabels(rows, hotspots) : rows

  /*
   * The table is derived from the markers, so the two are reconciled here as
   * well as on every edit — a hand-written file, or one from an older shape,
   * must open already in step rather than rearrange itself at the first
   * keystroke. `seedMarkers` runs first so that reconciling a document whose
   * rows have no markers keeps the rows instead of emptying the table.
   */
  const drawn: SpecCanvas = modern
    ? {
        height:
          unit(raw_canvas.height, DEFAULT_CANVAS_HEIGHT) ||
          DEFAULT_CANVAS_HEIGHT,
        images: list(raw_canvas.images, MAX_IMAGES).map(canvasImage),
        markers: list(raw_canvas.markers, MAX_MARKERS).map(marker),
      }
    : legacyImages
      ? legacyCanvas(list(mockup.images, MAX_IMAGES))
      : legacyHotspotCanvas(hotspots)

  const canvas = seedMarkers(drawn, written)
  const items = syncItemsWithMarkers(written, [], canvas.markers)

  return {
    meta: {
      title: text(meta.title),
      project: text(meta.project),
      status: text(meta.status),
      date: text(meta.date),
    },
    overview: {
      description: text(overview.description),
      preCondition: text(overview.preCondition),
      routing: text(overview.routing),
      navigatesTo: list(overview.navigatesTo, MAX_ROUTES).map(route),
      canvas,
    },
    items,
    processing: processing(source.processing),
    api: apiNotes(source.api),
    states: list(source.states, MAX_STATES).map(state),
  }
}

/** The document as it is written back. Two spaces, and a trailing newline, so
 * a spec diffs like the rest of the repository's JSON. */
export function serializeSpec(spec: Spec): string {
  return `${JSON.stringify(spec, null, 2)}\n`
}

/**
 * The statuses the picker offers, in the order a spec moves through them.
 *
 * Not a closed set: `status` stays a string, and a document that says something
 * else keeps saying it — the picker adds whatever it finds to the bottom of its
 * own list. A team with its own vocabulary should not have this panel quietly
 * renaming their specs.
 */
export const SPEC_STATUSES = [
  "Draft",
  "In review",
  "Approved",
  "Implemented",
  "Deprecated",
]

/**
 * A spec's date as `<input type="date">` wants it, or "" when it cannot tell.
 *
 * `yyyy-mm-dd` passes through; `dd/mm/yyyy` and `dd-mm-yyyy` are the other
 * shapes these documents are written in, and are read day-first, which is what
 * the format means everywhere it is used without a year in front.
 *
 * Nothing is written back from this — the stored string is left exactly as it
 * was until someone picks a date, so an ambiguous one is never silently
 * reinterpreted, only offered as a starting point.
 */
export function asDateInput(value: string): string {
  const trimmed = value.trim()

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (iso) return trimmed

  const dayFirst = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed)
  if (!dayFirst) return ""

  const [, day, month, year] = dayFirst as unknown as [
    string,
    string,
    string,
    string,
  ]
  if (Number(month) < 1 || Number(month) > 12) return ""
  if (Number(day) < 1 || Number(day) > 31) return ""
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
}

/** How a spec file is recognised, and what `New spec` names one. */
export const SPEC_SUFFIX = ".spec.json"

/** The file name without the suffix — what the sidebar and the tab show. */
export function specName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1)
  return base.endsWith(SPEC_SUFFIX) ? base.slice(0, -SPEC_SUFFIX.length) : base
}

/**
 * Where a spec's screenshots are copied to — `docs/specs/FR_008.assets/`.
 *
 * Beside the spec and named after it, so that a spec and its pictures move,
 * are reviewed, and are deleted together, and so two specs in one folder never
 * share an asset directory.
 */
/**
 * Where a spec's screenshots are copied to — `docs/specs/FR_008.assets/`.
 *
 * Beside the spec and named after it, so that a spec and its pictures move,
 * are reviewed, and are deleted together, and so two specs in one folder never
 * share an asset directory.
 */
export function assetsDir(specPath: string): string {
  const cut = specPath.lastIndexOf("/")
  const dir = cut === -1 ? "" : specPath.slice(0, cut + 1)
  return `${dir}${specName(specPath)}.assets`
}

/**
 * The next number to hand out: one past the highest already in use.
 *
 * Not the count, which repeats a number as soon as anything has been deleted —
 * and a number used twice is two markers claiming one row of the item table.
 * Counted across the whole canvas, because the canvas is one figure with one
 * run of numbers however many pictures are on it.
 */
export function nextNumber(used: string[]): string {
  const highest = used.reduce((best, no) => {
    const value = Number.parseInt(no, 10)
    return Number.isFinite(value) && value > best ? value : best
  }, 0)
  return String(highest + 1)
}

/**
 * The item table for a set of markers.
 *
 * A marker and a row are the same thing seen twice — the marker says where on
 * the canvas, the row says what it is — so the table is *derived*, not merely
 * nudged: one row per marker, in marker order, and no way to add or remove one
 * except by adding or removing a marker. That is why the table carries no add
 * or delete controls of its own. A row's other columns are still typed into the
 * table; only its existence belongs to the marker.
 *
 * The consequence is that removing a marker discards whatever was typed into
 * its row, and there is no undo. That is the price of the two sides never
 * disagreeing, and it is deliberate.
 *
 * `before` is here only for renumbering. A change that removes exactly one
 * number and adds exactly one is read as a renumbering rather than as a delete
 * and an insert, so a row's contents follow its marker. That is not a guess
 * about intent: editing a marker's number in place produces exactly that, one
 * keystroke at a time, and without it typing "2a" over "2" would throw the row
 * for 2 away and leave a blank one for 2a.
 */
export function syncItemsWithMarkers(
  items: SpecItem[],
  before: Marker[],
  after: Marker[]
): SpecItem[] {
  const had = new Set(before.map((mark) => mark.id))
  const has = new Set(after.map((mark) => mark.id))

  const removed = [...had].filter((id) => !has.has(id))
  const added = [...has].filter((id) => !had.has(id))

  const byNo = new Map(items.map((item) => [item.no, item]))

  if (removed.length === 1 && added.length === 1) {
    const [from] = removed as [string]
    const [to] = added as [string]
    const moved = byNo.get(from)
    // Not when the new number already has a row: renumbering onto an occupied
    // number is two markers pointing at one row, and the row already there is
    // the one that keeps it.
    if (moved && !byNo.has(to)) {
      byNo.delete(from)
      byNo.set(to, { ...moved, no: to })
    }
  }

  const rows: SpecItem[] = []
  const emitted = new Set<string>()
  for (const mark of after) {
    // Two markers may carry the same number — nothing stops that being typed —
    // and they then point at one row rather than conjuring a duplicate.
    if (emitted.has(mark.id)) continue
    emitted.add(mark.id)
    rows.push(byNo.get(mark.id) ?? blankItem(mark.id))
  }
  return rows
}

/**
 * Markers for a document whose rows have none.
 *
 * The table is derived from the markers, so a row nothing points at would
 * vanish the moment anything was edited — and for a spec written before this
 * panel existed, or one with no screenshot yet, that is its whole item table.
 * So the relationship is established the other way round on open: every row
 * gets a marker down the middle of the canvas, ready to be dragged into place
 * once a picture is added. Nothing is lost that way.
 */
function seedMarkers(canvas: SpecCanvas, items: SpecItem[]): SpecCanvas {
  if (items.length === 0 || canvas.markers.length > 0) return canvas

  return {
    ...canvas,
    markers: items.map((item, index) =>
      marker(
        {
          id: item.no,
          kind: "circle",
          x: 50,
          y: ((index + 1) / (items.length + 1)) * canvas.height,
        },
        index
      )
    ),
  }
}

/**
 * The same document with its pictures pointing at a different folder.
 *
 * A spec's screenshots live in `<name>.assets/` beside it, so renaming or
 * copying the spec moves that folder — and every `src` on the canvas is a path
 * into it. Rewriting them is what stops a renamed spec from losing its
 * pictures; a path that was never in the old folder is left exactly as it is,
 * because it was pointing somewhere else on purpose.
 */
export function withAssetsAt(spec: Spec, from: string, to: string): Spec {
  if (from === to) return spec

  const prefix = `${from}/`
  return {
    ...spec,
    overview: {
      ...spec.overview,
      canvas: {
        ...spec.overview.canvas,
        images: spec.overview.canvas.images.map((image) =>
          image.src.startsWith(prefix)
            ? { ...image, src: `${to}/${image.src.slice(prefix.length)}` }
            : image
        ),
      },
    },
  }
}

export function blankItem(no: string): SpecItem {
  // Empty rather than the dashes the old shape pre-filled: with the columns
  // that were always "-" gone, a dash is something an author writes to mean
  // "not applicable", not something the panel should assert on their behalf.
  return {
    no,
    itemName: "",
    control: "",
    api: "",
    constraints: "",
    description: "",
  }
}

/** A new spec: the frame filled in, the content left to the author. */
export function blankSpec(name: string): Spec {
  return {
    meta: {
      title: name,
      project: "",
      status: "Draft",
      date: new Date().toISOString().slice(0, 10),
    },
    overview: {
      description: "",
      preCondition: "",
      routing: "",
      navigatesTo: [],
      canvas: { height: DEFAULT_CANVAS_HEIGHT, images: [], markers: [] },
    },
    // No rows: a row exists because a pin does, and a spec with no screenshot
    // yet has no pins. The table fills itself in as they are placed.
    items: [],
    processing: { checkAuthority: "", eventBehavior: "" },
    api: "",
    states: [],
  }
}
