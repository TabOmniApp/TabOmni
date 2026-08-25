/**
 * The DeepSeek Harness gateway client.
 *
 * `dsh web` (the harness's own web surface) serves its browser API under
 * `/api` on a loopback port — the same JSON-RPC-style envelope its GUI uses,
 * with one request per method and business errors inside HTTP-200 responses.
 * This module talks to that endpoint through `@deepseek-ai/dsh-host-apiproxy`'s
 * typed client, projects its results onto the plain shapes in `shared/api.ts`,
 * and keeps the one live event stream every client shares.
 */

import { AbstractApiClient } from "@deepseek-ai/dsh-host-apiproxy/client"
import type { IApiClient } from "@deepseek-ai/dsh-host-apiproxy/client"
import type {
  RpcResponse,
  ClientResponse,
} from "@deepseek-ai/dsh-host-apiproxy/api/rpc"
// The gateway's session ids are branded strings; its own wire schema is the
// one place a plain string becomes one, so the boundary casts through it.
import { sessionIdSchema } from "@deepseek-ai/dsh-host-apiproxy/api/sessions.schema"
import type {
  ApiProxy,
  MuxFrame,
  RpcRequest,
} from "@deepseek-ai/dsh-host-apiproxy/api"
// The event stream is served over a WebSocket upgrade, not SSE — the frame
// schemas decode each socket message.
import { serverRequestSchema } from "@deepseek-ai/dsh-host-apiproxy/api/rpc.schema"
import { muxFrameSchema } from "@deepseek-ai/dsh-host-apiproxy/api/events.schema"
import type {
  DshCreateSessionInput,
  DshEvent,
  DshHistoryEntry,
  DshModelsCatalog,
  DshModelGroup,
  DshPromptInput,
  DshSessionSummary,
  DshStatus,
} from "../shared/api"

/** Where the dsh CLI serves by default; the `dshBaseUrl` setting overrides it. */
export const DEFAULT_DSH_BASE_URL = "http://127.0.0.1:3080"

/** One question the gateway's turn stopped on, as a chat draws it. */
export type DshQuestion = {
  id: string
  header?: string
  question: string
  options?: { label: string; description?: string }[]
  multiSelect?: boolean
}

/** One item of a session's turn stream: a session event, or a question the
 * turn is paused on. */
export type DshTurnItem =
  | DshHistoryEntry
  | { kind: "ask"; rpcId: string; sessionId: string; questions: DshQuestion[] }

/**
 * The one wire detail the abstract client does not carry: where the gateway
 * is. Its default base is a fake in-process authority, so this subclass points
 * `resolveBase` at the real URL and lets the stock `fetch` transport handle
 * the rest (Node's global `fetch` in the Electron main process).
 */
class DshFetchClient extends AbstractApiClient {
  constructor(
    private readonly baseUrl: string,
    timeoutMs?: number
  ) {
    super(timeoutMs)
  }

  protected override resolveBase(): string {
    return this.baseUrl
  }

  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init)
  }

  /**
   * The gateway serves its event stream over a WebSocket upgrade — a plain
   * GET on the mux path answers 426 — so the stock SSE `openMux` is replaced
   * with a socket reader. Each message is one JSON `ServerRequest` envelope
   * carrying a `MuxFrame`.
   */
  protected override openMux(
    _payload: Parameters<ApiProxy["events"]["mux"]>[0]["payload"],
    signal: AbortSignal,
    onOpen?: () => void
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readMux(signal, onOpen)
  }

  private async *readMux(
    signal: AbortSignal,
    onOpen?: () => void
  ): AsyncGenerator<RpcRequest<MuxFrame>> {
    const url = new URL("/api/events.mux", this.resolveBase())
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    const socket = new WebSocket(url)
    const inbox: (RpcRequest<MuxFrame> | { end: true })[] = []
    let wake: (() => void) | undefined
    const push = (item: RpcRequest<MuxFrame> | { end: true }): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const handleOpen = (): void => onOpen?.()
    const handleMessage = (message: MessageEvent): void => {
      try {
        if (typeof message.data !== "string") throw new Error("binary frame")
        const full = serverRequestSchema.parse(JSON.parse(message.data))
        const frame = muxFrameSchema.parse(full.payload)
        push({ rpcId: full.rpcId, payload: frame })
      } catch {
        // A malformed frame is dropped rather than fatal: a control message
        // this build does not know must not kill the stream.
      }
    }
    const handleClose = (): void => push({ end: true })
    const handleAbort = (): void => {
      if (
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close()
      }
    }
    socket.addEventListener("open", handleOpen)
    socket.addEventListener("message", handleMessage)
    socket.addEventListener("close", handleClose, { once: true })
    signal.addEventListener("abort", handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift() as RpcRequest<MuxFrame> | { end: true }
          if ("end" in item) return
          yield item
        }
        // The inbox re-check closes the window between the empty check above
        // and the wait: a frame arriving there would otherwise park the
        // generator until the next message.
        await new Promise<void>((resolve) => {
          if (inbox.length > 0) {
            resolve()
            return
          }
          wake = resolve
        })
      }
    } finally {
      signal.removeEventListener("abort", handleAbort)
      socket.removeEventListener("open", handleOpen)
      socket.removeEventListener("message", handleMessage)
      socket.removeEventListener("close", handleClose)
      handleAbort()
    }
  }
}

