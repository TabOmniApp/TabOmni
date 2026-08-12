import { memo, useEffect, useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { DbEngine } from "@shared/api"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  ArrowUpAZ,
  Binary,
  Braces,
  CalendarClock,
  Check,
  Copy,
  EyeOff,
  Hash,
  KeyRound,
  Link2,
  List,
  Maximize2,
  Pencil,
  Plus,
  Sigma,
  Square,
  SquareCheck,
  SquareMinus,
  Trash2,
  Type,
  X,
} from "lucide-react"

import { formatCell, formatOptionsFor, type ColumnPref } from "@/lib/db/display"
import {
  colorForEnumLabel,
  findSoleColumnForeignKey,
  inferFieldKind,
  type FieldKind,
} from "@/lib/db/field-kind"
import {
  newColumnDraft,
  newColumnError,
  type CellWrite,
  type Column,
  type ForeignKey,
  type LabelRow,
  type NewColumnDraft,
  type SortOrder,
} from "@/lib/db/engines"
import { columnSlots } from "@/lib/db/grid-columns"
import type { SqlField, SqlResult } from "@/lib/db/runner"
import { ColumnMenu } from "./column-menu"
import { IconButton } from "../icon-button"

/** A row's primary-key columns, keyed by name — what identifies it for an
 * update or a delete. */
export function primaryKeyFromRow(
  fields: SqlField[],
  columns: Column[],
  row: unknown[]
): Record<string, unknown> {
  const columnByName = new Map(columns.map((column) => [column.name, column]))
  const key: Record<string, unknown> = {}
  fields.forEach((field, index) => {
    if (columnByName.get(field.name)?.primaryKey) key[field.name] = row[index]
  })
  return key
}

/** Lets a grid mutate rows — the Data tab's own page, or a query tab's
 * result once it's traced back to one table's own row. Omitted wherever a
 * result may not even be a single table (a join, an aggregate, a script). */
export type CellEdit = {
  /** Introspected columns, correlated to `result.fields` by name. */
  columns: Column[]
  /** For inferring a foreign-key column's field kind — see `inferFieldKind`. */
  foreignKeys: ForeignKey[]
  engine: DbEngine
  /** Whether a column's type is safe to edit through a plain text input — engine-specific. */
  isEditableType: (type: string) => boolean
  /** Human labels for the foreign-key values on the current page, keyed by
   * column name then by the raw value stringified. */
  fkLabels: Record<string, Map<string, string>>
  /** Candidate rows for a foreign-key cell's picker, optionally filtered. */
  searchForeignKeyRows: (fk: ForeignKey, search?: string) => Promise<LabelRow[]>
  /**
   * Writes every cell edited since the last save, in one go.
   *
   * Editing a cell used to write it there and then, which made a table of
   * corrections a table of round trips — and each one re-read the page, so the
   * rows moved under the next edit. Edits are now held in the grid, drawn in
   * place of the values they replace, and sent when the bar at the foot of the
   * grid is used. Resolves to an error message on failure; the page is re-read
   * either way, so the grid shows what landed.
   */
  onSaveCells: (writes: CellWrite[]) => Promise<string | null>
  onRequestDelete: (row: unknown[]) => void
  /** Opens an unsaved draft row at the foot of the grid — the trailing
   * "New row" line. */
  onRequestInsert?: () => void
  /** Whether that draft row is currently open. */
  inserting?: boolean
  /** Discards the draft without writing anything. */
  onCancelInsert?: () => void
  /** Writes the draft row. Blank fields are omitted from `values` — the
   * column's default or NULL applies instead of an explicit empty string. */
  onInsertRow?: (values: Record<string, string>) => Promise<string | null>
  /** Lets the trailing column's own header open a small popover to add one —
   * rather than a hover button repeated down every row. Only the Data tab
   * wires this; a query tab's result has nowhere obvious for a new column to
   * appear once added. */
  onAddColumn?: {
    columnTypes: string[]
    onSubmit: (column: NewColumnDraft) => Promise<string | null>
  }
}

/**
 * How the columns themselves are controlled from their header menus.
 *
 * Optional as a whole: without it the grid keeps display preferences in its
 * own state, which is all the SQL console needs — its results belong to no
 * table, so there is nothing to sort, rename or drop.
 */
export type ColumnControl = {
  /** Display preferences, keyed by column name. */
  prefs: Record<string, ColumnPref>
  onPref: (column: string, pref: Partial<ColumnPref>) => void
  sort?: SortOrder | null
  onSort?: (sort: SortOrder | null) => void
  onRename?: (column: string) => void
  onDrop?: (column: string) => void
}

/** The trailing row-actions column is fixed width, so a sticky cell knows
 * what to offset itself by. */
const ACTIONS_WIDTH = 36

/**
 * Every cell is one line tall, so a page of rows stays scannable — and so the
 * virtualizer can size the rows it isn't rendering from a constant instead of
 * measuring them.
 *
 * The two must agree: `h-8` is 2rem at the app's unscaled root font size, and
 * `box-sizing: border-box` means a row's bottom border is inside that. Change
 * one and the scrollbar stops matching the rows.
 */
const ROW_HEIGHT = "h-8"
const ROW_HEIGHT_PX = 32

/** Rows kept mounted beyond the viewport, so a flick of the wheel lands on
 * rendered rows rather than on blank space waiting for a paint. */
const OVERSCAN = 12

/**
 * A sticky cell paints its own opaque background — otherwise the columns
 * scrolling underneath show through it. That background would also swallow
 * the row's translucent hover tint, so the tint comes back as a pseudo-element
 * layered *over* the background but under the cell's content.
 */
const STICKY_CELL =
  "sticky z-20 bg-background before:pointer-events-none before:absolute before:inset-0 before:-z-10 group-hover:before:bg-muted/40"

/** A stable identity for "no preferences set", so a cell whose column has
 * none doesn't get a fresh object — and a fresh render — on every pass. */
const EMPTY_PREF: ColumnPref = {}

type Address = { row: number; col: number }

/**
 * Renders one result set as a spreadsheet-style grid.
 *
 * Cells are formatted rather than stringified: telling an empty string from
 * NULL, or a real JSON column from the text `"[object Object]"`, is most of what
 * makes a result readable.
 *
 * Navigation follows the convention every grid app shares: one click selects a
 * cell, arrow keys move the selection, and Enter (or a double click) opens
 * whichever editor that cell's kind calls for.
 *
 * Memoized, and worth keeping that way: the panels around it re-render on
 * things the grid has no stake in — a keystroke in the SQL editor, a cursor
 * move — and re-laying out even a virtualized grid on each one is what made
 * typing stutter over a wide table. Callers pass `result`, `edit` and
 * `control` from a `useMemo` for the same reason.
 */
