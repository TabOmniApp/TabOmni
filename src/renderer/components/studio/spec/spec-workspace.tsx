import { useEffect, useState } from "react"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  ArrowRight,
  Eye,
  FileText,
  MapPin,
  Pencil,
  Plus,
  X,
} from "lucide-react"

import {
  CONTROL_KINDS,
  PROCESSING_SECTIONS,
  SPEC_STATUSES,
  SUGGESTED_STATES,
  syncItemsWithMarkers,
  type Spec,
  type SpecCanvas,
  type SpecItem,
  type SpecRoute,
  type SpecState,
} from "@/lib/spec/schema"
import { draftOf, isDirty, useSpecs } from "@/lib/spec/store"
import { controlTone, stateTone, statusTone } from "@/lib/spec/tones"
import { IconButton } from "../icon-button"
import { COLUMNS } from "./columns"
import { DatePicker } from "./date-picker"
import { MarkdownField } from "./markdown-field"
import { OpenSelect } from "./open-select"
import { SpecCanvasEditor } from "./spec-canvas"
import { SpecPreview } from "./spec-preview"

/**
 * A spec, read by default and written on request.
 *
 * Two views of one document, sharing a toolbar: `SpecPreview` is what opens,
 * and `Edit` swaps in the form below. There is no JSON view in either — the
 * file underneath is still JSON because it has to diff in a pull request, but
 * nobody has to look at it.
 *
 * The form edits the document in place rather than beside a live preview, so
 * the two views are the same page with the boxes turned on. Its two halves are
 * edited differently on purpose: the header, the overview and the item table
 * are fields, because their shape is the same in every spec and a reader scans
 * them; detail processing and the API notes are markdown, because they are
 * prose with structure inside, and a form that tried to model that would only
 * be a worse text editor.
 */
