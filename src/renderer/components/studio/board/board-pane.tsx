import { useState, type DragEvent } from "react"
import { Palette, Pencil, Plus, Trash2 } from "lucide-react"

import { BOARD_TONE_IDS, type BoardColumn } from "@shared/api"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cardsOf, columnsOf, todayKey } from "@/lib/board/cards"
import { useBoard } from "@/lib/board/store"
import { BOARD_TONES, TONE_LABEL, toneOf } from "@/lib/board/tones"
import { useStudio } from "@/lib/store"
import { cn } from "@/lib/utils"
import { IconButton } from "../icon-button"
import { RenameRow } from "../rename-row"
import { BoardCardRow } from "./board-card"
import { CardDrawer } from "./card-drawer"

/**
 * One project's kanban board: its own columns, and cards that can name the chat
 * their work is happening in.
 *
 * One tab per project and the tab's id is the project's, so the board is in the
 * strip exactly while that project is the one being worked in — the shape the
 * `Changes` tab has (`rootOf` in `lib/panels.ts` is the identity for both).
 *
 * **The link is this app's, not the agent's.** A card can open a chat, start
 * one, and say whether that chat is answering right now; the model cannot move
 * a card, because this app serves no MCP server of its own and so has no tool
 * to offer one. That is a deliberate line rather than a gap — see
 * `docs/design.md` § Board.
 *
 * **The columns are the project's own** — added, renamed, recoloured and
 * dragged. They were three fixed ones (`Todo` / `Doing` / `Done`) and the
 * argument for that is reversed in `design.md`; what is left of it is that those
 * three are still what a board starts as.
 *
 * Dragging — of both a card and a column — is the platform's own (`draggable`,
 * `dragover`, `drop`) rather than a library: what a board needs is one thing at
 * a time and an insertion point, and `moveCard` / `moveColumn` in
 * `lib/board/cards.ts` are the only parts with an answer that can be wrong.
 */
