import { useEffect, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import {
  Mail,
  Paperclip,
  Play,
  Settings2,
  Square,
  Trash2,
  Webhook,
} from "lucide-react"

import type { InboxKind, InboxMessage } from "@shared/api"
import { messagesOf, receivedLabel, useInbox } from "@/lib/inbox/store"
import { useStudio } from "@/lib/store"
import { SECTION_ACCENT } from "../activity-bar"
import { METHOD_TONES } from "../api/request-list"
import { IconButton } from "../icon-button"
import { PanelHeader } from "../panel-header"
import { SideRow } from "../side-row"

/**
 * The sidebar for Mail and for Webhooks.
 *
 * One component with a `server` rather than two files: the two panels are the
 * same list of arrivals — same header, same status strip, same start/stop, same
 * unread treatment — and only the row and the wording differ. Writing it twice
 * is how two sidebars drift a pixel apart, which is the reason `SideRow` and
 * `PanelHeader` exist at all.
 *
 * What is *not* shared is anything above this: two rail sections, two panes,
 * two settings tabs, two switches. They replace two applications and are used
 * in two different frames of mind.
 */
const PANEL: Record<
  InboxKind,
  {
    title: string
    Icon: typeof Mail
    /** What the header's start/stop is binding, for its tooltip. */
    server: string
    waiting: string
    stopped: string
  }
> = {
  mail: {
    title: "Mail",
    Icon: Mail,
    server: "SMTP server",
    waiting:
      "Point the project's mailer at this port. Nothing is delivered onward — every message it accepts lands here.",
    stopped:
      "Start the SMTP server to catch what the project sends. Mail sent while it is down goes wherever it was already configured to go.",
  },
  webhook: {
    title: "Webhooks",
    Icon: Webhook,
    server: "webhook catcher",
    waiting:
      "Point a provider — or your own code — at this port. Every method on every path is caught and answered with a 200.",
    stopped:
      "Start the catcher to bind the port. A callback fired while it is down cannot be caught after the fact.",
  },
}

export function CaptureList({ server }: { server: InboxKind }) {
  const projectId = useStudio((state) => state.projectId)

  const messages = useInbox((state) => state.messages)
  const status = useInbox((state) => state.status[server])
  const selectedId = useInbox((state) => state.selectedId[server])
  const refresh = useInbox((state) => state.refresh)
  const start = useInbox((state) => state.start)
  const stop = useInbox((state) => state.stop)
  const select = useInbox((state) => state.select)
  const openSettings = useInbox((state) => state.openSettings)
  const remove = useInbox((state) => state.remove)
  const clear = useInbox((state) => state.clear)

  const [clearing, setClearing] = useState(false)
  const panel = PANEL[server]
  const accent = SECTION_ACCENT[server]

  useEffect(() => {
    if (projectId) void refresh()
  }, [projectId, refresh])

  const own = messagesOf(messages, server)

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={panel.title}>
        <IconButton
          label={
            status.listening
              ? `Stop the ${panel.server}`
              : `Start the ${panel.server}`
          }
          disabled={!projectId}
          onClick={() => void (status.listening ? stop(server) : start(server))}
          className={status.listening ? "hover:text-current" : undefined}
          style={status.listening ? { color: accent } : undefined}
        >
          {status.listening ? <Square /> : <Play />}
        </IconButton>
        <IconButton
          label={`Clear ${panel.title.toLowerCase()}`}
          disabled={own.length === 0}
          onClick={() => setClearing(true)}
        >
          <Trash2 />
        </IconButton>
        <IconButton
          label="Port and endpoint"
          disabled={!projectId}
          onClick={() => openSettings(server)}
        >
          <Settings2 />
        </IconButton>
      </PanelHeader>

      {/* Whether anything is listening is the first thing to know when the
          list is empty, so it sits above the list rather than in the settings
          tab that the empty state would otherwise have to point at. */}
      <button
        type="button"
        onClick={() => openSettings(server)}
        disabled={!projectId}
        className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-left text-[0.65rem] text-muted-foreground hover:bg-muted/60 disabled:pointer-events-none"
      >
        <span
          aria-hidden
          style={status.listening ? { backgroundColor: accent } : undefined}
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            !status.listening && "bg-muted-foreground/40"
          )}
        />
        <span className="font-mono">
          {server === "mail" ? "smtp" : "http"}://127.0.0.1:{status.port}
        </span>
        <span className="ml-auto">
          {status.listening ? "listening" : "stopped"}
        </span>
      </button>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {own.length === 0 ? (
          <Nothing
            server={server}
            hasProject={Boolean(projectId)}
            running={status.listening}
          />
        ) : (
          own.map((message) => (
            <ContextMenu key={message.id}>
              <ContextMenuTrigger
                render={
                  <div>
                    <MessageRow
                      message={message}
                      accent={accent}
                      active={message.id === selectedId}
                      onClick={() => select(server, message.id)}
                    />
                  </div>
                }
              />
              <ContextMenuContent>
                <ContextMenuItem
                  variant="destructive"
                  onClick={() => void remove(message.id)}
                >
                  <Trash2 />
                  Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))
        )}
      </div>

      <AlertDialog open={clearing} onOpenChange={setClearing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Clear {panel.title.toLowerCase()}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All {own.length} captured{" "}
              {own.length === 1 ? "message" : "messages"} in this panel are
              deleted. The other panel keeps its own, and the server keeps
              running — anything sent after this still arrives.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                void clear(server)
                setClearing(false)
              }}
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * One capture.
 *
 * Two lines rather than one: who it went to, or how big the payload was, is
 * what tells two events from the same provider apart when their first lines
 * are identical.
 */
