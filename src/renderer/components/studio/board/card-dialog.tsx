import { useId, useState } from "react"

import type { BoardCard } from "@shared/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/**
 * A card's title and its line of detail — the form, and only the form.
 *
 * A dialog rather than an editor in the column, because the whole point of the
 * card in the column is that it is two lines high: a card that grew a text area
 * where it sat would push the rest of the column out of view every time
 * somebody fixed a typo.
 *
 * **It writes nothing itself.** `card` is null for one that does not exist yet,
 * and `onSave` is what the board does with the answer — add or edit. The first
 * cut of this added the card first and opened the dialog on it, so cancelling
 * out of `+` left a card called `New card` on the board: a dialog with a Cancel
 * button has to be cancellable, and nothing about a card is worth writing before
 * it has a name.
 *
 * No column picker in here. Which column a card is in is said by dragging it, or
 * by which column's `+` was pressed, and a select that could disagree with the
 * board behind the dialog is a second answer to a question the board is already
 * the answer to.
 */
export function CardDialog({
  card,
  onSave,
  onClose,
}: {
  /** The card being edited, or null for one being added. */
  card: BoardCard | null
  onSave: (fields: { title: string; body: string }) => void
  onClose: () => void
}) {
  const titleId = useId()
  const bodyId = useId()

  const [title, setTitle] = useState(card?.title ?? "")
  const [body, setBody] = useState(card?.body ?? "")

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const named = title.trim()
    // A card with no title is a card with nothing to identify it by — there is
    // no name anywhere else on it. Refused rather than defaulted, which is also
    // what the Save button says by being disabled.
    if (!named) return
    onSave({ title: named, body: body.trim() })
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{card ? "Card" : "New card"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 py-4">
            <div className="grid gap-2">
              <Label htmlFor={titleId}>Title</Label>
              <Input
                id={titleId}
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={bodyId}>Detail</Label>
              <Textarea
                id={bodyId}
                rows={5}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="What this is, or what done looks like…"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              {card ? "Save" : "Add card"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
