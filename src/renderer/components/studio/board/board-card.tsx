import { useRef } from "react"
import {
  Loader2,
  MessageSquare,
  Pencil,
  ShieldQuestion,
  Trash2,
  Unlink,
  type LucideIcon,
} from "lucide-react"

import type { BoardCard as Card, WorktreeChat } from "@shared/api"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { dueOf, linkedChat, priorityOf, tagsOf } from "@/lib/board/cards"
import { useBoard } from "@/lib/board/store"
import { since } from "@/lib/worktree-chat/since"
import { useWorktreeChats } from "@/lib/worktree-chat/store"
import { cn } from "@/lib/utils"
import { IconButton } from "../icon-button"
import { DueLine, PriorityChip, TagChip } from "./card-chips"

/**
 * One card, and the whole of the link to a chat as the board sees it.
 *
 * Three bands, top to bottom, and the order is what a card is scanned for:
 * **what kind of work** (its tags and how urgent), **what the work is** (the
 * title, and a line of it), then **who is on it** (the chat, and when it last
 * moved). A card with none of the first band is just a title, which is what
 * most cards are and what they should still look like — every part below is
 * drawn only when it has something to say, so adding these fields costs a plain
 * card no height at all.
 *
 * The link is drawn as a **footer line** rather than a button: what somebody
 * wants off a glance at a board is which cards have an agent on them and which
 * are waiting, and that is a line of text per card, not a control per card. The
 * line is the click — it opens the chat — and everything else is on the menu.
 *
 * A card whose chat has been deleted says so and offers to start another
 * (`linkedChat` is null for exactly that), because the alternative is a footer
 * that opens nothing.
 */
