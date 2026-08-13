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
import { Mail, Paperclip, Play, Settings2, Square, Trash2 } from "lucide-react"

import type { InboxMessage } from "@shared/api"
import { receivedLabel, useInbox } from "@/lib/inbox/store"
import { SECTION_ACCENT } from "../activity-bar"
import { IconButton } from "../icon-button"
import { PanelHeader } from "../panel-header"
import { SideRow } from "../side-row"

/** The sidebar for Mail: the arrivals, and the switch that binds the port. */
const PANEL = {
  title: "Mail",
  /** What the header's start/stop is binding, for its tooltip. */
  server: "SMTP server",
  waiting:
    "Point the project's mailer at this port. Nothing is delivered onward — every message it accepts lands here.",
  stopped:
    "Start the SMTP server to catch what the project sends. Mail sent while it is down goes wherever it was already configured to go.",
}

export function CaptureList() {
  const messages = useInbox((state) => state.messages)
  const status = useInbox((state) => state.status)
  const selectedId = useInbox((state) => state.selectedId)
  const refresh = useInbox((state) => state.refresh)
  const start = useInbox((state) => state.start)
  const stop = useInbox((state) => state.stop)
  const select = useInbox((state) => state.select)
  const openSettings = useInbox((state) => state.openSettings)
  const remove = useInbox((state) => state.remove)
  const clear = useInbox((state) => state.clear)

  const [clearing, setClearing] = useState(false)
  const accent = SECTION_ACCENT.mail

  // Once for the window: the captures are the workspace's, and there is no
  // longer anything they can be re-read in response to.
  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={PANEL.title}>
        <IconButton
          label={
            status.listening
              ? `Stop the ${PANEL.server}`
              : `Start the ${PANEL.server}`
          }
          onClick={() => void (status.listening ? stop() : start())}
          className={status.listening ? "hover:text-current" : undefined}
          style={status.listening ? { color: accent } : undefined}
        >
          {status.listening ? <Square /> : <Play />}
        </IconButton>
        <IconButton
          label={`Clear ${PANEL.title.toLowerCase()}`}
          disabled={messages.length === 0}
          onClick={() => setClearing(true)}
        >
          <Trash2 />
        </IconButton>
        <IconButton label="Port and endpoint" onClick={() => openSettings()}>
          <Settings2 />
        </IconButton>
      </PanelHeader>

      {/* Whether anything is listening is the first thing to know when the
          list is empty, so it sits above the list rather than in the settings
          tab that the empty state would otherwise have to point at. */}
      <button
        type="button"
        onClick={() => openSettings()}
        className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-left text-[0.65rem] text-muted-foreground hover:bg-muted/60"
      >
        <span
          aria-hidden
          style={status.listening ? { backgroundColor: accent } : undefined}
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            !status.listening && "bg-muted-foreground/40"
          )}
        />
        <span className="font-mono">smtp://127.0.0.1:{status.port}</span>
        <span className="ml-auto">
          {status.listening ? "listening" : "stopped"}
        </span>
      </button>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {messages.length === 0 ? (
          <Nothing running={status.listening} />
        ) : (
          messages.map((message) => (
            <ContextMenu key={message.id}>
              <ContextMenuTrigger
                render={
                  <div>
                    <MessageRow
                      message={message}
                      accent={accent}
                      active={message.id === selectedId}
                      onClick={() => select(message.id)}
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
              Clear {PANEL.title.toLowerCase()}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All {messages.length} captured{" "}
              {messages.length === 1 ? "message" : "messages"} are deleted. The
              server keeps running — anything sent after this still arrives.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                void clear()
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
 * Two lines rather than one: who it went to is what tells two messages from the
 * same sender apart when their subjects are identical.
 */
function MessageRow({
  message,
  accent,
  active,
  onClick,
}: {
  message: InboxMessage
  /** The panel's hue, so an unread mark matches the rail item it is counted
   * on. */
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
            {message.summary}
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
            {message.mail.to.join(", ") || message.mail.from}
          </span>
          {message.mail.attachments.length > 0 && (
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

function Nothing({ running }: { running: boolean }) {
  return (
    <Empty className="p-4">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Mail />
        </EmptyMedia>
        <EmptyTitle>{running ? "Waiting" : "Not listening"}</EmptyTitle>
        <EmptyDescription className="text-xs">
          {running ? PANEL.waiting : PANEL.stopped}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
