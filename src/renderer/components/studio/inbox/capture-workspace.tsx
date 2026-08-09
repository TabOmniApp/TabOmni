import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Mail, Webhook } from "lucide-react"

import type { InboxKind } from "@shared/api"
import { SETTINGS_TAB, useInbox } from "@/lib/inbox/store"
import { MailView } from "./mail-view"
import { ServerSettings } from "./server-settings"
import { WebhookView } from "./webhook-view"

/**
 * Whichever capture one panel's tab strip has selected.
 *
 * A `server` rather than reading the message's own kind, so that a stale id —
 * a tab left over from a message the other panel deleted — resolves to this
 * panel's empty state rather than to the other panel's view.
 */
export function CaptureWorkspace({ server }: { server: InboxKind }) {
  const selectedId = useInbox((state) => state.selectedId[server])
  const messages = useInbox((state) => state.messages)

  if (selectedId === SETTINGS_TAB[server])
    return <ServerSettings server={server} />

  const message = messages.find(
    (candidate) => candidate.id === selectedId && candidate.kind === server
  )

  if (!message) {
    const Icon = server === "mail" ? Mail : Webhook
    return (
      <div className="grid h-full place-items-center p-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon />
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
    )
  }

  return message.kind === "mail" ? (
    <MailView message={message} mail={message.mail} />
  ) : (
    <WebhookView message={message} webhook={message.webhook} />
  )
}
