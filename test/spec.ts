import {
  asDateInput,
  assetsDir,
  blankItem,
  blankSpec,
  nextNumber,
  parseSpec,
  serializeSpec,
  specName,
  syncItemsWithMarkers,
  withAssetsAt,
} from "../src/renderer/lib/spec/schema"
import { check, finish, section } from "./harness"

/**
 * The Spec panel's reader.
 *
 * Everything else in the panel is form controls bound to fields, which a test
 * here could only restate. What has logic worth checking is `parseSpec`: it is
 * what stands between a file in someone's repository and the editor, it is
 * total by contract, and it carries the one-way migration from the structured
 * shape the panel started with — so the checks below are mostly about
 * documents that are wrong, old, or not specs at all.
 */

section("a document that is not finished")

const empty = parseSpec({})
check("an empty object parses", empty.items.length === 0)
check(
  "the screen title is not per-document",
  !("title" in empty.overview),
  Object.keys(empty.overview)
)
check(
  "the canvas is always there to draw on",
  empty.overview.canvas.images.length === 0 &&
    empty.overview.canvas.markers.length === 0 &&
    empty.overview.canvas.height > 0
)
check(
  "prose sections start empty",
  empty.processing.checkAuthority === "" &&
    empty.processing.eventBehavior === "" &&
    empty.api === ""
)

check("a non-object parses", parseSpec("nonsense").items.length === 0)
check("null parses", parseSpec(null).processing.checkAuthority === "")
check("an array parses", parseSpec([1, 2]).items.length === 0)

section("fields")

const loose = parseSpec({
  items: [{ no: 3, itemName: "Camera" }, "junk", { no: 7 }],
})
check("a numeric `no` is read as text", loose.items[0]?.no === "3")
check(
  "a junk row still yields a row rather than a crash",
  loose.items.length === 3,
  loose.items
)
check("a junk row's fields are blank", loose.items[1]?.itemName === "")
check("a row with no `no` is numbered by position", loose.items[1]?.no === "2")

section("the columns that were folded away")

/**
 * The table went from eleven columns to six. `logicName` held the same words as
 * `itemName` in every document, and the five input properties read "-" on every
 * row that was not an input — but a document that did fill them in must not
 * lose what it said.
 */
const folded = parseSpec({
  items: [
    {
      no: "1",
      logicName: "Camera Scan QR",
      itemName: "Camera Scan QR",
      control: "Input",
      api: "-",
      inOutField: "-",
      default: "-",
      length: "-",
      required: "-",
      attribute: "-",
      description: "Line camera scan id",
    },
    {
      no: "2",
      logicName: "email",
      control: "Input",
      required: "○",
      length: "1-128",
      default: "—",
      attribute: "lowercase",
      inOutField: "user.email",
    },
  ],
}).items

check(
  "a row whose properties were all dashes gets an empty constraints cell",
  folded[0]?.constraints === "",
  folded[0]
)
check(
  "the columns that carried nothing are gone",
  Object.keys(folded[0] ?? {})
    .sort()
    .join() === "api,constraints,control,description,itemName,no",
  Object.keys(folded[0] ?? {})
)
check(
  "properties that were filled in are folded into one labelled line",
  folded[1]?.constraints ===
    "required: ○, length: 1-128, attribute: lowercase, in/out: user.email",
  folded[1]?.constraints
)
check(
  "a dash among them is dropped rather than carried across",
  !folded[1]?.constraints.includes("default")
)
check(
  "a row that only had a logic name keeps it as its item name",
  folded[1]?.itemName === "email"
)
check(
  "an item name already there is not replaced by the logic name",
  folded[0]?.itemName === "Camera Scan QR"
)
check(
  "a constraints field already written wins over the old columns",
  parseSpec({
    items: [{ no: "1", constraints: "as written", required: "○" }],
  }).items[0]?.constraints === "as written"
)

/** A number is which row it is, so a file naming one twice has one row. */
check(
  "two rows sharing a number collapse to one",
  parseSpec({ items: [{ no: "1", itemName: "first" }, { no: "1" }] }).items
    .length === 1
)

