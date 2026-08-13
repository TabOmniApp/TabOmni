import type { Ctx } from "@milkdown/kit/ctx"
import type { PluginView } from "@milkdown/kit/prose/state"
import type { EditorView } from "@milkdown/kit/prose/view"
import { SlashProvider, slashFactory } from "@milkdown/kit/plugin/slash"
import { useEffect, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"

import { cn } from "@/lib/utils"
import {
  mentionHref,
  rankMentions,
  MENTION_LABELS,
  type Mention,
  type MentionKind,
} from "@/lib/terminal/mention-text"
import { mentions, primeMentions } from "@/lib/terminal/mentions"

/**
 * An `@` menu for the composer, offering what the other panels are holding: a
 * table with its columns, a saved request resolved against the active
 * environment, a mail the sink caught, a note.
 *
 * The same `@milkdown/plugin-slash` machinery as the `/` menu beside it — that
 * plugin is a "menu on a trigger character" and neither of its two uses here is
 * Crepe's own block menu. What differs is the trigger, the rows, and that
 * picking one inserts *context* rather than a command name.
 *
 * Like that menu, this one only ever types. Picking a row replaces the typed
 * `@query` with one line of text; nothing is sent, nothing is run, and a
 * mention of something stale is a line the user can see and delete.
 */

/** Rows past this are not worth drawing — a workspace with two hundred requests
 * is one more keystroke away from a useful list. */
const MAX_ROWS = 40

/**
 * `@` anywhere a word could start, rather than only at the beginning of the
 * message: unlike a slash command, a mention belongs mid-sentence ("why is
 * @users slow?"). The lookbehind is what keeps it out of an email address
 * typed into the prompt.
 */
const QUERY = /(?:^|\s)@([\w./:-]*)$/

/** The hue each kind is known by — the same tokens the rail uses, so a row
 * reads as belonging to that panel. */
const KIND_ACCENT: Record<MentionKind, string> = {
  table: "var(--section-database)",
  request: "var(--section-api)",
  mail: "var(--section-mail)",
  note: "var(--section-note)",
}

export const composerMention = slashFactory("COMPOSER_MENTION")

function MentionMenu({
  items,
  selected,
  onSelect,
  onHover,
}: {
  items: Mention[]
  selected: number
  onSelect: (mention: Mention) => void
  onHover: (index: number) => void
}) {
  const listRef = useRef<HTMLUListElement>(null)

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
      {items.map((mention, index) => (
        <li key={mention.id}>
          <button
            type="button"
            data-selected={index === selected}
            // Pointer *down*, not click, for the reason the `/` menu gives: a
            // click lands after the editor has lost focus, which is what hides
            // the menu the row is in.
            onPointerDown={(event) => {
              event.preventDefault()
              onSelect(mention)
            }}
            onPointerEnter={() => onHover(index)}
            className={cn(
              "flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
              index === selected && "bg-accent text-accent-foreground"
            )}
          >
            <span
              aria-hidden
              style={{ backgroundColor: KIND_ACCENT[mention.kind] }}
              className="mt-1 size-1.5 shrink-0 rounded-full"
            />
            <span className="shrink-0 font-mono font-medium">
              {mention.label}
            </span>
            <span className="truncate text-muted-foreground">
              {mention.detail}
            </span>
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
              {MENTION_LABELS[mention.kind]}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

class MentionView implements PluginView {
  readonly #content = document.createElement("div")
  readonly #provider: SlashProvider
  readonly #root: Root
  #view: EditorView
  #items: Mention[] = []
  #selected = 0
  /** What is typed after the `@` right now — also how wide the range is that
   * picking a row replaces. */
  #filter = ""
  #open = false
  /** Set by Escape, cleared once the text stops being a mention query, so a
   * dismissed menu stays dismissed for this word rather than for ever. */
  #dismissed = false

  constructor(view: EditorView) {
    this.#view = view
    // The panels this menu reads load lazily; asking here is what makes the
    // first `@` of a launch show anything.
    primeMentions()

    this.#content.className = "composer-slash-menu"
    this.#content.dataset.show = "false"
    this.#root = createRoot(this.#content)

    this.#provider = new SlashProvider({
      content: this.#content,
      debounce: 0,
      offset: 6,
      root: document.body,
      floatingUIOptions: { strategy: "fixed" },
      shouldShow: (candidate) => this.#shouldShow(candidate),
    })

    this.#provider.onShow = () => {
      this.#open = true
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
    const items = rankMentions(mentions(), filter).slice(0, MAX_ROWS)
    if (items.length === 0) return false

    if (filter !== this.#filter) this.#selected = 0
    this.#filter = filter
    this.#items = items
    this.#view = view
    this.#render()

    return true
  }

  #render() {
    this.#root.render(
      <MentionMenu
        items={this.#items}
        selected={this.#selected}
        onSelect={(mention) => this.#select(mention)}
        onHover={(index) => {
          this.#selected = index
          this.#render()
        }}
      />
    )
  }

  #move(delta: number) {
    const count = this.#items.length
    this.#selected = (this.#selected + delta + count) % count
    this.#render()
  }

  /**
   * Replaces the typed `@query` with the mention's chip — its name, carrying the
   * private href the send path expands — and a plain space after it.
   *
   * Nothing is read here: what the chip stands for is resolved when the message
   * is sent (`expandMentions`), which is what keeps a note's whole body out of
   * the composer. So this is synchronous again, and picking a row cannot fail.
   *
   * The space is inserted unmarked, which is also what stops the link mark from
   * continuing into whatever is typed next — the caret takes its marks from the
   * character before it.
   */
  #select(mention: Mention) {
    const { state } = this.#view
    const to = state.selection.from
    const from = Math.max(0, to - (this.#filter.length + "@".length))

    const link = state.schema.marks.link
    const chip = state.schema.text(
      mention.label,
      // No link mark in the schema is not a state Crepe's commonmark preset can
      // be in; the plain label is the honest fallback rather than a throw, and
      // the send path leaves it exactly as it reads.
      link ? [link.create({ href: mentionHref(mention) })] : undefined
    )

    this.#view.dispatch(
      state.tr.replaceWith(from, to, [chip, state.schema.text(" ")])
    )
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
        const mention = this.#items[this.#selected]
        if (!mention) return
        this.#select(mention)
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
    const root = this.#root
    queueMicrotask(() => root.unmount())
    this.#content.remove()
  }
}

/** Wires the menu into an editor. Nothing is passed in: every row is read from
 * the panels' own stores at the moment the menu is drawn. */
export function configureComposerMention(ctx: Ctx) {
  ctx.set(composerMention.key, {
    view: (view: EditorView) => new MentionView(view),
  })
}
