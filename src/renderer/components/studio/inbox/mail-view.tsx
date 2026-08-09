import { useState } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { Paperclip, Trash2 } from "lucide-react"

import type { InboxMail, InboxMessage } from "@shared/api"
import { useInbox } from "@/lib/inbox/store"
import { ResponseBody } from "../api/response-body"
import { IconButton } from "../icon-button"

/**
 * What a mail's four views are.
 *
 * `Raw` earns its place: the panel exists to answer "is the app sending what I
 * think it is", and every other view is this one after a parser has had an
 * opinion about it.
 */
type View = "preview" | "text" | "raw" | "files"

/**
 * The HTML part, rendered in a frame that can do nothing.
 *
 * `sandbox=""` — every permission withheld, scripts included — and a CSP that
 * allows only what a data URI carries. Two separate things are being stopped:
 * a mail template with a script in it must not run inside the studio, and a
 * remote image must not load, because in a mail that image is a tracking pixel
 * and loading it tells a server the message was opened. A development mail
 * catcher that phoned home when a message was read would be a poor thing to
 * ship.
 *
 * Inline images the message carried itself are gone too — they are `cid:`
 * references, and nothing here resolves those. They are still in Files.
 */
const FRAME_POLICY =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:\">"

export function MailView({
  message,
  mail,
}: {
  message: InboxMessage
  mail: InboxMail
}) {
  const remove = useInbox((state) => state.remove)
  const [view, setView] = useState<View>(mail.html ? "preview" : "text")

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
            {mail.subject || "(no subject)"}
          </h2>
          <IconButton
            label="Delete this message"
            onClick={() => void remove(message.id)}
          >
            <Trash2 />
          </IconButton>
        </div>

        <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">
          <Field label="From">{mail.headerFrom || mail.from}</Field>
          <Field label="To">{mail.to.join(", ") || mail.headerTo}</Field>
          <Field label="Received">
            {new Date(message.receivedAt).toLocaleString()}
          </Field>
          {/*
            Only when they differ. The envelope is who really sent and who was
            really delivered to — `Bcc` shows up here and in no header — and
            saying so every time would bury the one case where it matters.
          */}
          {mail.from !== mail.headerFrom && mail.headerFrom && (
            <Field label="Envelope">{mail.from}</Field>
          )}
        </dl>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <Tabs value={view} onValueChange={(value) => setView(value as View)}>
          <TabsList variant="line" className="h-7">
            <TabsTrigger
              value="preview"
              disabled={!mail.html}
              className="px-2 text-xs"
            >
              Preview
            </TabsTrigger>
            <TabsTrigger
              value="text"
              disabled={!mail.text}
              className="px-2 text-xs"
            >
              Text
            </TabsTrigger>
            <TabsTrigger value="raw" className="px-2 text-xs">
              Raw
            </TabsTrigger>
            <TabsTrigger
              value="files"
              disabled={mail.attachments.length === 0}
              className="px-2 text-xs"
            >
              Files
              {mail.attachments.length > 0 && (
                <span className="ml-1 text-muted-foreground">
                  {mail.attachments.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1">
        {view === "preview" ? (
          <iframe
            // Keyed by message so switching captures replaces the document
            // rather than leaving the previous one to be re-written into.
            key={message.id}
            title="Message preview"
            sandbox=""
            srcDoc={FRAME_POLICY + mail.html}
            className="h-full w-full bg-white"
          />
        ) : view === "text" ? (
          <pre className="h-full overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
            {mail.text}
          </pre>
        ) : view === "raw" ? (
          <ResponseBody value={mail.raw} contentType="text/plain" />
        ) : (
          <Attachments mail={mail} />
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{children}</dd>
    </>
  )
}

/**
 * What the message carried.
 *
 * An image is shown, everything else is named. There is no download: the
 * attachment was built by the project's own code from a file it already has,
 * and the question this panel answers is whether the right one went out.
 */
function Attachments({ mail }: { mail: InboxMail }) {
  return (
    <div className="h-full overflow-auto p-3">
      <ul className="space-y-2">
        {mail.attachments.map((attachment, index) => (
          <li
            key={`${attachment.filename}:${index}`}
            className="rounded-md border p-2"
          >
            <div className="flex items-center gap-2 text-xs">
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">
                {attachment.filename}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[0.65rem] text-muted-foreground">
                {attachment.contentType} · {bytes(attachment.size)}
              </span>
            </div>

            {attachment.dataUrl &&
              attachment.contentType.startsWith("image/") && (
                <img
                  src={attachment.dataUrl}
                  alt={attachment.filename}
                  className={cn(
                    "mt-2 max-h-64 rounded border bg-white object-contain"
                  )}
                />
              )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function bytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
