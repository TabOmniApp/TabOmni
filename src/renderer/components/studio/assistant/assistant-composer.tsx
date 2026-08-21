import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { ArrowUp, Square } from "lucide-react"

import { cn } from "@/lib/utils"
import { assistantMentions, primeMentions } from "@/lib/assistant/mentions"
import {
  insertMention,
  markMentions,
  mentionQuery,
  rankPlainMentions,
  PLAIN_LABELS,
  type MentionQuery,
  type MentionSegment,
  type PlainMention,
  type PlainMentionKind,
} from "@/lib/assistant/mention-text"
import { IconButton } from "../icon-button"

/**
 * The assistant's composer, with an `@` menu over the other panels.
 *
 * The panel already has the panels' tools — a chat is started with whichever of
 * the Database, API and Notes MCP servers are switched on — so a mention here is
 * only the name: `list_tables`, `get_request` and `read_note` all take one, and
 * a name is something the agent can look up when it needs to rather than a copy
 * of a schema that was true when the message was typed. That is the whole
 * difference from the chat composer's `@`, whose CLI can see nothing but the
 * prompt and therefore gets the context pasted in. See
 * `lib/assistant/mention-text.ts`.
 *
 * The tint is drawn *behind* the text by a mirror of it, rather than by making
 * this a rich-text editor: the message is plain text on the wire and in the
 * transcript, and a Milkdown instance in a panel this narrow would be a document
 * model to keep in step for a decoration. The mirror is why the two share
 * `FIELD` — one class list, so one layout.
 */

/** Rows past this are a keystroke away from a shorter list. */
const MAX_ROWS = 40

/**
 * Everything that decides where a character lands, on both the textarea and the
 * mirror behind it. The font size is pinned at every breakpoint because the ui
 * `Textarea`'s own `md:text-sm` would move one of the two and not the other.
 */
const FIELD = "px-2.5 py-2 pr-10 text-xs leading-relaxed md:text-xs"

/** The hue each kind is known by — the rail's own tokens, so a mention reads as
 * belonging to that panel here, in the chat composer and on the icon. A database
 * and one of its tables share one: they are the same panel. */
const KIND_HUE: Record<PlainMentionKind, string> = {
  database: "var(--section-database)",
  table: "var(--section-database)",
  request: "var(--section-api)",
  note: "var(--section-note)",
}