/**
 * The gateway service.
 *
 * A client per call rather than one held for the run: the instances carry no
 * state worth keeping beyond the envelope tap, and a `dshBaseUrl` change then
 * applies on the next call without a reconnect.
 */
export class DshService {
  constructor(private readonly options: { baseUrl: () => Promise<string> }) {}

  private async client(): Promise<IApiClient> {
    return new DshFetchClient(await this.options.baseUrl())
  }

  /**
   * What the gateway calls a business error is still an HTTP 200 with
   * `ok: false`; it becomes a throw here so IPC handlers only ever see
   * rejections or values.
   */
  private async value<T>(call: Promise<RpcResponse<T>>): Promise<T> {
    const response = await call
    if (!response.result.ok) {
      throw new Error(
        `${response.result.error.code}: ${response.result.error.message}`
      )
    }
    return response.result.value
  }

  /** Whether a gateway answered at the configured URL, and what it says. */
  async status(): Promise<DshStatus> {
    const baseUrl = await this.options.baseUrl()
    try {
      const describe = await this.value((await this.client()).host.describe({}))
      return {
        reachable: true,
        baseUrl,
        describe: {
          version: describe.version,
          cwd: describe.cwd,
          attachedSessions: describe.attachedSessions,
        },
      }
    } catch (error) {
      return {
        reachable: false,
        baseUrl,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** Every session the gateway is holding, trimmed to the list's columns. */
  async listSessions(): Promise<DshSessionSummary[]> {
    const { items } = await this.value((await this.client()).sessions.list({}))
    return items.map((item) => ({
      sessionId: item.sessionId,
      updatedAt: item.updatedAt,
      running: item.running,
      blank: item.blank,
      ...(item.parentSessionId === undefined
        ? {}
        : { parentSessionId: item.parentSessionId }),
      ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
      ...(item.agentPreset === undefined
        ? {}
        : { agentPreset: item.agentPreset }),
    }))
  }

  /** A new session; resolves to its id. */
  async createSession(input: DshCreateSessionInput): Promise<string> {
    const { sessionId } = await this.value(
      (await this.client()).sessions.create({
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(input.agentPreset === undefined
          ? {}
          : { agentPreset: input.agentPreset }),
      })
    )
    return sessionId
  }

  /** Sends one prompt. Resolves when the gateway accepted it — the completion
   * arrives as `session/event` frames on the stream `eventsStart` opened. */
  async sendPrompt(input: DshPromptInput): Promise<void> {
    await this.value(
      (await this.client()).sessions.prompt({
        sessionId: sessionIdSchema.parse(input.sessionId),
        mode: input.mode ?? "queue",
        content: [{ type: "text", text: input.text }],
      })
    )
  }

  /** The session's events, oldest first — the polling counterpart of the
   * stream, used to seed a tab or to catch up after one was closed. */
  async history(
    sessionId: string,
    maxMessages?: number
  ): Promise<DshHistoryEntry[]> {
    const page = await this.value(
      (await this.client()).sessions.history({
        sessionId: sessionIdSchema.parse(sessionId),
        ...(maxMessages === undefined ? {} : { maxMessages }),
      })
    )
    return page.events.map(({ event }) => ({
      seq: event.seq,
      type: event.type,
      time: event.time,
      data: event.data,
    }))
  }

  /** Stops the session's active turn. */
  async cancel(sessionId: string): Promise<void> {
    await this.value(
      (await this.client()).sessions.cancel({
        sessionId: sessionIdSchema.parse(sessionId),
      })
    )
  }

  /** The model picker's catalog for one session, trimmed to what a picker
   * shows. */
  async listModels(sessionId: string): Promise<DshModelsCatalog> {
    const catalog = await this.value(
      (await this.client()).sessions.models({
        sessionId: sessionIdSchema.parse(sessionId),
      })
    )
    return {
      current: {
        provider: catalog.current.provider,
        model: catalog.current.model,
        ...(catalog.current.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: catalog.current.reasoningEffort }),
      },
      groups: catalog.groups.map((group) => ({
        id: group.id,
        name: group.name,
        models: group.models.map((model) => ({
          id: model.id,
          name: model.name,
        })),
      })),
    }
  }

  /** The gateway's whole model catalog — host-scoped, so no session is needed
   * to read it. Feeds the chat picker's DeepSeek group. */
  async modelCatalog(): Promise<DshModelGroup[]> {
    const catalog = await this.value((await this.client()).llm.models({}))
    return catalog.groups.map((group) => ({
      id: group.id,
      name: group.name,
      models: group.models.map((model) => ({
        id: model.id,
        name: model.name,
        ...(model.reasoning?.efforts === undefined
          ? {}
          : {
              efforts: model.reasoning.efforts.map((effort) => ({
                id: effort.id,
                name: effort.name,
              })),
            }),
      })),
    }))
  }

  /**
   * Selects a model — and optionally a reasoning effort — for one session, so
   * a chat that picked them runs on them.
   *
   * A session is created on the gateway's own default model; a project chat
   * that names another has to say so, or the turn answers with a model nobody
   * chose. The provider is resolved from the catalog that lists the model.
   */
  async applyModel(
    sessionId: string,
    modelId: string,
    effort?: string
  ): Promise<void> {
    const client = await this.client()
    const catalog = await this.value(client.llm.models({}))
    const group = catalog.groups.find((entry) =>
      entry.models.some((model) => model.id === modelId)
    )
    // Not in the catalog (an alias, or the gateway changed): leave the default,
    // which is what the web GUI itself would have fallen back to.
    if (group === undefined) return
    await this.value(
      client.sessions.selectModel({
        sessionId: sessionIdSchema.parse(sessionId),
        provider: group.id,
        model: modelId,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      })
    )
  }

  /**
   * Opens its own event stream for one session and yields only that session's
   * events.
   *
   * A separate stream rather than a subscription to {@link eventsStart}'s:
   * a project chat's turn owns its socket for the life of the turn, and the
   * shared one is the DeepSeek pane's. The gateway aggregates every session,
   * so this filters by sessionId.
   */
  async *openSessionEvents(
    sessionId: string,
    signal: AbortSignal
  ): AsyncGenerator<DshHistoryEntry> {
    const client = new DshFetchClient(await this.options.baseUrl())
    const frames = client.events.mux({}, signal)
    for await (const frame of frames) {
      const payload = frame.payload
      if (
        payload.type === "session/event" &&
        String(payload.sessionId) === sessionId
      ) {
        yield {
          seq: payload.event.seq,
          type: payload.event.type,
          time: payload.event.time,
          data: payload.event.data,
        }
      }
    }
  }

  /**
   * One session's turn, as a chat draws it: the session events plus the
   * question frames the gateway pushes when the agent stops to ask.
   *
   * Unlike {@link openSessionEvents} this does **not** drop `question/requested`
   * — the gateway pauses the turn on it, and a chat that cannot see the pause
   * reads as "Working…" forever.
   */
  async *openSessionTurn(
    sessionId: string,
    signal: AbortSignal
  ): AsyncGenerator<DshTurnItem> {
    const client = new DshFetchClient(await this.options.baseUrl())
    const frames = client.events.mux({}, signal)
    for await (const frame of frames) {
      const payload = frame.payload
      // Only the two per-session frame kinds carry a sessionId; the others
      // (stream/error, the session baselines) belong to every client.
      if (
        payload.type === "session/event" ||
        payload.type === "question/requested"
      ) {
        if (String(payload.sessionId) !== sessionId) continue
      }
      if (payload.type === "session/event") {
        yield {
          seq: payload.event.seq,
          type: payload.event.type,
          time: payload.event.time,
          data: payload.event.data,
        }
      } else if (payload.type === "question/requested") {
        // The frame's own rpcId is the question's stable id — the answer
        // echoes it.
        yield {
          kind: "ask",
          rpcId: String(frame.rpcId),
          sessionId: String(payload.sessionId),
          questions: payload.questions.map((question) => ({
            id: String(question.id),
            question: question.question,
            ...(question.header === undefined
              ? {}
              : { header: question.header }),
            ...(question.options === undefined
              ? {}
              : {
                  options: question.options.map((option) => ({
                    label: option.label,
                    ...(option.description === undefined
                      ? {}
                      : { description: option.description }),
                  })),
                }),
            ...(question.multiSelect === undefined
              ? {}
              : { multiSelect: question.multiSelect }),
          })),
        }
      }
    }
  }

  /**
   * Answers a question the agent's turn stopped on.
   *
   * One client-response echoing the question frame's rpcId; the gateway
   * resumes the turn once it is accepted.
   */
  async answerQuestion(
    rpcId: string,
    sessionId: string,
    answers: { id: string; selected: string[]; custom?: string }[]
  ): Promise<void> {
    const client = await this.client()
    const message: ClientResponse = {
      type: "client-response",
      rpcId: rpcId as ClientResponse["rpcId"],
      result: { ok: true, value: { sessionId, answer: { answers } } },
    }
    await client.respond(message)
  }

  private streamController: AbortController | null = null

  /**
   * Opens the gateway's all-session event stream and forwards every
   * `session/event` frame plus the stream's own lifecycle.
   *
   * One stream for the whole app: the gateway aggregates every session into
   * this channel, so a renderer subscribes once and filters by `sessionId`.
   * Idempotent — a second call closes the previous stream first.
   *
   * Resolves once the stream is actually open (or has failed to open), never
   * before: the gateway only pushes live events, so a caller that sends a
   * prompt after this resolves can rely on that turn's frames arriving.
   */
  async eventsStart(onEvent: (event: DshEvent) => void): Promise<void> {
    this.eventsStop()
    const controller = new AbortController()
    this.streamController = controller
    let opened: (() => void) | undefined
    const openedPromise = new Promise<void>((resolve) => {
      opened = resolve
    })
    const frames = (await this.client()).events.mux({}, controller.signal, () =>
      opened?.()
    )
    void (async () => {
      try {
        for await (const frame of frames) {
          opened?.()
          const payload = frame.payload
          if (payload.type === "session/event") {
            onEvent({
              kind: "event",
              sessionId: payload.sessionId,
              event: {
                seq: payload.event.seq,
                type: payload.event.type,
                time: payload.event.time,
                data: payload.event.data,
              },
            })
          } else if (payload.type === "stream/error") {
            onEvent({ kind: "error", message: payload.error.message })
          }
        }
      } catch (error) {
        opened?.()
        // A deliberate restart aborts the previous stream; only a natural
        // failure is worth reporting — the next stream is opening anyway.
        if (!controller.signal.aborted) {
          onEvent({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          })
        }
      } finally {
        opened?.()
        if (this.streamController === controller) this.streamController = null
        // Same rule for the close: a restart's `end` must not read as the
        // stream having died mid-turn.
        if (!controller.signal.aborted) onEvent({ kind: "end" })
      }
    })()
    await openedPromise
  }

  /** Closes the stream opened by `eventsStart`, if one is open. */
  eventsStop(): void {
    this.streamController?.abort()
    this.streamController = null
  }

  /** The app is quitting; the open stream goes with it. */
  dispose(): void {
    this.eventsStop()
  }
}
