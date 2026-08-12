import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Copy,
  EyeOff,
  Pencil,
  Settings2,
  SlidersHorizontal,
  Trash2,
  WrapText,
  X,
} from "lucide-react"

import type { ColumnPref, FormatOption } from "@/lib/db/display"

/** Everything one column's header menu can do, beyond the display preferences
 * every column has. Each is optional: the SQL console's results have no table
 * to sort, rename a column of, or drop one from. */
export type ColumnActions = {
  sortDirection?: "asc" | "desc" | null
  onSort?: (direction: "asc" | "desc" | null) => void
  onRename?: () => void
  onDrop?: () => void
}

/**
 * The settings menu on a column header: how the column is ordered, how its
 * values are rendered, and — for a real table column — renaming and dropping
 * it.
 *
 * Sorting and the DDL items reach the database; everything else is display
 * only and lives in the session (see `ColumnPref`).
 */
export function ColumnMenu({
  name,
  type,
  reference,
  primaryKey,
  pref,
  formats,
  actions,
  onPref,
}: {
  name: string
  /** The SQL type, when the column was introspected from a real table. */
  type?: string
  /** `users.id`, for a foreign key. */
  reference?: string
  primaryKey?: boolean
  pref: ColumnPref
  /** Formats that can apply to this column's values — empty for a kind with
   * nothing to format, such as text or boolean. */
  formats: FormatOption[]
  actions: ColumnActions
  onPref: (pref: Partial<ColumnPref>) => void
}) {
  const { sortDirection, onSort, onRename, onDrop } = actions
  // Anything the user has already set stays visible without hovering, so a
  // sorted or reformatted column advertises itself.
  const touched = Boolean(sortDirection || pref.format || pref.wrap)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`${name} settings`}
            className={cn(
              "ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover/head:opacity-100 hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent data-[popup-open]:opacity-100",
              touched && "opacity-100"
            )}
          >
            <Settings2 className="size-3.5" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        {/* A plain heading, not `DropdownMenuLabel`: that one is Base UI's
            `Menu.GroupLabel`, which throws unless it is inside a `Menu.Group`
            whose items it names. This titles the whole menu. */}
        <div className="px-1.5 pt-1 pb-1.5">
          <p className="truncate font-mono text-xs font-medium">{name}</p>
          {(type || reference || primaryKey) && (
            <p className="truncate text-[0.65rem] text-muted-foreground">
              {[
                type,
                primaryKey ? "primary key" : null,
                reference ? `→ ${reference}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
        <DropdownMenuSeparator />

        {onSort && (
          <>
            <DropdownMenuItem
              onClick={() => onSort(sortDirection === "asc" ? null : "asc")}
            >
              <ArrowUpAZ />
              Sort ascending
              {sortDirection === "asc" && (
                <span className="ml-auto text-[0.65rem] text-muted-foreground">
                  on
                </span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onSort(sortDirection === "desc" ? null : "desc")}
            >
              <ArrowDownAZ />
              Sort descending
              {sortDirection === "desc" && (
                <span className="ml-auto text-[0.65rem] text-muted-foreground">
                  on
                </span>
              )}
            </DropdownMenuItem>
            {sortDirection && (
              <DropdownMenuItem onClick={() => onSort(null)}>
                <X />
                Clear sort
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}

        {formats.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <SlidersHorizontal />
              Format
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              <DropdownMenuRadioGroup
                value={pref.format ?? formats[0]!.id}
                onValueChange={(value) =>
                  onPref({
                    // The first option *is* the plain rendering; storing it
                    // would only be noise.
                    format:
                      value === formats[0]!.id ? undefined : String(value),
                  })
                }
              >
                {formats.map((option) => (
                  <DropdownMenuRadioItem key={option.id} value={option.id}>
                    {option.label}
                    <span className="ml-auto pl-3 font-mono text-[0.65rem] text-muted-foreground">
                      {option.example}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuCheckboxItem
          checked={Boolean(pref.wrap)}
          onCheckedChange={(checked) => onPref({ wrap: checked })}
        >
          <WrapText />
          Wrap text
        </DropdownMenuCheckboxItem>

        <DropdownMenuItem
          onClick={() => void navigator.clipboard.writeText(name)}
        >
          <Copy />
          Copy field name
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPref({ hidden: true })}>
          <EyeOff />
          Hide field
        </DropdownMenuItem>

        {(onRename || onDrop) && <DropdownMenuSeparator />}
        {onRename && (
          <DropdownMenuItem onClick={onRename}>
            <Pencil />
            Rename field…
          </DropdownMenuItem>
        )}
        {onDrop && (
          <DropdownMenuItem variant="destructive" onClick={onDrop}>
            <Trash2 />
            Delete field
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
