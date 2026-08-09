import {
  controlTone,
  stateTone,
  statusTone,
} from "../src/renderer/lib/spec/tones"
import { check, finish, section } from "./harness"

/**
 * The spec panel's three tone lookups.
 *
 * Colour here is meant to carry information, which is only true if it is the
 * *same* colour for the same thing every time — and every one of these
 * vocabularies is open, so a document may say anything at all. What is checked
 * is therefore the two ends: that a word in the vocabulary is always coloured,
 * and that a word outside it falls back to neutral rather than to whatever a
 * lookup happened to return.
 */

section("a spec's status")

check(
  "draft is neutral, not coloured",
  statusTone("Draft").text.includes("muted")
)
check("approved is settled", statusTone("Approved").text.includes("success"))
check(
  "in review is unsettled",
  statusTone("In review").text.includes("warning")
)
check(
  "deprecated is red",
  statusTone("Deprecated").text.includes("destructive")
)

check(
  "a document that shouts is coloured the same",
  statusTone("APPROVED").badge === statusTone("Approved").badge
)
check(
  "so is one with stray space",
  statusTone("  approved ").badge === statusTone("Approved").badge
)
check(
  "a team's own word is neutral rather than mis-coloured",
  statusTone("Chờ duyệt").badge === statusTone("Draft").badge
)
check("and so is nothing at all", statusTone("").text.includes("muted"))

section("a screen state")

check("error stands out", stateTone("Error").text.includes("destructive"))
check(
  "so does no permission",
  stateTone("No permission").text.includes("warning")
)
check("loading is calm", stateTone("Loading").text.includes("info"))
check("empty is neutral", stateTone("Empty").text.includes("muted"))
check(
  "an unlisted state is neutral",
  stateTone("Scanning").text.includes("muted")
)

section("a control")

/** The question a reader is asking of this column is "which of these does the
 * user type into", so the families are what is checked, not the words. */
const typedInto = ["Input", "TextArea", "Select", "Checkbox", "Radio", "Camera"]
check(
  "everything typed into shares one tone",
  typedInto.every(
    (control) => controlTone(control).badge === controlTone("Input").badge
  )
)
check(
  "everything that acts shares another",
  ["Button", "Link", "Tab"].every(
    (control) => controlTone(control).badge === controlTone("Button").badge
  )
)
check(
  "the two are not the same tone",
  controlTone("Input").badge !== controlTone("Button").badge
)
check(
  "what a screen merely shows is left uncoloured",
  ["Label", "Image", "Table", "List"].every((control) =>
    controlTone(control).text.includes("muted")
  )
)
check("an overlay is amber", controlTone("Dialog").text.includes("warning"))
check(
  "a control this list has never heard of is neutral",
  controlTone("QRScanner").text.includes("muted")
)

section("both strengths exist")

/** `badge` is for a chip standing on its own, `text` for a word inside a
 * control that already has a border and a background of its own. */
for (const [label, tone] of [
  ["status", statusTone("Approved")],
  ["state", stateTone("Error")],
  ["control", controlTone("Button")],
] as const) {
  check(
    `${label}: the badge carries a border and a fill`,
    tone.badge.includes("border-") && tone.badge.includes("bg-")
  )
  check(
    `${label}: the text strength carries neither`,
    !tone.text.includes("border-") && !tone.text.includes("bg-")
  )
  /**
   * Both strengths name a status token rather than a palette step. The tokens
   * are redefined for the dark theme in `globals.css`, so one class is right in
   * both; a hard-coded `text-amber-700` needs a `dark:` twin, and keeping the
   * two halves in step by hand is what let them drift apart before.
   */
  check(
    `${label}: neither strength hard-codes a palette step`,
    !/-\d{3}(\b|\/)/.test(tone.badge) && !/-\d{3}(\b|\/)/.test(tone.text)
  )
}

finish()
