import { check, finish, section } from "./harness"

/**
 * The Explorer's store, and what it reads when.
 *
 * Written for a bug that shipped: a reload put the picture tabs back but left
 * the pane on "Reading…" until something else happened to open them. `restore`
 * read every remembered tab as *text*, which for a PNG comes back "binary" —
 * enough to keep the tab and nothing the image view could draw. The half a tab
 * needs depends on how it will be shown, and that is what these check.
 *
 * The store is a renderer module, so `window.desktop` is stubbed here rather
 * than mocked over: the bridge is a plain object of functions, and a stub of it
 * is a smaller thing than a fake of the store. Everything below the stub — the
 * viewer rules, the reads, the way the two halves are kept apart — is the real
 * module.
 */

/** What the fake bridge was asked for, so "did it read this twice" is a
 * question the test can put. */
const calls = { image: [] as string[], text: [] as string[] }

const remembered = {
  openIds: ["/w/logo.png", "/w/notes.md", "/w/gone.png"],
  selectedId: "/w/logo.png",
}

;(globalThis as { window?: unknown }).window = {
  desktop: {
    getSetting: async (key: string) =>
      key === "files.tabs" ? JSON.stringify(remembered) : null,
    setSetting: async () => {},
    readImageFile: async (filePath: string) => {
      calls.image.push(filePath)
      if (filePath.includes("gone")) throw new Error("ENOENT")
      return `data:image/png;base64,${filePath.length}`
    },
    readTextFile: async (filePath: string) => {
      calls.text.push(filePath)
      return { kind: "text", text: `text of ${filePath}` }
    },
  },
}

const { isDeleted, useFiles, viewOf } =
  await import("../src/renderer/lib/files/store")
const { keepSelected } = await import("../src/renderer/lib/files/changes")

async function main() {
  section("restore")

  await useFiles.getState().restore()
  const restored = useFiles.getState()

  check(
    "a remembered picture comes back with its picture read",
    restored.images["/w/logo.png"]?.kind === "image",
    restored.images["/w/logo.png"]
  )
  check(
    "and was never read as text on the way",
    !calls.text.includes("/w/logo.png"),
    calls.text
  )
  check(
    "a remembered text file comes back as text",
    restored.docs["/w/notes.md"]?.kind === "text",
    restored.docs["/w/notes.md"]
  )
  check(
    "a file that no longer reads is dropped from the strip",
    !restored.openIds.includes("/w/gone.png"),
    restored.openIds
  )
  check(
    "the rest of the strip survives it",
    restored.openIds.join() === "/w/logo.png,/w/notes.md",
    restored.openIds
  )
  check(
    "and the selected tab is the remembered one",
    restored.selectedId === "/w/logo.png"
  )

  section("ensureLoaded")

  const before = calls.image.length
  await useFiles.getState().ensureLoaded("/w/logo.png", "image")
  check(
    "asking for something already held reads nothing",
    calls.image.length === before,
    "the pane asks on every mount; it must be free when there is nothing to do"
  )

  section("two halves of an SVG")

  await useFiles.getState().open("/w/icon.svg")
  check(
    "an SVG opens as a picture",
    viewOf(useFiles.getState(), "/w/icon.svg") === "image" &&
      useFiles.getState().images["/w/icon.svg"]?.kind === "image"
  )
  check(
    "and is not read as text until it is asked for",
    !calls.text.includes("/w/icon.svg")
  )

  await useFiles.getState().setView("/w/icon.svg", "text")
  const both = useFiles.getState()
  check(
    "switching to the editor reads the other half",
    both.docs["/w/icon.svg"]?.kind === "text",
    both.docs["/w/icon.svg"]
  )
  check(
    "and keeps the first one",
    both.images["/w/icon.svg"]?.kind === "image",
    "switching back must not re-read what is already here"
  )

  const images = calls.image.length
  await useFiles.getState().setView("/w/icon.svg", "image")
  check(
    "switching back reads nothing at all",
    calls.image.length === images,
    calls.image
  )

  section("the All changes tab's selection")

  /*
   * The case worth a test: a commit made in the dock's shell empties the list
   * under a tab that is showing one of its files, and a selection left pointing
   * into it is a diff of a file with nothing left to diff.
   */
  const change = (path: string) => ({
    path,
    state: "modified" as const,
    added: 1,
    removed: 0,
  })

  check(
    "a file still in the list stays selected",
    keepSelected({ r1: "/w/a.ts" }, "r1", [change("/w/a.ts")]).r1 === "/w/a.ts"
  )

  check(
    "a file that has stopped being a change is dropped",
    keepSelected({ r1: "/w/a.ts" }, "r1", [change("/w/b.ts")]).r1 === null
  )

  check(
    "an emptied list drops it too",
    keepSelected({ r1: "/w/a.ts" }, "r1", []).r1 === null
  )

  check(
    "another root's selection is left alone",
    keepSelected({ r1: "/w/a.ts", r2: "/w/c.ts" }, "r1", []).r2 === "/w/c.ts",
    "one tab per checkout, and they are read one at a time"
  )

  check(
    "nothing selected is nothing to drop, and the record comes back as it was",
    (() => {
      const before = { r1: null }
      return keepSelected(before, "r1", []) === before
    })(),
    "the same object, so a re-read cannot look like a change to React"
  )

  section("what makes a tab say deleted")

  /*
   * The bug this is written for: a file an agent had just created was opened
   * from the Changes list, git had it as `U`, and the tab said `deleted` —
   * because the listing the tree held had been read before the file existed.
   */
  const listing = {
    entries: {
      "/w": [
        { name: "kept.ts", path: "/w/kept.ts", kind: "file" as const },
        { name: "edited.ts", path: "/w/edited.ts", kind: "file" as const },
      ],
    },
  }

  check(
    "git saying deleted is enough on its own",
    isDeleted("deleted", listing, "/w/kept.ts")
  )

  check(
    "a file git currently calls untracked exists, whatever a stale listing says",
    !isDeleted("untracked", listing, "/w/fresh.ts"),
    "the listing was read before the file was written"
  )

  check(
    "and so does one it calls added",
    !isDeleted("added", listing, "/w/fresh.ts")
  )

  check(
    "a listing that has stopped mentioning a file git says nothing about",
    isDeleted(null, listing, "/w/gone.ts"),
    "an untracked file deleted: git stops reporting it, so only the tree knows"
  )

  check(
    "a tracked file with no changes is neither",
    !isDeleted(null, listing, "/w/kept.ts")
  )

  check(
    "a directory nothing has read says nothing either way",
    !isDeleted(null, { entries: {} }, "/elsewhere/unknown.ts"),
    "a tab must not be labelled gone for never having been looked for"
  )

  finish()
}

await main()
