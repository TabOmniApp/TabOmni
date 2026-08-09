import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { Repeat, Trash2 } from "lucide-react"

import type { InboxMessage, InboxWebhook } from "@shared/api"
import { useInbox } from "@/lib/inbox/store"
import { METHOD_TONES } from "../api/request-list"
import { ResponseBody } from "../api/response-body"
import { IconButton } from "../icon-button"

type View = "body" | "headers" | "query"

export function WebhookView({
  message,
  webhook,
}: {
  message: InboxMessage
  webhook: InboxWebhook
}) {
  const replayUrl = useInbox((state) => state.replayUrl)
  const setReplayUrl = useInbox((state) => state.setReplayUrl)
  const replay = useInbox((state) => state.replay)
  const outcome = useInbox((state) => state.replays[message.id])
  const remove = useInbox((state) => state.remove)

  const [view, setView] = useState<View>(webhook.body ? "body" : "headers")

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "shrink-0 font-mono text-xs font-semibold",
              METHOD_TONES[webhook.method] ?? "text-muted-foreground"
            )}
          >
            {webhook.method}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {webhook.path}
          </span>
          <span className="shrink-0 text-[0.65rem] text-muted-foreground">
            {new Date(message.receivedAt).toLocaleTimeString()} · {webhook.size}{" "}
            bytes
          </span>
          <IconButton
            label="Delete this request"
            onClick={() => void remove(message.id)}
          >
            <Trash2 />
          </IconButton>
        </div>

        {/*
          The reason to catch a request rather than log it. A provider fires an
          event once; the handler that mishandled it can be run against that
          exact payload — signature header included — as many times as it takes
          to get it right.
        */}
        <form
          className="mt-2 flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            void replay(message.id)
          }}
        >
          <Input
            value={replayUrl}
            onChange={(event) => setReplayUrl(event.target.value)}
            placeholder="Replay to — http://localhost:3000/webhooks/stripe"
            aria-label="Replay target"
            spellCheck={false}
            className="h-7 font-mono text-xs"
          />
          <Button
            type="submit"
            size="xs"
            variant="outline"
            disabled={!replayUrl.trim() || outcome?.sending}
          >
            <Repeat data-icon="inline-start" />
            {outcome?.sending ? "Sending…" : "Replay"}
          </Button>
        </form>

        {outcome?.error && (
          <p className="mt-1.5 font-mono text-[0.65rem] text-destructive">
            {outcome.error}
          </p>
        )}
        {outcome?.response && (
          <p className="mt-1.5 text-[0.65rem] text-muted-foreground">
            <span
              className={cn(
                "font-mono font-semibold",
                outcome.response.status < 400
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive"
              )}
            >
              {outcome.response.status} {outcome.response.statusText}
            </span>{" "}
            in {outcome.response.timeMs}ms
            {outcome.response.body && ` — ${preview(outcome.response.body)}`}
          </p>
        )}
      </div>

      <div className="flex h-9 shrink-0 items-center border-b px-3">
        <Tabs value={view} onValueChange={(value) => setView(value as View)}>
          <TabsList variant="line" className="h-7">
            <TabsTrigger value="body" className="px-2 text-xs">
              Body
            </TabsTrigger>
            <TabsTrigger value="headers" className="px-2 text-xs">
              Headers
              <span className="ml-1 text-muted-foreground">
                {webhook.headers.length}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="query"
              disabled={webhook.query.length === 0}
              className="px-2 text-xs"
            >
              Query
              {webhook.query.length > 0 && (
                <span className="ml-1 text-muted-foreground">
                  {webhook.query.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1">
        {view === "body" ? (
          webhook.isText && webhook.body ? (
            <ResponseBody
              value={webhook.body}
              contentType={contentTypeOf(webhook)}
            />
          ) : (
            <p className="p-3 text-xs text-muted-foreground">
              {webhook.size === 0
                ? "The request had no body."
                : `${webhook.size} bytes that are not text, so they were not kept.`}
            </p>
          )
        ) : view === "headers" ? (
          <Pairs rows={webhook.headers} />
        ) : (
          <Pairs rows={webhook.query} />
        )}
      </div>
    </div>
  )
}

/** Headers and query parameters are the same table twice — name, value, both
 * shown exactly as they arrived. */
function Pairs({ rows }: { rows: { name: string; value: string }[] }) {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.name}:${index}`} className="border-b last:border-0">
              <td className="w-1/3 max-w-0 truncate px-3 py-1 font-mono text-muted-foreground">
                {row.name}
              </td>
              <td className="px-3 py-1 font-mono break-all">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function contentTypeOf(webhook: InboxWebhook): string {
  return (
    webhook.headers.find(
      (header) => header.name.toLowerCase() === "content-type"
    )?.value ?? "text/plain"
  )
}

/** The first line of a replay's response, for the strip under the button. */
function preview(body: string): string {
  const line = body.trim().split("\n")[0] ?? ""
  return line.length > 120 ? `${line.slice(0, 120)}…` : line
}
