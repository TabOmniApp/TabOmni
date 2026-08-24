import { useEffect, useRef } from "react"

import {
  chatOptions,
  type ChatPermission,
  type ChatPlace,
  type WorktreeChatOptions,
} from "@shared/api"
import { Spinner } from "@/components/ui/spinner"
import { useStudio } from "@/lib/store"
import { cn } from "@/lib/utils"
import { useWorktrees } from "@/lib/worktree/store"
import { blocksOf } from "@/lib/worktree-chat/activity"
import { placeOf, useWorktreeChats } from "@/lib/worktree-chat/store"
import { ChatAsk } from "./chat-ask"
import { ChatComposer } from "./chat-composer"
import { ChatActivity } from "./chat-activity"
import { ChatMessage } from "./chat-message"
import { WorktreeWelcome } from "./worktree-welcome"

/**
 * A worktree's chat: the pane the strip's chat tabs draw into.
 *
 * The conversation is hosted rather than tailed — one agent-SDK turn at a time
 * in the checkout's own directory, streamed back a message at a time (see
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
  const worktrees = useWorktrees((state) => state.worktrees)

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
      // The chat's own place rather than the workbench's: a chat tab can be on
      // screen for a moment before the context has followed it, and the caption
      // saying what this turn may do has to be about *this* chat.
      place={placeOf(shown, worktrees)}
      // Through `chatOptions` on both sides of the contract: main builds the
      // turn's argument list out of the same reading, and a toolbar showing
      // `Edits` over a turn that ran as a plan is the one disagreement worth
      // ruling out.
      options={chatOptions(shown.options)}
    />
  )
}

/**
 * What the empty field asks for. The permission is what the turn will actually
 * do, so it is what the prompt should be inviting.
 *
 * `where` is the word for the directory, and it is the chat's rather than a
 * constant: a chat in a project's own working tree is not in a checkout, and a
 * placeholder saying otherwise is the composer being wrong about the one thing
 * that decides how carefully somebody phrases the next sentence.
 */
const placeholderFor = (permission: ChatPermission, where: string): string =>
  permission === "plan"
    ? `Ask for a plan for ${where}…`
    : permission === "read"
      ? `Ask about ${where}…`
      : `Ask to make changes in ${where}…`

/**
 * The line under the composer: what this chat's next turn may do, in the words
 * somebody would want to have read before it ran.
 *
 * The last two are the reason this takes the place at all. "In this branch only"
 * is the isolation argument, and in a project's own working tree there is none —
 * the directory *is* the branch they have checked out — so the caption there has
 * to say that instead of borrowing a reassurance that does not hold. See
 * `SYSTEM_PROMPTS` in `main/worktree-chat.ts`, which stops making the same claim
 * to the model.
 */
function captionFor(permission: ChatPermission, isolated: boolean): string {
  switch (permission) {
    case "plan":
      return "Plan mode: this turn reads and changes nothing"
    case "read":
      return "Read only: this turn reads and changes nothing"
    case "ask":
      return "Reading runs freely; edits and commands will stop and ask you"
    case "edits":
      return isolated
        ? "Edits and commands run without asking, in this branch only"
        : "Edits and commands run without asking, in this project's own working tree"
    case "full":
      return isolated
        ? "Full access: nothing is asked, in this branch only"
        : "Full access: nothing is asked, in this project's own working tree"
  }
}

function Conversation({
  chatId,
  place,
  options,
}: {
  chatId: string
  /** Null once the checkout or project a chat names has gone. */
  place: ChatPlace | null
  options: WorktreeChatOptions
}) {
  const messages = useWorktreeChats((state) => state.messages[chatId])
  const sending = useWorktreeChats((state) => state.sending.includes(chatId))
  const ask = useWorktreeChats((state) => state.asks[chatId])
  const send = useWorktreeChats((state) => state.send)
  const stop = useWorktreeChats((state) => state.stop)
  const answer = useWorktreeChats((state) => state.answer)
  const setOptions = useWorktreeChats((state) => state.setOptions)

  // Where the file picker opens and what a picked path is written relative to.
  // The record's own path rather than one built here: a checkout lives under
  // `~/.tabomni/workspace/worktrees/`, which is not something to reconstruct in
  // two places.
  const worktreePath = useWorktrees((state) =>
    state.worktrees.find((entry) => entry.id === place?.worktreeId)
  )?.path
  const folderPath = useStudio((state) =>
    state.folders.find((entry) => entry.id === place?.folderId)
  )?.path
  // Not a `??` chain: a chat in a checkout whose directory has gone must not
  // start writing paths relative to the project's own, which is a different
  // repository state with the same file names.
  const root = place?.worktreeId ? worktreePath : folderPath

  // A place that has gone reads as a checkout, which is what every chat was
  // until now — nothing runs in it either way, and the alternative is a caption
  // naming the user's own working tree for a directory nobody can resolve.
  const isolated = place === null || place.worktreeId !== null

  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  // Follows the newest turn, but only while it is already at the bottom:
  // yanking the view down while somebody reads further up is what makes a
  // transcript unusable.
  // `ask` is in here too: a question arriving is the one thing that must not be
  // left below the fold, since the turn is waiting on it.
  useEffect(() => {
    const element = box.current
    if (element && atBottom.current) element.scrollTop = element.scrollHeight
  }, [messages, sending, ask])

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
          // Where this chat is, which is what somebody with three checkouts of
          // one project open needs before they ask for anything.
          <div className="w-full max-w-md">
            <WorktreeWelcome place={place} />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
            {blocksOf(lines).map((block) =>
              block.kind === "activity" ? (
                <ChatActivity key={block.id} of={block} />
              ) : (
                <ChatMessage key={block.id} of={block.line} />
              )
            )}
            {/* At the end of the transcript rather than over it: it is the turn
                asking, so it belongs where the turn had got to. */}
            {ask && (
              <ChatAsk ask={ask} onAnswer={(given) => answer(chatId, given)} />
            )}
            {/* Not while a question is up — the turn is held, not working, and
                a spinner under the card would say otherwise. */}
            {sending && !ask && (
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
              ask
                ? "Answer above to carry on…"
                : placeholderFor(
                    options.permission,
                    isolated ? "this checkout" : "this project"
                  )
            }
            options={options}
            onOptions={(next) => setOptions(chatId, next)}
            attachRoot={root}
          />

          {/* Said plainly rather than left implicit: a turn here edits files and
              runs commands without asking, and the only reason that is
              acceptable is that this is a branch of its own. It has to follow
              the permission rather than describe the usual one — a caption that
              lies about the turn is worse than none, in either direction. */}
          <p
            className={cn(
              "px-1 text-[0.7rem]",
              options.permission === "full"
                ? "text-destructive"
                : "text-muted-foreground"
            )}
          >
            {ask
              ? "The turn is waiting on your answer. Stop ends it instead."
              : captionFor(options.permission, isolated)}
          </p>
        </div>
      </div>
    </div>
  )
}
