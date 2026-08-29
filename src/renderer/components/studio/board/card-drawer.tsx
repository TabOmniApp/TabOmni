import { useId, useState } from "react"
import { X } from "lucide-react"

import { BOARD_PRIORITY_IDS, type BoardCard } from "@shared/api"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { dueOf, parseTags, priorityOf, tagText } from "@/lib/board/cards"
import { PRIORITY_LABEL } from "@/lib/board/tones"
import type { CardFields } from "@/lib/board/store"
import { IconButton } from "../icon-button"
import { PriorityChip, TagChip } from "./card-chips"

/** What the priority select offers, with the absent case as an option of its
 * own: "none" is a real answer here — most cards have no priority — and a
 * clear button beside a select would be a second control for one field. */
const NO_PRIORITY = "none"

/**
 * A card's fields — the form, and only the form.
 *
 * **A drawer down the right-hand edge, not a dialog over the middle.** It was a
 * centred dialog, and what was wrong with that is what a card is opened for:
 * the board is the context the card is being read against — which column it is
 * in, what is beside it, what else is due — and a modal in the middle covers
 * exactly that. A panel down one edge leaves the board legible behind it, which
 * is also what makes closing it feel like putting a card down rather than
 * escaping a form. `swipeDirection="right"` is the whole of that choice; the
 * width is set here because the component's default (24rem) leaves the
 * label/value rows too tight to read.
 *
 * An editor in the column was never the alternative: the point of the card on
 * the board is that it is a few lines high, and one that grew a text area where
 * it sat would push the rest of the column out of view every time somebody
 * fixed a typo.
 *
 * **It writes nothing itself.** `card` is null for one that does not exist yet,
 * and `onSave` is what the board does with the answer — add or edit. The first
 * cut of this added the card first and opened the form on it, so cancelling out
 * of `+` left a card called `New card` on the board: a form with a Cancel button
 * has to be cancellable, and nothing about a card is worth writing before it has
 * a name.
 *
 * No column picker in here. Which column a card is in is said by dragging it, or
 * by which column's `+` was pressed, and a select that could disagree with the
 * board **visible behind the drawer** is a second answer to a question the board
 * is already the answer to. The chat link is not here either, for the same
 * reason — it is made by the card's own menu, which is where it can also be
 * undone.
 *
 * The **title is the heading**, not a labelled field: it is the one thing every
 * card has, it is what the card is called on the board, and a `Title` label over
 * an input under a `Card` heading says the word twice. Everything else is a
 * labelled row, in the order a card is read — how urgent, when, what it is
 * about.
 */
export function CardDrawer({
  card,
  onSave,
  onClose,
}: {
  /** The card being edited, or null for one being added. */
  card: BoardCard | null
  onSave: (fields: CardFields) => void
  onClose: () => void
}) {
  const titleId = useId()
  const bodyId = useId()
  const dueId = useId()
  const tagsId = useId()

  const [title, setTitle] = useState(card?.title ?? "")
  const [body, setBody] = useState(card?.body ?? "")
  const [priority, setPriority] = useState<string>(
    (card && priorityOf(card)) ?? NO_PRIORITY
  )
  const [due, setDue] = useState((card && dueOf(card)) ?? "")
  const [tags, setTags] = useState(card ? tagText(card) : "")

  // Parsed as it is typed, because the chips under the field are what say what
  // the commas did — a field whose meaning is only revealed on save is a field
  // people get wrong once and then avoid.
  const parsed = parseTags(tags)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const named = title.trim()
    // A card with no title is a card with nothing to identify it by — there is
    // no name anywhere else on it. Refused rather than defaulted, which is also
    // what the Save button says by being disabled.
    if (!named) return
    onSave({
      title: named,
      body: body.trim(),
      tags: parsed,
      priority:
        priority === NO_PRIORITY
          ? null
          : (BOARD_PRIORITY_IDS.find((id) => id === priority) ?? null),
      // The empty field is no date rather than an empty string, so that
      // clearing one leaves the card in the state a card that never had one is
      // in — `dueOf` answers null for both, and only one of them is worth
      // writing to disk.
      due: due || null,
    })
    onClose()
  }

  return (
    <Drawer
      open
      swipeDirection="right"
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DrawerContent
        aria-label={card ? "Card" : "New card"}
        // Wider than the component's default, and capped at the viewport so a
        // narrow window gets a panel rather than a drawer wider than the screen.
        className="sm:[--drawer-content-width:min(28rem,100vw)]"
      >
        {/* The form is the whole panel, so the footer's Save is a submit and
            Enter in any field means the same thing it does in a dialog. */}
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DrawerHeader className="flex flex-row items-start gap-2 pb-3">
            <DrawerTitle className="sr-only">
              {card ? "Card" : "New card"}
            </DrawerTitle>
            <Input
              id={titleId}
              autoFocus
              value={title}
              aria-label="Card title"
              placeholder="What needs doing"
              onChange={(event) => setTitle(event.target.value)}
              // The heading of the panel, typed into: no border and no
              // background until it is being edited, so it reads as the card's
              // name rather than as the first of five fields.
              className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-base leading-snug font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <DrawerClose
              render={
                <IconButton label="Close" className="-mt-0.5 size-6 shrink-0">
                  <X className="size-3.5" />
                </IconButton>
              }
            />
          </DrawerHeader>

          {/* The one part that scrolls. A drawer is the height of the window, so
              a long description pushes the buttons off the bottom unless the
              header and the footer are pinned outside it. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-1">
            {/* Label and value in two columns, which is the shape a card's
                details are read in — every value starts at the same x, so the
                three rows scan as a block rather than as three widgets. */}
            <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-2.5">
              <Label className="text-xs text-muted-foreground">Priority</Label>
              <Select
                items={[
                  { value: NO_PRIORITY, label: "None" },
                  ...BOARD_PRIORITY_IDS.map((id) => ({
                    value: id,
                    label: PRIORITY_LABEL[id],
                  })),
                ]}
                value={priority}
                onValueChange={(value) => setPriority(String(value))}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Priority"
                  className="h-7 w-40"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  <SelectItem value={NO_PRIORITY}>None</SelectItem>
                  {BOARD_PRIORITY_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      <PriorityChip priority={id} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Label htmlFor={dueId} className="text-xs text-muted-foreground">
                Due date
              </Label>
              <Input
                id={dueId}
                type="date"
                value={due}
                onChange={(event) => setDue(event.target.value)}
                // The platform's own picker: `type="date"` speaks the field's
                // format exactly (`YYYY-MM-DD` is what `value` is, whatever the
                // OS displays), and a calendar component would be a dependency
                // for a field this app has one of.
                className="h-7 w-40"
              />

              <Label
                htmlFor={tagsId}
                className="self-start pt-1.5 text-xs text-muted-foreground"
              >
                Tags
              </Label>
              <div className="grid gap-1.5">
                <Input
                  id={tagsId}
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="design system, api"
                  className="h-7"
                />
                {parsed.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {parsed.map((tag) => (
                      <TagChip key={tag.toLowerCase()} tag={tag} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 grid gap-1.5">
              <Label htmlFor={bodyId} className="text-xs text-muted-foreground">
                Description
              </Label>
              <Textarea
                id={bodyId}
                rows={8}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="What this is, or what done looks like…"
              />
            </div>
          </div>

          <DrawerFooter className="flex-row justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              {card ? "Save" : "Add card"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
