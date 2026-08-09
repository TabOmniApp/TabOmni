/**
 * The few places a spec is worth colouring.
 *
 * The chrome around a panel spends its hue on where you are — the rail and the
 * panel headers carry a section's colour, and `--primary` carries the brand's.
 * A spec spends it on something else, and not because a document should be
 * decorated: it is *scanned*. Whether a spec is agreed, which rows of its item
 * table are typed into, and which state is the failing one are all questions a
 * reader answers by sweeping down the page, and a tone answers them before the
 * words are read.
 *
 * So the rule is that colour here carries information or is not used. Section
 * headings, cards and prose stay neutral; three vocabularies get tones, and the
 * numbered badges keep the red they share with the markers on the canvas, which
 * is what ties a row to the mark pointing at it.
 *
 * Every vocabulary is open — a document may say anything — so each lookup falls
 * back to neutral rather than to a guess, the same as `METHOD_TONES` in the API
 * panel.
 */

/**
 * One tone in two strengths.
 *
 * `badge` is for a chip that stands on its own; `text` is for a word inside a
 * control that already has a border and a background of its own, where a second
 * set would read as two controls stacked. Each is a status token rather than a
 * palette step, so the theme picks the weight — these used to name both halves
 * (`text-amber-700 dark:text-amber-400`) and the pairs had drifted apart from
 * the ones the git and API panels were spelling out for themselves.
 */
export type Tone = { badge: string; text: string }

const TONES = {
  neutral: {
    badge: "border-border bg-muted text-muted-foreground",
    text: "text-muted-foreground",
  },
  info: {
    badge: "border-info/30 bg-info/10 text-info",
    text: "text-info",
  },
  success: {
    badge: "border-success/30 bg-success/10 text-success",
    text: "text-success",
  },
  warning: {
    badge: "border-warning/30 bg-warning/10 text-warning",
    text: "text-warning",
  },
  danger: {
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
    text: "text-destructive",
  },
} satisfies Record<string, Tone>

type ToneName = keyof typeof TONES

/** Case-folded, so a document saying "approved" is coloured like "Approved". */
function lookup(map: Record<string, ToneName>, value: string): Tone {
  return TONES[map[value.trim().toLowerCase()] ?? "neutral"]
}

/**
 * How far along a spec is — the most useful colour on the page. A reader
 * opening a folder of these wants to know which are settled before reading a
 * word of any of them.
 */
const STATUSES: Record<string, ToneName> = {
  draft: "neutral",
  "in review": "warning",
  approved: "success",
  implemented: "info",
  deprecated: "danger",
}

export function statusTone(status: string): Tone {
  return lookup(STATUSES, status)
}

/**
 * What kind of state the screen is in. Error and no-permission are the two a
 * reviewer is looking for — they are the two most often missing — so they are
 * the two that stand out.
 */
const STATES: Record<string, ToneName> = {
  loading: "info",
  empty: "neutral",
  error: "danger",
  failed: "danger",
  "no permission": "warning",
  offline: "warning",
  success: "success",
}

export function stateTone(name: string): Tone {
  return lookup(STATES, name)
}

/**
 * What kind of thing a row of the item table is, by family rather than one
 * tone per control.
 *
 * What a reader is actually asking is "which of these does the user type
 * into" — fifteen colours would answer that no better than three while making
 * the table a mess. Everything not listed, Label and Image and Table and List,
 * is something the screen merely shows, which is the ordinary case and so the
 * uncoloured one.
 */
const CONTROLS: Record<string, ToneName> = {
  // Takes input: the rows whose `constraints` cell is worth reading.
  input: "info",
  textarea: "info",
  select: "info",
  checkbox: "info",
  radio: "info",
  camera: "info",
  upload: "info",
  // Does something when used.
  button: "success",
  link: "success",
  tab: "success",
  // Appears over the screen rather than in it.
  dialog: "warning",
  toast: "warning",
  tooltip: "warning",
  popover: "warning",
}

export function controlTone(control: string): Tone {
  return lookup(CONTROLS, control)
}
