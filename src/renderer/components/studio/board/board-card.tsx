import { Loader2, MessageSquare, Pencil, Trash2, Unlink } from "lucide-react"

import type { BoardCard as Card } from "@shared/api"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { linkedChat } from "@/lib/board/cards"
import { useBoard } from "@/lib/board/store"
import { since } from "@/lib/worktree-chat/since"
import { useWorktreeChats } from "@/lib/worktree-chat/store"
import { cn } from "@/lib/utils"

/**
 * One card, and the whole of the link to a chat as the board sees it.
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
  dragging: boolean
  onEdit: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const chats = useWorktreeChats((state) => state.chats)
  const sending = useWorktreeChats((state) => state.sending)

  const chat = linkedChat(chats, card)
  const busy = chat ? sending.includes(chat.id) : false
  // Named rather than resolved: a card pointing at a chat that has gone is a
  // different thing to say from a card that never had one.
  const lost = card.chatId !== null && chat === null

  function openChat() {
    if (!chat) return
    useWorktreeChats.getState().select(chat.id)
  }

  const row = (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDoubleClick={onEdit}
      className={cn(
        "cursor-grab rounded-md border border-border/60 bg-card px-2.5 py-2 text-left shadow-none transition-opacity",
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
      <p className="text-xs leading-snug font-medium text-foreground">
        {card.title}
      </p>

      {card.body && (
        // Two lines at most. A card is a handle on a piece of work, and a board
        // whose cards each hold a paragraph is a board nobody can scan; the
        // whole text is in the dialog behind a double click.
        <p className="mt-1 line-clamp-2 text-[0.6875rem] leading-snug text-muted-foreground">
          {card.body}
        </p>
      )}

      {(chat || lost) && (
        <button
          type="button"
          onClick={openChat}
          disabled={!chat}
          className={cn(
            "mt-1.5 flex w-full items-center gap-1 text-[0.6875rem] text-muted-foreground",
            chat && "hover:text-foreground"
          )}
        >
          {busy ? (
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
        <ContextMenuItem onClick={onEdit}>
          <Pencil />
          Edit card
        </ContextMenuItem>
        <ContextMenuSeparator />
        {chat ? (
          <ContextMenuItem onClick={openChat}>
            <MessageSquare className="text-muted-foreground" />
            Open chat
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            onClick={() => void useBoard.getState().startChat(card.id)}
          >
            <MessageSquare className="text-muted-foreground" />
            Start chat from this card
          </ContextMenuItem>
        )}
        {card.chatId && (
          // Unlinks the card, and leaves the conversation alone: the chat is
          // its own thing on disk, and a board is not where one gets deleted.
          <ContextMenuItem onClick={() => useBoard.getState().unlink(card.id)}>
            <Unlink />
            Unlink chat
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => useBoard.getState().remove(card.id)}
        >
          <Trash2 />
          Delete card
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