export function AssistantComposer({
  sending,
  onSend,
  onStop,
}: {
  sending: boolean
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [draft, setDraft] = useState("")
  const [menu, setMenu] = useState<{
    query: MentionQuery
    items: PlainMention[]
    selected: number
  } | null>(null)

  const field = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  /** Where the caret has to be put once a pick has re-rendered the value. */
  const pending = useRef<number | null>(null)
  /** Set by Escape and cleared once the caret leaves the query, so a dismissed
   * menu stays dismissed for this word rather than for ever. */
  const dismissed = useRef(false)

  // The panels this menu reads load lazily, so the first `@` of a launch would
  // otherwise offer a workspace that looks empty.
  useEffect(primeMentions, [])

  useEffect(() => {
    const caret = pending.current
    if (caret === null) return
    pending.current = null
    field.current?.focus()
    field.current?.setSelectionRange(caret, caret)
  }, [draft])

  function refresh(text: string, caret: number) {
    const query = mentionQuery(text, caret)
    if (!query) {
      dismissed.current = false
      setMenu(null)
      return
    }
    if (dismissed.current) return

    const items = rankPlainMentions(assistantMentions(), query.filter).slice(
      0,
      MAX_ROWS
    )
    if (items.length === 0) {
      setMenu(null)
      return
    }
    setMenu((was) => ({
      query,
      items,
      selected:
        was && was.query.filter === query.filter
          ? Math.min(was.selected, items.length - 1)
          : 0,
    }))
  }

  function pick(mention: PlainMention) {
    const element = field.current
    if (!element || !menu) return
    const next = insertMention(
      draft,
      menu.query,
      element.selectionStart,
      mention.label
    )
    pending.current = next.caret
    setDraft(next.text)
    setMenu(null)
  }

  function submit() {
    if (!draft.trim() || sending) return
    onSend(draft)
    setDraft("")
    setMenu(null)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // While an IME candidate window is open every key belongs to it: on a
    // Vietnamese or Japanese keyboard the Enter that accepts a word would
    // otherwise pick a mention, and the arrows would walk this list instead of
    // the candidates.
    if (event.nativeEvent.isComposing) return

    // ⌘/Ctrl chords belong to the window, and the menu answering one would take
    // a shortcut away while it happened to be open.
    if (menu && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const count = menu.items.length
      switch (event.key) {
        case "ArrowDown":
        case "ArrowUp": {
          const delta = event.key === "ArrowDown" ? 1 : -1
          setMenu({
            ...menu,
            selected: (menu.selected + delta + count) % count,
          })
          event.preventDefault()
          return
        }
        case "Enter":
        case "Tab": {
          const mention = menu.items[menu.selected]
          if (!mention) break
          pick(mention)
          event.preventDefault()
          return
        }
        case "Escape":
          dismissed.current = true
          setMenu(null)
          event.preventDefault()
          return
      }
    }

    // Enter sends and ⇧Enter breaks the line, the way every chat box does.
    if (event.key !== "Enter" || event.shiftKey) return
    event.preventDefault()
    submit()
  }

  const segments = markMentions(draft, assistantMentions())

  return (
    <div className="relative">
      {menu && (
        <MentionMenu
          items={menu.items}
          selected={menu.selected}
          onSelect={pick}
          onHover={(selected) => setMenu({ ...menu, selected })}
        />
      )}

      {/* The box's border, background and focus ring are the wrapper's rather
          than the textarea's: the textarea has to be transparent for the tint
          behind it to show through, and a background of its own would wash it
          out in dark mode. */}
      <div
        className={cn(
          "relative rounded-lg border border-input transition-colors dark:bg-input/30",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
        )}
      >
        <div
          ref={mirror}
          aria-hidden
          className={cn(
            FIELD,
            "pointer-events-none absolute inset-0 overflow-hidden",
            "break-words whitespace-pre-wrap text-transparent select-none"
          )}
        >
          <Marks segments={segments} />
          {/* A draft ending in a newline would otherwise leave the mirror a line
              short of the textarea. */}
          {"\n"}
        </div>

        <textarea
          ref={field}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            refresh(event.target.value, event.target.selectionStart)
          }}
          // A click or an arrow key can move the caret out of a query — or into
          // one — without changing a character.
          onSelect={(event) => {
            const element = event.currentTarget
            refresh(element.value, element.selectionStart)
          }}
          onScroll={(event) => {
            if (mirror.current)
              mirror.current.scrollTop = event.currentTarget.scrollTop
          }}
          onKeyDown={onKeyDown}
          rows={3}
          spellCheck={false}
          placeholder="Ask about this workspace…"
          className={cn(
            FIELD,
            "relative block field-sizing-content max-h-48 min-h-16 w-full resize-none",
            "bg-transparent outline-none placeholder:text-muted-foreground"
          )}
        />

        <div className="absolute right-1.5 bottom-1.5">
          {sending ? (
            <IconButton label="Stop" variant="outline" onClick={onStop}>
              <Square />
            </IconButton>
          ) : (
            <IconButton
              label="Send"
              variant="outline"
              disabled={!draft.trim()}
              onClick={submit}
            >
              <ArrowUp />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * A message's own text with its mentions tinted — the same marks the composer
 * showed while it was being typed, so a sent line still reads as pointing at a
 * table rather than mentioning one in passing.
 */
export function MentionText({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      <Marks segments={markMentions(text, assistantMentions())} visible />
    </span>
  )
}

/**
 * The runs, tinted by kind.
 *
 * `visible` is the difference between the two callers: the message renders the
 * text, and the composer's mirror renders only the tint, with the glyphs coming
 * from the real textarea sitting on top of it.
 */
function Marks({
  segments,
  visible,
}: {
  segments: MentionSegment[]
  visible?: boolean
}) {
  return (
    <>
      {segments.map((segment, index) =>
        // A run's only identity is where it sits in the text.
        segment.kind === null ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <span
            key={index}
            style={{
              // Tinted from the hue itself rather than a second token per
              // panel, the way the chat composer's chips are.
              backgroundColor: `color-mix(in oklab, ${KIND_HUE[segment.kind]} 16%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${KIND_HUE[segment.kind]} 28%, transparent)`,
              color: visible ? KIND_HUE[segment.kind] : undefined,
            }}
            className="rounded-[0.25rem] font-medium"
          >
            {segment.text}
          </span>
        )
      )}
    </>
  )
}

function MentionMenu({
  items,
  selected,
  onSelect,
  onHover,
}: {
  items: PlainMention[]
  selected: number
  onSelect: (mention: PlainMention) => void
  onHover: (index: number) => void
}) {
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    list.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" })
  }, [selected])

  return (
    <ul
      ref={list}
      // Above the composer rather than at the caret: the panel is narrow and the
      // composer is at the bottom of it, so there is one place a menu fits.
      className={cn(
        "absolute inset-x-0 bottom-full z-20 mb-1 max-h-64 overflow-y-auto overscroll-contain",
        "rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      )}
    >
      {items.map((mention, index) => (
        <li key={`${mention.kind}:${mention.label}`}>
          <button
            type="button"
            data-selected={index === selected}
            // Pointer *down*, not click: a click lands after the textarea has
            // lost focus, which is what hides the menu the row is in.
            onPointerDown={(event) => {
              event.preventDefault()
              onSelect(mention)
            }}
            onPointerEnter={() => onHover(index)}
            className={cn(
              "w-full rounded-sm px-2 py-1 text-left text-xs",
              index === selected && "bg-accent text-accent-foreground"
            )}
          >
            <span className="flex items-baseline gap-2">
              <span
                aria-hidden
                style={{ backgroundColor: KIND_HUE[mention.kind] }}
                className="mt-1 size-1.5 shrink-0 rounded-full"
              />
              <span className="truncate font-mono font-medium">
                {mention.label}
              </span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
                {PLAIN_LABELS[mention.kind]}
              </span>
            </span>
            {/* On its own line, and the reason the row has two: the name is what
                is inserted, and in a panel this narrow a connection beside it
                would push one of the two out of sight. */}
            <span className="block truncate pl-[0.875rem] text-[0.7rem] text-muted-foreground">
              {mention.detail}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