const drawn = parseSpec({
  overview: {
    canvas: {
      height: 90,
      images: [
        {
          src: "docs/specs/FR_008.assets/scan.png",
          caption: "Quét QR",
          x: 4,
          y: 6,
          width: 55,
        },
        "junk",
      ],
      markers: [
        { id: 1, kind: "circle", x: 40, y: 62.5 },
        { id: "2", kind: "box", x: 10, y: 10, width: 30, height: 20 },
        { id: "3", kind: "arrow", x: 20, y: 20, tipX: 44, tipY: 8 },
        { id: "4", kind: "made-up", x: -5, y: 5 },
      ],
    },
  },
}).overview.canvas

check("the canvas keeps its height", drawn.height === 90)
check(
  "an image keeps its path",
  drawn.images[0]?.src.endsWith("scan.png") === true
)
check("a caption is kept", drawn.images[0]?.caption === "Quét QR")
check(
  "an image keeps where it was put",
  drawn.images[0]?.x === 4 && drawn.images[0]?.width === 55
)
check(
  "a junk image is placed rather than dropped",
  drawn.images[1]?.width === 60
)

check("a numeric marker id is read as text", drawn.markers[0]?.id === "1")
check(
  "every marker kind is kept",
  drawn.markers[1]?.kind === "box" && drawn.markers[2]?.kind === "arrow"
)
check(
  "an unknown kind falls back to the plain number",
  drawn.markers[3]?.kind === "circle"
)
check(
  "a negative coordinate is pulled back onto the canvas",
  drawn.markers[3]?.x === 0
)
check(
  "an arrow keeps where it points",
  drawn.markers[2]?.tipX === 44 && drawn.markers[2]?.tipY === 8
)
check(
  "an arrow with no tip recorded is given one beside itself",
  drawn.markers[0]?.tipX !== drawn.markers[0]?.x
)
check(
  "a marker carries no text of its own — its row is where that lives",
  Object.keys(drawn.markers[0] ?? {})
    .sort()
    .join() === "height,id,kind,tipX,tipY,width,x,y",
  drawn.markers[0]
)

section("the canvas a document of separate screenshots becomes")

/**
 * Until now the mockup was a list of pictures, each with pins positioned as a
 * percentage of itself. One canvas cannot keep that — the numbers are now one
 * sequence over one figure — so the pictures are stacked and the pins mapped
 * into the slot each picture now occupies.
 */
const stacked = parseSpec({
  overview: {
    mockup: {
      images: [
        { src: "a.png", caption: "one", pins: [{ id: "1", x: 50, y: 50 }] },
        { src: "b.png", caption: "two", pins: [{ id: "2", x: 0, y: 0 }] },
      ],
    },
  },
}).overview.canvas

check("both pictures land on one canvas", stacked.images.length === 2)
check(
  "they are stacked rather than piled on the origin",
  stacked.images[0]!.y < stacked.images[1]!.y
)
check("the canvas grows to hold them", stacked.height >= 80)
check("every pin becomes a marker", stacked.markers.length === 2)
check(
  "numbers survive exactly",
  stacked.markers.map((m) => m.id).join() === "1,2"
)
check(
  "a pin is mapped into its own picture's slot",
  stacked.markers[1]!.y >= stacked.images[1]!.y,
  { marker: stacked.markers[1], image: stacked.images[1] }
)

const fromHotspots = parseSpec({
  overview: {
    mockup: {
      screenTitle: "Quét QR Code",
      hotspots: [
        { id: 1, type: "camera", label: "Vùng Camera" },
        { id: 2, type: "dialog", label: "Dialog Lỗi" },
      ],
    },
  },
})
const legacy = fromHotspots.overview.canvas

check(
  "old hotspots become markers on an empty canvas",
  legacy.images.length === 0 && legacy.markers.length === 2
)
check(
  "their numbers are kept",
  legacy.markers.map((m) => m.id).join() === "1,2"
)
check(
  "they are spread down the middle",
  legacy.markers[0]!.x === 50 && legacy.markers[0]!.y < legacy.markers[1]!.y
)
check(
  "a hotspot's label becomes the item name of the row its number points at",
  fromHotspots.items.find((row) => row.no === "1")?.itemName === "Vùng Camera",
  fromHotspots.items
)
check(
  "every hotspot gets a row",
  fromHotspots.items.map((row) => row.no).join() === "1,2"
)
check(
  "a spec with nothing at all gets an empty canvas",
  parseSpec({ overview: { mockup: {} } }).overview.canvas.markers.length === 0
)

