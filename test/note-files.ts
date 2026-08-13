import {
  mapNoteFileNames,
  noteFileNamesIn,
  type NoteBlock,
} from "../src/renderer/lib/note/blocks"
import {
  noteFileNamesIn as noteFileNamesInMain,
  withNoteFileUrls,
} from "../src/main/note-blocks"
import { noteFileNameOf, noteFileUrl } from "../src/shared/note-files"
import { check, finish, section } from "./harness"

/**
 * The pictures in a note: the URL the document holds, and the two walks that
 * read it.
 *
 * Worth a test of its own because the answer is spent in three places that fail
 * differently. Delete: the names a document holds decide which files go with the
 * note, so a missed name leaks a file and an invented one takes a picture out of
 * a note nobody touched. Duplicate: a name not rewritten is a file two notes
 * share, where deleting either blanks the other. Preview: a URL not swapped for
 * the bytes is a picture the browser cannot fetch, since the scheme is this
 * app's own.
 *
 * The last of those is why the walk exists twice — the renderer edits the
 * document and the main process renders it, and neither may import the other's
 * (`CLAUDE.md`). The URL they agree on is the shared half, so both are checked
 * against it here rather than each side being trusted to have read the same
 * file.
 */

const NAME = "7c3f1a2e-5b6d-4a8f-9e21-1f0b3c4d5e6f.png"
const OTHER = "a1b2c3d4-0000-4111-8222-333344445555.jpg"

const picture = (fileName: string): NoteBlock => ({
  type: "image",
  props: { url: noteFileUrl(fileName), name: "shape" },
})

const embedded = (url: string): NoteBlock => ({
  type: "image",
  props: { url },
})

section("the URL")
{
  check(
    "round-trips a name",
    noteFileNameOf(noteFileUrl(NAME)) === NAME,
    noteFileUrl(NAME)
  )
  check(
    "is not one of the workspace's for an embedded image",
    noteFileNameOf("https://example.test/logo.png") === null
  )
  check(
    "nor for a data URL pasted out of a browser",
    noteFileNameOf("data:image/png;base64,iVBORw0KGgo=") === null
  )
  check(
    "nor for a block that has no url at all",
    noteFileNameOf(undefined) === null
  )
  check(
    "and not for a lookalike host",
    noteFileNameOf(`note-file://elsewhere/${NAME}`) === null,
    `note-file://elsewhere/${NAME}`
  )
}

section("noteFileNamesIn")
{
  const note: NoteBlock[] = [
    { type: "paragraph", content: [{ type: "text", text: "before" }] },
    picture(NAME),
    embedded("https://example.test/logo.png"),
    {
      type: "bulletListItem",
      content: [],
      children: [picture(OTHER)],
    },
    // The same picture twice: one file, and it must not be deleted twice or
    // copied to two names on a duplicate.
    picture(NAME),
  ]

  check(
    "finds every one of the workspace's own, nested and once each",
    noteFileNamesIn(note).join() === `${NAME},${OTHER}`,
    noteFileNamesIn(note)
  )
  check(
    "and the main process's walk agrees",
    noteFileNamesInMain(note).join() === noteFileNamesIn(note).join(),
    noteFileNamesInMain(note)
  )
  check(
    "an embedded image is nobody's file",
    !noteFileNamesIn(note).some((name) => name.includes("example.test"))
  )
}

section("mapNoteFileNames")
{
  const source: NoteBlock[] = [
    picture(NAME),
    embedded("https://example.test/logo.png"),
    { type: "bulletListItem", content: [], children: [picture(OTHER)] },
  ]
  const copied = mapNoteFileNames(source, (name) => `copy-${name}`)

  check(
    "every name is rewritten, nested ones included",
    noteFileNamesIn(copied).join() === `copy-${NAME},copy-${OTHER}`,
    noteFileNamesIn(copied)
  )
  check(
    "the original is untouched",
    noteFileNamesIn(source).join() === `${NAME},${OTHER}`
  )
  check(
    "an embedded image is left as it was",
    copied[1]?.props?.url === "https://example.test/logo.png",
    copied[1]?.props?.url
  )
}

section("withNoteFileUrls")
{
  const source: NoteBlock[] = [
    picture(NAME),
    embedded("https://example.test/logo.png"),
    { type: "bulletListItem", content: [], children: [picture(OTHER)] },
  ]
  const resolved = withNoteFileUrls(
    source,
    new Map([[NAME, "data:image/png;base64,iVBORw0KGgo="]])
  )

  check(
    "swaps a picture that resolved",
    resolved[0]?.props?.url === "data:image/png;base64,iVBORw0KGgo=",
    resolved[0]?.props?.url
  )
  check("keeps the rest of its props", resolved[0]?.props?.name === "shape")
  check(
    "leaves one that did not, for the page to call missing",
    resolved[2]?.children?.[0]?.props?.url === noteFileUrl(OTHER),
    resolved[2]?.children?.[0]?.props?.url
  )
  check(
    "leaves an embedded image alone",
    resolved[1]?.props?.url === "https://example.test/logo.png"
  )
  check(
    "and does not touch the document it was handed",
    source[0]?.props?.url === noteFileUrl(NAME)
  )
}

finish()
