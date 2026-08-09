import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { CalendarIcon } from "lucide-react"

import { asDateInput } from "@/lib/spec/schema"

/**
 * A date, picked from a calendar.
 *
 * shadcn's own date-picker recipe — a `Popover` holding a `Calendar` — rather
 * than `<input type="date">`. The native control would work in Chromium, but it
 * is the one field in this panel that would then be drawn by the OS instead of
 * by the app, and its calendar cannot be themed to match anything around it.
 *
 * The value stays a string on the document, in `yyyy-mm-dd`. A spec's date is
 * read by people, sorted by machines, and diffed by git, and that is the one
 * format all three agree on; `asDateInput` is what lets a document written as
 * "07/08/2026" open here at all.
 */
export function DatePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)

  const iso = asDateInput(value)
  const selected = iso ? fromIso(iso) : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            aria-label="Date"
            className={cn(
              "w-full justify-start font-normal",
              !selected && "text-muted-foreground"
            )}
          >
            <CalendarIcon data-icon="inline-start" />
            {/*
              A date this cannot parse is still shown as it was written. It is
              what the document says, and replacing it with "Pick a date" would
              hide the very thing someone opened the field to correct.
            */}
            {selected ? format(selected) : value || "Pick a date"}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          autoFocus
          selected={selected}
          defaultMonth={selected}
          onSelect={(next) => {
            if (!next) return
            onChange(toIso(next))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * `yyyy-mm-dd` as a local `Date`.
 *
 * Built from parts rather than `new Date(iso)`, which reads a bare date as UTC
 * — so west of Greenwich the calendar would open on, and highlight, the day
 * before the one the document names.
 */
function fromIso(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number) as [
    number,
    number,
    number,
  ]
  return new Date(year, month - 1, day)
}

/** The reverse, and for the same reason: the local date, not the UTC one. */
function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/** Shown on the button. The OS locale, so a spec read in Vietnamese shows the
 * day first without this having to decide that itself. */
function format(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}
