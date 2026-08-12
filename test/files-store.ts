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

const { useFiles, viewOf } = await import("../src/renderer/lib/files/store")

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

  finish()
}

await main()
