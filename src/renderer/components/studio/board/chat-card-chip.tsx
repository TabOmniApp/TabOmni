import { ArrowRight, Check, ChevronDown, Columns3 } from "lucide-react"

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
import { useWorktreeChats } from "@/lib/worktree-chat/store"

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
 *
 * Beside it, once the chat has stopped, is the **last column in one click** —
 * see `finish`. Two controls for one field is a repeat only on paper: the
 * dropdown answers "which column", and this answers the one question actually
 * asked at the end of a turn, which the board is otherwise switched to and
 * dragged across to say. Both are the user pressing something; the agent still
 * cannot write to the board.
 */
export function ChatCardChip({ chatId }: { chatId: string }) {
  const cards = useBoard((state) => state.cards)
  const allColumns = useBoard((state) => state.columns)
  // Whether this conversation is mid-turn. Read here rather than passed in
  // because it decides only what this strip draws — see `finish` below.
  const busy = useWorktreeChats((state) => state.sending.includes(chatId))
  const asking = useWorktreeChats((state) => state.asks[chatId] !== undefined)

  const card = cardOfChat(cards, chatId)
  if (!card) return null

  // Through `columnOf`, so a card whose column was deleted names the one it is
  // actually drawn in rather than a stale id nobody can see.
  const columns = columnsOf(allColumns, card.folderId)
  const here = columnOf(allColumns, card)
  const tone = BOARD_TONES[toneOf(here?.tone ?? "slate")]

  const moveTo = (columnId: string) =>
    useBoard
      .getState()
      .move(
        card.id,
        columnId,
        cardsOf(cards, allColumns, card.folderId, columnId).length
      )

  /**
   * The one-click way to the **last** column, or nothing.
   *
   * The last one rather than a column called `Done`, because the names are the
   * user's — the same reading `unfinishedCount` does, and the two must agree or
   * this button would move a card the tab's count still calls unfinished.
   *
   * Drawn only while the chat is **stopped**, and this is the whole of why it
   * is a second control beside a dropdown that could already do it. The moment
   * it is for is finishing reading a turn and knowing the work is done; offered
   * mid-answer it is a button for a fact nobody has yet, and beside a question
   * the chat is waiting on it is worse than useless. Absent rather than
   * disabled, since a disabled button in a strip this thin is a smear nobody
   * can read the reason for — the dropdown is still there for anyone who means
   * it anyway.
   */
  const last = columns.at(-1)
  const finish = !busy && !asking && last && last.id !== here?.id ? last : null

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5">
      <Columns3 className="size-3.5 shrink-0 text-muted-foreground" />
      <span
        className="min-w-0 flex-1 truncate text-xs text-foreground"
        title={card.body || card.title}
      >
        {card.title}
      </span>

      {finish && (
        <button
          type="button"
          title={`Move this card to ${finish.name}`}
          onClick={() => moveTo(finish.id)}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowRight className="size-3" />
          {finish.name}
        </button>
      )}

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
                moveTo(column.id)
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
