import { IS_MAC } from "@/components/studio/title-bar"

/**
 * Whether a keydown is one of the studio's own window shortcuts, and one it is
 * entitled to take.
 *
 * The three there are — `⌘P` for the search palette, `⌘W` for the tab strip,
 * `⌘S` for the Explorer's open file — agree on everything but the letter, and
 * are answered in the three places that know what they act on rather than in a
 * keymap here: the palette owns its own dialog, which tab is the current one is
 * only the strip's answer, and only the Explorer knows which file is on screen.
 * What they share is this predicate.
 *
 * `⌃` on macOS and `⌘` elsewhere are refused rather than ignored, so that
 * `⌃⌘W` — a chord something may yet be given — is not read as `⌘W` with a key
 * held down.
 */
export function isStudioShortcut(event: KeyboardEvent, key: string): boolean {
  if (event.repeat) return false
  if (event.key.toLowerCase() !== key) return false
  if (event.altKey || event.shiftKey) return false
  if (IS_MAC ? !event.metaKey || event.ctrlKey : !event.ctrlKey) return false
  if (!IS_MAC && event.metaKey) return false

  /*
   * Off macOS these are all `Ctrl`-, and the letters are readline's before
   * they are ours: `Ctrl+P` walks a shell's history, `Ctrl+W` deletes the word
   * behind the cursor and `Ctrl+S` stops the terminal's output. A session's terminal keeps them — the
   * editing keys of the thing running in the pty are not the studio's to take,
   * and there is no second way to press them. Nothing is given up on macOS,
   * where xterm never sends `⌘` to the process.
   */
  if (!IS_MAC && inTerminal(event.target)) return false

  return true
}

/** Whether the key was pressed inside a session's terminal, where xterm hands
 * it to the process. */
function inTerminal(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(".xterm") !== null
}
