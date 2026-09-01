import type { WorktreeChat } from "@shared/api"

/**
 * How many of a set of chats are working, and how many have stopped to ask.
 *
 * Pure and tested (`test/chat-running.ts`) for the reason the rest of
 * `lib/worktree-chat/` is split this way: the counting has one rule in it that
 * is easy to get wrong in two places at once, and neither way of getting it
 * wrong looks broken.
 *
 * **Waiting wins over working**, which is the rule. Both are true while a
 * question is up — the turn has not ended, so the chat is still `busy` — and
 * only one of them is something for the user to do. A chat counted in both
 * columns would make a project of three chats read as five things happening,
 * and worse, it would draw a "1 waiting" beside a "1 working" that are the same
 * conversation. This is the same precedence the chat row itself draws with, and
 * they must not disagree: the row is what somebody checks the count against.
 */
export type ChatActivity = {
  /** Answering, and nothing is wanted from anybody. */
  working: number
  /** Stopped on a question. Nothing moves in these until they are answered, and
   * nothing times them out — see `WorktreeChats.ask` in main. */
  waiting: number
}

export const NOTHING_RUNNING: ChatActivity = { working: 0, waiting: 0 }

export function activityOf(
  chats: WorktreeChat[],
  /** The chats main last said were busy — `sending` in the store. */
  sending: string[],
  /** The questions that are up, keyed by chat — `asks` in the store. */
  asks: Record<string, unknown>
): ChatActivity {
  let working = 0
  let waiting = 0
  for (const chat of chats) {
    if (asks[chat.id] !== undefined) waiting += 1
    else if (sending.includes(chat.id)) working += 1
  }
  return { working, waiting }
}

/** Whether there is anything to draw at all. A row that says `0 running` is a
 * row saying nothing, and this list is mostly idle. */
export function isRunning(activity: ChatActivity): boolean {
  return activity.working > 0 || activity.waiting > 0
}

/**
 * The count as a row draws it: `2` working, `1!` waiting, `2 · 1!` for both.
 *
 * Deliberately not words. This sits at the right-hand end of a sidebar row
 * whose left-hand end is a project name that has to keep its width — "2 chats
 * running, 1 waiting" is a sentence, and a sentence here is a truncated project
 * name. The `!` is what separates the two without a second colour to read, so
 * the label survives being drawn in the muted hue everything else on the row
 * uses.
 */
export function activityLabel(activity: ChatActivity): string {
  const parts: string[] = []
  if (activity.working > 0) parts.push(String(activity.working))
  if (activity.waiting > 0) parts.push(`${activity.waiting}!`)
  return parts.join(" · ")
}

/** The same thing said out loud, for the row's `title` and for a screen reader —
 * where the width the label was compressed for does not apply. */
export function activityTitle(activity: ChatActivity): string {
  const parts: string[] = []
  if (activity.working > 0) parts.push(`${activity.working} answering`)
  if (activity.waiting > 0)
    parts.push(`${activity.waiting} waiting for your answer`)
  return parts.join(", ")
}
