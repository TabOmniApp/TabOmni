import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import {
  ArrowUp,
  AtSign,
  Eye,
  Map,
  MessageCircleQuestion,
  Paperclip,
  PencilLine,
  Plus,
  ShieldOff,
  Signal,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Sparkles,
  Square,
  Check as CheckIcon,
} from "lucide-react"

import {
  CHAT_EFFORTS,
  CHAT_MODELS,
  CHAT_PERMISSIONS,
  DEFAULT_CHAT_OPTIONS,
  type ChatEffort,
  type ChatPermission,
  type WorktreeChatOptions,
} from "@shared/api"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { relativeTo } from "@/lib/files/paths"
import { cn } from "@/lib/utils"
import { chatMentions, primeMentions } from "@/lib/worktree-chat/mentions"
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
} from "@/lib/worktree-chat/mention-text"
import { IconButton } from "../icon-button"

/**
 * A chat's composer, with an `@` menu over the workspace's panels.
 *
 * The turn already has the panels' tools — a chat is started with whichever of
 * the Database, API and Notes MCP servers are switched on — so a mention here is
 * only the name: `list_tables`, `get_request` and `read_note` all take one, and
 * a name is something the agent can look up when it needs to rather than a copy
 * of a schema that was true when the message was typed. There was a composer
 * whose `@` pasted the context in, because its CLI could see nothing but the
 * prompt; see `lib/worktree-chat/mention-text.ts` for why this one does not.
 *
 * The tint is drawn *behind* the text by a mirror of it, rather than by making
 * this a rich-text editor: the message is plain text on the wire and in the
 * transcript, and a Milkdown instance in a pane this narrow would be a document
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
// The send button used to sit on top of the text, which is what `pr-10` was
// holding room for; it is in the toolbar under the field now, so the text has
// the whole width back.
const FIELD = "px-2.5 pt-2 pb-1 text-xs leading-relaxed md:text-xs"

/** The hue each kind is known by — the section's own tokens, so a mention reads
 * as belonging to that panel here and on its icon. A database and one of its
 * tables share one: they are the same panel. */
const KIND_HUE: Record<PlainMentionKind, string> = {
  database: "var(--section-database)",
  table: "var(--section-database)",
  request: "var(--section-api)",
  note: "var(--section-note)",
}

