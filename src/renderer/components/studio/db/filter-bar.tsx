import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { Filter as FilterIcon, Plus, Sparkles, Trash2 } from "lucide-react"

import { takesValue } from "@/lib/db/engines/filters"
import type {
  Column,
  Filter,
  FilterOperator,
  FilterSet,
} from "@/lib/db/engines"
import { useStudio } from "@/lib/store"
import { IconButton } from "../icon-button"

/**
 * Which operators make sense for a column.
 *
 * By what the values *are*, not by what the column is called: `contains` on a
 * number column would build a `like` against an integer, which Postgres
 * refuses outright and MySQL answers surprisingly.
 */
const COMPARISONS: FilterOperator[] = ["=", "!=", ">", ">=", "<", "<="]
const TEXT_ONLY: FilterOperator[] = [
  "contains",
  "not contains",
  "starts with",
  "ends with",
]
const NULLS: FilterOperator[] = ["is null", "is not null"]

function operatorsFor(column: Column | undefined): FilterOperator[] {
  const type = column?.type.toLowerCase() ?? ""
  const textish =
    type === "" ||
    /char|text|uuid|json|enum|clob/.test(type) ||
    (column?.enumValues?.length ?? 0) > 0

  return [
    ...COMPARISONS,
    ...(textish ? TEXT_ONLY : []),
    ...(column?.nullable !== false ? NULLS : []),
  ]
}

/** Labels that read as a sentence rather than as SQL. */
const OPERATOR_LABEL: Record<FilterOperator, string> = {
  "=": "is",
  "!=": "is not",
  ">": ">",
  ">=": "≥",
  "<": "<",
  "<=": "≤",
  contains: "contains",
  "not contains": "does not contain",
  "starts with": "starts with",
  "ends with": "ends with",
  "is null": "is empty",
  "is not null": "is not empty",
}

/**
 * The Data tab's filters.
 *
 * A flat list joined by one `and`/`or`, not the nested groups a query builder
 * grows into: everything here still has to be a `where` clause someone can
 * read in the SQL tab, and two levels of nesting is where that stops being
 * true. Conditions run against the database, not the loaded page, so a filter
 * finds rows on page 40 as readily as page 1.
 */
