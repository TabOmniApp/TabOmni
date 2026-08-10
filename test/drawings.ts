import { drawingIdsIn } from "../src/renderer/lib/note/drawings"
import { check, finish, section } from "./harness"

/**
 * Which drawings a note's markdown refers to.
 *
 * This is read back out of the text rather than tracked beside it, and what it
 * answers decides which `.excalidraw` files get deleted when a note is deleted
 * and which get copied when one is duplicated. Both directions are destructive
 * when it is wrong: miss an id and a duplicate shares its original's scenes, so
 * editing one changes the other; invent one and a delete takes a file that
 * belonged to a note nobody touched.
 */

const ID = "7c3f1a2e-5b6d-4a8f-9e21-1f0b3c4d5e6f"
const OTHER = "a1b2c3d4-0000-4111-8222-333344445555"

const fence = (id: string) => "```drawing\n" + id + "\n```"

section("what counts as a drawing")
{
  check(
    "a drawing block on its own",
    drawingIdsIn(fence(ID)).join() === ID,
    drawingIdsIn(fence(ID))
  )

  const note = `# Architecture\n\n${fence(ID)}\n\nprose in between\n\n${fence(OTHER)}\n`
  check(
    "every block in a note, in the order they appear",
    drawingIdsIn(note).join() === `${ID},${OTHER}`,
    drawingIdsIn(note)
  )

  // A note that was duplicated and never edited holds the same block twice; the
  // caller deletes and copies by this list, and doing either twice is a bug.
  check(
    "the same drawing twice counts once",
    drawingIdsIn(`${fence(ID)}\n\n${fence(ID)}`).join() === ID
  )

  check(
    "a note with no drawing has none",
    drawingIdsIn("# Just words").length === 0
  )
  check("an empty note has none", drawingIdsIn("").length === 0)
}

section("what does not")
{
  // The serializer writes exactly three backticks, but a note edited by hand or
  // by another editor may not — and a fence of four is still a fence.
  check(
    "a longer fence is still a drawing",
    drawingIdsIn("````drawing\n" + ID + "\n````").join() === ID
  )

  check(
    "another language is not a drawing",
    drawingIdsIn("```json\n" + ID + "\n```").length === 0
  )
  check(
    "a language that merely starts the same is not",
    drawingIdsIn("```drawings\n" + ID + "\n```").length === 0
  )
  check(
    "the word in prose is not",
    drawingIdsIn(`I put a drawing at ${ID} yesterday`).length === 0
  )
  check(
    "a fence with nothing in it names nothing",
    drawingIdsIn("```drawing\n\n```").length === 0
  )
}

section("what the serializer actually produces")
{
  // Milkdown writes the fence with no indentation and a trailing newline, and
  // this is the shape that has to keep working above all others.
  const written = "# Notes\n\n```drawing\n" + ID + "\n```\n\nAfter.\n"
  check("the real thing round-trips", drawingIdsIn(written).join() === ID, {
    written,
    found: drawingIdsIn(written),
  })

  // Windows line endings reach this the moment a note is edited outside the app.
  check(
    "CRLF is still read",
    drawingIdsIn("```drawing\r\n" + ID + "\r\n```\r\n").join() === ID
  )
}

finish()
