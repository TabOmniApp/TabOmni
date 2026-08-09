import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { Braces, Plus, Send, Trash2 } from "lucide-react"

import type { HttpCookie, HttpHeader, HttpResponseResult } from "@shared/api"
import { cookiesFor } from "@/lib/http/cookies"
import {
  joinQuery,
  nextParamName,
  paramRows,
  splitQuery,
  splitRows,
  type ParamRow,
} from "@/lib/http/query"
import {
  isBodyless,
  METHODS,
  outcomeOf,
  resolveUrl,
  SETTINGS_TAB_ID,
  useApi,
  variablesFrom,
  type ScriptOutcome,
} from "@/lib/http/store"
import { IconButton } from "../icon-button"
import { ApiSettings } from "./api-settings"
import { BodyEditor } from "./body-editor"
import { FolderSettingsEditor } from "./folder-settings-editor"
import { METHOD_TONES } from "./request-list"
import { ResponseBody } from "./response-body"

const METHOD_ITEMS = METHODS.map((method) => ({
  value: method,
  label: method,
}))

export function ApiWorkspace() {
  const requests = useApi((state) => state.requests)
  const folders = useApi((state) => state.folders)
  const selectedId = useApi((state) => state.selectedId)
  const outcomes = useApi((state) => state.outcomes)

  const request = requests.find((candidate) => candidate.id === selectedId)
  const folder = folders.find((candidate) => candidate.id === selectedId)
  const outcome = outcomeOf(outcomes, selectedId)

  return (
    <div className="flex h-full min-w-0 flex-col">
      {selectedId === SETTINGS_TAB_ID ? (
        <ApiSettings />
      ) : request ? (
        <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
          <ResizablePanel minSize={140} defaultSize="45">
            {/* Keyed by request: the editors below hold a draft of whatever
                they were given, and a different request is different text. */}
            <RequestEditor key={request.id} requestId={request.id} />
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel minSize={120}>
            <ResponseView
              outcome={outcome}
              hasScript={(request.postResponseScript ?? "").trim() !== ""}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : folder ? (
        <FolderSettingsEditor key={folder.id} folderId={folder.id} />
      ) : (
        <Empty className="size-full border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Send />
            </EmptyMedia>
            <EmptyTitle>No request selected</EmptyTitle>
            <EmptyDescription>
              Pick one on the left, or add a request to call the app you are
              building.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}

type EditorTab = "params" | "headers" | "body" | "cookies" | "script"

/** Shown on an empty Post-response buffer — the Body tab's JSON example
 * would read as an instruction to write JSON here instead of a script. */
const SCRIPT_PLACEHOLDER = [
  "// Runs after the response comes back.",
  'pm.environment.set("authToken", pm.response.json().token)',
].join("\n")

function RequestEditor({ requestId }: { requestId: string }) {
  const request = useApi((state) =>
    state.requests.find((candidate) => candidate.id === requestId)
  )
  const update = useApi((state) => state.update)
  const send = useApi((state) => state.send)
  const sending = useApi((state) => state.outcomes[requestId]?.sending ?? false)

  const environments = useApi((state) => state.environments)
  const activeEnvironmentId = useApi((state) => state.activeEnvironmentId)
  const cookies = useApi((state) => state.cookies)
  const addCookie = useApi((state) => state.addCookie)
  const removeCookie = useApi((state) => state.removeCookie)

  const [tab, setTab] = useState<EditorTab>("params")

  const variables = useMemo(
    () => variablesFrom(environments, activeEnvironmentId),
    [environments, activeEnvironmentId]
  )

  if (!request) return null

  const resolved = resolveUrl(request.url, variables)
  const headers = request.headers
  // Derived, not stored: the query string is where a parameter that will be
  // sent lives, so the table below and the URL above cannot fall out of step.
  // Only unticked rows are kept aside, on the request itself.
  const { base, params, hash } = splitQuery(request.url)
  const rows = paramRows(params, request.disabledParams ?? [])

  function setHeader(index: number, patch: Partial<HttpHeader>) {
    update(requestId, {
      headers: headers.map((header, position) =>
        position === index ? { ...header, ...patch } : header
      ),
    })
  }

  /** Writes the table back: ticked rows into the URL, unticked ones aside. */
  function setRows(next: ParamRow[]) {
    const split = splitRows(next)
    update(requestId, {
      url: joinQuery(base, split.params, hash),
      disabledParams: split.parked,
    })
  }

  function setRow(index: number, patch: Partial<ParamRow>) {
    setRows(
      rows.map((row, position) =>
        position === index ? { ...row, ...patch } : row
      )
    )
  }

  /** What the body is written in: whatever the request says it is sending,
   * and JSON until it says otherwise. */
  const bodyType =
    headers.find(
      (header) =>
        header.enabled && header.name.trim().toLowerCase() === "content-type"
    )?.value ?? "application/json"

  const formatted = formatJson(request.body)

  // What the jar will actually put on this request, so a Cookie header that
  // appears from nowhere is visible before it is sent rather than after.
  const jarCookies = resolved.error ? [] : cookiesFor(cookies, resolved.url)
  const manualCookieHeader = headers.some(
    (header) => header.enabled && header.name.trim().toLowerCase() === "cookie"
  )

  /** Edits a cookie in place: same identity, new name or value. */
  function replaceCookie(cookie: HttpCookie, patch: Partial<HttpCookie>) {
    removeCookie(cookie)
    addCookie({ ...cookie, ...patch })
  }
  // A GET is sent without its body, so editing one would be a lie. Falling
  // back to Params rather than leaving a disabled tab selected.
  const bodyless = isBodyless(request.method)
  const shown = bodyless && tab === "body" ? "params" : tab

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <Select
          items={METHOD_ITEMS}
          value={request.method}
          onValueChange={(value) => {
            if (value) update(requestId, { method: String(value) })
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label="Method"
            className={cn(
              "h-7 w-28 font-mono text-xs font-semibold",
              METHOD_TONES[request.method]
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            align="start"
            alignItemWithTrigger={false}
            className="w-auto min-w-(--anchor-width)"
          >
            {METHODS.map((method) => (
              <SelectItem
                key={method}
                value={method}
                className={cn("font-mono text-xs", METHOD_TONES[method])}
              >
                {method}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={request.url}
          onChange={(event) => update(requestId, { url: event.target.value })}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            void send(requestId)
          }}
          placeholder="{{baseUrl}}/api/users"
          spellCheck={false}
          aria-label="URL"
          className="h-7 flex-1 font-mono text-xs md:text-xs"
        />

        <Button
          size="xs"
          disabled={sending}
          onClick={() => void send(requestId)}
        >
          <Send data-icon="inline-start" />
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>

      {/* What the request will actually hit, so the substitution is never a
          guess. `{{baseUrl}}` is whatever the active environment defines it
          as. */}
      <p
        className={cn(
          "shrink-0 truncate border-b px-3 py-1 font-mono text-[0.65rem]",
          resolved.error ? "text-destructive" : "text-muted-foreground"
        )}
        title={resolved.error ?? resolved.url}
      >
        {resolved.error ?? resolved.url}
      </p>

      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2">
        <Tabs
          value={shown}
          onValueChange={(value) => setTab(value as EditorTab)}
          className="min-w-0"
        >
          <TabsList variant="line" className="h-7">
            <TabsTrigger value="params" className="px-2 text-xs">
              Params
              {rows.length > 0 && (
                <span className="ml-1 text-[0.65rem] text-muted-foreground tabular-nums">
                  {rows.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="headers" className="px-2 text-xs">
              Headers
              {headers.length > 0 && (
                <span className="ml-1 text-[0.65rem] text-muted-foreground tabular-nums">
                  {headers.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="cookies" className="px-2 text-xs">
              Cookies
              {jarCookies.length > 0 && !manualCookieHeader && (
                <span className="ml-1 text-[0.65rem] text-muted-foreground tabular-nums">
                  {jarCookies.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="body"
              disabled={bodyless}
              title={
                bodyless
                  ? `${request.method} is sent without a body.`
                  : undefined
              }
              className="px-2 text-xs"
            >
              Body
            </TabsTrigger>
            <TabsTrigger value="script" className="px-2 text-xs">
              Post-response
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {shown === "params" && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            onClick={() =>
              setRows([
                ...rows,
                { name: nextParamName(rows), value: "", enabled: true },
              ])
            }
          >
            <Plus data-icon="inline-start" />
            Param
          </Button>
        )}

        {shown === "headers" && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            onClick={() =>
              update(requestId, {
                headers: [...headers, { name: "", value: "", enabled: true }],
              })
            }
          >
            <Plus data-icon="inline-start" />
            Header
          </Button>
        )}

        {shown === "cookies" && !resolved.error && !manualCookieHeader && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            onClick={() => addCookie(blankCookie(resolved.url))}
          >
            <Plus data-icon="inline-start" />
            Cookie
          </Button>
        )}

        {shown === "body" && formatted !== null && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            disabled={formatted === request.body}
            onClick={() => update(requestId, { body: formatted })}
          >
            <Braces data-icon="inline-start" />
            Format
          </Button>
        )}
      </div>

      <div
        className={cn(
          "min-h-0 flex-1",
          // The body and script panes scroll themselves; the tables do not.
          shown === "body" || shown === "script"
            ? "overflow-hidden"
            : "overflow-auto"
        )}
      >
        {shown === "params" ? (
          rows.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No query parameters. Typing{" "}
              <code className="font-mono">?a=1</code> in the URL fills this in.
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((row, index) => (
                <li key={index} className="flex items-center gap-2 px-2 py-1">
                  <Checkbox
                    checked={row.enabled}
                    onCheckedChange={(enabled) =>
                      setRow(index, { enabled: Boolean(enabled) })
                    }
                    aria-label={`Send ${row.name || "this parameter"}`}
                  />
                  <Input
                    value={row.name}
                    onChange={(event) =>
                      setRow(index, { name: event.target.value })
                    }
                    placeholder="Name"
                    spellCheck={false}
                    aria-label="Parameter name"
                    className={cn(
                      "h-7 w-56 font-mono text-xs md:text-xs",
                      !row.enabled && "text-muted-foreground line-through"
                    )}
                  />
                  <Input
                    value={row.value}
                    onChange={(event) =>
                      setRow(index, { value: event.target.value })
                    }
                    placeholder="Value"
                    spellCheck={false}
                    aria-label="Parameter value"
                    className={cn(
                      "h-7 flex-1 font-mono text-xs md:text-xs",
                      !row.enabled && "text-muted-foreground"
                    )}
                  />
                  <IconButton
                    label="Remove parameter"
                    className="hover:text-destructive"
                    onClick={() =>
                      setRows(rows.filter((_, position) => position !== index))
                    }
                  >
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
            </ul>
          )
        ) : shown === "cookies" ? (
          <div className="p-3 text-xs">
            {resolved.error ? (
              <p className="text-muted-foreground">
                Nothing to match until the URL resolves.
              </p>
            ) : manualCookieHeader ? (
              <p className="text-muted-foreground">
                This request sets its own{" "}
                <code className="font-mono">Cookie</code> header, so the jar
                stays out of it.
              </p>
            ) : jarCookies.length === 0 ? (
              <p className="text-muted-foreground">
                No cookies for{" "}
                <span className="font-mono">{hostOf(resolved.url)}</span>. One
                arrives the first time a response here sets one.
              </p>
            ) : (
              <ul className="divide-y">
                {jarCookies.map((cookie, index) => (
                  <li
                    key={`${cookie.domain}${cookie.path}${cookie.name}${index}`}
                    className="flex items-center gap-2 py-1"
                  >
                    <Input
                      value={cookie.name}
                      onChange={(event) =>
                        replaceCookie(cookie, { name: event.target.value })
                      }
                      spellCheck={false}
                      aria-label="Cookie name"
                      className="h-7 w-56 font-mono text-xs md:text-xs"
                    />
                    <Input
                      value={cookie.value}
                      onChange={(event) =>
                        replaceCookie(cookie, { value: event.target.value })
                      }
                      spellCheck={false}
                      aria-label="Cookie value"
                      className="h-7 flex-1 font-mono text-xs md:text-xs"
                    />
                    <span
                      className="w-40 shrink-0 truncate text-[0.65rem] text-muted-foreground"
                      title={`${cookie.domain}${cookie.path}`}
                    >
                      {cookie.hostOnly ? cookie.domain : `*.${cookie.domain}`}
                      {cookie.path}
                    </span>
                    <IconButton
                      label={`Remove ${cookie.name}`}
                      className="hover:text-destructive"
                      onClick={() => removeCookie(cookie)}
                    >
                      <Trash2 />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : shown === "headers" ? (
          headers.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No headers.
            </p>
          ) : (
            <ul className="divide-y">
              {headers.map((header, index) => (
                <li key={index} className="flex items-center gap-2 px-2 py-1">
                  <Checkbox
                    checked={header.enabled}
                    onCheckedChange={(enabled) =>
                      setHeader(index, { enabled: Boolean(enabled) })
                    }
                    aria-label={`Send ${header.name || "this header"}`}
                  />
                  <Input
                    value={header.name}
                    onChange={(event) =>
                      setHeader(index, { name: event.target.value })
                    }
                    placeholder="Header"
                    spellCheck={false}
                    aria-label="Header name"
                    className="h-7 w-56 font-mono text-xs md:text-xs"
                  />
                  <Input
                    value={header.value}
                    onChange={(event) =>
                      setHeader(index, { value: event.target.value })
                    }
                    placeholder="Value"
                    spellCheck={false}
                    aria-label="Header value"
                    className="h-7 flex-1 font-mono text-xs md:text-xs"
                  />
                  <IconButton
                    label="Remove header"
                    className="hover:text-destructive"
                    onClick={() =>
                      update(requestId, {
                        headers: headers.filter(
                          (_, position) => position !== index
                        ),
                      })
                    }
                  >
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
            </ul>
          )
        ) : shown === "script" ? (
          <BodyEditor
            value={request.postResponseScript ?? ""}
            contentType="application/javascript"
            onChange={(script) =>
              update(requestId, { postResponseScript: script })
            }
            placeholder={SCRIPT_PLACEHOLDER}
          />
        ) : (
          <BodyEditor
            value={request.body}
            contentType={bodyType}
            onChange={(body) => update(requestId, { body })}
          />
        )}
      </div>
    </div>
  )
}

type ResponseTab = "body" | "headers" | "cookies" | "script"

function ResponseView({
  outcome,
  hasScript,
}: {
  outcome: ReturnType<typeof outcomeOf>
  /** Whether this request currently has a post-response script — the
   * Post-response tab still shows a past run even after the script is
   * cleared, so this is only about what's worth offering to write one. */
  hasScript: boolean
}) {
  const [tab, setTab] = useState<ResponseTab>("body")

  if (outcome.sending) {
    return <Notice pulse>Waiting for a response…</Notice>
  }
  if (outcome.error) {
    return (
      <div className="h-full overflow-auto p-3">
        <p className="font-mono text-xs whitespace-pre-wrap text-destructive">
          {outcome.error}
        </p>
      </div>
    )
  }
  if (!outcome.result) {
    return <Notice>Send the request to see its response.</Notice>
  }

  const { result } = outcome

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as ResponseTab)}
          className="min-w-0"
        >
          <TabsList variant="line" className="h-7">
            <TabsTrigger value="body" className="px-2 text-xs">
              Response
            </TabsTrigger>
            <TabsTrigger value="headers" className="px-2 text-xs">
              Headers
              <span className="ml-1 text-[0.65rem] text-muted-foreground tabular-nums">
                {Object.keys(result.headers).length}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="cookies"
              disabled={result.setCookies.length === 0}
              className="px-2 text-xs"
            >
              Cookies
              {result.setCookies.length > 0 && (
                <span className="ml-1 text-[0.65rem] text-muted-foreground tabular-nums">
                  {result.setCookies.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="script"
              disabled={!hasScript && !outcome.script}
              className="px-2 text-xs"
            >
              Post-response
              {outcome.script?.error && (
                <span className="ml-1 size-1.5 rounded-full bg-destructive" />
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="ml-auto flex shrink-0 items-center gap-2 text-[0.65rem] text-muted-foreground tabular-nums">
          <StatusPill result={result} />
          <span>{result.timeMs} ms</span>
          <span>{formatSize(result.size)}</span>
        </div>
      </div>

      {/* `overflow-hidden`, not `auto`: the response viewer scrolls itself, and
          two scrollbars for one body is one too many. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "body" ? (
          result.isText ? (
            <ResponseBody
              value={prettify(result.body)}
              contentType={result.headers["content-type"] ?? ""}
            />
          ) : (
            <p className="p-3 font-mono text-xs text-muted-foreground">
              {result.body}
            </p>
          )
        ) : tab === "cookies" ? (
          <ul className="h-full divide-y overflow-auto">
            {result.setCookies.map((line, index) => (
              <li key={index} className="px-3 py-1.5">
                <p className="font-mono text-xs break-words">{line}</p>
              </li>
            ))}
          </ul>
        ) : tab === "script" ? (
          <ScriptPanel script={outcome.script} hasScript={hasScript} />
        ) : (
          <ul className="h-full divide-y overflow-auto">
            {Object.entries(result.headers).map(([name, value]) => (
              <li key={name} className="grid grid-cols-3 gap-3 px-3 py-1">
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {name}
                </span>
                <span className="col-span-2 font-mono text-xs break-words">
                  {value}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** What a post-response script did the last time it ran — or, if it hasn't
 * run yet this session, what to expect once it does. */
function ScriptPanel({
  script,
  hasScript,
}: {
  script: ScriptOutcome | null
  hasScript: boolean
}) {
  if (!script) {
    return (
      <p className="p-3 text-xs text-muted-foreground">
        {hasScript
          ? "Send the request to run its script."
          : "This request has no post-response script."}
      </p>
    )
  }

  const nothingToShow =
    !script.error &&
    script.setVariables.length === 0 &&
    script.logs.length === 0

  return (
    <div className="h-full space-y-3 overflow-auto p-3 text-xs">
      {script.error && (
        <p className="font-mono whitespace-pre-wrap text-destructive">
          {script.error}
        </p>
      )}

      {script.setVariables.length > 0 && (
        <ul className="space-y-1">
          {script.setVariables.map((variable) => (
            <li key={variable.name} className="font-mono">
              Set <span className="font-medium">{variable.name}</span> ={" "}
              <span className="text-muted-foreground">
                {truncateValue(variable.value)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {script.logs.length > 0 && (
        <ul className="space-y-0.5 border-t pt-2">
          {script.logs.map((line, index) => (
            <li
              key={index}
              className="font-mono whitespace-pre-wrap text-muted-foreground"
            >
              {line}
            </li>
          ))}
        </ul>
      )}

      {nothingToShow && (
        <p className="text-muted-foreground">Ran with nothing to show.</p>
      )}
    </div>
  )
}

/** Long enough to recognize a token by, short enough not to wrap the row. */
function truncateValue(value: string): string {
  return value.length > 60 ? `${value.slice(0, 60)}…` : value
}

function StatusPill({ result }: { result: HttpResponseResult }) {
  const tone =
    result.status < 300
      ? "bg-success/15 text-success"
      : result.status < 400
        ? "bg-warning/15 text-warning"
        : "bg-destructive/15 text-destructive"

  return (
    <span className={cn("rounded-full px-2 py-0.5 font-medium", tone)}>
      {result.status} {result.statusText}
    </span>
  )
}

/** A cookie for this request's own host, for one typed in by hand. */
function blankCookie(url: string): HttpCookie {
  return {
    name: "cookie",
    value: "",
    domain: hostOf(url),
    // Typed for this host, so it stays on this host.
    hostOnly: true,
    path: "/",
    expiresAt: null,
    secure: false,
    httpOnly: false,
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** The body re-indented, or null when there is no JSON here to format. */
function formatJson(body: string): string | null {
  const trimmed = body.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return null
  }
}

/** JSON is the common case and unreadable in one line; anything else is left
 * exactly as it came back. */
function prettify(body: string): string {
  const trimmed = body.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return body
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return body
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Notice({
  children,
  pulse = false,
}: {
  children: React.ReactNode
  pulse?: boolean
}) {
  return (
    <p
      className={cn(
        "px-3 py-2 text-xs text-muted-foreground",
        pulse && "animate-pulse"
      )}
    >
      {children}
    </p>
  )
}
