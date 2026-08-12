import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Mail, Webhook } from "lucide-react"
import { cn } from "@/lib/utils"

import type { InboxKind } from "@shared/api"
import { SETTINGS_TAB, useInbox } from "@/lib/inbox/store"
import { MailView } from "./mail-view"
import { ServerSettings } from "./server-settings"
import { WebhookView } from "./webhook-view"

/**
 * One panel's captures, one view per open tab.
 *
 * Stacked and hidden rather than swapped, the way the Notes and Explorer panes
 * do it: a long mail body and a webhook's payload are both scrolled, and a pane
 * that mounted one view and changed the message under it put every one of them
 * back at the top on the way back. Nothing here is expensive to keep — a
 * capture is already in the store, and the view over it is markup.
 */
export function CaptureWorkspace({ server }: { server: InboxKind }) {
  const openIds = useInbox((state) => state.openIds[server])
  const selectedId = useInbox((state) => state.selectedId[server])

  const activeId =
    selectedId && openIds.includes(selectedId) ? selectedId : null

  return (
    <div className="relative h-full">
      {openIds.map((id) => (
        <div
          key={id}
          className={cn("absolute inset-0", id !== activeId && "invisible")}
        >
          <CapturePane server={server} id={id} />
        </div>
      ))}

      {activeId === null && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {server === "mail" ? <Mail /> : <Webhook />}
              </EmptyMedia>
              <EmptyTitle>Nothing selected</EmptyTitle>
              <EmptyDescription>
                {server === "mail"
                  ? "Pick a captured message from the list."
                  : "Pick a captured request from the list."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}
    </div>
  )
}

/**
 * What one tab of this panel shows.
 *
 * The message is looked up by `server` rather than read from its own kind, so
 * that a stale id — a tab left over from a message the other panel deleted —
 * draws nothing rather than the other panel's view.
 */
function CapturePane({ server, id }: { server: InboxKind; id: string }) {
  const message = useInbox((state) =>
    state.messages.find(
      (candidate) => candidate.id === id && candidate.kind === server
    )
  )

  if (id === SETTINGS_TAB[server]) return <ServerSettings server={server} />
  if (!message) return null

  return message.kind === "mail" ? (
    <MailView message={message} mail={message.mail} />
  ) : (
    <WebhookView message={message} webhook={message.webhook} />
  )
}