section("detail processing — two fixed sections")

check(
  "an object of the two fields is read as written",
  parseSpec({
    processing: { checkAuthority: "who", eventBehavior: "what" },
  }).processing.checkAuthority === "who"
)
check(
  "a missing field is an empty section, not a missing one",
  parseSpec({ processing: { checkAuthority: "who" } }).processing
    .eventBehavior === ""
)

/**
 * The older structured shape, and the single markdown string that came between
 * it and the two fields. Both carried their own headings, and those are what
 * decide where each part now goes.
 */
const migrated = parseSpec({
  processing: [
    {
      no: "3.1",
      title: "Check authority",
      type: "list",
      content: [
        { icon: "info", text: "User <strong>phải đăng nhập</strong>." },
        { icon: "warning", text: "Nếu không thì tới <code>FR_010</code>." },
      ],
    },
    {
      no: "3.2",
      title: "Screen initialization",
      type: "text",
      content: "Hiển thị camera",
    },
    {
      no: "3.3",
      title: "Event behavior handling",
      type: "tree",
      content: [
        {
          id: "3.3.1",
          text: "Bật camera",
          type: "root",
          children: [
            {
              id: "3.3.1.1",
              text: "Call <code>/stores/line_favourite</code>",
              type: "api",
            },
          ],
        },
      ],
    },
  ],
  api: { required: ["FR_001"], description: "Tham khảo <strong>API</strong>" },
})

check(
  "an old section lands in the fixed one its title names",
  migrated.processing.checkAuthority.includes("- User **phải đăng nhập**."),
  migrated.processing.checkAuthority
)
check(
  "a tree lands in event behaviour, as a nested list",
  migrated.processing.eventBehavior.includes("- **3.3.1** Bật camera") &&
    migrated.processing.eventBehavior.includes(
      "  - **3.3.1.1** Call `/stores/line_favourite`"
    ),
  migrated.processing.eventBehavior
)
check(
  "inline code becomes a backtick span",
  migrated.processing.checkAuthority.includes("`FR_010`")
)
check(
  "a fixed section's own title is not repeated as a heading inside it",
  !migrated.processing.checkAuthority.includes("Check authority"),
  migrated.processing.checkAuthority
)

/**
 * "Screen initialization" belongs to neither fixed section. Keeping it — with
 * its heading, in the first section — is deliberate: a paragraph in the wrong
 * place is one someone can see and move, a dropped one is one nobody knows to
 * look for.
 */
check(
  "a section matching neither is kept rather than dropped",
  migrated.processing.checkAuthority.includes("Hiển thị camera"),
  migrated.processing.checkAuthority
)
check(
  "and keeps its own heading, so it is obvious where it came from",
  migrated.processing.checkAuthority.includes("## 3.2 Screen initialization")
)

check(
  "the old api object becomes prose plus a required line",
  migrated.api === "Tham khảo **API**\n\nAPI required: `FR_001`",
  migrated.api
)
check(
  "an api object with no required list is just its description",
  parseSpec({ api: { description: "see the wiki" } }).api === "see the wiki"
)

section("detail processing — from one markdown string")

const split = parseSpec({
  processing:
    "## 3.1 Check authority\n\nmust be logged in\n\n## 3.3 Event behavior handling\n\n- taps the button",
}).processing

check(
  "each heading routes to its section",
  split.checkAuthority === "must be logged in",
  split
)
check("the other one too", split.eventBehavior === "- taps the button")

check(
  "a string with no headings at all is kept, in the first section",
  parseSpec({ processing: "just some notes" }).processing.checkAuthority ===
    "just some notes"
)
check(
  "text before the first heading is kept too",
  parseSpec({
    processing: "preamble\n\n## Event behavior handling\n\nthe rest",
  }).processing.checkAuthority === "preamble"
)