export function ChatComposer({
  sending,
  onSend,
  onStop,
  placeholder = "Ask about this checkout…",
  options = DEFAULT_CHAT_OPTIONS,
  onOptions,
  attachRoot,
}: {
  sending: boolean
  onSend: (text: string) => void
  onStop: () => void
  placeholder?: string
  /** What the toolbar under the field is showing. */
  options?: WorktreeChatOptions
  /**
   * A whole new set of them, on every change.
   *
   * Whole rather than a patch all the way down to the record — see
   * `WorktreeChatOptions`. Optional so the composer still draws without an
   * owner for the toolbar, in which case it is left off.
   */
  onOptions?: (options: WorktreeChatOptions) => void
  /**
   * The checkout the chat is in: where the file picker opens, and what a picked
   * path is written relative to.
   *
   * A path in a message is for the agent to read, and its cwd is this
   * directory — so `src/main/ipc.ts` is both shorter than the absolute path and
   * the thing the agent would have typed itself.
   */
  attachRoot?: string
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

    const items = rankPlainMentions(chatMentions(), query.filter).slice(
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

  /**
   * Files chosen in the OS picker, written into the draft at the caret.
   *
   * Plain text rather than a mention, and for the same reason the `@` menu
   * inserts a name: the turn runs in this checkout with `Read`, so a path is
   * already something the agent can open. There is nothing to attach it *to* —
   * print mode takes a prompt, not an upload.
   */
  async function attach() {
    const picked = await window.desktop.pickFiles(attachRoot).catch(() => [])
    if (picked.length === 0) return

    const element = field.current
    const caret = element?.selectionStart ?? draft.length
    const written = picked
      .map((path) => (attachRoot ? relativeTo(attachRoot, path) : path))
      .join(" ")

    // Spaced off whatever is already there, so a path does not run into the end
    // of a sentence somebody was in the middle of.
    const before = draft.slice(0, caret)
    const after = draft.slice(caret)
    const lead = before && !/\s$/.test(before) ? " " : ""
    const tail = after && !/^\s/.test(after) ? " " : ""
    const insertion = `${lead}${written}${tail}`

    pending.current = caret + insertion.length
    setDraft(before + insertion + after)
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

    // The `+` menu's own shortcut, answered here rather than by the window: it
    // is about this field's caret, and a chord bound globally would fire for
    // whichever chat is on screen.
    if ((event.metaKey || event.ctrlKey) && event.key === "u") {
      event.preventDefault()
      void attach()
      return
    }

    // Enter sends and ⇧Enter breaks the line, the way every chat box does.
    if (event.key !== "Enter" || event.shiftKey) return
    event.preventDefault()
    submit()
  }

  /** `@` typed for somebody, from the `+` menu: the menu that follows is the
   * one a typed `@` opens, since `refresh` is what decides it is a query. */
  function startMention() {
    const element = field.current
    const caret = element?.selectionStart ?? draft.length
    const before = draft.slice(0, caret)
    const lead = before && !/\s$/.test(before) ? " " : ""
    const next = `${before}${lead}@${draft.slice(caret)}`

    dismissed.current = false
    pending.current = caret + lead.length + 1
    setDraft(next)
    refresh(next, caret + lead.length + 1)
  }

  const segments = markMentions(draft, chatMentions())

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
        {/* The mirror is positioned against the field alone rather than against
            the whole box: `inset-0` used to be the box, and with a toolbar in it
            the tint behind the last line would have been drawn over the
            buttons. */}
        <div className="relative">
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
            {/* A draft ending in a newline would otherwise leave the mirror a
                line short of the textarea. */}
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
            placeholder={placeholder}
            className={cn(
              FIELD,
              "relative block field-sizing-content max-h-48 min-h-14 w-full resize-none",
              "bg-transparent outline-none placeholder:text-muted-foreground"
            )}
          />
        </div>

        {/* Inside the box rather than under it: these are properties of the
            message about to be sent, and a row of controls floating below the
            border reads as belonging to the pane. */}
        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          {onOptions && (
            <>
              <ModelMenu
                model={options.model}
                onPick={(model) => onOptions({ ...options, model })}
              />
              <EffortMenu
                effort={options.effort}
                onPick={(effort) => onOptions({ ...options, effort })}
              />
              <PermissionMenu
                permission={options.permission}
                onPick={(permission) => onOptions({ ...options, permission })}
              />
            </>
          )}

          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="Add to this message"
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground",
                      "transition-colors hover:bg-accent hover:text-foreground",
                      "data-[popup-open]:bg-accent data-[popup-open]:text-foreground"
                    )}
                  >
                    <Plus className="size-3.5" />
                  </button>
                }
              />
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => void attach()}>
                  <Paperclip />
                  Attach file
                  <span className="ml-auto text-[0.65rem] text-muted-foreground">
                    ⌘U
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={startMention}>
                  <AtSign />
                  Mention…
                  <span className="ml-auto text-[0.65rem] text-muted-foreground">
                    @
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

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
    </div>
  )
}

/**
 * One control in the composer's toolbar.
 *
 * A plain button rather than `IconButton`, which is icon-only and square: these
 * carry a word each, because "which model" and "how much effort" are not
 * questions a glyph answers. The tooltip is the `title` attribute for the same
 * reason — the label is already on screen, and a floating repeat of it is noise.
 *
 * **Everything it is not asked about goes to the button**, `ref` included, which
 * is what lets two of the three be a menu's trigger: Base UI clones the element
 * it is handed and passes it the trigger's own props, so a component that named
 * its props and dropped the rest would open its menu against no anchor at all.
 * See `IconButton`, which was written against the same failure.
 */
function ToolbarButton({
  icon,
  label,
  on,
  className,
  ...rest
}: {
  icon: ReactNode
  label: string
  /** A toggle that is on, or a picker with something chosen: either way the
   * control stops being the muted grey of one nobody has touched. */
  on?: boolean
} & ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[0.7rem]",
        "transition-colors hover:bg-accent hover:text-foreground",
        "data-[popup-open]:bg-accent data-[popup-open]:text-foreground",
        "[&_svg]:size-3.5 [&_svg]:shrink-0",
        on ? "text-foreground" : "text-muted-foreground",
        className
      )}
      {...rest}
    >
      {icon}
      {label}
    </button>
  )
}