function MessageRow({
  message,
  accent,
  active,
  onClick,
}: {
  message: InboxMessage
  /** The panel's own hue, so an unread mark matches the rail item it is
   * counted on. */
  accent: string
  active: boolean
  onClick: () => void
}) {
  return (
    <SideRow
      active={active}
      onClick={onClick}
      title={message.summary}
      className="h-auto items-start py-1.5 text-foreground"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate",
              message.unread ? "font-medium" : "text-muted-foreground"
            )}
          >
            {message.kind === "webhook" ? (
              <>
                <span
                  className={cn(
                    "font-mono text-[0.6rem] font-semibold",
                    METHOD_TONES[message.webhook.method] ??
                      "text-muted-foreground"
                  )}
                >
                  {message.webhook.method}
                </span>{" "}
                {message.webhook.path}
              </>
            ) : (
              message.summary
            )}
          </span>
          {message.unread && (
            <span
              aria-label="Unread"
              style={{ backgroundColor: accent }}
              className="ml-auto size-1.5 shrink-0 rounded-full"
            />
          )}
        </span>

        <span className="flex min-w-0 items-center gap-1.5 text-[0.65rem] text-muted-foreground">
          <span className="truncate">
            {message.kind === "mail"
              ? message.mail.to.join(", ") || message.mail.from
              : `${message.webhook.size} bytes`}
          </span>
          {message.kind === "mail" && message.mail.attachments.length > 0 && (
            <Paperclip className="size-2.5 shrink-0" />
          )}
          <span className="ml-auto shrink-0">
            {receivedLabel(message.receivedAt)}
          </span>
        </span>
      </span>
    </SideRow>
  )
}

function Nothing({
  server,
  hasProject,
  running,
}: {
  server: InboxKind
  hasProject: boolean
  running: boolean
}) {
  const panel = PANEL[server]
  return (
    <Empty className="p-4">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <panel.Icon />
        </EmptyMedia>
        <EmptyTitle>
          {!hasProject
            ? "No project open"
            : running
              ? "Waiting"
              : "Not listening"}
        </EmptyTitle>
        <EmptyDescription className="text-xs">
          {!hasProject
            ? "The server binds per project."
            : running
              ? panel.waiting
              : panel.stopped}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