export function FilterBar({
  columns,
  filters,
  onChange,
}: {
  columns: Column[]
  filters: FilterSet | null
  onChange: (filters: FilterSet | null) => void
}) {
  /*
   * Edited as a draft and sent on Apply, rather than on every keystroke.
   *
   * A condition is typed a character at a time, and each of those characters
   * would otherwise be a round trip to the database — a `where title = 'a'`
   * on the way to `where title = 'apple'`. Building the whole thing and then
   * asking once is also how a filter bar is expected to behave.
   */
  const [applied, setApplied] = useState(filters)
  const [draft, setDraft] = useState(filters)

  const projectId = useStudio((state) => state.projectId)
  const [request, setRequest] = useState("")
  const [asking, setAsking] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  // The applied set changed underneath us: another table was opened, or it was
  // cleared from outside. Adjusted during render rather than in an effect,
  // which would show one frame of the old draft first.
  if (applied !== filters) {
    setApplied(filters)
    setDraft(filters)
  }

  const conditions = draft?.conditions ?? []
  const join = draft?.join ?? "and"

  /** Only the ones the database will actually be asked about. */
  const active = (filters?.conditions ?? []).filter(
    (condition) => !takesValue(condition.operator) || condition.value !== ""
  ).length

  const dirty = !sameFilters(draft, filters)

  function commit(next: Filter[], nextJoin = join) {
    setDraft(next.length === 0 ? null : { join: nextJoin, conditions: next })
  }

  function apply() {
    if (!dirty) return
    onChange(draft)
  }

  /** Asks the agent for conditions and puts them in the draft. */
  async function describe() {
    const question = request.trim()
    if (!question || !projectId) return

    setAsking(true)
    setAiError(null)
    try {
      const proposed = await window.desktop.aiFilter(
        projectId,
        question,
        columns.map((column) => ({ name: column.name, type: column.type }))
      )
      if (proposed.conditions.length === 0) {
        setAiError("Nothing in that matched a column of this table.")
        return
      }
      setDraft(proposed)
      setRequest("")
    } catch (problem) {
      setAiError(problem instanceof Error ? problem.message : String(problem))
    } finally {
      setAsking(false)
    }
  }

  function add() {
    const column = columns[0]
    if (!column) return
    commit([...conditions, { column: column.name, operator: "=", value: "" }])
  }

  function patch(index: number, part: Partial<Filter>) {
    commit(
      conditions.map((condition, position) =>
        position === index ? { ...condition, ...part } : condition
      )
    )
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            disabled={columns.length === 0}
            className={cn(active > 0 && "text-foreground")}
          >
            <FilterIcon data-icon="inline-start" />
            Filter
            {active > 0 && (
              <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-[0.65rem] text-primary tabular-nums">
                {active}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-[34rem] p-2">
        {/* Proposes, never applies: what comes back lands in the draft below
            for the user to read and correct, and Apply is still theirs to
            press. A filter nobody checked is a wrong answer that looks like a
            table. */}
        <form
          className="mb-2 flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            void describe()
          }}
        >
          <Input
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="Describe the rows you want…"
            disabled={asking}
            aria-label="Describe a filter"
            className="h-7 flex-1 text-xs md:text-xs"
          />
          <Button
            type="submit"
            size="xs"
            variant="outline"
            disabled={asking || request.trim() === ""}
          >
            <Sparkles data-icon="inline-start" />
            {asking ? "Asking…" : "Ask"}
          </Button>
        </form>

        {aiError && (
          <p className="mb-2 max-h-24 overflow-auto font-mono text-[0.65rem] whitespace-pre-wrap text-destructive">
            {aiError}
          </p>
        )}

        {conditions.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            No filters. Rows are read straight from the table.
          </p>
        ) : (
          <ul className="space-y-1">
            {conditions.map((condition, index) => {
              const column = columns.find(
                (candidate) => candidate.name === condition.column
              )
              const operators = operatorsFor(column)

              return (
                <li key={index} className="flex items-center gap-1.5">
                  {/* The first row says "where"; the rest carry the join, and
                      changing any one of them changes all of them — this is
                      one flat group, and pretending otherwise with a per-row
                      choice would be a lie about what gets built. */}
                  <div className="w-16 shrink-0">
                    {index === 0 ? (
                      <span className="pl-1 text-xs text-muted-foreground">
                        where
                      </span>
                    ) : (
                      <Select
                        items={[
                          { value: "and", label: "and" },
                          { value: "or", label: "or" },
                        ]}
                        value={join}
                        onValueChange={(value) =>
                          commit(conditions, value === "or" ? "or" : "and")
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label="Join"
                          className="h-7 w-full text-xs"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent
                          align="start"
                          alignItemWithTrigger={false}
                          className="w-auto min-w-(--anchor-width)"
                        >
                          <SelectItem value="and">and</SelectItem>
                          <SelectItem value="or">or</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <Select
                    items={columns.map((candidate) => ({
                      value: candidate.name,
                      label: candidate.name,
                    }))}
                    value={condition.column}
                    onValueChange={(value) => {
                      if (!value) return
                      const next = columns.find(
                        (candidate) => candidate.name === value
                      )
                      // An operator the new column cannot take — `contains` on
                      // a date — would be a filter that only fails at the
                      // database.
                      const allowed = operatorsFor(next)
                      patch(index, {
                        column: String(value),
                        operator: allowed.includes(condition.operator)
                          ? condition.operator
                          : "=",
                      })
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label="Column"
                      className="h-7 min-w-0 flex-1 font-mono text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      alignItemWithTrigger={false}
                      className="w-auto min-w-(--anchor-width)"
                    >
                      {columns.map((candidate) => (
                        <SelectItem
                          key={candidate.name}
                          value={candidate.name}
                          className="font-mono text-xs"
                        >
                          {candidate.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    items={operators.map((operator) => ({
                      value: operator,
                      label: OPERATOR_LABEL[operator],
                    }))}
                    value={condition.operator}
                    onValueChange={(value) =>
                      value &&
                      patch(index, { operator: value as FilterOperator })
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label="Operator"
                      className="h-7 w-36 text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      alignItemWithTrigger={false}
                      className="w-auto min-w-(--anchor-width)"
                    >
                      {operators.map((operator) => (
                        <SelectItem key={operator} value={operator}>
                          {OPERATOR_LABEL[operator]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    value={condition.value}
                    onChange={(event) =>
                      patch(index, { value: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return
                      event.preventDefault()
                      apply()
                    }}
                    disabled={!takesValue(condition.operator)}
                    placeholder={
                      takesValue(condition.operator) ? "value" : "no value"
                    }
                    spellCheck={false}
                    aria-label="Value"
                    className="h-7 w-40 font-mono text-xs md:text-xs"
                  />

                  <IconButton
                    label="Remove filter"
                    className="hover:text-destructive"
                    onClick={() =>
                      commit(
                        conditions.filter((_, position) => position !== index)
                      )
                    }
                  >
                    <Trash2 />
                  </IconButton>
                </li>
              )
            })}
          </ul>
        )}

        <div className="mt-1 flex items-center gap-1.5 border-t pt-2">
          <Button size="xs" variant="ghost" onClick={add}>
            <Plus data-icon="inline-start" />
            Add filter
          </Button>

          {(conditions.length > 0 || filters !== null) && (
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                setDraft(null)
                onChange(null)
              }}
            >
              Clear all
            </Button>
          )}

          <Button
            size="xs"
            disabled={!dirty}
            className={cn(
              conditions.length === 0 && filters === null && "ml-auto"
            )}
            onClick={apply}
          >
            {dirty ? "Apply" : "Applied"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Whether two filter sets would build the same `where` clause. */
function sameFilters(a: FilterSet | null, b: FilterSet | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.join !== b.join) return false
  if (a.conditions.length !== b.conditions.length) return false

  return a.conditions.every((condition, index) => {
    const other = b.conditions[index]!
    return (
      condition.column === other.column &&
      condition.operator === other.operator &&
      condition.value === other.value
    )
  })
}
