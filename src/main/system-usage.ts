import os from "node:os"

import { app } from "electron"

import type { SystemUsage } from "../shared/api"

/**
 * What the machine has left, and what this app is taking of it.
 *
 * Every figure here is a *delta*, measured from the last time this was called
 * rather than from boot: a CPU percentage is meaningless without a span of
 * time to average over, and the span this app cares about is "since the bar
 * last drew". That makes the function stateful — two calls a millisecond
 * apart leave the second one nothing to divide by — which is why the renderer
 * runs one poller for the whole window instead of one per component
 * (`lib/system/usage.ts`).
 *
 * Nothing is shelled out to. `top`/`vm_stat`/`ps` would each be a per-poll
 * process spawn to learn what `os.cpus()` and Chromium's own accounting
 * already have, and the app polls this every couple of seconds.
 */
export function systemUsage(): SystemUsage {
  const cores = os.cpus().length
  return {
    cpuPercent: machineCpuPercent(),
    cores,
    ...memory(),
    ...appShare(cores),
  }
}

/** Cumulative busy/total tick counts across every core, as `os.cpus()` reports
 * them since boot. Only the difference between two of these means anything. */
type CpuSample = { busy: number; total: number }

/**
 * Primed at import — which happens inside `registerIpc()`, at startup — so the
 * first reading the renderer asks for is measured against app launch rather
 * than against boot, where it would be an average over however many days the
 * machine has been up.
 */
let previous = cpuSample()

/** The last percentage actually measured, held so that a poll with no elapsed
 * ticks to divide repeats it rather than dropping the bar to zero. */
let lastCpuPercent = 0

function cpuSample(): CpuSample {
  let busy = 0
  let total = 0
  for (const core of os.cpus()) {
    for (const [mode, ticks] of Object.entries(core.times)) {
      total += ticks
      if (mode !== "idle") busy += ticks
    }
  }
  return { busy, total }
}

/**
 * How much of the machine's total capacity was busy since the last call, 0–100
 * — all cores together, so a single core pinned on a ten-core machine reads
 * 10% rather than 100%. That is the scale the question "how much is left" is
 * asked on.
 */
function machineCpuPercent(): number {
  const current = cpuSample()
  const busy = current.busy - previous.busy
  const total = current.total - previous.total
  previous = current

  if (total <= 0) return lastCpuPercent
  lastCpuPercent = clampPercent((busy / total) * 100)
  return lastCpuPercent
}

/**
 * Total and *available* physical memory, in bytes.
 *
 * `os.freemem()` is the wrong number to answer this with on macOS: it counts
 * only wholly free pages, so a healthy machine with gigabytes of reclaimable
 * file cache reports tens of megabytes free and the bar sits pinned at 100%
 * for the life of the app. Chromium already computes the honest figure —
 * free plus file-backed plus purgeable, all of which the kernel will hand back
 * on demand — and `process.getSystemMemoryInfo()` exposes the pieces, in
 * kilobytes.
 *
 * The extra fields are macOS-only and absent from Electron's typings, so they
 * are read defensively: a platform that does not report them falls back to
 * free pages alone, which is what "available" means there anyway.
 */
function memory(): { memoryTotal: number; memoryAvailable: number } {
  try {
    const info = process.getSystemMemoryInfo() as unknown as Record<
      string,
      unknown
    >
    const total = kilobytes(info["total"])
    const free = kilobytes(info["free"])
    if (total > 0) {
      const available =
        free + kilobytes(info["fileBacked"]) + kilobytes(info["purgeable"])
      return {
        memoryTotal: total,
        memoryAvailable: Math.min(total, available),
      }
    }
  } catch {
    // Nothing to report from Chromium's side; `os` still knows the shape of
    // the machine, even if its idea of "free" is the pessimistic one.
  }

  return { memoryTotal: os.totalmem(), memoryAvailable: os.freemem() }
}

function kilobytes(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value * 1024
    : 0
}

/**
 * This app's own share: every process Electron runs, added up.
 *
 * `getAppMetrics()` reports one row per process — the main process, each
 * renderer, the GPU and utility processes — and none of them alone is "the
 * app". The ptys are not in here: a `claude` or a shell is a child of the
 * daemon, not of this app, and counting it would make the studio look
 * responsible for work the user started deliberately.
 *
 * `percentCPUUsage` is Chromium's own since-the-last-call delta, on the same
 * clock as the machine figure above, and — measured, not assumed — it is
 * already a share of *all* cores rather than of one: a process burning 1.09
 * CPU-seconds over two seconds on a ten-core machine reports 5%, not 54%.
 * So it goes straight into `appCpuPercent`, and it is the *Activity Monitor*
 * figure that has to be derived, by multiplying back up by the core count.
 * Both are carried because a bar disagreeing with Activity Monitor by a
 * factor of ten, with no way to see why, would just look broken.
 */
function appShare(cores: number): {
  appCpuPercent: number
  appCoreCpuPercent: number
  appMemory: number
  appProcesses: number
} {
  const metrics = app.getAppMetrics()

  let machine = 0
  let memory = 0
  for (const entry of metrics) {
    machine += entry.cpu.percentCPUUsage
    memory += kilobytes(entry.memory.workingSetSize)
  }

  return {
    appCpuPercent: clampPercent(machine),
    appCoreCpuPercent: Math.max(0, machine * Math.max(1, cores)),
    appMemory: memory,
    appProcesses: metrics.length,
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}