section("no tag survives the migration")

/**
 * What comes out of the migration goes straight into a markdown editor, and the
 * one thing that must not survive the trip is a tag that becomes a tag again.
 */
const hostile = parseSpec({
  processing: [
    {
      no: "1",
      title: "x",
      type: "text",
      content: `<script>alert(1)</script><img src=x onerror="alert(1)">ok`,
    },
  ],
  api: { description: `<a href="javascript:alert(1)">click</a>` },
})

check(
  "no script tag survives",
  !hostile.processing.checkAuthority.includes("<script"),
  hostile.processing.checkAuthority
)
check(
  "no img tag survives",
  !hostile.processing.checkAuthority.includes("<img")
)
check(
  "no event handler survives",
  !/on[a-z]+\s*=/i.test(hostile.processing.checkAuthority)
)
check(
  "the surrounding text is kept",
  hostile.processing.checkAuthority.includes("ok")
)
check("an anchor is reduced to its text", hostile.api === "click", hostile.api)

section("screen states and where the screen leads")

const flow = parseSpec({
  overview: {
    navigatesTo: [
      { condition: "QR hợp lệ, store tồn tại", target: "FR_002" },
      { condition: "chưa đăng nhập", target: 10 },
      "junk",
    ],
  },
  states: [
    { name: "Loading", when: "đang gọi API", shows: "spinner" },
    { name: "Empty" },
    null,
  ],
})

check(
  "a route is read as a pair",
  flow.overview.navigatesTo[0]?.target === "FR_002"
)
check(
  "utf-8 conditions survive",
  flow.overview.navigatesTo[0]?.condition === "QR hợp lệ, store tồn tại"
)
check(
  "a numeric target is read as text",
  flow.overview.navigatesTo[1]?.target === "10"
)
check(
  "a junk route is a blank one rather than a crash",
  flow.overview.navigatesTo[2]?.target === ""
)

check("a state is read", flow.states[0]?.shows === "spinner")
check("a half-written state keeps its name", flow.states[1]?.name === "Empty")
check("and its blanks are blank", flow.states[1]?.when === "")
check("a junk state does not crash", flow.states[2]?.name === "")

check(
  "a document with neither gets empty lists",
  parseSpec({}).states.length === 0
)
check(
  "and an empty route list",
  parseSpec({}).overview.navigatesTo.length === 0
)

check(
  "routes are capped",
  parseSpec({
    overview: { navigatesTo: Array.from({ length: 200 }, () => ({})) },
  }).overview.navigatesTo.length === 40
)
check(
  "states are capped",
  parseSpec({ states: Array.from({ length: 200 }, () => ({})) }).states
    .length === 40
)

section("caps — a file that is not a spec at all")

const huge = parseSpec({
  items: Array.from({ length: 5000 }, (_, index) => ({ no: index })),
})
check("the item table is capped", huge.items.length === 500, huge.items.length)

const crowded = parseSpec({
  overview: {
    canvas: {
      images: Array.from({ length: 200 }, () => ({})),
      markers: Array.from({ length: 500 }, () => ({})),
    },
  },
}).overview.canvas
check("images are capped", crowded.images.length === 20, crowded.images.length)
check(
  "markers are capped",
  crowded.markers.length === 100,
  crowded.markers.length
)

section("the item table is the pins")

const pin = (id: string) => ({
  id,
  kind: "circle" as const,
  x: 50,
  y: 50,
  width: 20,
  height: 12,
  tipX: 62,
  tipY: 42,
})
const nos = (rows: { no: string }[]) => rows.map((row) => row.no).join()

check(
  "a new pin brings a row with it",
  nos(syncItemsWithMarkers([], [], [pin("1"), pin("2")])) === "1,2"
)
check(
  "rows follow pin order, not the order they were written in",
  nos(
    syncItemsWithMarkers(
      [blankItem("1"), blankItem("2")],
      [pin("1"), pin("2")],
      [pin("2"), pin("1")]
    )
  ) === "2,1"
)
check(
  "a pin whose number already has a row reuses it",
  syncItemsWithMarkers([blankItem("1")], [], [pin("1")]).length === 1
)