export function BoardCardRow({
  card,
  edge,
  today,
  dragging,
  onEdit,
  onDragStart,
  onDragEnd,
}: {
  card: Card
  /**
   * The left border in its column's hue — `edge` from `BOARD_TONES`.
   *
   * Handed down rather than looked up here, because the column is what knows
   * its own tone and this component is drawn once per card: a card that resolved
   * the hue itself would be doing the lookup a column already did, and could
   * disagree with the header above it for a frame.
   */
  edge: string
  /** Today as `YYYY-MM-DD`, from the board — see `DueLine`. */
  today: string
  dragging: boolean
  onEdit: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const chats = useWorktreeChats((state) => state.chats)
  const sending = useWorktreeChats((state) => state.sending)

  const asks = useWorktreeChats((state) => state.asks)

  const chat = linkedChat(chats, card)
  const busy = chat ? sending.includes(chat.id) : false
  // A card whose chat is stopped on a question: the one state on this board
  // that is waiting on the reader rather than on the agent.
  const waiting = chat ? asks[chat.id] !== undefined : false
  // Named rather than resolved: a card pointing at a chat that has gone is a
  // different thing to say from a card that never had one.
  const lost = card.chatId !== null && chat === null

  const tags = tagsOf(card)
  const priority = priorityOf(card)
  const due = dueOf(card)
  const marks = tags.length > 0 || priority !== null

  function openChat(event: React.MouseEvent) {
    // The footer sits inside a card that opens on a click, and the two are
    // different destinations: the line names the chat, so it goes to the chat.
    event.stopPropagation()
    if (!chat) return
    useWorktreeChats.getState().select(chat.id)
  }

  const actions = cardActions(card, chat, onEdit)

  /**
   * Whether the press that is in progress landed on the menu button.
   *
   * A drag starts on the nearest **draggable ancestor**, and its `dragstart`
   * fires on that element whatever was actually pressed — so a child cannot
   * refuse the drag on its own, and pressing `⋯` and moving a few pixels
   * dragged the whole card out from under its own open menu. A ref rather than
   * state, because nothing about it is drawn and a re-render on every press of
   * a card would be a re-render nobody asked for.
   */
  const onMenu = useRef(false)

  const row = (
    <div
      draggable
      onDragStart={(event) => {
        if (onMenu.current) return event.preventDefault()
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      // One click, not two. It was a double click, which is a gesture nothing
      // announces and which no card on this board looked like it wanted; now
      // that opening a card is a drawer beside the board rather than a modal
      // over it, opening one is cheap enough to be the ordinary thing a click
      // does. A click is not fired after a drag, so this cannot be triggered by
      // letting a card go.
      onClick={onEdit}
      className={cn(
        "group/card cursor-grab rounded-md border border-border/60 bg-card px-2.5 py-2 text-left shadow-none transition-opacity",
        "hover:border-border",
        // The hue arrives as a thicker left edge, which is what carries the
        // column's colour down the column: a card dragged into the wrong one
        // reads as wrong without the header being in view.
        "border-l-2",
        edge,
        // Left in place at half strength while it is being carried, rather than
        // removed: a column that reflows under the cursor moves the gap the
        // card is aimed at.
        dragging && "opacity-40"
      )}
    >
      {/* The marks and the menu share a row, so a card with neither loses the
          row entirely rather than keeping an empty strip above its title. The
          menu is the exception that keeps it: it only appears under the
          pointer, and a row that existed for it alone would be one every card
          paid for. */}
      <div className={cn("flex items-start gap-1", marks && "mb-1.5")}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {tags.map((tag) => (
            <TagChip key={tag.toLowerCase()} tag={tag} />
          ))}
          {priority && <PriorityChip priority={priority} />}
        </div>

        {/* The span is the flag's home: `pointerdown` bubbles here from the
            button, which `dragstart` on the card would not tell us about. */}
        <span
          className="contents"
          // The card behind it opens on a click now, and the menu button is
          // inside the card: without this, every press of `⋯` would open the
          // drawer under its own menu.
          onClick={(event) => event.stopPropagation()}
          onPointerDown={() => {
            onMenu.current = true
          }}
          onPointerUp={() => {
            onMenu.current = false
          }}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <IconButton
                  label={`${card.title} card`}
                  // Hidden until the card is under the pointer or the menu is
                  // open, which is what keeps a column of cards free of a column
                  // of buttons. `focus-visible` too, or it could not be reached
                  // from the keyboard at all.
                  className="-mt-0.5 -mr-1 size-5 shrink-0 opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
                >
                  <span aria-hidden className="text-muted-foreground">
                    ⋯
                  </span>
                </IconButton>
              }
            />
            <DropdownMenuContent align="end" className="w-52">
              {actions.map((action, at) =>
                action === null ? (
                  <DropdownMenuSeparator key={`gap:${at}`} />
                ) : (
                  <DropdownMenuItem
                    key={action.label}
                    variant={action.destructive ? "destructive" : undefined}
                    onClick={action.run}
                  >
                    <action.icon
                      className={
                        action.destructive ? undefined : "text-muted-foreground"
                      }
                    />
                    {action.label}
                  </DropdownMenuItem>
                )
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      {/*
        `break-words` and a clamp, both because a title is typed rather than
        chosen from anything. A run with no spaces in it — a branch name, a URL,
        a path — is one unbreakable word to the browser, and it laid itself
        straight out through the card's right-hand edge and across the column
        beside it. Three lines rather than the body's two: the title is the
        thing being read, and the rest of it is in the drawer a click away.
      */}
      <p className="line-clamp-3 text-xs leading-snug font-medium break-words text-foreground">
        {card.title}
      </p>

      {card.body && (
        // Two lines at most. A card is a handle on a piece of work, and a board
        // whose cards each hold a paragraph is a board nobody can scan; the
        // whole text is in the drawer, one click away.
        <p className="mt-1 line-clamp-2 text-[0.6875rem] leading-snug break-words text-muted-foreground">
          {card.body}
        </p>
      )}

      {due && <DueLine due={due} today={today} className="mt-1.5" />}

      {(chat || lost) && (
        <button
          type="button"
          onClick={openChat}
          disabled={!chat}
          className={cn(
            // A rule above it, so the footer reads as the card's status line
            // rather than as a third paragraph of its text.
            "mt-2 flex w-full items-center gap-1 border-t border-border/60 pt-1.5 text-[0.6875rem] text-muted-foreground",
            chat && "hover:text-foreground"
          )}
        >
          {waiting ? (
            <ShieldQuestion className="size-3 shrink-0 animate-pulse text-primary" />
          ) : busy ? (
            <Loader2 className="size-3 shrink-0 animate-spin" />
          ) : (
            <MessageSquare className="size-3 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">
            {chat ? chat.title : "Chat deleted"}
          </span>
          {/* What the age says is whether the agent is still on this, which is
              the question a board is being read for. `tabular-nums` for the
              reason the projects column uses it: a column of ages that shifts
              by a digit reads as the board twitching. */}
          {chat && (
            <span className="shrink-0 tabular-nums">
              {busy ? "now" : since(chat.updatedAt)}
            </span>
          )}
        </button>
      )}
    </div>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger render={row} />
      <ContextMenuContent className="w-52">
        {actions.map((action, at) =>
          action === null ? (
            <ContextMenuSeparator key={`gap:${at}`} />
          ) : (
            <ContextMenuItem
              key={action.label}
              variant={action.destructive ? "destructive" : undefined}
              onClick={action.run}
            >
              <action.icon
                className={
                  action.destructive ? undefined : "text-muted-foreground"
                }
              />
              {action.label}
            </ContextMenuItem>
          )
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** One entry of a card's menu, or `null` for a rule between two groups. */
type CardAction = {
  label: string
  icon: LucideIcon
  run: () => void
  destructive?: boolean
} | null

/**
 * What a card's menu offers — described once, drawn twice.
 *
 * The card is reachable two ways: a right click anywhere on it, and the `⋯`
 * that appears under the pointer. Those are two different menu components with
 * the same items, and the first cut wrote the items out in both — which lasted
 * exactly until an item was added to one of them. So the items are data here,
 * and each menu is a `map`.
 */
function cardActions(
  card: Card,
  chat: WorktreeChat | null,
  onEdit: () => void
): CardAction[] {
  const board = () => useBoard.getState()
  return [
    { label: "Edit card", icon: Pencil, run: onEdit },
    null,
    chat
      ? {
          label: "Open chat",
          icon: MessageSquare,
          run: () => useWorktreeChats.getState().select(chat.id),
        }
      : {
          label: "Start chat from this card",
          icon: MessageSquare,
          run: () => void board().startChat(card.id),
        },
    // Unlinks the card, and leaves the conversation alone: the chat is its own
    // thing on disk, and a board is not where one gets deleted.
    card.chatId
      ? {
          label: "Unlink chat",
          icon: Unlink,
          run: () => board().unlink(card.id),
        }
      : null,
    null,
    {
      label: "Delete card",
      icon: Trash2,
      run: () => board().remove(card.id),
      destructive: true,
    },
  ].filter(
    // Two nulls in a row would be two rules with nothing between them, which is
    // what an absent `Unlink` leaves behind.
    (action, at, all) => action !== null || all[at - 1] !== null
  ) as CardAction[]
}
