import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { Check, Copy, Play, Square } from "lucide-react"

import { useInbox } from "@/lib/inbox/store"
import { SECTION_ACCENT } from "../activity-bar"

/**
 * The SMTP sink's port, switch and endpoint.
 *
 * A tab rather than a dialog, because it is also the panel's answer to "why is
 * nothing arriving" — a thing to read beside the empty list, not something to
 * open, check and dismiss.
 */
const COPY = {
  title: "SMTP server",
  blurb:
    "What the project's mailer sends to. Any username and password are accepted, and TLS is not offered — configure the app for a plain connection. Nothing is delivered onward, which is the point: an app pointed here cannot mail a customer by accident.",
  note: "Set the mailer's host and port to these and leave encryption off. A mail sent while this is stopped goes wherever the app was already configured to send it — which, in a project whose settings still point at a real provider, is a real person.",
}

export function ServerSettings() {
  const status = useInbox((state) => state.status)
  const saved = useInbox((state) => state.settings)
  const start = useInbox((state) => state.start)
  const stop = useInbox((state) => state.stop)
  const save = useInbox((state) => state.saveSettings)

  // Edited locally and committed on submit: a port typed one digit at a time
  // would otherwise rebind the server at `1`, `10` and `102` on the way to
  // 1025.
  const [port, setPort] = useState(saved.port)
  // Adjusted during the render that first sees a new saved port rather than in
  // an effect afterwards, which would paint one frame of the old one — the
  // same reason the workbench sets `terminalOpened` this way.
  const [synced, setSynced] = useState(saved.port)
  if (synced !== saved.port) {
    setSynced(saved.port)
    setPort(saved.port)
  }

  const accent = SECTION_ACCENT.mail
  const endpoint = `smtp://127.0.0.1:${saved.port}`

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-sm font-medium">{COPY.title}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {COPY.blurb} It binds <code className="font-mono">127.0.0.1</code>{" "}
              and nothing else.
            </p>
          </div>
          <Button
            size="xs"
            variant={status.listening ? "outline" : "default"}
            onClick={() => void (status.listening ? stop() : start())}
          >
            {status.listening ? (
              <>
                <Square data-icon="inline-start" />
                Stop
              </>
            ) : (
              <>
                <Play data-icon="inline-start" />
                Start
              </>
            )}
          </Button>
        </header>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void save({ ...saved, port })
          }}
        >
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                style={
                  status.listening ? { backgroundColor: accent } : undefined
                }
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  !status.listening && "bg-muted-foreground/40"
                )}
              />
              <h3 className="text-xs font-medium">Port</h3>
              <span className="text-[0.65rem] text-muted-foreground">
                {status.listening ? "listening" : "stopped"}
              </span>

              <Input
                type="number"
                value={port}
                min={1}
                max={65535}
                onChange={(event) => setPort(Number(event.target.value))}
                aria-label={`${COPY.title} port`}
                className="ml-auto h-7 w-24 font-mono text-xs"
              />
            </div>

            {/* Almost always a port already taken, which is why the number is
                editable right beside this rather than somewhere it has to be
                found. */}
            {status.error && (
              <p className="mt-1.5 font-mono text-xs text-destructive">
                {status.error}
              </p>
            )}
          </div>

          {port !== saved.port && (
            <div className="flex items-center gap-2">
              <Button type="submit" size="xs">
                Save port
              </Button>
              <p className="text-xs text-muted-foreground">
                {status.listening
                  ? "The server restarts on the new port."
                  : "Used the next time it starts."}
              </p>
            </div>
          )}
        </form>

        <div className="flex items-start gap-3 rounded-md border p-3">
          <Switch
            id="mail-autostart"
            checked={saved.autoStart}
            onCheckedChange={(autoStart) => void save({ ...saved, autoStart })}
          />
          <div className="min-w-0">
            <Label htmlFor="mail-autostart" className="text-xs">
              Start with the project
            </Label>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Binds this port whenever the project is opened.
            </p>
          </div>
        </div>

        <section className="space-y-2">
          <h3 className="text-xs font-medium">Point things here</h3>
          <Endpoint value={endpoint} />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {COPY.note}
          </p>
        </section>
      </div>
    </div>
  )
}

function Endpoint({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Copy the endpoint"
        onClick={() => {
          void navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}
