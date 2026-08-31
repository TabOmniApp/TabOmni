/**
 * The wire protocol between the daemon (`daemon.ts`, owns the ptys) and the
 * main process's client (`daemon-client.ts`) — newline-delimited JSON, one
 * object per line, both directions. Its own file so the two sides of the
 * socket cannot describe the same message shape two different ways.
 */

import { homedir } from "node:os"
import path from "node:path"

/** Where both sides find each other. A named pipe has no filesystem path to
 * agree on on Windows, so it is not "under `~/.yasuo`" there — just a
 * name both processes know. */
export function socketPath(): string {
  if (process.platform === "win32") return "\\\\.\\pipe\\yasuo-agent-daemon"
  return path.join(homedir(), ".yasuo", "agent-daemon.sock")
}

export type CreateRequest = {
  op: "create"
  reqId: string
  cwd: string
  command?: string
  env?: Record<string, string>
  cols: number
  rows: number
}
export type AttachRequest = { op: "attach"; reqId: string; id: string }
export type WriteRequest = { op: "write"; id: string; data: string }
export type ResizeRequest = {
  op: "resize"
  id: string
  cols: number
  rows: number
}
export type KillRequest = { op: "kill"; id: string }

export type DaemonRequest =
  CreateRequest | AttachRequest | WriteRequest | ResizeRequest | KillRequest

export type CreatedResponse = { type: "created"; reqId: string; id: string }
export type AttachedResponse = {
  type: "attached"
  reqId: string
  id: string
  backlog: string
}
export type NotFoundResponse = { type: "notFound"; reqId: string; id: string }
export type DataMessage = { type: "data"; id: string; chunk: string }
export type ExitMessage = {
  type: "exit"
  id: string
  exitCode: number
  signal: number | null
}

export type DaemonMessage =
  | CreatedResponse
  | AttachedResponse
  | NotFoundResponse
  | DataMessage
  | ExitMessage

export function isDaemonRequest(value: unknown): value is DaemonRequest {
  const op = (value as { op?: unknown } | null)?.op
  return (
    op === "create" ||
    op === "attach" ||
    op === "write" ||
    op === "resize" ||
    op === "kill"
  )
}

export function isDaemonMessage(value: unknown): value is DaemonMessage {
  const type = (value as { type?: unknown } | null)?.type
  return (
    type === "created" ||
    type === "attached" ||
    type === "notFound" ||
    type === "data" ||
    type === "exit"
  )
}
