import { Check, ChevronDown, Columns3 } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cardOfChat, cardsOf, columnOf, columnsOf } from "@/lib/board/cards"
import { useBoard } from "@/lib/board/store"
import { BOARD_TONES, toneOf } from "@/lib/board/tones"
import { cn } from "@/lib/utils"

/**
 * The card this chat is the work of, over the transcript — the link read from
 * the chat's side.
 *
 * Nothing at all when no card names this chat, which is most chats: a bar
 * reading "not on the board" over every conversation would be a row of nothing
 * happening. So this renders `null` rather than an empty state, and the pane
 * simply has no strip in it.
 *
 * The column is changeable **here** because that is where the answer is known:
 * somebody finishes reading a turn and knows the card is done, and the
 * alternative is switching to the board to drag a card whose chat they were
 * just in. Moving it to the foot of the column it goes to — index past the end,
 * which `moveCard` lands last — since a card arriving in `Doing` from a chat is
 * not jumping the queue of what was already being worked on.
 */
export function ChatCardChip({ chatId }: { chatId: string }) {
  const cards = useBoard((state) => state.cards)
  const allColumns = useBoard((state) => state.columns)

  const card = cardOfChat(cards, chatId)
  if (!card) return null

  // Through `columnOf`, so a card whose column was deleted names the one it is
  // actually drawn in rather than a stale id nobody can see.
  const columns = columnsOf(allColumns, card.folderId)
  const here = columnOf(allColumns, card)
  const tone = BOARD_TONES[toneOf(here?.tone ?? "slate")]

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5">
      <Columns3 className="size-3.5 shrink-0 text-muted-foreground" />
      <span
        className="min-w-0 flex-1 truncate text-xs text-foreground"
        title={card.body || card.title}
      >
        {card.title}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              title="Which column this card is in"
              className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {/* The column's own hue, so the chip says which column at a
                  glance and in the same colour the board draws it. */}
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", tone.dot)}
              />
              {here?.name ?? "Board"}
              <ChevronDown className="size-3" />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-44">
          {columns.map((column) => (
            <DropdownMenuItem
              key={column.id}
              onClick={() => {
                if (column.id === here?.id) return
                useBoard
                  .getState()
                  .move(
                    card.id,
                    column.id,
                    cardsOf(cards, allColumns, card.folderId, column.id).length
                  )
              }}
            >
              {column.id === here?.id ? (
                <Check className="text-muted-foreground" />
              ) : (
                <span
                  aria-hidden
                  className={cn(
                    "size-2.5 rounded-full",
                    BOARD_TONES[toneOf(column.tone)].dot
                  )}
                />
              )}
              {column.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