/** `--model`, or the CLI's own. */
function ModelMenu({
  model,
  onPick,
}: {
  model: string | null
  onPick: (model: string | null) => void
}) {
  const chosen = CHAT_MODELS.find((entry) => entry.id === model)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ToolbarButton
            icon={<Sparkles />}
            label={chosen?.label ?? "Model"}
            title="Which model answers"
            on={model !== null}
          />
        }
      />
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem onClick={() => onPick(null)}>
          Default
          {model === null && <Check />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {CHAT_MODELS.map((entry) => (
          <DropdownMenuItem key={entry.id} onClick={() => onPick(entry.id)}>
            {entry.label}
            {model === entry.id && <Check />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** `--effort`. The icon fills up with the level, which is what the word beside
 * it means and the only part of it readable at a glance. */
function EffortMenu({
  effort,
  onPick,
}: {
  effort: ChatEffort | null
  onPick: (effort: ChatEffort | null) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ToolbarButton
            icon={<EffortIcon effort={effort} />}
            label={effort ? EFFORT_LABELS[effort] : "Effort"}
            title="How much thinking each turn gets"
            on={effort !== null}
          />
        }
      />
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem onClick={() => onPick(null)}>
          Default
          {effort === null && <Check />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {CHAT_EFFORTS.map((level) => (
          <DropdownMenuItem key={level} onClick={() => onPick(level)}>
            <EffortIcon effort={level} />
            {EFFORT_LABELS[level]}
            {effort === level && <Check />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The levels as a row says them — the CLI's own words, capitalised, since
 * `xhigh` is a flag value and not something to put in front of somebody. */
const EFFORT_LABELS: Record<ChatEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Very high",
  max: "Max",
}

function EffortIcon({ effort }: { effort: ChatEffort | null }) {
  if (effort === "low") return <SignalLow />
  if (effort === "medium") return <SignalMedium />
  if (effort === "high") return <SignalHigh />
  if (effort === null) return <Signal className="opacity-60" />
  // `xhigh` and `max` are both the full four bars: lucide has no fifth, and the
  // word beside it is what tells them apart.
  return <Signal />
}

/**
 * How much this chat's turns may do.
 *
 * One picker rather than the plan toggle it replaced plus a picker beside it:
 * plan mode *is* a permission — the read-only one, asked a particular way — and
 * two controls over one question can be put into a state neither means. It is
 * the only control here that never reads "Default", because there is no such
 * thing: a turn runs at whatever this says, and `Edits` is what it says until
 * somebody changes it.
 */
function PermissionMenu({
  permission,
  onPick,
}: {
  permission: ChatPermission
  onPick: (permission: ChatPermission) => void
}) {
  const chosen = PERMISSION_MARKS[permission] ?? PERMISSION_MARKS.edits

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ToolbarButton
            icon={<chosen.icon />}
            label={chosen.short}
            title={chosen.detail}
            on={permission !== "edits"}
            // The one mode that is worth spotting from across the pane: a chat
            // left on it approves whatever the next turn reaches for.
            className={permission === "full" ? "text-destructive" : undefined}
          />
        }
      />
      <DropdownMenuContent align="start" className="w-60">
        {CHAT_PERMISSIONS.map((entry) => {
          const mark = PERMISSION_MARKS[entry]
          return (
            <DropdownMenuItem
              key={entry}
              onClick={() => onPick(entry)}
              variant={entry === "full" ? "destructive" : undefined}
            >
              <mark.icon />
              <span className="flex min-w-0 flex-col">
                {mark.label}
                {/* The second line is the whole point of the menu being wider
                    than the others: "read only" and "full access" are the two
                    somebody has to be sure about before picking. */}
                <span className="text-[0.7rem] text-muted-foreground">
                  {mark.detail}
                </span>
              </span>
              {permission === entry && <Check />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** What each mode is called on the button, in the menu, and on the hover line.
 * The detail says what it *does*, since none of these four names are self
 * evident to somebody who has not read `PERMISSIONS`. */
const PERMISSION_MARKS: Record<
  ChatPermission,
  {
    label: string
    /** The toolbar has room for one word. */
    short: string
    detail: string
    icon: typeof Map
  }
> = {
  plan: {
    label: "Plan",
    short: "Plan",
    detail: "Reads, and answers with a plan. Changes nothing.",
    icon: Map,
  },
  read: {
    label: "Read only",
    short: "Read",
    detail: "Reads and answers. No edits, no shell.",
    icon: Eye,
  },
  ask: {
    label: "Ask",
    short: "Ask",
    detail: "Reads freely, and stops to ask before it writes or runs anything.",
    icon: MessageCircleQuestion,
  },
  edits: {
    label: "Edits",
    short: "Edits",
    detail: "Edits files and runs commands in this checkout.",
    icon: PencilLine,
  },
  full: {
    label: "Full access",
    short: "Full",
    detail: "Nothing is asked, including tools this app has not listed.",
    icon: ShieldOff,
  },
}

/** The tick a chosen row carries, pushed to the end. */
function Check() {
  return <CheckIcon className="ml-auto size-3 text-muted-foreground" />
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
      <Marks segments={markMentions(text, chatMentions())} visible />
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
              // panel.
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
      // Above the composer rather than at the caret: the composer is at the
      // bottom of the pane, so there is one place a menu fits.
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
                is inserted, and a connection beside it would push one of the two
                out of sight in a narrow pane. */}
            <span className="block truncate pl-[0.875rem] text-[0.7rem] text-muted-foreground">
              {mention.detail}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
