import { useEffect, useState } from "react"

import type { ClaudeUsageLimits } from "@shared/api"

/**
 * How often the cache is re-read. Not how often it changes — the CLI refreshes
 * it on its own schedule — so this only decides how long the bar can go on
 * showing a figure that has already been superseded on disk. Two seconds so a
 * `/usage` in any terminal shows up here as good as immediately; the cost is
 * bounded on the other side, where `claudeUsageLimits` answers an unchanged
 * file from its own cache after a `stat` rather than re-parsing it.
 */
const POLL_MS = 2_000

/**
 * One poller for the whole window, not one per session.
 *
 * Every `claude` tab draws the same account-wide figures, so a hook that
 * polled per component would multiply reads by the number of open tabs to
 * arrive at the same answer. Subscribers share the last value, and the timer
 * stops when the last one goes away.
 */
let current: ClaudeUsageLimits | null = null
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<(value: ClaudeUsageLimits | null) => void>()

let inFlight = false

async function refresh() {
  // A read that outlives the interval would otherwise queue up behind itself
  // and answer out of order, and at two seconds the interval is short enough
  // for that to be worth guarding rather than assuming away.
  if (inFlight) return
  inFlight = true
  let next: ClaudeUsageLimits | null
  try {
    next = await window.desktop.claudeUsageLimits()
  } finally {
    inFlight = false
  }

  // Every poll gets an answer, but most of them are the answer already on
  // screen: the CLI rewrites its cache far more rarely than this reads it.
  // Handing an equal-but-new object to the subscribers would re-render every
  // open tab's bar every two seconds for nothing.
  if (same(current, next)) return
  current = next
  for (const listener of listeners) listener(next)
}

function same(a: ClaudeUsageLimits | null, b: ClaudeUsageLimits | null) {
  if (a === null || b === null) return a === b
  return (
    a.sessionPercent === b.sessionPercent &&
    a.weeklyPercent === b.weeklyPercent &&
    a.sessionResetsAt === b.sessionResetsAt &&
    a.weeklyResetsAt === b.weeklyResetsAt &&
    a.fetchedAt === b.fetchedAt
  )
}

/** The account's five-hour and weekly allowance, or null until the first read
 * lands (and after it, if the CLI has never cached one). */
export function useClaudeLimits(): ClaudeUsageLimits | null {
  const [value, setValue] = useState(current)

  useEffect(() => {
    listeners.add(setValue)
    if (!timer) {
      void refresh()
      timer = setInterval(() => void refresh(), POLL_MS)
    }
    return () => {
      listeners.delete(setValue)
      if (listeners.size === 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }, [])

  return value
}