/**
 * The panel is specified to keep the two sides identical, so a pin's row goes
 * with it — including everything typed into it. There is no undo; this is the
 * price of the table never disagreeing with the picture.
 */
const written = { ...blankItem("2"), itemName: "Dialog", description: "…" }
check(
  "removing a pin removes its row, written in or not",
  nos(
    syncItemsWithMarkers(
      [blankItem("1"), written],
      [pin("1"), pin("2")],
      [pin("1")]
    )
  ) === "1"
)
check(
  "a row no pin points at cannot survive",
  syncItemsWithMarkers([blankItem("9")], [], [pin("1")]).length === 1
)
check(
  "removing every pin empties the table",
  syncItemsWithMarkers([blankItem("1"), written], [pin("1"), pin("2")], [])
    .length === 0
)

check(
  "editing a pin's number renumbers its row rather than resetting it",
  nos(syncItemsWithMarkers([written], [pin("2")], [pin("2a")])) === "2a"
)
check(
  "and keeps what was written in it",
  syncItemsWithMarkers([written], [pin("2")], [pin("2a")])[0]?.itemName ===
    "Dialog"
)
check(
  "renumbering onto a number that is already a row leaves that row alone",
  syncItemsWithMarkers(
    [blankItem("1"), written],
    [pin("1"), pin("2")],
    [pin("1"), pin("1")]
  )[0]?.itemName === "",
  syncItemsWithMarkers(
    [blankItem("1"), written],
    [pin("1"), pin("2")],
    [pin("1"), pin("1")]
  )
)
check(
  "two pins sharing a number point at one row, not two",
  syncItemsWithMarkers([], [], [pin("1"), pin("1")]).length === 1
)
check(
  "removing one pin and adding an unrelated one is not read as a renumber",
  nos(
    syncItemsWithMarkers(
      [blankItem("1"), written],
      [pin("1"), pin("2")],
      [pin("1"), pin("3"), pin("4")]
    )
  ) === "1,3,4"
)

check(
  "a number is one past the highest, not the count",
  nextNumber(["1", "2", "7"]) === "8"
)
check("gaps left by deletions are not reused", nextNumber(["1", "3"]) === "4")
check("nothing yet starts at one", nextNumber([]) === "1")
check("a non-numeric number is skipped over", nextNumber(["2a", "3"]) === "4")

check(
  "the number sequence runs across the whole canvas, not per picture",
  parseSpec({
    overview: {
      mockup: {
        images: [
          { src: "a.png", pins: [{ id: "1" }, { id: "2" }] },
          { src: "b.png", pins: [{ id: "3" }] },
        ],
      },
    },
  })
    .overview.canvas.markers.map((mark) => mark.id)
    .join() === "1,2,3"
)

section("a document opens already in step")

/** Rows with no pins would otherwise vanish at the first keystroke, so opening
 * the file gives each one a pin rather than emptying the table. */
const unpinned = parseSpec({
  items: [
    { no: "1", itemName: "Camera" },
    { no: "2", itemName: "Dialog" },
  ],
})
check("no row is lost", nos(unpinned.items) === "1,2")
check(
  "each row gets a marker on the canvas",
  unpinned.overview.canvas.markers.map((mark) => mark.id).join() === "1,2",
  unpinned.overview.canvas.markers
)
check(
  "they are spread down the middle, ready to be dragged onto a screenshot",
  unpinned.overview.canvas.markers.every((mark) => mark.x === 50)
)

const withPicture = parseSpec({
  items: [{ no: "1", itemName: "Camera" }],
  overview: { canvas: { images: [{ src: "a.png", x: 0, y: 0, width: 80 }] } },
})
check(
  "a canvas that already has a picture keeps it, and still gets the marker",
  withPicture.overview.canvas.images.length === 1 &&
    withPicture.overview.canvas.images[0]?.src === "a.png" &&
    withPicture.overview.canvas.markers.length === 1
)

check(
  "a row the markers do not mention is dropped on open",
  nos(
    parseSpec({
      items: [{ no: "1" }, { no: "9" }],
      overview: { canvas: { markers: [{ id: "1", x: 5, y: 5 }] } },
    }).items
  ) === "1"
)

