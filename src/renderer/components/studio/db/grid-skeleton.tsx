import { cn } from "@/lib/utils"

/** The grid's own row height and default column width, so the placeholder and
 * the rows that replace it are laid out the same. */
const ROW_HEIGHT = "h-8"
const COLUMN_WIDTH = 160

/** Enough to fill a tall pane; the container clips the rest. */
const ROWS = 18

/** Stand-ins for a table whose columns have not been read yet. */
const UNKNOWN_COLUMNS = 5

/** Cell widths, cycled rather than random so a re-render doesn't reshuffle
 * them mid-wait. */
const BAR_WIDTHS = ["w-1/2", "w-3/4", "w-1/3", "w-2/3", "w-5/6", "w-2/5"]

/**
 * The grid as it will be laid out, while its rows are being read.
 *
 * A table's shape is known before its rows are — the columns come from the
 * schema — so the wait is drawn in that shape, headers and all, and the rows
 * land where the placeholder was. It replaces a line of text that said the
 * same thing in a corner of the toolbar, which was easy to miss on a page
 * still showing the previous page's rows.
 */
export function GridSkeleton({ columns }: { columns: string[] }) {
  const headers =
    columns.length > 0
      ? columns
      : Array.from({ length: UNKNOWN_COLUMNS }, () => "")

  return (
    <div
      className="h-full overflow-hidden"
      role="status"
      aria-busy="true"
      aria-label="Reading rows"
    >
      <div
        className="flex w-max min-w-full border-b bg-muted"
        style={{ height: 32 }}
      >
        {headers.map((name, index) => (
          <div
            key={`${name}-${index}`}
            className="flex shrink-0 items-center px-2"
            style={{ width: COLUMN_WIDTH }}
          >
            {name ? (
              <span className="truncate font-mono text-xs text-foreground/80">
                {name}
              </span>
            ) : (
              <Bar className="w-2/3" />
            )}
          </div>
        ))}
      </div>

      {/* The rows fade out downwards: the wait is what is being shown, not a
          page of eighteen rows that happens to be blank. */}
      <div className="animate-pulse [mask-image:linear-gradient(to_bottom,black_35%,transparent)]">
        {Array.from({ length: ROWS }, (_, row) => (
          <div key={row} className={cn("flex w-max min-w-full", ROW_HEIGHT)}>
            {headers.map((name, column) => (
              <div
                key={`${name}-${column}`}
                className="flex shrink-0 items-center border-b px-2"
                style={{ width: COLUMN_WIDTH }}
              >
                <Bar
                  className={
                    BAR_WIDTHS[(row * 3 + column * 5) % BAR_WIDTHS.length]
                  }
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function Bar({ className }: { className?: string }) {
  return (
    <span
      className={cn("h-2.5 rounded-sm bg-muted-foreground/20", className)}
    />
  )
}
