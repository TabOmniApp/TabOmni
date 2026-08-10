import type { Pane } from "./store"

/**
 * How the workbench's one tab strip addresses tabs belonging to four panels.
 *
 * The strip hands back an id and nothing else, so which panel a tab belongs to
 * has to travel in the id itself — `db:public.users`, `api:<uuid>`. Kept apart
 * from the component so the ordering below can be tested without pulling the
 * renderer in with it.
 */
export const PREFIX: Record<Pane, string> = {
  database: "db:",
  api: "api:",
  mail: "mail:",
  webhook: "hook:",
  terminal: "term:",
}

export function kindOf(id: string): Pane | null {
  if (id.startsWith(PREFIX.database)) return "database"
  if (id.startsWith(PREFIX.api)) return "api"
  if (id.startsWith(PREFIX.mail)) return "mail"
  if (id.startsWith(PREFIX.webhook)) return "webhook"
  if (id.startsWith(PREFIX.terminal)) return "terminal"
  return null
}

/** The id as its own panel knows it, with the prefix taken back off. */
export function bare(id: string, kind: Pane): string {
  return id.slice(PREFIX[kind].length)
}

/**
 * The open tabs in the order the user arranged them.
 *
 * `order` is the last arrangement and `open` is what is actually open now, and
 * neither is authoritative alone: the first goes stale as tabs are opened and
 * closed, the second knows nothing about a drag. So this reconciles them on
 * every render, which is what lets the stored order be written once on drop and
 * never maintained afterwards — an id for a tab that has since closed simply
 * matches nothing.
 *
 * A tab the order has never seen is one opened since the last drag. It goes
 * after the last tab of its own panel rather than at the end of the strip, so
 * opening a second table still puts it beside the first even in a strip that
 * has been interleaved. With no tab of that panel on screen, it goes at the end.
 *
 * Generic over the item so the test does not have to build a `TabStripItem`
 * with an icon and a label to ask a question about ordering.
 */
export function arrange<T extends { id: string }>(
  open: T[],
  order: string[]
): T[] {
  if (order.length === 0) return open

  const remaining = new Map(open.map((item) => [item.id, item]))
  const arranged: T[] = []

  for (const id of order) {
    const item = remaining.get(id)
    if (!item) continue
    arranged.push(item)
    // An id repeated in a stale order must not place the same tab twice.
    remaining.delete(id)
  }

  // Whatever is left, walked in the given order so several new tabs of one
  // panel keep their own sequence.
  for (const item of open) {
    if (!remaining.has(item.id)) continue
    remaining.delete(item.id)

    const kind = kindOf(item.id)
    let after = -1
    for (let index = arranged.length - 1; index >= 0; index -= 1) {
      if (kindOf(arranged[index]!.id) === kind) {
        after = index
        break
      }
    }
    if (after === -1) arranged.push(item)
    else arranged.splice(after + 1, 0, item)
  }

  return arranged
}