export const ResultGrid = memo(function ResultGrid({
  result,
  emptyLabel = "No rows.",
  edit,
  control,
  onUnsavedChange,
}: {
  result: SqlResult
  emptyLabel?: string
  edit?: CellEdit
  control?: ColumnControl
  /** How many cells are edited but unwritten, for the pane around the grid:
   * anything that re-reads the rows drops them, so it has controls to hold
   * back while there are any. Called with 0 when the grid goes away. */
  onUnsavedChange?: (count: number) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [active, setActive] = useState<Address | null>(null)
  const [editing, setEditing] = useState(false)
  const [widths, setWidths] = useState<Record<number, number>>({})
  const [localPrefs, setLocalPrefs] = useState<Record<string, ColumnPref>>({})
  /** Which row (and which column of it, when the click landed on a cell) the
   * context menu was opened on. */
  const [menuTarget, setMenuTarget] = useState<{
    row: number
    col: number | null
  } | null>(null)
  /** A failure from an action taken through the context menu, which has no
   * cell of its own to report into. */
  const [actionError, setActionError] = useState<string | null>(null)
  const [insertDraft, setInsertDraft] = useState<Record<string, string>>({})
  const [insertBusy, setInsertBusy] = useState(false)
  /** Cells changed but not yet written, keyed by `row index:column name` — the
   * row's own index because that is what identifies it until it is saved, and
   * a page is re-read (and these cleared) whenever the rows themselves move. */
  const [pending, setPending] = useState<Record<string, string | null>>({})
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Both above the early return for a result with no columns at all, which is
  // ahead of every other hook in this component.
  const pendingCount = Object.keys(pending).length
  useEffect(() => {
    onUnsavedChange?.(pendingCount)
  }, [pendingCount, onUnsavedChange])
  useEffect(() => {
    // The grid is unmounted while its page is re-read, taking its edits with
    // it — the pane must not be left holding a count for a grid that is gone.
    return () => onUnsavedChange?.(0)
  }, [onUnsavedChange])

  // A fresh draft every time the row is (re)opened, rather than whatever was
  // left over from the last one that was saved or cancelled. Adjusted during
  // the render that first sees the change, the same way `shownSignature`
  // resets selection below.
  const inserting = edit?.inserting ?? false
  const [shownInserting, setShownInserting] = useState(inserting)
  if (shownInserting !== inserting) {
    setShownInserting(inserting)
    if (inserting) {
      setInsertDraft({})
      setActionError(null)
    }
  }

  async function saveInsertDraft() {
    if (!edit?.onInsertRow || insertBusy) return
    setInsertBusy(true)
    setActionError(null)
    // A field left blank is treated as "not set" — the default or NULL
    // applies — rather than an explicit empty string.
    const values = Object.fromEntries(
      Object.entries(insertDraft).filter(([, value]) => value.length > 0)
    )
    const failure = await edit.onInsertRow(values)
    setInsertBusy(false)
    if (failure) setActionError(failure)
  }

  const prefs = control?.prefs ?? localPrefs
  const setPref = (column: string, pref: Partial<ColumnPref>) => {
    if (control) {
      control.onPref(column, pref)
      return
    }
    setLocalPrefs((current) => ({
      ...current,
      [column]: { ...current[column], ...pref },
    }))
  }

  const columnByName = new Map(
    edit?.columns.map((column) => [column.name, column])
  )
  const hasPrimaryKey = result.fields.some(
    (field) => columnByName.get(field.name)?.primaryKey
  )
  // A row can only be identified — so only updated or deleted — once a
  // primary key is known. A view or a PK-less table stays read-only here even
  // when `edit` is passed in.
  const canMutateRows = Boolean(edit) && hasPrimaryKey

  // Selection and hand-set widths belong to the shape being shown; switching
  // tables (or queries) has to drop both rather than carry them onto columns
  // that no longer mean the same thing.
  // Adjusted during the render that first sees the new shape, rather than in an
  // effect that would paint one page of rows under the old widths first.
  const signature = result.fields.map((field) => field.name).join("\u0000")
  const [shownSignature, setShownSignature] = useState(signature)
  if (shownSignature !== signature) {
    setShownSignature(signature)
    setWidths({})
    setActive(null)
    setEditing(false)
  }

  // Unsaved edits are addressed by row index, so any new set of rows — a save,
  // a refresh, a page turned, a filter — invalidates them. They are dropped
  // rather than re-anchored: the values behind them have just been re-read, and
  // an edit carried onto whatever row now sits at that index would be written
  // against the wrong one.
  const [shownRows, setShownRows] = useState(result)
  if (shownRows !== result) {
    setShownRows(result)
    setPending({})
  }

  const defaultWidths = useMemo(() => measureColumns(result), [result])
  const widthOf = (index: number) =>
    widths[index] ?? defaultWidths[index] ?? 160

  /** Everything about a column that doesn't change row to row. */
  const columnInfo = useMemo(
    () =>
      result.fields.map((field, dataIndex) => {
        const column = edit?.columns.find((item) => item.name === field.name)
        const foreignKey = column
          ? findSoleColumnForeignKey(column, edit?.foreignKeys ?? [])
          : undefined
        const kind: FieldKind = column
          ? inferFieldKind(column, foreignKey, edit?.engine ?? "postgres")
          : "text"
        const editable =
          canMutateRows &&
          column !== undefined &&
          !column.primaryKey &&
          column.generatedExpression === null &&
          edit!.isEditableType(column.type)
        return { field, column, foreignKey, kind, editable, dataIndex }
      }),
    [result.fields, edit, canMutateRows]
  )

  // Hiding a column only takes it off the screen — `dataIndex` keeps every
  // visible column pointing at its own value in the row, which is still the
  // full row the query returned. The selection model counts in visible
  // columns, so arrowing across the grid skips what was hidden.
  const visible = columnInfo.filter((info) => !prefs[info.field.name]?.hidden)

  /**
   * Only the rows in view exist in the DOM.
   *
   * A result is one `select` away from being a million rows, and a million
   * rows is tens of millions of cells — enough that the app stops responding
   * while it lays them out, whatever is done to make each cell cheaper. The
   * rest of the grid is written as though every row were there: `rowIndex` is
   * always an index into `result.rows`, never into what happens to be
   * mounted.
   *
   * The compiler skips memoizing this component because TanStack Virtual hands
   * back functions it cannot prove stable. That is the library's shape, not a
   * mistake here, so the rule is silenced rather than left to warn on every
   * run — the grid does its own memoizing below.
   */
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: OVERSCAN,
  })
  const virtualRows = virtualizer.getVirtualItems()

  // Rows the virtualizer isn't rendering become one tall spacer above and one
  // below, so the table keeps its full height (the scrollbar stays honest) and
  // `thead` keeps something to stick to.
  const padTop = virtualRows[0]?.start ?? 0
  const padBottom =
    virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)

  /**
   * And only the columns in view.
   *
   * Rows alone are not enough: `select *` over a 200-column table still leaves
   * ~30 rendered rows × 200 columns of cells, plus 200 headers each carrying a
   * whole `ColumnMenu`'s worth of elements. It is the product that hurts, so
   * both axes are virtualized.
   */
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const info = visible[index]
      return info ? widthOf(info.dataIndex) : 160
    },
    overscan: 3,
  })

  // Column sizes are cached by index, so dragging a column wider (or hiding
  // one, which shifts every index after it) has to invalidate that cache —
  // nothing else tells the virtualizer its estimates went stale.
  const widthSignature = visible
    .map((info) => widthOf(info.dataIndex))
    .join(",")
  useEffect(() => {
    columnVirtualizer.measure()
  }, [columnVirtualizer, widthSignature])

  // Header, body and `colgroup` are all built from this one list, so they
  // cannot disagree about which columns are on screen or how wide the gaps
  // between them are.
  const virtualColumns = columnVirtualizer.getVirtualItems()
  const slots = columnSlots(
    visible,
    virtualColumns,
    (info) => widthOf(info.dataIndex),
    columnVirtualizer.getTotalSize()
  )

  // Keyboard navigation moves the selection; the DOM has to follow it so the
  // next key lands on the cell the user can see is selected. Arrowing past the
  // viewport has to scroll the row into existence first — until it renders
  // there is no element to focus.
  useEffect(() => {
    if (!active || editing) return
    virtualizer.scrollToIndex(active.row)
    columnVirtualizer.scrollToIndex(active.col)
  }, [active, editing, virtualizer, columnVirtualizer])

  // Keyed on the rendered range rather than the items themselves: the arrays
  // are new on every render, and refocusing the same cell each time is wasted
  // work. Both axes count — a cell can be waiting on a sideways scroll.
  const renderedRange = [
    virtualRows[0]?.index,
    virtualRows[virtualRows.length - 1]?.index,
    virtualColumns[0]?.index,
    virtualColumns[virtualColumns.length - 1]?.index,
  ].join("-")
  useEffect(() => {
    if (!active || editing) return
    bodyRef.current
      ?.querySelector<HTMLElement>(`[data-cell="${active.row}-${active.col}"]`)
      ?.focus()
  }, [active, editing, renderedRange])

  if (result.fields.length === 0) {
    return (
      <Notice>
        {result.affectedRows === undefined
          ? "Statement completed."
          : `${result.affectedRows} row${result.affectedRows === 1 ? "" : "s"} affected.`}
      </Notice>
    )
  }

  function moveBy(rowStep: number, colStep: number) {
    setActive((current) => {
      const base = current ?? { row: 0, col: 0 }
      return {
        row: clamp(base.row + rowStep, 0, result.rows.length - 1),
        col: clamp(base.col + colStep, 0, visible.length - 1),
      }
    })
  }

  function onGridKeyDown(event: React.KeyboardEvent) {
    // While a cell is being edited its own editor owns the keyboard: Enter
    // commits, Escape cancels, arrows move the caret.
    if (editing || !active) return

    switch (event.key) {
      case "ArrowDown":
        moveBy(1, 0)
        break
      case "ArrowUp":
        moveBy(-1, 0)
        break
      case "ArrowRight":
        moveBy(0, 1)
        break
      case "ArrowLeft":
        moveBy(0, -1)
        break
      case "Tab":
        moveBy(0, event.shiftKey ? -1 : 1)
        break
      case "Enter":
      case " ": {
        const info = visible[active.col]
        // A boolean has no editor to open — it is toggled in place, by click —
        // so entering "editing" for one would only wedge the keyboard.
        if (info?.editable && info.kind !== "boolean") setEditing(true)
        else if (info && !info.editable)
          setExpanded(
            formatCell(
              result.rows[active.row]?.[info.dataIndex],
              prefs[info.field.name]
            ).text
          )
        break
      }
      case "Escape":
        setActive(null)
        return
      default:
        return
    }
    event.preventDefault()
  }

  /** Drags a column's right edge. Widths live in state rather than on the DOM
   * so the header and every body cell stay in step through `colgroup`. */
  function startResize(event: React.PointerEvent, index: number) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = widthOf(index)

    function onMove(move: PointerEvent) {
      setWidths((current) => ({
        ...current,
        [index]: Math.max(64, Math.round(startWidth + move.clientX - startX)),
      }))
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  /**
   * Points the context menu at whatever was right-clicked, and selects it.
   *
   * One menu serves the whole grid — a `ContextMenu` per cell would be a
   * thousand of them on a full page — so the target is read back off the DOM
   * here. A click that landed on no row at all (the header, the "New row"
   * line) stops here rather than opening an empty menu: the event never
   * reaches the trigger wrapping the grid.
   */
  function onCellContextMenu(event: React.MouseEvent) {
    const target = event.target as HTMLElement
    const rowElement = target.closest<HTMLElement>("[data-row]")
    if (!rowElement) {
      event.stopPropagation()
      return
    }

    const cellElement = target.closest<HTMLElement>("[data-cell]")
    const col = cellElement
      ? Number(cellElement.dataset.cell!.split("-")[1])
      : null
    const row = Number(rowElement.dataset.row)

    setActionError(null)
    setMenuTarget({ row, col })
    if (col !== null) {
      setActive({ row, col })
      setEditing(false)
    }
  }

  /** Holds one cell's new value until the bar at the foot of the grid sends
   * it. Setting a cell back to what it already held drops the edit instead of
   * keeping a write that would change nothing. */
  function stage(row: number, column: string, value: string | null) {
    const key = `${row}:${column}`
    const index = result.fields.findIndex((field) => field.name === column)
    const current = index === -1 ? undefined : result.rows[row]?.[index]
    setActionError(null)
    setPending((held) => {
      const next = { ...held }
      if (sameAsStored(current, value)) delete next[key]
      else next[key] = value
      return next
    })
  }

  /** Sets a cell to NULL, straight from the menu — staged like any other edit. */
  function clearCell(row: number, col: number) {
    const info = visible[col]
    if (!info) return
    stage(row, info.field.name, null)
  }

  function discard() {
    setPending({})
    setActionError(null)
    setEditing(false)
  }

  async function save() {
    if (!edit || saving) return
    const writes: CellWrite[] = []
    for (const [key, value] of Object.entries(pending)) {
      // The column name can itself contain a colon, so only the first
      // separator is one.
      const separator = key.indexOf(":")
      const row = result.rows[Number(key.slice(0, separator))]
      if (!row) continue
      writes.push({
        primaryKey: primaryKeyFromRow(result.fields, edit.columns, row),
        column: key.slice(separator + 1),
        value,
      })
    }
    if (writes.length === 0) return

    setSaving(true)
    setActionError(null)
    // A failure is the pane's to show, not this grid's: the page is re-read
    // either way, and the grid goes with it while that runs.
    await edit.onSaveCells(writes)
    setSaving(false)
  }

  const totalWidth =
    visible.reduce((sum, info) => sum + widthOf(info.dataIndex), 0) +
    (canMutateRows ? ACTIONS_WIDTH : 0)

  // The cells one row actually has — rendered columns and their spacers, the
  // unsized filler, and the row-actions column when there is one. What a
  // spacer *row* has to span.
  const columnCount = slots.length + 1 + (canMutateRows ? 1 : 0)

  const menuInfo =
    menuTarget?.col !== null && menuTarget !== null
      ? visible[menuTarget.col]
      : undefined
  const menuRow = menuTarget ? result.rows[menuTarget.row] : undefined

  return (
    <ContextMenu>
      <div className="relative h-full">
        <div
          ref={scrollRef}
          className="h-full overflow-auto"
          onKeyDown={onGridKeyDown}
        >
          {/* The trigger wraps the table itself, not the scroll area: a
              right-click on the empty space below the last row belongs to no
              row, and should open nothing rather than the previous row's menu. */}
          <ContextMenuTrigger render={<div className="w-max min-w-full" />}>
            <table
              role="grid"
              style={{ width: totalWidth }}
              onContextMenu={onCellContextMenu}
              className="min-w-full table-fixed border-separate border-spacing-0 text-left font-mono text-xs"
            >
              {/* One `col` per slot, so the spacers standing in for the columns
            out of view are sized here alongside the real ones. The unsized
            filler column soaks up any width beyond the columns' own — without
            it a fixed layout would stretch every column, including the two
            whose exact width the sticky offsets rely on. */}
              <colgroup>
                {slots.map((slot, slotIndex) => (
                  <col key={slotIndex} style={{ width: slot.width }} />
                ))}
                <col />
                {canMutateRows && <col style={{ width: ACTIONS_WIDTH }} />}
              </colgroup>

              <thead className="sticky top-0 z-30">
                <tr>
                  {slots.map((slot, slotIndex) => {
                    if (slot.kind === "spacer") {
                      return (
                        <th
                          key={`gap-${slotIndex}`}
                          aria-hidden
                          className="border-b bg-muted"
                        />
                      )
                    }

                    const { field, column, foreignKey, kind, dataIndex } =
                      slot.info
                    const index = slot.index
                    const sorted =
                      control?.sort?.column === field.name
                        ? control.sort.direction
                        : null
                    const SortIcon = sorted === "desc" ? ArrowDown : ArrowUp

                    return (
                      <th
                        key={`${field.name}-${dataIndex}`}
                        scope="col"
                        title={
                          column
                            ? `${column.name} · ${column.type}`
                            : field.name
                        }
                        style={index === 0 ? { left: 0 } : undefined}
                        className={cn(
                          "group/head relative border-r border-b bg-muted px-2 font-medium whitespace-nowrap text-muted-foreground",
                          index === 0 && "sticky z-10"
                        )}
                      >
                        <span className="flex h-7 items-center gap-1.5 overflow-hidden">
                          <ColumnIcon kind={kind} column={column} />
                          <span className="truncate text-foreground/80">
                            {field.name}
                          </span>
                          {column?.nullable === false && !column.primaryKey && (
                            <span className="text-[0.6rem] text-muted-foreground">
                              *
                            </span>
                          )}
                          {sorted && (
                            <SortIcon className="size-3 shrink-0 text-primary" />
                          )}
                          <ColumnMenu
                            name={field.name}
                            type={column?.type}
                            primaryKey={column?.primaryKey}
                            reference={
                              foreignKey
                                ? `${foreignKey.referencedTable}.${foreignKey.referencedColumns.join(", ")}`
                                : undefined
                            }
                            pref={prefs[field.name] ?? {}}
                            formats={formatOptionsFor(
                              column,
                              result.rows.find(
                                (row) =>
                                  row[dataIndex] !== null &&
                                  row[dataIndex] !== undefined
                              )?.[dataIndex]
                            )}
                            actions={{
                              sortDirection: sorted,
                              onSort: control?.onSort
                                ? (direction) =>
                                    control.onSort!(
                                      direction
                                        ? { column: field.name, direction }
                                        : null
                                    )
                                : undefined,
                              onRename: control?.onRename
                                ? () => control.onRename!(field.name)
                                : undefined,
                              onDrop: control?.onDrop
                                ? () => control.onDrop!(field.name)
                                : undefined,
                            }}
                            onPref={(pref) => setPref(field.name, pref)}
                          />
                        </span>
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${field.name}`}
                          onPointerDown={(event) =>
                            startResize(event, dataIndex)
                          }
                          onDoubleClick={() =>
                            setWidths((current) => {
                              const next = { ...current }
                              delete next[dataIndex]
                              return next
                            })
                          }
                          className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none opacity-0 transition-opacity group-hover/head:opacity-100 hover:bg-primary/60"
                        />
                      </th>
                    )
                  })}
                  <th className="border-b bg-muted" />
                  {canMutateRows && (
                    <th className="border-b bg-muted p-0 text-center align-middle">
                      {edit?.onAddColumn && (
                        <AddColumnPopover
                          columnTypes={edit.onAddColumn.columnTypes}
                          onSubmit={edit.onAddColumn.onSubmit}
                        />
                      )}
                    </th>
                  )}
                </tr>
              </thead>

              <tbody ref={bodyRef}>
                {padTop > 0 && (
                  <tr aria-hidden style={{ height: padTop }}>
                    <td colSpan={columnCount} />
                  </tr>
                )}

                {virtualRows.map((virtualRow) => {
                  const rowIndex = virtualRow.index
                  const row = result.rows[rowIndex]!
                  return (
                    <tr
                      key={rowIndex}
                      data-row={rowIndex}
                      className={cn("group", ROW_HEIGHT, "hover:bg-muted/40")}
                    >
                      {slots.map((slot, slotIndex) => {
                        if (slot.kind === "spacer") {
                          return (
                            <td key={`gap-${slotIndex}`} className="border-b" />
                          )
                        }

                        const {
                          field,
                          column,
                          foreignKey,
                          kind,
                          editable,
                          dataIndex,
                        } = slot.info
                        const index = slot.index
                        const onCommit = editable
                          ? (value: string | null) => {
                              stage(rowIndex, field.name, value)
                              setEditing(false)
                            }
                          : undefined

                        // An unsaved edit stands in for the stored value, so
                        // the grid reads as what saving would leave behind.
                        const key = `${rowIndex}:${field.name}`
                        const dirty = key in pending
                        const value = dirty
                          ? asStoredShape(pending[key]!, kind)
                          : row[dataIndex]

                        return (
                          <GridCell
                            key={`${field.name}-${dataIndex}`}
                            value={value}
                            pref={prefs[field.name] ?? EMPTY_PREF}
                            kind={kind}
                            column={column}
                            foreignKey={foreignKey}
                            fkLabel={
                              foreignKey && edit
                                ? edit.fkLabels[field.name]?.get(String(value))
                                : undefined
                            }
                            searchForeignKeyRows={edit?.searchForeignKeyRows}
                            editable={editable}
                            dirty={dirty}
                            sticky={index === 0}
                            address={`${rowIndex}-${index}`}
                            active={
                              active?.row === rowIndex && active.col === index
                            }
                            editing={
                              editing &&
                              active?.row === rowIndex &&
                              active.col === index
                            }
                            onActivate={() => {
                              setActive({ row: rowIndex, col: index })
                              setEditing(false)
                            }}
                            onEdit={() => {
                              setActive({ row: rowIndex, col: index })
                              setEditing(true)
                            }}
                            onEditEnd={() => setEditing(false)}
                            onCommit={onCommit}
                            onExpand={(text) => setExpanded(text)}
                          />
                        )
                      })}

                      <td className="border-b" />

                      {/* Deleting a row lives in its context menu now — a hover
                          button repeated down every row was one destructive
                          action too easy to reach for what the menu already
                          offers. The cell stays, empty, so the column itself
                          (and the sticky offsets that assume it) doesn't shift
                          between a table that can mutate rows and one that
                          can't. */}
                      {canMutateRows && (
                        <td
                          style={{ right: 0 }}
                          className={cn(STICKY_CELL, "border-b")}
                        />
                      )}
                    </tr>
                  )
                })}

                {padBottom > 0 && (
                  <tr aria-hidden style={{ height: padBottom }}>
                    <td colSpan={columnCount} />
                  </tr>
                )}

                {edit?.onRequestInsert &&
                  canMutateRows &&
                  (edit.inserting ? (
                    <tr className={cn(ROW_HEIGHT, "bg-muted/20")}>
                      {slots.map((slot, slotIndex) => {
                        if (slot.kind === "spacer") {
                          return (
                            <td key={`gap-${slotIndex}`} className="border-b" />
                          )
                        }

                        const { field, column, dataIndex } = slot.info
                        const index = slot.index
                        const generated = column?.generatedExpression != null
                        const editableType = column
                          ? edit.isEditableType(column.type)
                          : true
                        return (
                          <td
                            key={`draft-${field.name}-${dataIndex}`}
                            style={index === 0 ? { left: 0 } : undefined}
                            className={cn(
                              "relative border-r border-b px-1 align-middle",
                              index === 0 && "sticky z-20 bg-background"
                            )}
                          >
                            <Input
                              autoFocus={index === 0}
                              value={insertDraft[field.name] ?? ""}
                              disabled={
                                insertBusy || generated || !editableType
                              }
                              onChange={(event) =>
                                setInsertDraft((current) => ({
                                  ...current,
                                  [field.name]: event.target.value,
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault()
                                  void saveInsertDraft()
                                }
                                if (event.key === "Escape")
                                  edit.onCancelInsert?.()
                              }}
                              placeholder={
                                generated
                                  ? "generated"
                                  : column?.default
                                    ? "default"
                                    : column?.nullable
                                      ? "NULL"
                                      : ""
                              }
                              spellCheck={false}
                              className="h-6 px-1.5 font-mono text-xs md:text-xs"
                            />
                          </td>
                        )
                      })}
                      <td className="border-b" />
                      <td
                        style={{ right: 0 }}
                        className={cn(
                          STICKY_CELL,
                          "relative border-b text-center align-middle"
                        )}
                      >
                        <span className="flex items-center justify-center gap-1">
                          <IconButton
                            label="Save row"
                            onClick={() => void saveInsertDraft()}
                          >
                            <Check />
                          </IconButton>
                          <IconButton
                            label="Discard row"
                            onClick={() => edit.onCancelInsert?.()}
                          >
                            <X />
                          </IconButton>
                        </span>
                      </td>
                    </tr>
                  ) : (
                    <tr
                      className={cn("group", ROW_HEIGHT, "hover:bg-muted/40")}
                    >
                      <td colSpan={columnCount} className="border-b p-0">
                        {/* Sticky inside the cell, not the cell itself: the row spans
                    the whole table, so only the button needs to stay put while
                    the columns scroll past it. */}
                        <div className="sticky left-0 inline-flex">
                          <button
                            type="button"
                            onClick={edit.onRequestInsert}
                            className="flex h-8 items-center gap-1.5 px-3 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <Plus className="size-3.5" />
                            New row
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>

            {result.rows.length === 0 && <Notice>{emptyLabel}</Notice>}
          </ContextMenuTrigger>
        </div>

        {actionError && (
          <p
            className={cn(
              "absolute right-2 z-40 max-w-96 rounded-md border bg-destructive/10 px-2 py-1 text-[0.65rem] whitespace-pre-wrap text-destructive shadow-sm",
              // Above the save bar when both are up: the error is usually that
              // bar's own, and the two must not sit on top of each other.
              pendingCount > 0 ? "bottom-14" : "bottom-2"
            )}
          >
            {actionError}
          </p>
        )}

        {/* The unsaved edits, and the only way they reach the database. Across
            the foot of the grid rather than per cell: a correction is rarely
            one cell, and a bar per cell would have put a pair of buttons under
            each of them. */}
        {pendingCount > 0 && (
          <div className="absolute inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t bg-popover/95 px-3 py-2 shadow-[0_-2px_8px_rgb(0_0_0/0.06)] backdrop-blur-sm">
            <span className="size-2 rounded-full bg-warning" />
            <span className="text-xs text-muted-foreground">
              {pendingCount} unsaved {pendingCount === 1 ? "cell" : "cells"}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={saving}
                onClick={discard}
              >
                Discard
              </Button>
              <Button
                type="button"
                size="xs"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {menuTarget && menuRow && (
        <ContextMenuContent className="w-56">
          {menuInfo && (
            <>
              <ContextMenuItem
                onClick={() =>
                  void navigator.clipboard.writeText(
                    formatCell(
                      menuRow[menuInfo.dataIndex],
                      prefs[menuInfo.field.name]
                    ).text
                  )
                }
              >
                <Copy />
                Copy cell
              </ContextMenuItem>
            </>
          )}
          <ContextMenuItem
            onClick={() =>
              void navigator.clipboard.writeText(
                rowAsJson(result.fields, menuRow)
              )
            }
          >
            <Braces />
            Copy row as JSON
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setExpandedRow(menuTarget.row)}>
            <Maximize2 />
            Expand row
          </ContextMenuItem>

          {menuInfo?.editable && (
            <>
              <ContextMenuSeparator />
              {menuInfo.kind !== "boolean" && (
                <ContextMenuItem
                  onClick={() => {
                    setActive({ row: menuTarget.row, col: menuTarget.col! })
                    setEditing(true)
                  }}
                >
                  <Pencil />
                  Edit cell
                </ContextMenuItem>
              )}
              {menuInfo.column?.nullable && (
                <ContextMenuItem
                  onClick={() =>
                    void clearCell(menuTarget.row, menuTarget.col!)
                  }
                >
                  <X />
                  Set NULL
                </ContextMenuItem>
              )}
            </>
          )}

          {menuInfo && (control?.onSort || control) && (
            <>
              <ContextMenuSeparator />
              {control?.onSort && (
                <>
                  <ContextMenuItem
                    onClick={() =>
                      control.onSort!({
                        column: menuInfo.field.name,
                        direction: "asc",
                      })
                    }
                  >
                    <ArrowUpAZ />
                    Sort ascending
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() =>
                      control.onSort!({
                        column: menuInfo.field.name,
                        direction: "desc",
                      })
                    }
                  >
                    <ArrowDownAZ />
                    Sort descending
                  </ContextMenuItem>
                </>
              )}
              <ContextMenuItem
                onClick={() => setPref(menuInfo.field.name, { hidden: true })}
              >
                <EyeOff />
                Hide field
              </ContextMenuItem>
            </>
          )}

          {(edit?.onRequestInsert || canMutateRows) && <ContextMenuSeparator />}
          {edit?.onRequestInsert && canMutateRows && (
            <ContextMenuItem onClick={edit.onRequestInsert}>
              <Plus />
              New row
            </ContextMenuItem>
          )}
          {canMutateRows && (
            <ContextMenuItem
              variant="destructive"
              onClick={() => edit!.onRequestDelete(menuRow)}
            >
              <Trash2 />
              Delete row
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      )}

      <CellDialog text={expanded} onClose={() => setExpanded(null)} />
      <RowDialog
        fields={result.fields}
        row={expandedRow === null ? null : (result.rows[expandedRow] ?? null)}
        columns={edit?.columns}
        onDelete={
          canMutateRows && expandedRow !== null
            ? () => {
                const row = result.rows[expandedRow]
                setExpandedRow(null)
                if (row) edit!.onRequestDelete(row)
              }
            : undefined
        }
        onClose={() => setExpandedRow(null)}
      />
    </ContextMenu>
  )
})

/**
 * The trailing column header's own "+" — a small popover to add a column
 * without leaving the grid, rather than a bar of its own above it.
 */
export function AddColumnPopover({
  columnTypes,
  onSubmit,
  trigger = (
    <IconButton label="Add column">
      <Plus />
    </IconButton>
  ),
}: {
  columnTypes: string[]
  onSubmit: (column: NewColumnDraft) => Promise<string | null>
  /** Defaults to an icon-only "+" — room enough for a label belongs to the
   * caller to say, not this. */
  trigger?: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<NewColumnDraft>(newColumnDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invalid = newColumnError(draft)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || invalid) return
    setBusy(true)
    setError(null)
    const failure = await onSubmit(draft)
    setBusy(false)
    if (failure) {
      setError(failure)
      return
    }
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          // A fresh draft every time it opens, rather than whatever was left
          // over from the last column added (or abandoned) through it.
          setDraft(newColumnDraft)
          setError(null)
        }
      }}
    >
      <PopoverTrigger render={trigger} />
      <PopoverContent align="end" className="w-56 p-3">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Label className="flex flex-col items-start gap-0.5 text-[0.65rem] font-normal text-muted-foreground">
            Name
            <Input
              autoFocus
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="published_at"
              spellCheck={false}
              className="h-7 w-full font-mono text-xs md:text-xs"
            />
          </Label>
          <Label className="flex flex-col items-start gap-0.5 text-[0.65rem] font-normal text-muted-foreground">
            Type
            <Select
              value={draft.type}
              onValueChange={(type) =>
                setDraft((current) => ({ ...current, type: type ?? "" }))
              }
            >
              <SelectTrigger
                size="sm"
                aria-label="Type"
                className="h-7 w-full font-mono text-xs"
              >
                <SelectValue placeholder="type" />
              </SelectTrigger>
              <SelectContent>
                {columnTypes.map((type) => (
                  <SelectItem
                    key={type}
                    value={type}
                    className="font-mono text-xs"
                  >
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label className="flex flex-col items-start gap-0.5 text-[0.65rem] font-normal text-muted-foreground">
            Default
            <Input
              value={draft.default}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  default: event.target.value,
                }))
              }
              placeholder="—"
              spellCheck={false}
              className="h-7 w-full font-mono text-xs md:text-xs"
            />
          </Label>
          <Label className="flex items-center gap-1.5 text-[0.65rem] font-normal text-muted-foreground">
            <Checkbox
              checked={draft.nullable}
              onCheckedChange={(nullable) =>
                setDraft((current) => ({ ...current, nullable }))
              }
            />
            Nullable
          </Label>

          {error && (
            <p className="font-mono text-xs whitespace-pre-wrap text-destructive">
              {error}
            </p>
          )}

          <div className="mt-1 flex items-center justify-end gap-1.5">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="xs" disabled={busy || invalid !== null}>
              {busy ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

/** One row as a JSON object, for the clipboard. Values keep their own shape
 * where JSON has one, and fall back to the grid's own rendering where it
 * doesn't — a date reads better as its ISO string than as `{}`. */
function rowAsJson(fields: SqlField[], row: unknown[]): string {
  const object: Record<string, unknown> = {}
  fields.forEach((field, index) => {
    const value = row[index]
    object[field.name] =
      value === null || value === undefined || typeof value !== "object"
        ? (value ?? null)
        : value instanceof Date
          ? value.toISOString()
          : value instanceof Uint8Array
            ? `${value.byteLength} bytes`
            : value
  })
  return JSON.stringify(object, null, 2)
}

/**
 * An unsaved edit, as the value the engine would have handed back for it.
 *
 * Edits are held as the string that will be written, which is what the update
 * takes — but the cells draw stored values, and a boolean drawn from the
 * string "false" would be `Boolean("false")`, which is true. Everything else
 * stays a string: a number column showing "42" before the save and 42 after it
 * reads the same, and rewriting the user's own text would be claiming to know
 * what the engine will make of it.
 */
function asStoredShape(value: string | null, kind: FieldKind): unknown {
  if (value === null) return null
  return kind === "boolean" ? value === "true" : value
}

/** Whether an edit would write back the value the cell already holds — checked
 * against the stored value's own text, so `42` and "42" are the same edit. */
function sameAsStored(stored: unknown, staged: string | null): boolean {
  if (stored === null || stored === undefined) return staged === null
  if (staged === null) return false
  if (typeof stored === "boolean") return String(stored) === staged
  return formatCell(stored).text === staged
}

/** Roughly how wide a column has to be to show its header and its values —
 * sampled from the first rows only, which is enough to stop an `id` column
 * from taking the same room as a `description` one. */
function measureColumns(result: SqlResult): number[] {
  const SAMPLE = 30
  return result.fields.map((field, index) => {
    let longest = field.name.length + 3 // the type icon sits before the name
    for (let row = 0; row < Math.min(result.rows.length, SAMPLE); row++) {
      const { text } = formatCell(result.rows[row]?.[index])
      if (text.length > longest) longest = text.length
    }
    return clamp(Math.round(longest * 7.1 + 28), 96, 360)
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** The header's at-a-glance column type, in the same vocabulary as the cell
 * renderers: what the column *is*, not what SQL calls it. */
function ColumnIcon({ kind, column }: { kind: FieldKind; column?: Column }) {
  const Icon = (() => {
    if (column?.primaryKey) return KeyRound
    if (kind === "generated") return Sigma
    if (kind === "boolean") return SquareCheck
    if (kind === "select") return List
    if (kind === "foreign-key") return Link2
    const type = column?.type.toLowerCase() ?? ""
    if (/int|numeric|decimal|float|double|real|serial|money/.test(type))
      return Hash
    if (/date|time|year/.test(type)) return CalendarClock
    if (/json|xml/.test(type)) return Braces
    if (/bytea|blob|binary/.test(type)) return Binary
    return Type
  })()
  return <Icon className="size-3 shrink-0 opacity-70" />
}

/** What every cell renderer needs to sit in the grid: its place in the
 * selection model, and the classes that place it visually. */
type CellShell = {
  sticky: boolean
  address: string
  active: boolean
  /** Changed and not yet written, so it is tinted apart from the rows around
   * it — the one thing telling the reader the value under the cursor is not
   * the one in the database. */
  dirty: boolean
  /** The column is set to wrap: the cell grows to fit its value instead of
   * truncating it, and its row grows with it. */
  wrap: boolean
  onActivate: () => void
}

/** The `<td>` props shared by every kind of cell. */
function shellProps(shell: CellShell, extra?: string) {
  return {
    role: "gridcell" as const,
    tabIndex: -1,
    "data-cell": shell.address,
    "aria-selected": shell.active,
    style: shell.sticky ? { left: 0 } : undefined,
    onPointerDown: shell.onActivate,
    className: cn(
      "relative border-r border-b px-2 outline-none",
      shell.wrap ? "py-1 align-top" : "align-middle",
      shell.sticky && STICKY_CELL,
      // Before the sticky cell's own background, which would otherwise paint
      // over it — see STICKY_CELL's `before` layer.
      shell.dirty && "bg-warning/20 before:bg-warning/20",
      shell.active && "ring-2 ring-primary ring-inset",
      extra
    ),
  }
}

/** How a cell's own text behaves inside it. */
function contentClass(shell: CellShell): string {
  return shell.wrap ? "block break-words whitespace-pre-wrap" : "block truncate"
}

/**
 * Dispatches a cell to a kind-specific renderer/editor. `text` (the default,
 * and the only kind reachable when `edit` was never passed in — the SQL
 * console's results have no column metadata to infer anything richer from)
 * keeps a plain text input; the others each have their own display *and* edit
 * affordance, so they get their own small components rather than more branches
 * bolted onto `TextCell`.
 */
function GridCell({
  value,
  pref,
  kind,
  column,
  foreignKey,
  fkLabel,
  searchForeignKeyRows,
  editable,
  dirty,
  sticky,
  address,
  active,
  editing,
  onActivate,
  onEdit,
  onEditEnd,
  onCommit,
  onExpand,
}: {
  value: unknown
  pref: ColumnPref
  kind: FieldKind
  column?: Column
  foreignKey?: ForeignKey
  fkLabel?: string
  searchForeignKeyRows?: (
    fk: ForeignKey,
    search?: string
  ) => Promise<LabelRow[]>
  editable: boolean
  /** The cell holds an unsaved edit — see `ResultGrid`'s `pending`. */
  dirty: boolean
  sticky: boolean
  address: string
  active: boolean
  editing: boolean
  onActivate: () => void
  onEdit: () => void
  onEditEnd: () => void
  /** Holds the new value as an unsaved edit — the write happens when the bar
   * at the foot of the grid is used, not here. */
  onCommit?: (value: string | null) => void
  onExpand: (text: string) => void
}) {
  const shell: CellShell = {
    sticky,
    address,
    active,
    dirty,
    wrap: Boolean(pref.wrap),
    onActivate,
  }

  if (kind === "generated" && column) {
    return (
      <GeneratedCell
        shell={shell}
        value={value}
        pref={pref}
        expression={column.generatedExpression ?? ""}
        onExpand={onExpand}
      />
    )
  }
  if (kind === "boolean") {
    return (
      <BooleanCell
        shell={shell}
        value={value}
        nullable={column?.nullable ?? true}
        editable={editable}
        onCommit={onCommit}
        onExpand={onExpand}
      />
    )
  }
  if (kind === "select" && column?.enumValues) {
    return (
      <SelectCell
        shell={shell}
        value={value}
        enumValues={column.enumValues}
        nullable={column.nullable}
        editable={editable}
        open={editing}
        onOpen={onEdit}
        onClose={onEditEnd}
        onCommit={onCommit}
        onExpand={onExpand}
      />
    )
  }
  if (kind === "foreign-key" && foreignKey && searchForeignKeyRows) {
    return (
      <ForeignKeyCell
        shell={shell}
        value={value}
        label={fkLabel}
        nullable={column?.nullable ?? true}
        foreignKey={foreignKey}
        onSearch={searchForeignKeyRows}
        editable={editable}
        open={editing}
        onOpen={onEdit}
        onClose={onEditEnd}
        onCommit={onCommit}
        onExpand={onExpand}
      />
    )
  }
  return (
    <TextCell
      shell={shell}
      value={value}
      pref={pref}
      editable={editable}
      editing={editing}
      onEdit={onEdit}
      onEditEnd={onEditEnd}
      onCommit={onCommit}
      onExpand={onExpand}
    />
  )
}

/** A cell whose column is `generated` — read-only no matter what, regardless
 * of anything a broader `editable` computation might otherwise allow. */
function GeneratedCell({
  shell,
  value,
  pref,
  expression,
  onExpand,
}: {
  shell: CellShell
  value: unknown
  pref: ColumnPref
  expression: string
  onExpand: (text: string) => void
}) {
  const { text, muted } = formatCell(value, pref)
  return (
    <td
      {...shellProps(
        shell,
        cn("cursor-default", muted && "text-muted-foreground italic")
      )}
      title={`Generated: ${expression}`}
      onDoubleClick={() => onExpand(text)}
    >
      <span className={contentClass(shell)}>{text}</span>
    </td>
  )
}

/** An inline tri-state toggle (true / false / NULL when nullable) — commits
 * immediately on click, unlike every other kind, which opens some picker. */
function BooleanCell({
  shell,
  value,
  nullable,
  editable,
  onCommit,
  onExpand,
}: {
  shell: CellShell
  value: unknown
  nullable: boolean
  editable: boolean
  /** Holds the new value as an unsaved edit — the write happens when the bar
   * at the foot of the grid is used, not here. */
  onCommit?: (value: string | null) => void
  onExpand: (text: string) => void
}) {
  const current = value === null || value === undefined ? null : Boolean(value)

  function cycle() {
    if (!editable) {
      onExpand(formatCell(value).text)
      return
    }
    const next =
      current === true
        ? false
        : current === false
          ? nullable
            ? null
            : true
          : true
    onCommit!(next === null ? null : String(next))
  }

  const Icon =
    current === true ? SquareCheck : current === false ? Square : SquareMinus

  return (
    <td {...shellProps(shell)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={current === null ? "mixed" : current}
        onClick={cycle}
        className={cn(
          "inline-flex items-center rounded-sm text-muted-foreground hover:text-foreground",
          current === true && "text-primary",
          !editable && "cursor-default"
        )}
      >
        <Icon className="size-4" />
      </button>
    </td>
  )
}

/** A native-enum column: a colored pill, editable through a small popover
 * listing every declared label. */
function SelectCell({
  shell,
  value,
  enumValues,
  nullable,
  editable,
  open,
  onOpen,
  onClose,
  onCommit,
  onExpand,
}: {
  shell: CellShell
  value: unknown
  enumValues: string[]
  nullable: boolean
  editable: boolean
  open: boolean
  onOpen: () => void
  onClose: () => void
  /** Holds the new value as an unsaved edit — the write happens when the bar
   * at the foot of the grid is used, not here. */
  onCommit?: (value: string | null) => void
  onExpand: (text: string) => void
}) {
  const label = value === null || value === undefined ? null : String(value)

  function choose(next: string | null) {
    onClose()
    onCommit!(next)
  }

  const pill =
    label === null ? (
      <span className="text-muted-foreground italic">NULL</span>
    ) : (
      <Pill label={label} />
    )

  if (!editable) {
    return (
      <td
        {...shellProps(shell, "cursor-default")}
        onDoubleClick={() => onExpand(label ?? "NULL")}
      >
        <span className={contentClass(shell)}>{pill}</span>
      </td>
    )
  }

  return (
    <td {...shellProps(shell)}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) onOpen()
          else onClose()
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex w-full items-center truncate rounded-sm text-left hover:opacity-80"
            >
              {pill}
            </button>
          }
        />
        <PopoverContent align="start" className="w-48 p-1">
          <Command>
            <CommandList>
              {nullable && (
                <CommandItem value="__null__" onSelect={() => choose(null)}>
                  <span className="text-muted-foreground italic">NULL</span>
                </CommandItem>
              )}
              {enumValues.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={() => choose(option)}
                >
                  <Pill label={option} />
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </td>
  )
}

/** A foreign-key column: a pill showing the referenced row's label (falling
 * back to the raw value until it resolves, or if it never does), editable
 * through a searchable popover of candidate rows. */
function ForeignKeyCell({
  shell,
  value,
  label,
  nullable,
  foreignKey,
  onSearch,
  editable,
  open,
  onOpen,
  onClose,
  onCommit,
  onExpand,
}: {
  shell: CellShell
  value: unknown
  label?: string
  nullable: boolean
  foreignKey: ForeignKey
  onSearch: (fk: ForeignKey, search?: string) => Promise<LabelRow[]>
  editable: boolean
  open: boolean
  onOpen: () => void
  onClose: () => void
  /** Holds the new value as an unsaved edit — the write happens when the bar
   * at the foot of the grid is used, not here. */
  onCommit?: (value: string | null) => void
  onExpand: (text: string) => void
}) {
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState<LabelRow[] | null>(null)
  const rawText = value === null || value === undefined ? "NULL" : String(value)

  useEffect(() => {
    if (!open) return
    let current = true
    const timeout = setTimeout(() => {
      void onSearch(foreignKey, search || undefined).then((result) => {
        if (current) setRows(result)
      })
    }, 200)
    return () => {
      current = false
      clearTimeout(timeout)
    }
  }, [open, search, foreignKey, onSearch])

  function choose(row: LabelRow) {
    onClose()
    const next = Object.values(row.pk)[0]
    onCommit!(next === null || next === undefined ? null : String(next))
  }

  function clear() {
    onClose()
    onCommit!(null)
  }

  const pill =
    value === null || value === undefined ? (
      <span className="text-muted-foreground italic">NULL</span>
    ) : (
      <Pill label={label ?? rawText} tone="link" />
    )

  if (!editable) {
    return (
      <td
        {...shellProps(shell, "cursor-default")}
        onDoubleClick={() => onExpand(rawText)}
      >
        <span className={contentClass(shell)}>{pill}</span>
      </td>
    )
  }

  return (
    <td {...shellProps(shell)}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) {
            onOpen()
            return
          }
          onClose()
          setSearch("")
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex w-full items-center truncate rounded-sm text-left hover:opacity-80"
            >
              {pill}
            </button>
          }
        />
        <PopoverContent align="start" className="w-64 p-1">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={`Search ${foreignKey.referencedTable}…`}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {nullable && (
                <CommandItem value="__null__" onSelect={clear}>
                  <span className="text-muted-foreground italic">NULL</span>
                </CommandItem>
              )}
              {rows === null ? (
                <CommandEmpty>Loading…</CommandEmpty>
              ) : rows.length === 0 ? (
                <CommandEmpty>No matching rows.</CommandEmpty>
              ) : (
                rows.map((row, index) => (
                  <CommandItem
                    key={index}
                    value={`${index}-${row.label}`}
                    onSelect={() => choose(row)}
                  >
                    {row.label || (
                      <span className="text-muted-foreground italic">
                        empty
                      </span>
                    )}
                  </CommandItem>
                ))
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </td>
  )
}

/** A colored pill for an enum label or a foreign-key's display label. */
function Pill({ label, tone }: { label: string; tone?: "link" }) {
  const color = colorForEnumLabel(label)
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "link"
          ? "bg-accent text-accent-foreground"
          : `${color.bg} ${color.fg}`
      )}
    >
      {label}
    </span>
  )
}

function TextCell({
  shell,
  value,
  pref,
  editable,
  editing,
  onEdit,
  onEditEnd,
  onCommit,
  onExpand,
}: {
  shell: CellShell
  value: unknown
  pref: ColumnPref
  editable: boolean
  editing: boolean
  onEdit: () => void
  onEditEnd: () => void
  /** Holds the new value as an unsaved edit — the write happens when the bar
   * at the foot of the grid is used, not here. */
  onCommit?: (value: string | null) => void
  onExpand: (text: string) => void
}) {
  const { text, muted } = formatCell(value, pref)

  if (editing && onCommit) {
    return (
      // onPointerDown overridden to a no-op: the cell is already active, and
      // a click placing the caret inside the input would otherwise bubble up
      // and re-trigger onActivate, which clears `editing` and kicks the
      // editor out from under the click.
      <td {...shellProps(shell, "px-1")} onPointerDown={undefined}>
        {/* Mounted fresh for each edit, so the draft always starts from the
            value currently in the database rather than from a stale one. */}
        <TextEditor
          initial={formatCell(value).text}
          initiallyNull={value === null || value === undefined}
          onCommit={onCommit}
          onCancel={onEditEnd}
        />
      </td>
    )
  }

  return (
    <td
      {...shellProps(
        shell,
        cn("cursor-default", muted && "text-muted-foreground italic")
      )}
      title={text}
      onDoubleClick={() => (editable ? onEdit() : onExpand(text))}
    >
      <span className={contentClass(shell)}>{text}</span>
    </td>
  )
}

/**
 * The text input a `TextCell` swaps in while it is being edited.
 *
 * Leaving the input keeps what was typed rather than throwing it away: the
 * value is only staged, and the bar at the foot of the grid is what decides
 * whether it is ever written. Escape is the way out without keeping it. A
 * draft equal to what is already in the cell stages nothing — which is what
 * makes opening a NULL cell to read it harmless, since its draft starts empty
 * and leaving it that way used to write an empty string over the NULL.
 */
function TextEditor({
  initial,
  initiallyNull,
  onCommit,
  onCancel,
}: {
  initial: string
  initiallyNull: boolean
  onCommit: (value: string | null) => void
  onCancel: () => void
}) {
  const original = initiallyNull ? "" : initial
  const [draft, setDraft] = useState(original)
  // Enter and the blur it causes would otherwise stage the same value twice.
  const settled = useRef(false)

  function commit() {
    if (settled.current) return
    settled.current = true
    if (draft !== original) onCommit(draft)
    onCancel()
  }

  function cancel() {
    settled.current = true
    onCancel()
  }

  return (
    <Input
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          commit()
        }
        if (event.key === "Escape") cancel()
      }}
      onBlur={commit}
      className="h-6 min-w-16 px-1.5 font-mono text-xs md:text-xs"
    />
  )
}

/** Shows a cell's untruncated value, for cells too long to read from the grid. */
function CellDialog({
  text,
  onClose,
}: {
  text: string | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  return (
    <Dialog
      open={text !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cell value</DialogTitle>
        </DialogHeader>
        <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
          {text}
        </pre>
        <DialogFooter showCloseButton>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(text ?? "")
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** One row as a record: every field on its own line, for rows too wide to read
 * across. Read-only — the grid itself is where a value gets changed. */
function RowDialog({
  fields,
  row,
  columns,
  onDelete,
  onClose,
}: {
  fields: SqlField[]
  row: unknown[] | null
  columns?: Column[]
  onDelete?: () => void
  onClose: () => void
}) {
  const columnByName = new Map(
    (columns ?? []).map((column) => [column.name, column])
  )

  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Row</DialogTitle>
        </DialogHeader>
        <dl className="max-h-[60vh] space-y-2 overflow-auto pr-1">
          {fields.map((field, index) => {
            const { text, muted } = formatCell(row?.[index])
            const column = columnByName.get(field.name)
            return (
              <div
                key={`${field.name}-${index}`}
                className="grid grid-cols-3 gap-3"
              >
                <dt className="flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground">
                  {column?.primaryKey && (
                    <KeyRound className="size-3 shrink-0" />
                  )}
                  <span className="truncate" title={field.name}>
                    {field.name}
                  </span>
                </dt>
                <dd
                  className={cn(
                    "col-span-2 font-mono text-xs break-words",
                    muted && "text-muted-foreground italic"
                  )}
                >
                  {text}
                </dd>
              </div>
            )
          })}
        </dl>
        <DialogFooter showCloseButton>
          {onDelete && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onDelete}
            >
              <Trash2 data-icon="inline-start" />
              Delete row
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>
}
