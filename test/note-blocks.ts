import {
  adoptDrawingFences,
  drawingIdsIn,
  mapDrawingIds,
  type NoteBlock,
} from "../src/renderer/lib/note/blocks"
import { check, finish, section } from "./harness"

/**
 * Which drawings a note refers to, and what happens to the ones a markdown note
 * carried in a fence.
 *
 * Read back out of the document rather than tracked beside it, and what it
 * answers decides which `.excalidraw` files are deleted when a note is deleted
 * and which are copied when one is duplicated. Both directions are destructive
 * when it is wrong: miss an id and a duplicate shares its original's scenes, so
 * editing one changes the other; invent one and a delete takes a file belonging
 * to a note nobody touched.
 *
 * This used to be a regular expression over ```drawing fences, and the fence
 * shapes it had to survive — four backticks, CRLF, an indented block — are now
 * BlockNote's parser's business rather than ours. What is left is the walk, and
 * the one hand-off that is still this app's own: a code block that says
 * `drawing` is a drawing, and nothing else is.
 */

const ID = "7c3f1a2e-5b6d-4a8f-9e21-1f0b3c4d5e6f"
const OTHER = "a1b2c3d4-0000-4111-8222-333344445555"

const drawing = (id: string): NoteBlock => ({
  type: "drawing",
  props: { drawingId: id },
})

const text = (words: string): NoteBlock => ({
  type: "paragraph",
  content: [{ type: "text", text: words }],
})

const fence = (language: string, id: string): NoteBlock => ({
  type: "codeBlock",
  props: { language },
  content: [{ type: "text", text: id }],
})

section("drawingIdsIn")
{
  check("a drawing block on its own", drawingIdsIn([drawing(ID)]).join() === ID)

  const note = [
    text("Architecture"),
    drawing(ID),
    text("prose"),
    drawing(OTHER),
  ]
  check(
    "every drawing in a note, in the order they appear",
    drawingIdsIn(note).join() === `${ID},${OTHER}`,
    drawingIdsIn(note)
  )

  // A note duplicated and never edited holds the same block twice; the caller
  // deletes and copies by this list, and doing either twice is a bug.
  check(
    "the same drawing twice counts once",
    drawingIdsIn([drawing(ID), drawing(ID)]).join() === ID
  )

  // A drawing dragged into a list or a column is still in the note, and a
  // delete that missed it would leave an orphaned scene behind.
  const nested: NoteBlock[] = [
    { type: "bulletListItem", content: [], children: [drawing(ID)] },
  ]
  check(
    "a drawing nested under another block",
    drawingIdsIn(nested).join() === ID
  )

  check(
    "a note with no drawing has none",
    drawingIdsIn([text("words")]).length === 0
  )
  check("an empty note has none", drawingIdsIn([]).length === 0)
  check(
    "a drawing block with no id names nothing",
    drawingIdsIn([drawing("  ")]).length === 0
  )
}

section("adoptDrawingFences")
{
  const adopted = adoptDrawingFences([text("before"), fence("drawing", ID)])
  check(
    "a drawing fence becomes a drawing block",
    adopted[1]?.type === "drawing" &&
      adopted[1]?.props?.drawingId === ID &&
      drawingIdsIn(adopted).join() === ID,
    adopted[1]
  )

  const other = adoptDrawingFences([fence("json", ID)])
  check(
    "a code block in another language is left alone",
    other[0]?.type === "codeBlock" && drawingIdsIn(other).length === 0
  )

  check(
    "a language that merely starts the same is not a drawing",
    adoptDrawingFences([fence("drawings", ID)])[0]?.type === "codeBlock"
  )

  // Without this the id would be "", and a block pointing at no scene reads as
  // an empty drawing the user never made.
  check(
    "an empty fence stays a code block",
    adoptDrawingFences([fence("drawing", "  ")])[0]?.type === "codeBlock"
  )

  const deep = adoptDrawingFences([
    { type: "bulletListItem", content: [], children: [fence("drawing", ID)] },
  ])
  check(
    "a fence nested under another block is adopted too",
    drawingIdsIn(deep).join() === ID
  )
}

section("mapDrawingIds")
{
  const source: NoteBlock[] = [
    text("keep me"),
    drawing(ID),
    { type: "bulletListItem", content: [], children: [drawing(OTHER)] },
  ]
  const copied = mapDrawingIds(source, (id) => `copy-${id}`)

  check(
    "every id is rewritten, nested ones included",
    drawingIdsIn(copied).join() === `copy-${ID},copy-${OTHER}`,
    drawingIdsIn(copied)
  )
  check(
    "the original is untouched",
    drawingIdsIn(source).join() === `${ID},${OTHER}`
  )
  check(
    "everything else survives the copy",
    copied[0]?.type === "paragraph" && copied.length === source.length
  )
}

finish()