export function SpecWorkspace() {
  const selectedPath = useSpecs((state) => state.selectedPath)
  const drafts = useSpecs((state) => state.drafts)
  const edit = useSpecs((state) => state.edit)
  const save = useSpecs((state) => state.save)
  const addImages = useSpecs((state) => state.addImages)
  const draft = draftOf(drafts, selectedPath)

  /**
   * Whether this spec is being written rather than read, and which spec that
   * answer is about.
   *
   * A spec opens in the preview: it is read far more often than it is changed,
   * by whoever is building the screen and whoever is testing it, and a page of
   * input boxes is a worse thing to read than a page. The mode is per visit
   * rather than remembered — switching to another tab and back is a fresh look
   * at the document, and the path is carried here so that switch resets it
   * during the render instead of a frame later.
   */
  const [mode, setMode] = useState({ path: selectedPath, editing: false })
  if (mode.path !== selectedPath)
    setMode({ path: selectedPath, editing: false })

  // ⌘S / Ctrl-S writes now instead of waiting out the debounce. The panel
  // saves either way; this is for the habit.
  useEffect(() => {
    if (!selectedPath) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "s" || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      void save(selectedPath)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selectedPath, save])

  if (!selectedPath) {
    return (
      <Placeholder title="No spec open">
        Pick one from the sidebar, or start a new one.
      </Placeholder>
    )
  }

  if (draft.loading) {
    return <p className="p-3 text-xs text-muted-foreground">Reading…</p>
  }

  if (!draft.spec) {
    return (
      <div className="flex h-full flex-col">
        <Toolbar path={selectedPath} dirty={false} />
        <Placeholder title="Could not open this spec">
          {draft.error ?? "The file could not be read."}
        </Placeholder>
      </div>
    )
  }

  const spec = draft.spec
  const path = selectedPath

  /** One field of the document, replaced. */
  const set = <K extends keyof Spec>(key: K, value: Spec[K]) =>
    edit(path, (current) => ({ ...current, [key]: value }))

  const setMeta = (key: keyof Spec["meta"], value: string) =>
    edit(path, (current) => ({
      ...current,
      meta: { ...current.meta, [key]: value },
    }))

  const setOverview = (
    key: Exclude<keyof Spec["overview"], "mockup">,
    value: string
  ) =>
    edit(path, (current) => ({
      ...current,
      overview: { ...current.overview, [key]: value },
    }))

  /**
   * The mockup, and the item table it implies.
   *
   * Both in one edit rather than an effect watching the pins: a row appearing
   * a render after the pin that caused it is a row the author sees arrive on
   * its own, and — since every edit here is also a write to disk — it would be
   * a second save of a document they did not change twice.
   */
  const setCanvas = (canvas: SpecCanvas) =>
    edit(path, (current) => ({
      ...current,
      overview: { ...current.overview, canvas },
      items: syncItemsWithMarkers(
        current.items,
        current.overview.canvas.markers,
        canvas.markers
      ),
    }))

  /** What the item table calls a marker's number, for the canvas to show. */
  const nameOf = (no: string) =>
    spec.items.find((item) => item.no === no)?.itemName ?? ""

  const chrome = (body: React.ReactNode) => (
    <div className="flex h-full min-w-0 flex-col">
      <Toolbar
        path={path}
        dirty={isDirty(draft)}
        editing={mode.editing}
        onToggle={() => setMode({ path, editing: !mode.editing })}
      />

      {draft.error && (
        <p className="shrink-0 border-b bg-destructive/10 px-3 py-1.5 font-mono text-[0.65rem] break-words text-destructive">
          Could not save this file — {draft.error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </div>
  )

  if (!mode.editing) return chrome(<SpecPreview spec={spec} />)

  return chrome(
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-6">
      {/* The header: what this document is, above what it says. */}
      <div className="space-y-2 border-b pb-5">
        <Input
          value={spec.meta.title}
          placeholder="Screen title"
          aria-label="Spec title"
          onChange={(event) => setMeta("title", event.target.value)}
          className="h-auto border-0 bg-transparent px-0 font-heading text-lg font-medium shadow-none focus-visible:ring-0"
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Project">
            <Input
              value={spec.meta.project}
              placeholder="Project name"
              onChange={(event) => setMeta("project", event.target.value)}
            />
          </Field>
          <Field label="Status">
            <OpenSelect
              value={spec.meta.status}
              options={SPEC_STATUSES}
              label="Status"
              placeholder="Draft"
              className={cn(
                "w-full min-w-0",
                statusTone(spec.meta.status).text
              )}
              onChange={(value) => setMeta("status", value)}
            />
          </Field>
          <Field label="Date">
            <DatePicker
              value={spec.meta.date}
              onChange={(value) => setMeta("date", value)}
            />
          </Field>
        </div>
      </div>

      <Section no={1} title="Screen Overview">
        {/* The pictures take the full width rather than a phone-sized
                column: a screenshot is what the pins are placed on, and one
                scaled into a 240px gutter is one nobody can aim at. */}
        <div className="space-y-5">
          <div className="space-y-3">
            <Field label="Description">
              <Textarea
                rows={2}
                value={spec.overview.description}
                placeholder="What this screen shows."
                onChange={(event) =>
                  setOverview("description", event.target.value)
                }
              />
            </Field>
            <Field label="Pre-data condition">
              <Textarea
                rows={2}
                value={spec.overview.preCondition}
                placeholder="What must already be true to reach this screen."
                onChange={(event) =>
                  setOverview("preCondition", event.target.value)
                }
              />
            </Field>
            <Field label="Navigates to">
              <Routes
                routes={spec.overview.navigatesTo}
                onChange={(routes) =>
                  edit(path, (current) => ({
                    ...current,
                    overview: { ...current.overview, navigatesTo: routes },
                  }))
                }
              />
            </Field>
            <Field label="Routing">
              <Input
                value={spec.overview.routing}
                placeholder="https://example.com/scanner"
                onChange={(event) => setOverview("routing", event.target.value)}
                className="font-mono text-xs"
              />
            </Field>
          </div>

          <SpecCanvasEditor
            canvas={spec.overview.canvas}
            nameOf={nameOf}
            onChange={setCanvas}
            onAddImages={() => void addImages(path)}
          />
        </div>
      </Section>

      <Section no={2} title="Item Description">
        <Items
          items={spec.items}
          pinned={new Set(spec.overview.canvas.markers.map((mark) => mark.id))}
          onChange={(items) => set("items", items)}
        />
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
              <div className="rounded-xl border bg-card">
                <MarkdownField
                  // Keyed on the file: the editor is uncontrolled, so switching
                  // specs has to build a new one rather than hand the old one a
                  // different document.
                  key={`${path}:${key}`}
                  value={spec.processing[key]}
                  placeholder={PROCESSING_PLACEHOLDERS[key]}
                  onChange={(markdown) =>
                    set("processing", { ...spec.processing, [key]: markdown })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section no={4} title="Link API">
        <div className="rounded-xl border bg-card">
          <MarkdownField
            key={`${path}:api`}
            value={spec.api}
            placeholder="Which endpoints this screen calls, and where they are documented."
            onChange={(markdown) => set("api", markdown)}
          />
        </div>
      </Section>

      <Section no={5} title="Screen states">
        <States
          states={spec.states}
          onChange={(states) => set("states", states)}
        />
      </Section>
    </div>
  )
}

/** What each fixed section is asking for, shown while it is empty. */
const PROCESSING_PLACEHOLDERS: Record<keyof Spec["processing"], string> = {
  checkAuthority: "Who may reach this screen, and what happens to anyone else.",
  eventBehavior:
    "What each thing on this screen does when it is used, and what happens on success and on failure.",
}

/**
 * Where the screen leads, as pairs rather than sentences.
 *
 * The counterpart of Pre-data condition, and the reason it is a list: "then
 * move to FR_002" buried four levels into the event prose cannot be collected
 * into a screen map, and cannot be checked against the specs that exist.
 */
function Routes({
  routes,
  onChange,
}: {
  routes: SpecRoute[]
  onChange: (routes: SpecRoute[]) => void
}) {
  const update = (index: number, changes: Partial<SpecRoute>) =>
    onChange(
      routes.map((route, at) =>
        at === index ? { ...route, ...changes } : route
      )
    )

  return (
    <div className="space-y-1">
      {routes.map((route, index) => (
        <div key={index} className="flex items-center gap-1">
          <Input
            value={route.condition}
            placeholder="When…"
            aria-label={`Route ${index + 1} condition`}
            onChange={(event) =>
              update(index, { condition: event.target.value })
            }
            className="h-8 min-w-0 flex-1 text-xs"
          />
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={route.target}
            placeholder="FR_002"
            aria-label={`Route ${index + 1} target`}
            onChange={(event) => update(index, { target: event.target.value })}
            className="h-8 w-28 shrink-0 font-mono text-xs"
          />
          <IconButton
            label="Remove route"
            onClick={() => onChange(routes.filter((_, at) => at !== index))}
          >
            <X />
          </IconButton>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="w-full text-xs"
        onClick={() => onChange([...routes, { condition: "", target: "" }])}
      >
        <Plus data-icon="inline-start" />
        Add route
      </Button>
    </div>
  )
}

/**
 * The states the screen can be in.
 *
 * Empty by default rather than pre-filled with the four common ones: a spec
 * listing "Loading / Empty / Error / No permission" with nothing written
 * against them would look answered while saying nothing. The button offers
 * them instead, so the list is something someone chose.
 */
function States({
  states,
  onChange,
}: {
  states: SpecState[]
  onChange: (states: SpecState[]) => void
}) {
  const update = (index: number, changes: Partial<SpecState>) =>
    onChange(
      states.map((state, at) =>
        at === index ? { ...state, ...changes } : state
      )
    )

  const missing = SUGGESTED_STATES.filter(
    (suggested) =>
      !states.some(
        (state) =>
          state.name.trim().toLowerCase() === suggested.name.toLowerCase()
      )
  )

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b bg-muted/50 text-[0.65rem] tracking-wider text-muted-foreground uppercase">
              <th className="w-36 px-2 py-2 font-medium">State</th>
              <th className="px-2 py-2 font-medium">When</th>
              <th className="px-2 py-2 font-medium">The screen shows</th>
              <th className="w-9 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {states.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-4 text-center text-muted-foreground italic"
                >
                  No states listed — every screen has at least a few.
                </td>
              </tr>
            ) : (
              states.map((state, index) => (
                <tr key={index} className="border-b last:border-0">
                  <td className="px-1 py-1">
                    <Input
                      value={state.name}
                      placeholder="Loading"
                      aria-label={`State ${index + 1} name`}
                      onChange={(event) =>
                        update(index, { name: event.target.value })
                      }
                      className={cn(
                        "h-7 border-0 bg-transparent text-xs font-medium shadow-none focus-visible:bg-background focus-visible:ring-1",
                        stateTone(state.name).text
                      )}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <Input
                      value={state.when}
                      placeholder="While the store is being looked up"
                      aria-label={`State ${index + 1} condition`}
                      onChange={(event) =>
                        update(index, { when: event.target.value })
                      }
                      className="h-7 border-0 bg-transparent text-xs shadow-none focus-visible:bg-background focus-visible:ring-1"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <Input
                      value={state.shows}
                      placeholder="A spinner over the camera"
                      aria-label={`State ${index + 1} appearance`}
                      onChange={(event) =>
                        update(index, { shows: event.target.value })
                      }
                      className="h-7 border-0 bg-transparent text-xs shadow-none focus-visible:bg-background focus-visible:ring-1"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <IconButton
                      label="Remove state"
                      onClick={() =>
                        onChange(states.filter((_, at) => at !== index))
                      }
                    >
                      <X />
                    </IconButton>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() =>
            onChange([...states, { name: "", when: "", shows: "" }])
          }
        >
          <Plus data-icon="inline-start" />
          Add state
        </Button>
        {missing.map((suggested) => (
          <Button
            key={suggested.name}
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => onChange([...states, suggested])}
          >
            <Plus data-icon="inline-start" />
            {suggested.name}
          </Button>
        ))}
      </div>
    </div>
  )
}

function Toolbar({
  path,
  dirty,
  editing,
  onToggle,
}: {
  path: string
  dirty: boolean
  /** Omitted for a spec that could not be read — there is nothing to edit. */
  editing?: boolean
  onToggle?: () => void
}) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
      <span className="truncate font-mono text-xs text-muted-foreground">
        {path}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {/* Only while editing: "Saved" against a page nobody can change says
            nothing, and the preview is quieter without it. */}
        {editing && (
          <span className="text-[0.65rem] text-muted-foreground">
            {dirty ? "Saving…" : "Saved"}
          </span>
        )}
        {onToggle && (
          <IconButton
            label={editing ? "Done editing" : "Edit"}
            onClick={onToggle}
            variant={editing ? "outline" : "ghost"}
          >
            {editing ? <Eye /> : <Pencil />}
          </IconButton>
        )}
      </div>
    </div>
  )
}

function Placeholder({ title, children }: { title: string; children: string }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{children}</EmptyDescription>
        </EmptyHeader>
      </Empty>
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

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[0.65rem] font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      {children}
    </label>
  )
}

function Items({
  items,
  pinned,
  onChange,
}: {
  items: SpecItem[]
  /** Numbers a pin on the mockup points at — which, since the table is derived
   * from the pins, is every row. Kept as a parameter rather than assumed so a
   * number typed into two pins, or a row the reconciliation has not caught up
   * with, shows as unpinned instead of silently claiming to be fine. */
  pinned: Set<string>
  onChange: (items: SpecItem[]) => void
}) {
  const update = (index: number, key: keyof SpecItem, value: string) =>
    onChange(
      items.map((item, at) => (at === index ? { ...item, [key]: value } : item))
    )

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b bg-muted/50 text-[0.65rem] tracking-wider text-muted-foreground uppercase">
              <th className="w-16 px-2 py-2 text-center font-medium">No.</th>
              {COLUMNS.map(([key, label, width]) => (
                <th key={key} className={cn("px-2 py-2 font-medium", width)}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length + 1}
                  className="px-3 py-4 text-center text-muted-foreground italic"
                >
                  Rows appear here as pins are placed on the screenshots above.
                </td>
              </tr>
            ) : (
              items.map((item, index) => (
                <tr key={index} className="border-b last:border-0">
                  <td className="px-1 py-1">
                    <div className="flex items-center">
                      <Input
                        value={item.no}
                        aria-label={`Row ${index + 1} number`}
                        onChange={(event) =>
                          update(index, "no", event.target.value)
                        }
                        className="h-7 border-0 bg-transparent px-1 text-center text-xs shadow-none focus-visible:bg-background focus-visible:ring-1"
                      />
                      {/* Which rows the screenshot points at, so a number that
                          no longer matches any pin is visible as such rather
                          than merely wrong somewhere else. */}
                      <MapPin
                        aria-hidden
                        className={cn(
                          "size-3 shrink-0",
                          pinned.has(item.no)
                            ? "text-destructive"
                            : "text-transparent"
                        )}
                      />
                    </div>
                  </td>
                  {COLUMNS.map(([key]) => (
                    <td key={key} className="px-1 py-1">
                      {key === "control" ? (
                        <OpenSelect
                          value={item.control}
                          options={CONTROL_KINDS}
                          label={`Row ${index + 1} control`}
                          placeholder="—"
                          className={cn(
                            "h-7 w-full border-0 bg-transparent text-xs shadow-none",
                            // The text only: a filled chip inside a cell that
                            // is already an editable control reads as two
                            // controls stacked.
                            controlTone(item.control).text
                          )}
                          onChange={(value) => update(index, "control", value)}
                        />
                      ) : (
                        <Input
                          value={item[key]}
                          aria-label={`Row ${index + 1} ${key}`}
                          onChange={(event) =>
                            update(index, key, event.target.value)
                          }
                          className="h-7 border-0 bg-transparent text-xs shadow-none focus-visible:bg-background focus-visible:ring-1"
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
