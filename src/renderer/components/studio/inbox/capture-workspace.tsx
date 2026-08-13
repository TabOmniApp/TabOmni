import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Mail } from "lucide-react"
import { cn } from "@/lib/utils"

import { SETTINGS_TAB, useInbox } from "@/lib/inbox/store"
import { MailView } from "./mail-view"
import { ServerSettings } from "./server-settings"

/**
 * The panel's captures, one view per open tab.
 *
 * Stacked and hidden rather than swapped, the way the Notes and Explorer panes
 * do it: a long mail body is scrolled, and a pane that mounted one view and
 * changed the message under it put every one of them back at the top on the way
 * back. Nothing here is expensive to keep — a capture is already in the store,
 * and the view over it is markup.
 */
export function CaptureWorkspace() {
  const openIds = useInbox((state) => state.openIds)
  const selectedId = useInbox((state) => state.selectedId)

  const activeId =
    selectedId && openIds.includes(selectedId) ? selectedId : null

  return (
    <div className="relative h-full">
      {openIds.map((id) => (
        <div
          key={id}
          className={cn("absolute inset-0", id !== activeId && "invisible")}
        >
          <CapturePane id={id} />
        </div>
      ))}

      {activeId === null && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Mail />
              </EmptyMedia>
              <EmptyTitle>Nothing selected</EmptyTitle>
              <EmptyDescription>
                Pick a captured message from the list.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}
    </div>
  )
}

/** What one tab of this panel shows. A stale id — a tab left over from a
 * message since deleted — draws nothing. */
function CapturePane({ id }: { id: string }) {
  const message = useInbox((state) =>
    state.messages.find((candidate) => candidate.id === id)
  )

  if (id === SETTINGS_TAB) return <ServerSettings />
  if (!message) return null

  return <MailView message={message} mail={message.mail} />
}