export function BoardPane() {
  const openIds = useBoard((state) => state.openIds)
  const selectedId = useBoard((state) => state.selectedId)
  const folderId =
    selectedId && openIds.includes(selectedId) ? selectedId : null

  const folders = useStudio((state) => state.folders)
  const folder = folders.find((entry) => entry.id === folderId)

  const cards = useBoard((state) => state.cards)
  const allColumns = useBoard((state) => state.columns)

  /**
   * What day it is, for the due dates — read once for the whole board.
   *
   * Per render rather than held in state, and deliberately not on a timer: a
   * board left open across midnight repaints on the next thing anybody does to
   * it, and a clock ticking in a panel nobody is looking at to recolour one
   * chip is not worth an interval. One value for every card so that no two of
   * them can disagree about which day they are being compared against.
   */
  const today = todayKey()

  /**
   * What is being carried, and where it would land.
   *
   * One state for both kinds rather than two, because they are exclusive — a
   * column is dragged by its header and a card by its body, and nothing can be
   * doing both. Keeping them apart meant a stale card target deciding a column
   * drop.
   */
  const [drag, setDrag] = useState<
    { card: string } | { column: string } | null
  >(null)
  const [target, setTarget] = useState<{
    column: string
    index: number
  } | null>(null)
  /** Where a dragged **column** would land, among the project's columns. */
  const [columnTarget, setColumnTarget] = useState<number | null>(null)

  const draggingCard = drag && "card" in drag ? drag.card : null
  const draggingColumn = drag && "column" in drag ? drag.column : null

  /**
   * The card drawer, if it is open: a card being edited, or a column a card is
   * being added to.
   *
   * A **column** and not a card for the second one, because there is no card
   * yet — `+` writes nothing, and the card is created when the drawer is
   * submitted. See `CardDrawer`.
   */
  const [drawer, setDrawer] = useState<
    { edit: string } | { add: string } | null
  >(null)

  /** Which column's name is a field right now, and whether a new one is being
   * named — in place, the way every other list in the studio renames. */
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [addingColumn, setAddingColumn] = useState(false)

  /* Derived rather than held, which is what closes the drawer of a card deleted
   * from under it: there is nothing to draw, so nothing draws. */
  const editing =
    drawer && "edit" in drawer
      ? (cards.find((card) => card.id === drawer.edit) ?? null)
      : null
  const adding = drawer && "add" in drawer ? drawer.add : null

  // A project that has left the workspace while its tab was open: the tab
  // closes a frame later (`reconcileScope`), and until then this is what it
  // draws rather than an empty board that looks like a board with no cards.
  if (!folderId || !folder) {
    return (
      <div className="grid h-full place-items-center p-6">
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          That project has left the workspace. Open another project&apos;s board
          from its row on the left.
        </p>
      </div>
    )
  }

  const columns = columnsOf(allColumns, folderId)

  function endDrag() {
    setDrag(null)
    setTarget(null)
    setColumnTarget(null)
  }

  function dropCard(columnId: string) {
    if (!draggingCard) return endDrag()

    const carried = cards.find((card) => card.id === draggingCard)
    if (!carried) return endDrag()

    // The gap the cursor was last over, or the foot of the column it was let go
    // in — a drop on a column's empty space is a drop at the end of it.
    const own = cardsOf(cards, allColumns, carried.folderId, columnId)
    let index = target?.column === columnId ? target.index : own.length

    /*
     * The gap indices above are counted against the column **as drawn**, which
     * still holds the card being carried; `moveCard` counts against the column
     * with it taken out. Dragging a card down its own column is where the two
     * disagree, and by exactly one.
     */
    const from = own.findIndex((card) => card.id === draggingCard)
    if (from !== -1 && from < index) index -= 1

    useBoard.getState().move(draggingCard, columnId, index)
    endDrag()
  }

  function dropColumn(at: number) {
    if (!draggingColumn) return endDrag()

    let index = columnTarget ?? at
    // The same off-by-one as a card's, one level up: the gaps are counted
    // against the row as drawn, and `moveColumn` counts with the column taken
    // out.
    const from = columns.findIndex((column) => column.id === draggingColumn)
    if (from !== -1 && from < index) index -= 1

    // The carried column's own project, not the pane's: a column id is only
    // unique within one board (see `columnKey`), so the write has to name both.
    const carried = columns[from]
    if (!carried) return endDrag()

    useBoard.getState().moveColumn(carried.folderId, draggingColumn, index)
    endDrag()
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/*
        Scrolls sideways rather than dividing the width by however many columns
        there are: columns are the user's now, and a tenth column that made the
        other nine unreadably narrow would be a board that punished being used.
        A fixed column width and a horizontal scrollbar is what every board does,
        and for this reason.
      */}
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-2">
        {columns.map((column, at) => {
          const own = cardsOf(cards, allColumns, folderId, column.id)
          const tone = BOARD_TONES[toneOf(column.tone)]

          return (
            <div key={column.id} className="flex min-h-0 shrink-0">
              {/* Where a dragged column would land. A vertical rule between two
                  columns, the same idea as the card's line. */}
              <ColumnGap
                shown={draggingColumn !== null && columnTarget === at}
              />

              <section
                aria-label={column.name}
                onDragOver={(event) => {
                  // Without this the browser refuses the drop outright, and an
                  // empty column would be the one place a card could not go.
                  event.preventDefault()
                  if (draggingColumn) {
                    setColumnTarget(columnGapAt(event, at))
                    return
                  }
                  if (target?.column !== column.id || own.length === 0) {
                    setTarget({ column: column.id, index: own.length })
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (draggingColumn) dropColumn(at)
                  else dropCard(column.id)
                }}
                className={cn(
                  // Wider than it was (w-64), because a card now carries a row
                  // of tags above its title: at the old width two tags and a
                  // priority wrapped to a second line on most cards, which is
                  // the row costing height on every card to save it on none.
                  "flex min-h-0 w-72 flex-col overflow-hidden rounded-lg bg-muted/40",
                  draggingColumn === column.id && "opacity-40"
                )}
              >
                {renamingId === column.id ? (
                  <div className="shrink-0 py-1">
                    <RenameRow
                      name={column.name}
                      label="Column name"
                      onRename={async (name) => {
                        useBoard
                          .getState()
                          .renameColumn(column.folderId, column.id, name)
                        setRenamingId(null)
                        return null
                      }}
                      onCancel={() => setRenamingId(null)}
                    />
                  </div>
                ) : (
                  <header
                    // The header is the column's drag handle, which is why the
                    // cards below it are draggable separately: a whole column
                    // that could be picked up anywhere would swallow every
                    // attempt to pick up a card.
                    draggable
                    onDragStart={() => setDrag({ column: column.id })}
                    onDragEnd={endDrag}
                    className={cn(
                      "flex shrink-0 cursor-grab items-center gap-2 px-2.5 py-2",
                      tone.head
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn("size-2 shrink-0 rounded-full", tone.dot)}
                    />
                    {/* Small caps: the header is a label over a stack of cards,
                        and setting it apart in weight and case rather than in
                        size keeps it from competing with the card titles under
                        it — which are the thing being read. */}
                    <h2 className="min-w-0 flex-1 truncate text-[0.6875rem] font-semibold tracking-wide text-foreground uppercase">
                      {column.name}
                    </h2>
                    {/* Nothing for an empty column: a count reading zero is a
                        thing to notice saying there is nothing to notice — the
                        rule the `Changes` tab's badge follows. */}
                    {own.length > 0 && (
                      <span className="shrink-0 rounded bg-foreground/8 px-1.5 py-0.5 text-[0.6875rem] leading-none text-muted-foreground tabular-nums">
                        {own.length}
                      </span>
                    )}
                    <IconButton
                      label={`Add a card to ${column.name}`}
                      onClick={() => setDrawer({ add: column.id })}
                      className="size-5 shrink-0"
                    >
                      <Plus className="size-3" />
                    </IconButton>
                    <ColumnMenu
                      column={column}
                      cards={own.length}
                      only={columns.length === 1}
                      onRename={() => setRenamingId(column.id)}
                    />
                  </header>
                )}

                <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pt-2 pb-2">
                  {own.map((card, index) => (
                    <div
                      key={card.id}
                      onDragOver={(event) => {
                        if (draggingColumn) return
                        event.preventDefault()
                        setTarget({
                          column: column.id,
                          index: gapAt(event, index),
                        })
                      }}
                    >
                      {/* The insertion point, drawn where the card would go, in
                          the hue of the column it would go into. A line rather
                          than a space held open: a column that reflows as the
                          cursor crosses it moves the gap being aimed at. */}
                      <Gap
                        tone={tone.ring}
                        shown={
                          target?.column === column.id && target.index === index
                        }
                      />
                      <BoardCardRow
                        card={card}
                        edge={tone.edge}
                        today={today}
                        dragging={draggingCard === card.id}
                        onEdit={() => setDrawer({ edit: card.id })}
                        onDragStart={() => setDrag({ card: card.id })}
                        onDragEnd={endDrag}
                      />
                    </div>
                  ))}

                  <Gap
                    tone={tone.ring}
                    shown={
                      target?.column === column.id &&
                      target.index === own.length
                    }
                  />

                  {own.length === 0 && drag === null && (
                    <p className="px-0.5 py-1 text-[0.6875rem] text-muted-foreground">
                      Nothing here.
                    </p>
                  )}
                </div>
              </section>
            </div>
          )
        })}

        {/* The gap past the last column, so a column can be dragged to the end. */}
        <div
          onDragOver={(event) => {
            if (!draggingColumn) return
            event.preventDefault()
            setColumnTarget(columns.length)
          }}
          onDrop={(event) => {
            if (!draggingColumn) return
            event.preventDefault()
            dropColumn(columns.length)
          }}
          className="flex shrink-0 items-start gap-2 pt-0"
        >
          <ColumnGap
            shown={draggingColumn !== null && columnTarget === columns.length}
          />

          {addingColumn ? (
            <div className="w-56 py-1">
              <RenameRow
                name=""
                label="New column name"
                onRename={async (name) => {
                  useBoard.getState().addColumn(folderId, name)
                  setAddingColumn(false)
                  return null
                }}
                onCancel={() => setAddingColumn(false)}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingColumn(true)}
              className="flex w-40 shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground hover:border-ring hover:text-foreground"
            >
              <Plus className="size-3.5" />
              Add column
            </button>
          )}
        </div>
      </div>

      {/* One drawer, two things it can be doing with the answer. Keyed so that
          it starts from the right text: the fields are held in it, and a second
          card opened without remounting would keep the first one's. */}
      {editing && (
        <CardDrawer
          key={editing.id}
          card={editing}
          onSave={(fields) => useBoard.getState().edit(editing.id, fields)}
          onClose={() => setDrawer(null)}
        />
      )}

      {adding && (
        <CardDrawer
          key={`add:${adding}`}
          card={null}
          onSave={(fields) => useBoard.getState().add(folderId, adding, fields)}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  )
}

/**
 * A column's own menu: rename, recolour, delete.
 *
 * Delete says **how many cards it is leaving behind** rather than moving them
 * anywhere, and that is the whole of the rule: a delete that silently relocated
 * eight cards would be a delete that lost track of work. They are drawn in the
 * first column afterwards (`columnOf` in `lib/board/cards.ts`), which is stated
 * here so it is read before the click rather than discovered after it.
 */
function ColumnMenu({
  column,
  cards,
  only,
  onRename,
}: {
  column: BoardColumn
  cards: number
  /** Whether it is the last column standing, which cannot be deleted. */
  only: boolean
  onRename: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            label={`${column.name} column`}
            className="size-5 shrink-0"
          >
            <span aria-hidden className="text-muted-foreground">
              ⋯
            </span>
          </IconButton>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={onRename}>
          <Pencil />
          Rename column
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette />
            Colour
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            {BOARD_TONE_IDS.map((tone) => (
              <DropdownMenuItem
                key={tone}
                onClick={() =>
                  useBoard
                    .getState()
                    .setColumnTone(column.folderId, column.id, tone)
                }
              >
                <span
                  aria-hidden
                  className={cn("size-2.5 rounded-full", BOARD_TONES[tone].dot)}
                />
                {TONE_LABEL[tone]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {!only && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                useBoard.getState().removeColumn(column.folderId, column.id)
              }
            >
              <Trash2 />
              {cards
                ? `Delete column (${cards} card${cards === 1 ? "" : "s"} move to the first)`
                : "Delete column"}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Which gap the cursor is in, over the card at `at`: before it, or after it.
 *
 * The midpoint of the card rather than its edges, so the answer changes once as
 * the cursor crosses a card rather than flickering along a boundary.
 */
function gapAt(event: DragEvent<HTMLDivElement>, at: number): number {
  const box = event.currentTarget.getBoundingClientRect()
  return event.clientY < box.top + box.height / 2 ? at : at + 1
}

/** The same question for a column, across rather than down. */
function columnGapAt(event: DragEvent<HTMLElement>, at: number): number {
  const box = event.currentTarget.getBoundingClientRect()
  return event.clientX < box.left + box.width / 2 ? at : at + 1
}

/** The line a card would land on, in its column's hue. Always rendered, so the
 * column's height does not change as it appears — see the note at the call
 * site. */
function Gap({ tone, shown }: { tone: string; shown: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "h-0.5 rounded-full transition-colors",
        shown ? tone : "bg-transparent"
      )}
    />
  )
}

/** The same, for a column: a rule down the gap it would land in. Always
 * rendered, so the row does not shift sideways as it appears. */
function ColumnGap({ shown }: { shown: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "w-0.5 shrink-0 rounded-full transition-colors",
        shown ? "bg-primary" : "bg-transparent"
      )}
    />
  )
}