check(
  "a new spec starts with neither markers nor rows",
  blankSpec("FR_008").items.length === 0 &&
    blankSpec("FR_008").overview.canvas.markers.length === 0
)

section("the date field")

check("an ISO date passes through", asDateInput("2026-08-07") === "2026-08-07")
check(
  "a slashed date is read day-first",
  asDateInput("07/08/2026") === "2026-08-07"
)
check("single digits are padded", asDateInput("7/8/2026") === "2026-08-07")
check("prose is not a date", asDateInput("next sprint") === "")
check("a two-digit year is refused", asDateInput("07/08/26") === "")
check("an impossible month is refused", asDateInput("07/13/2026") === "")

section("a spec that is renamed or copied")

/**
 * A spec's screenshots live in `<name>.assets/` beside it, so renaming or
 * copying the spec moves that folder — and every `src` on the canvas points
 * into it. Getting this wrong does not fail: it leaves a spec whose pictures
 * silently stop loading.
 */
const pictured = parseSpec({
  overview: {
    canvas: {
      images: [
        { src: "docs/specs/FR_008.assets/a.png", x: 0, y: 0, width: 50 },
        { src: "docs/specs/FR_008.assets/nested/b.png", x: 0, y: 0, width: 50 },
        { src: "docs/shared/logo.svg", x: 0, y: 0, width: 10 },
      ],
    },
  },
})

const renamed = withAssetsAt(
  pictured,
  assetsDir("docs/specs/FR_008.spec.json"),
  assetsDir("docs/specs/FR_009.spec.json")
)
const moved = renamed.overview.canvas.images.map((image) => image.src)

check(
  "a picture in the spec's own folder follows it",
  moved[0] === "docs/specs/FR_009.assets/a.png",
  moved
)
check(
  "so does one in a folder under it",
  moved[1] === "docs/specs/FR_009.assets/nested/b.png"
)
check(
  "a picture that was never in that folder is left exactly as it was",
  moved[2] === "docs/shared/logo.svg"
)
check(
  "nothing else about the document changes",
  JSON.stringify({
    ...renamed,
    overview: { ...renamed.overview, canvas: null },
  }) ===
    JSON.stringify({
      ...pictured,
      overview: { ...pictured.overview, canvas: null },
    })
)
check(
  "renaming to the same name is a no-op",
  withAssetsAt(
    pictured,
    "docs/specs/FR_008.assets",
    "docs/specs/FR_008.assets"
  ) === pictured
)

/** The folder is named after the spec, so a name that is a prefix of another
 * must not drag the other one's pictures along. */
check(
  "a folder whose name merely starts the same is not touched",
  withAssetsAt(
    parseSpec({
      overview: {
        canvas: {
          images: [
            { src: "docs/specs/FR_0081.assets/a.png", x: 0, y: 0, width: 1 },
          ],
        },
      },
    }),
    "docs/specs/FR_008.assets",
    "docs/specs/FR_009.assets"
  ).overview.canvas.images[0]?.src === "docs/specs/FR_0081.assets/a.png"
)

section("round trip")

const fresh = blankSpec("FR_008")
check(
  "serialize then parse is a fixed point",
  serializeSpec(parseSpec(JSON.parse(serializeSpec(fresh)))) ===
    serializeSpec(fresh)
)
check(
  "the file ends with a newline, like the repo's other JSON",
  serializeSpec(fresh).endsWith("}\n")
)
check(
  "a migrated document is a fixed point after one save",
  serializeSpec(parseSpec(JSON.parse(serializeSpec(migrated)))) ===
    serializeSpec(migrated)
)

check(
  "the suffix comes off for display",
  specName("docs/specs/FR_008.spec.json") === "FR_008"
)
check("a plain name is left alone", specName("notes.json") === "notes.json")
check(
  "a spec's images go in a folder beside it, named after it",
  assetsDir("docs/specs/FR_008.spec.json") === "docs/specs/FR_008.assets"
)
check(
  "a spec at the repository root still gets one",
  assetsDir("FR_008.spec.json") === "FR_008.assets"
)

finish()
