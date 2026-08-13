import { Button } from "@/components/ui/button"
import { Play, ScrollText } from "lucide-react"

import {
  useConversations,
  type OpenConversation,
} from "@/lib/terminal/conversations"
import { useTerminal } from "@/lib/terminal/store"
import { useStudio } from "@/lib/store"
import {
  TranscriptFeed,
  useTranscript,
  useTranscriptDisplay,
} from "./chat-view"
import { TouchedFiles } from "./touched-files"

/**
 * What each conversation's own mirror is tagged with.
 *
 * A session tab uses its own id, and the same conversation may well be open in
 * both — read here and running there — so these have to be told apart or the
 * two panes would be handed each other's events.
 */
const MIRROR = "read:"

/**
 * A `claude` conversation drawn from its transcript alone: no pty, no composer,
 * nothing to talk to.
 *
 * This is the other half of the CLI writing its conversations to disk. The chat
 * view follows the transcript of the session running in its own tab; this
 * follows one that is not running at all — including conversations this app
 * never started, since a `claude` in the user's own terminal appends to the same
 * place. Opened from the Explorer sidebar's list, and read the same way the live
 * chat is read, because the events are the same events.
 *
 * `Resume` is the way from reading to talking: it hands the conversation to a
 * real session (`--resume`) and closes this tab, because what this tab was for
 * is then on screen with a composer under it.
 */
export function ConversationView({
  conversation,
  visible,
}: {
  conversation: OpenConversation
  visible: boolean
}) {
  const folder = useStudio((state) =>
    state.folders.find((entry) => entry.id === conversation.folderId)
  )
  /** The session running this same conversation, if one is: `Resume` goes to it
   * rather than starting a second `claude` on one transcript. */
  const running = useTerminal((state) =>
    state.sessions.some(
      (session) =>
        !session.closed && session.claudeSessionId === conversation.id
    )
  )
  const resume = useConversations((state) => state.resume)

  const transcript = useTranscript({
    id: MIRROR + conversation.id,
    folderId: conversation.folderId,
    claudeSessionId: conversation.id,
  })
  const { showToolCalls, showThinking } = useTranscriptDisplay()

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <ScrollText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs">
          {conversation.title}
        </span>

        {folder && (
          <span className="hidden shrink-0 text-[0.65rem] text-muted-foreground sm:inline">
            {folder.name}
          </span>
        )}

        {/* The CLI's own session id, so the conversation on screen can also be
            reached with `claude --resume` from a terminal of the user's own. */}
        <span
          className="hidden shrink-0 font-mono text-[10px] text-muted-foreground/70 sm:inline"
          title={`claude --resume ${conversation.id}`}
        >
          {conversation.id.slice(0, 8)}
        </span>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => resume(conversation.id)}
          className="h-6 shrink-0 gap-1 px-2 text-xs"
        >
          <Play className="size-3" />
          {running ? "Go to session" : "Resume"}
        </Button>
      </div>

      <TranscriptFeed
        entries={transcript.entries}
        // Nothing is being sent from here, so there is never a message waiting
        // to come back out of the file.
        pending={[]}
        conversation={conversation.id}
        // Deliberately conditional about the file: this is also what is on
        // screen for the beat between the mirror's first empty event and the
        // transcript arriving, so it must not announce a deletion that has not
        // happened.
        emptyNotice="Nothing in this transcript. A conversation whose file has been deleted reads as empty here — `claude --resume` would not find it either."
        visible={visible}
        showToolCalls={showToolCalls}
        showThinking={showThinking}
      />

      {/* The files this conversation wrote, listed the same way a live session's
          are — reading a finished conversation is largely asking what it did.
          Nothing is re-read off disk for these: the writes happened whenever this
          conversation ran, and a tree refreshed from a transcript days old would
          be answering a question nobody asked. */}
      <TouchedFiles paths={transcript.touched} />
    </div>
  )
}
