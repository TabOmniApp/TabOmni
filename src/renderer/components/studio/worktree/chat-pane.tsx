import { useEffect, useRef } from "react"

import { DEFAULT_CHAT_OPTIONS, type WorktreeChatOptions } from "@shared/api"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { useWorktrees } from "@/lib/worktree/store"
import { useWorktreeChats } from "@/lib/worktree-chat/store"
import { ChatComposer } from "./chat-composer"
import { ChatMessage } from "./chat-message"
import { WorktreeWelcome } from "./worktree-welcome"

/**
 * A worktree's chat: the pane the strip's chat tabs draw into.
 *
 * The conversation is hosted rather than tailed — `claude -p` per turn in the
 * checkout's own directory, streamed back a message at a time (see
 * `main/worktree-chat.ts`). So this is the app's own chat UI rather than a
 * reader: a session's chat view tails the transcript the interactive CLI
 * writes, and therefore cannot be anything else.
 *
 * The rows and the composer are its own — `ChatMessage` and `ChatComposer`
 * beside this file. They were the assistant panel's until that panel was
 * removed, and came here with it: this is the only chat left in the app.
 *
 * One pane for every chat, keyed by which one the strip has selected — the tabs
 * above it are `lib/panels.ts`'s, grouped by worktree, so the outer tab is the
 * branch and the strip inside it is that checkout's conversations.
 */
export function WorktreeChatPane() {
  const chats = useWorktreeChats((state) => state.chats)
  const selectedId = useWorktreeChats((state) => state.selectedId)
  const openIds = useWorktreeChats((state) => state.openIds)

  const shown =
    selectedId && openIds.includes(selectedId)
      ? chats.find((chat) => chat.id === selectedId)
      : undefined

  // A tab whose chat was deleted underneath it. Said here rather than through
  // `NothingOpen`, which is about a rail section having nothing selected — this
  // pane has no section, and the answer is about the chat.
  if (!shown) {
    return (
      <div className="grid h-full place-items-center p-6">
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          That chat has been deleted. Pick another from the strip, or start one
          from its worktree.
        </p>
      </div>
    )
  }

  return (
    <Conversation
      chatId={shown.id}
      worktreeId={shown.worktreeId}
      options={shown.options ?? DEFAULT_CHAT_OPTIONS}
    />
  )
}

function Conversation({
  chatId,
  worktreeId,
  options,
}: {
  chatId: string
  worktreeId: string
  options: WorktreeChatOptions
}) {
  const messages = useWorktreeChats((state) => state.messages[chatId])
  const sending = useWorktreeChats((state) => state.sending.includes(chatId))
  const send = useWorktreeChats((state) => state.send)
  const stop = useWorktreeChats((state) => state.stop)
  const setOptions = useWorktreeChats((state) => state.setOptions)

  // Where the file picker opens and what a picked path is written relative to.
  // The record's own path rather than one built here: a checkout lives under
  // `~/.tabomni/workspace/worktrees/`, which is not something to reconstruct in
  // two places.
  const root = useWorktrees((state) =>
    state.worktrees.find((entry) => entry.id === worktreeId)
  )?.path

  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  // Follows the newest turn, but only while it is already at the bottom:
  // yanking the view down while somebody reads further up is what makes a
  // transcript unusable.
  useEffect(() => {
    const element = box.current
    if (element && atBottom.current) element.scrollTop = element.scrollHeight
  }, [messages, sending])

  const lines = messages ?? []
  const empty = lines.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={box}
        onScroll={(event) => {
          const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
          atBottom.current = scrollHeight - scrollTop - clientHeight < 8
        }}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          empty ? "grid place-items-center px-6" : "px-4 py-4"
        )}
      >
        {empty ? (
          // Where this checkout came from, which is what somebody with three of
          // them open needs before they ask for anything.
          <div className="w-full max-w-md">
            <WorktreeWelcome worktreeId={worktreeId} />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
            {lines.map((line) => (
              <ChatMessage key={line.id} of={line} />
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3" />
                Working…
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t p-3">
        <div className="mx-auto w-full max-w-2xl space-y-1.5">
          <ChatComposer
            sending={sending}
            onSend={(text) => void send(chatId, text)}
            onStop={() => stop(chatId)}
            placeholder={
              options.plan
                ? "Ask for a plan for this checkout…"
                : "Ask to make changes in this checkout…"
            }
            options={options}
            onOptions={(next) => setOptions(chatId, next)}
            attachRoot={root}
          />

          {/* Said plainly rather than left implicit: a turn here edits files and
              runs commands without asking, and the only reason that is
              acceptable is that this is a branch of its own. Plan mode is the
              one case where that is not true, and the line has to say so — a
              caption that lies about the turn is worse than none. */}
          <p className="px-1 text-[0.7rem] text-muted-foreground">
            {options.plan
              ? "Plan mode: this turn reads and changes nothing"
              : "Edits and commands run without asking, in this branch only"}
          </p>
        </div>
      </div>
    </div>
  )
}
