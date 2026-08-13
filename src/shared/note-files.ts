/**
 * Where a picture dropped into a note lives, and what the note writes down for
 * it.
 *
 * A note's images are **files of the workspace's own**, one per upload under
 * `workspace/note-files/`, and the document holds a URL naming one. Not a data
 * URL inlined into the block: a note's body is rewritten on every pause in the
 * typing and travels across the bridge each time, so a photograph pasted into
 * one would be re-encoded, re-sent and re-written for the rest of that note's
 * life. Not a path into the user's own folders either — the file the picture
 * came from is theirs to move or delete, and a note is expected to still have
 * its picture afterwards. It is the same trade the drawings make: the note keeps
 * a reference, and the bytes are beside it.
 *
 * The URL is a scheme of this app's, served by `main/protocol.ts`, because both
 * sides have to be able to say what one means: the renderer puts it in an `img`
 * and Chromium fetches it, and the preview server — which renders the same
 * document in the main process, for a browser that has never heard of this
 * scheme — swaps it for the bytes inlined. That is why the shape lives here
 * rather than in either of them.
 */

/** Registered as a privileged scheme before the app is ready — see
 * `registerNoteFileScheme`. */
export const NOTE_FILE_SCHEME = "note-file"

/**
 * The host every note file URL carries.
 *
 * A standard scheme needs one, and it is a constant rather than the file's name
 * because a host is lower-cased and punycoded by the URL parser: a name that
 * became a filename after that trip would be a different name. So the name is a
 * path segment, where it survives being parsed.
 */
const NOTE_FILE_HOST = "workspace"

const PREFIX = `${NOTE_FILE_SCHEME}://${NOTE_FILE_HOST}/`

/** The URL a note holds for one of its files. */
export function noteFileUrl(fileName: string): string {
  return `${PREFIX}${encodeURIComponent(fileName)}`
}

/** The file a note's URL names, or null for any other URL — an image embedded
 * from the web, or a `data:` one pasted out of a browser, both of which the
 * note keeps as they are. */
export function noteFileNameOf(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith(PREFIX)) return null
  const name = decodeURIComponent(url.slice(PREFIX.length))
  return name || null
}
