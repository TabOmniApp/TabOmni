import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * A picker whose list is a suggestion rather than a rule.
 *
 * Two fields want this — a spec's status, and an item's control — and both for
 * the same reason. Typed by hand, one project ends up with "Approved",
 * "approved" and "APPROVED", or with "Input", "input" and "TextBox", and
 * nothing can group or filter them. But a closed list is worse: a team with its
 * own vocabulary would find this panel quietly correcting their documents.
 *
 * So the value stays a plain string, and a document already saying something
 * outside `options` keeps its word — offered at the bottom of the menu, where
 * it can be seen and changed but is never lost.
 *
 * Built the same way as the project picker in `studio.tsx`, down to
 * `alignItemWithTrigger`: `items` is what the trigger reads its label from, and
 * without it Base UI stringifies the value itself.
 */
export function OpenSelect({
  value,
  options,
  label,
  placeholder,
  className,
  onChange,
}: {
  value: string
  options: string[]
  /** The accessible name — this control never carries a visible one. */
  label: string
  placeholder: string
  className?: string
  onChange: (value: string) => void
}) {
  const known = options.includes(value)
  const all = known || !value ? options : [...options, value]

  return (
    <Select
      items={all.map((option) => ({ value: option, label: option }))}
      value={value || null}
      onValueChange={(next) => {
        if (next) onChange(next)
      }}
    >
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        className="w-auto min-w-(--anchor-width)"
      >
        {all.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
