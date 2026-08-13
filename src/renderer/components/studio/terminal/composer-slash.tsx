import type { Ctx } from "@milkdown/kit/ctx"
import type { PluginView } from "@milkdown/kit/prose/state"
import type { EditorView } from "@milkdown/kit/prose/view"
import { SlashProvider, slashFactory } from "@milkdown/kit/plugin/slash"
import { useEffect, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"

import type { ClaudeSlashCommand, ClaudeSlashSource } from "@shared/api"
import { cn } from "@/lib/utils"

/**
 * A `/` menu for the composer, offering Claude Code's own commands and
 * skills (`electron/claude-commands.ts` is what finds them).
 *
 * Crepe ships a slash menu of its own, and this composer deliberately turns
 * it off (`chat-composer.tsx`): its entries insert *editor* blocks, which is
 * the wrong meaning for a `/` here entirely — what the person typing means
 * is the slash command of the CLI on the other end. This plugin puts that
 * meaning back on the key, reusing the same `@milkdown/plugin-slash`
 * machinery Crepe's own menu is built from.
 *
 * The menu only ever *types*: picking a row replaces the typed `/query` with
 * `/name `, and sending is still a separate, deliberate act. Nothing here
 * talks to the CLI, so a menu that has drifted from what the CLI actually
 * supports cannot do anything worse than compose a line it will reject.
 */

/** Rows past this are not worth drawing — a filter this loose is one more
 * keystroke away from being useful, and a list this long is not read. */
const MAX_ROWS = 40

/**
 * A slash command has to start the message, the same rule the CLI itself
 * applies — which is also what keeps the menu from firing inside ordinary
 * prose (`and/or`, a URL, a date).
 */
const QUERY = /^\/([A-Za-z0-9:_-]*)$/

/** What a row says about where it came from. */
const SOURCE_LABEL: Record<ClaudeSlashSource, string> = {
  builtin: "built-in",
  "project-command": "project",
  "user-command": "personal",
  "project-skill": "project skill",
  "user-skill": "skill",
}

export const claudeSlash = slashFactory("CLAUDE_SLASH")

/**
 * Orders `commands` by how well they answer `filter`: a name that starts
 * with it first, then a name that merely contains it, then a description
 * that does. Ties keep the caller's order, which is alphabetical.
 */
function rank(
  commands: ClaudeSlashCommand[],
  filter: string
): ClaudeSlashCommand[] {
  if (filter === "") return commands.slice(0, MAX_ROWS)

  const needle = filter.toLowerCase()
  const scored: { command: ClaudeSlashCommand; score: number }[] = []

  for (const command of commands) {
    const at = command.name.toLowerCase().indexOf(needle)
    if (at === 0) scored.push({ command, score: 0 })
    else if (at > 0) scored.push({ command, score: 1 })
    else if (command.description.toLowerCase().includes(needle))
      scored.push({ command, score: 2 })
  }

  return scored
    .sort((left, right) => left.score - right.score)
    .slice(0, MAX_ROWS)
    .map((entry) => entry.command)
}

function SlashMenu({
  items,
  selected,
  onSelect,
  onHover,
}: {
  items: ClaudeSlashCommand[]
  selected: number
  onSelect: (command: ClaudeSlashCommand) => void
  onHover: (index: number) => void
}) {
  const listRef = useRef<HTMLUListElement>(null)

  // Keyboard selection has to drag the list along with it; the pointer's
  // does not, and would fight the user's own scrolling if it did.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" })
  }, [selected])

  return (
    <ul
      ref={listRef}
      className="max-h-64 w-96 overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.map((command, index) => (
        <li key={`${command.source}:${command.name}`}>
          <button
            type="button"
            data-selected={index === selected}
            // Pointer *down*, not click: a click fires after the editor has
            // already lost focus to this button, and losing focus is exactly
            // what `SlashProvider` hides the menu on — the row would be gone
            // before its own click landed.
            onPointerDown={(event) => {
              event.preventDefault()
              onSelect(command)
            }}
            onPointerEnter={() => onHover(index)}
            className={cn(
              "flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
              index === selected && "bg-accent text-accent-foreground"
            )}
          >
            <span className="shrink-0 font-mono font-medium">
              /{command.name}
            </span>
            {command.argumentHint && (
              <span className="shrink-0 font-mono text-muted-foreground">
                {command.argumentHint}
              </span>
            )}
            <span className="truncate text-muted-foreground">
              {command.description}
            </span>
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
              {SOURCE_LABEL[command.source]}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

class ClaudeSlashView implements PluginView {
  readonly #content = document.createElement("div")
  readonly #root: Root
  readonly #provider: SlashProvider
  readonly #getCommands: () => ClaudeSlashCommand[]

  #view: EditorView
  #items: ClaudeSlashCommand[] = []
  #selected = 0
  /** What is typed after the slash right now — also how wide the range is
   * that picking a row replaces. */
  #filter = ""
  #open = false
  /** Set by Escape, cleared as soon as the block stops being a `/` query, so
   * a dismissed menu stays dismissed for the command being typed rather than
   * springing back on the next keystroke. */
  #dismissed = false

  constructor(view: EditorView, getCommands: () => ClaudeSlashCommand[]) {
    this.#view = view
    this.#getCommands = getCommands

    this.#content.className = "composer-slash-menu"
    // `SlashProvider` only sets this when it shows or hides; unset, the menu
    // would be on screen from the moment it is appended.
    this.#content.dataset.show = "false"
    this.#root = createRoot(this.#content)

    this.#provider = new SlashProvider({
      content: this.#content,
      debounce: 0,
      offset: 6,
      // Out to the body rather than beside the editor: the composer's own
      // scroll box (`chat-composer.tsx`) clips overflow, and a menu that
      // needs more room than a three-line text box has is the normal case,
      // not the exception. `fixed` is what keeps floating-ui's coordinates
      // right for an element parked there.
      root: document.body,
      floatingUIOptions: { strategy: "fixed" },
      shouldShow: (candidate) => this.#shouldShow(candidate),
    })

    this.#provider.onShow = () => {
      this.#open = true
      // Capture phase on the window, rather than a ProseMirror keymap: the
      // preset's own Enter and arrow bindings would otherwise get these
      // first, and split the paragraph instead of picking the row.
      window.addEventListener("keydown", this.#onKeyDown, { capture: true })
    }
    this.#provider.onHide = () => {
      this.#open = false
      window.removeEventListener("keydown", this.#onKeyDown, { capture: true })
    }
  }

  #shouldShow(view: EditorView): boolean {
    const text = this.#provider.getContent(view)
    const match = text == null ? null : QUERY.exec(text)

    if (!match) {
      this.#dismissed = false
      return false
    }
    if (this.#dismissed) return false

    const filter = match[1] ?? ""
    const items = rank(this.#getCommands(), filter)
    if (items.length === 0) return false

    // Editing the query invalidates where the highlight was: the row that was
    // second a keystroke ago is not the row that is second now.
    if (filter !== this.#filter) this.#selected = 0
    this.#filter = filter
    this.#items = items
    this.#view = view
    this.#render()

    return true
  }

  #render() {
    this.#root.render(
      <SlashMenu
        items={this.#items}
        selected={this.#selected}
        onSelect={(command) => this.#select(command)}
        onHover={(index) => {
          this.#selected = index
          this.#render()
        }}
      />
    )
  }

  #move(delta: number) {
    const count = this.#items.length
    // Wrapping, so holding ArrowDown at the bottom returns to the top rather
    // than sticking — the list is short and cyclic reads better than a wall.
    this.#selected = (this.#selected + delta + count) % count
    this.#render()
  }

  /**
   * Replaces the typed `/query` with the chosen command, leaving the caret
   * after a trailing space — ready for an argument when the command takes
   * one, and harmless when it does not.
   *
   * The completed text no longer matches `QUERY` (the space sees to that),
   * which is what closes the menu; nothing has to hide it explicitly.
   */
  #select(command: ClaudeSlashCommand) {
    const { state } = this.#view
    const to = state.selection.from
    const from = to - (this.#filter.length + "/".length)

    this.#view.dispatch(state.tr.insertText(`/${command.name} `, from, to))
    this.#view.focus()
  }

  #onKeyDown = (event: KeyboardEvent) => {
    if (!this.#open) return
    // Not a chord: ⌘/Ctrl+Enter is the composer's Send, and this handler runs on
    // the capture phase — unchecked, an open menu answered it by inserting
    // whatever row happened to be highlighted instead of sending the message.
    if (event.metaKey || event.ctrlKey || event.altKey) return

    switch (event.key) {
      case "ArrowDown":
        this.#move(1)
        break
      case "ArrowUp":
        this.#move(-1)
        break
      case "Enter":
      case "Tab": {
        const command = this.#items[this.#selected]
        if (!command) return
        this.#select(command)
        break
      }
      case "Escape":
        this.#dismissed = true
        this.#provider.hide()
        break
      default:
        return
    }

    event.preventDefault()
    event.stopPropagation()
  }

  update(view: EditorView, prevState?: Parameters<SlashProvider["update"]>[1]) {
    this.#view = view
    this.#provider.update(view, prevState)
  }

  destroy() {
    window.removeEventListener("keydown", this.#onKeyDown, { capture: true })
    this.#provider.destroy()
    // Unmounting a React root synchronously from inside a ProseMirror update
    // is what React warns about; the microtask defers it out of that frame.
    const root = this.#root
    queueMicrotask(() => root.unmount())
    this.#content.remove()
  }
}

/**
 * Wires the menu into an editor. `getCommands` is read on every keystroke
 * rather than captured, so the list can arrive (and be refreshed) long after
 * the editor was built.
 */
export function configureClaudeSlash(
  ctx: Ctx,
  getCommands: () => ClaudeSlashCommand[]
) {
  ctx.set(claudeSlash.key, {
    view: (view: EditorView) => new ClaudeSlashView(view, getCommands),
  })
}
