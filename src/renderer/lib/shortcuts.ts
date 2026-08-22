import { IS_MAC } from "@/components/studio/title-bar"

/**
 * Whether a keydown is one of the studio's own window shortcuts, and one it is
 * entitled to take.
 *
 * The four there are — `⌘P` for the search palette, `⌘W` for the tab strip,
 * `⌘S` for the Explorer's open file, `⌘B` for the sidebar — agree on everything
 * but the letter, and are answered in the four places that know what they act
 * on rather than in a keymap here: the palette owns its own dialog, which tab is
 * the current one is only the strip's answer, only the Explorer knows which file
 * is on screen, and the sidebar is the workbench's own. What they share is this
 * predicate.
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
   * behind the cursor and `Ctrl+S` stops the terminal's output. The dock's
   * shell keeps them — the editing keys of the thing running in the pty are not
   * the studio's to take, and there is no second way to press them. Nothing is given up on macOS,
   * where xterm never sends `⌘` to the process.
   */
  if (!IS_MAC && inTerminal(event.target)) return false

  return true
}

/** Whether the key was pressed inside a terminal, where xterm hands it to the
 * process. */
function inTerminal(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(".xterm") !== null
}

/**
 * Whether the caret is in a rich-text editor, where `⌘B` is bold.
 *
 * The one shortcut that has to ask. `⌘P`, `⌘W` and `⌘S` mean nothing to
 * ProseMirror, but `⌘B` is bold in every editor there has ever been — and this
 * studio has three of them on screen at once: a note, a `.md` opened in the
 * block editor, and the chat composer. Taking the key on the capture phase
 * would take it *before* the editor saw it, so a note would have no way to bold
 * a word. The sidebar has a menu item, a rail click and a second way in;
 * bolding text does not.
 *
 * Asked of the element rather than of the editor libraries: `contenteditable`
 * is what they all have in common, and it is also true of anything else that
 * accepts rich text, which is the right answer for those too. A plain `<input>`
 * or Monaco is not one — neither does anything with `⌘B` — so the sidebar keeps
 * the key while a name is being typed or a file edited, exactly as it does in
 * the editor this borrows the shortcut from.
 */
export function isEditingRichText(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.isContentEditable
}
