import { useEffect, useRef, useState, type DragEvent } from "react"

import {
  chatOptions,
  type ChatPermission,
  type ChatPlace,
  type WorktreeChatOptions,
} from "@shared/api"
import { useStudio } from "@/lib/store"
import { cn } from "@/lib/utils"
import { blocksOf } from "@/lib/worktree-chat/activity"
import { placeOf, useWorktreeChats } from "@/lib/worktree-chat/store"
import { chatLine, totalOf, usageDetail } from "@/lib/worktree-chat/usage"
import { ChatCardChip } from "../board/chat-card-chip"
import { ChatAsk } from "./chat-ask"
import { ChatComposer, type ChatComposerHandle } from "./chat-composer"
import { ChatActivity } from "./chat-activity"
import { ChatMessage } from "./chat-message"
import { ChatSkeleton, ChatTranscriptSkeleton } from "./chat-skeleton"
import { WorktreeWelcome } from "./worktree-welcome"

/**
 * A project's chat: the pane the strip's chat tabs draw into.
 *
 * The conversation is hosted rather than tailed — one agent-SDK turn at a time
 * in the project's own directory, streamed back a message at a time (see
 * `main/worktree-chat.ts`). So this is the app's own chat UI rather than a
 * reader: a session's chat view tails the transcript the interactive CLI
 * writes, and therefore cannot be anything else.
 *
 * The rows and the composer are its own — `ChatMessage` and `ChatComposer`
 * beside this file. They were the assistant panel's until that panel was
 * removed, and came here with it: this is the only chat left in the app.
 *
 * One pane for every chat, keyed by which one the strip has selected — the tabs
 * above it are `lib/panels.ts`'s, gathered under the project when grouping is
 * switched on.
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
          from its project.
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
      place={placeOf(shown)}
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
 * The last two say **where**, and that is the point of them. There was a second
 * wording for a chat in a `git worktree` checkout — "in this branch only",
 * which is the isolation argument — and it does not hold here: the directory
 * *is* the branch the user has checked out, so the caption says so rather than
 * borrowing a reassurance. See `SYSTEM_PROMPT` in `main/worktree-chat.ts`,
 * which tells the model the same thing.
 */
function captionFor(permission: ChatPermission): string | null {
  switch (permission) {
    case "plan":
      return "Plan mode: this turn reads and changes nothing"
    case "read":
      return "Read only: this turn reads and changes nothing"
    case "ask":
      return "Reading runs freely; edits and commands will stop and ask you"
    // Nothing for `edits`: it is the mode a chat is normally in, so its caption
    // was under the composer of every chat all day saying what the toolbar
    // above it already says. The modes that still speak are the ones somebody
    // would be surprised by — the two that refuse, and the one that asks
    // nothing at all.
    case "edits":
      return null
    case "full":
      return "Full access: nothing is asked, in this project's own working tree"
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
  const reading = useWorktreeChats((state) => state.reading.includes(chatId))
  const sending = useWorktreeChats((state) => state.sending.includes(chatId))
  const startedAt = useWorktreeChats((state) => state.startedAt[chatId])
  const context = useWorktreeChats((state) => state.context[chatId])
  const ask = useWorktreeChats((state) => state.asks[chatId])
  const send = useWorktreeChats((state) => state.send)
  const stop = useWorktreeChats((state) => state.stop)
  const answer = useWorktreeChats((state) => state.answer)
  const setOptions = useWorktreeChats((state) => state.setOptions)
  /**
   * This chat's unsent draft — what was typed and left, or a message written
   * *for* the user: the `Changes` pane's review, which `Ask AI to fix` puts in
   * the field rather than sending (`drafts` on the store).
   *
   * Read here and handed down as the field's initial value, which is why the
   * composer is keyed by the chat below: a draft belongs to the conversation it
   * was written in, and the same field instance carried across a switch is how
   * one chat's half-written message came to sit under another one's.
   */
  const seeded = useWorktreeChats((state) => state.drafts[chatId])
  const keepDraft = useWorktreeChats((state) => state.keepDraft)
  const clearDraft = useWorktreeChats((state) => state.clearDraft)

  // Where the file picker opens and what a picked path is written relative to.
  // The record's own path rather than one built here, and undefined for a
  // project that has left the workspace — there is nowhere to resolve against.
  const root = useStudio((state) =>
    state.folders.find((entry) => entry.id === place?.folderId)
  )?.path

  const lines = messages ?? []
  // A chat with no lines *yet* is not an empty chat, and the two have nothing
  // in common to say — one gets the skeleton, the other the welcome.
  const empty = !reading && lines.length === 0

  const box = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const composer = useRef<ChatComposerHandle>(null)

  /**
   * A file dropped anywhere over the conversation, typed in as its path.
   *
   * The same substitution the terminal makes (`terminal-view.tsx`) and for the
   * same reason: what goes to the turn is a prompt, so a picture is *named* to
   * it rather than uploaded — the agent runs here with `Read`, which is how it
   * opens an image. Anywhere over the pane rather than on the field alone,
   * because a screenshot is dragged at the conversation, not at a 60-pixel box.
   *
   * Any file, not only a picture, for the reason the `+` menu takes any: a path
   * is a path, and a `.csv` dropped in is as good an instruction as a `.png`.
   *
   * `dragleave` fires on every crossing into a child as well as on the way out,
   * so the depth is counted rather than trusted — read as a boolean the tint
   * flickers off the moment the pointer moves over a message.
   */
  const [dropping, setDropping] = useState(false)
  const depth = useRef(0)

  const carriesFiles = (event: DragEvent) =>
    [...event.dataTransfer.types].includes("Files")

  function onDrop(event: DragEvent) {
    if (!carriesFiles(event)) return
    event.preventDefault()
    depth.current = 0
    setDropping(false)

    // Empty for anything with no file behind it — an image dragged out of a
    // web page is bytes Chromium is holding, and there is no path to type.
    // Those are dropped rather than written out to the workspace: what the
    // turn would then read is a copy nobody can find again.
    const paths = [...event.dataTransfer.files]
      .map((file) => window.desktop.getPathForFile(file))
      .filter(Boolean)
    composer.current?.insertPaths(paths)
  }
  /**
   * Whether the view is following the end of the transcript. Deliberately not
   * "is scrolled to the bottom": a message rendering taller a frame later —
   * markdown, a code block, an image — leaves the view short of the bottom
   * without anybody having scrolled, and reading the distance alone is what
   * made the pane stop following after the first such block.
   */
  const pinned = useRef(true)
  const lastTop = useRef(0)

  // Follows the newest turn, but only while it is pinned: yanking the view down
  // while somebody reads further up is what makes a transcript unusable.
  // `ask` is in here too: a question arriving is the one thing that must not be
  // left below the fold, since the turn is waiting on it.
  useEffect(() => {
    const element = box.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [messages, sending, ask])

  // Opening a chat lands at its newest turn. The pane is one instance reused
  // across the strip's chats rather than one per chat, so without this a switch
  // inherits the previous conversation's scroll position — and its pin, which
  // is what kept the effect above from following the new chat at all.
  useEffect(() => {
    const element = box.current
    pinned.current = true
    lastTop.current = 0
    if (element) element.scrollTop = element.scrollHeight
  }, [chatId])

  // The transcript settles over several frames — lines arrive from disk after
  // the switch, and a block that has just mounted grows as its markdown, code
  // and images render. Scrolling once from an effect lands on whatever height
  // existed at that moment, so the bottom is held here instead, for as long as
  // the content keeps changing size.
  useEffect(() => {
    const element = box.current
    const inner = content.current
    if (!element || !inner) return
    const observer = new ResizeObserver(() => {
      if (!pinned.current) return
      element.scrollTop = element.scrollHeight
      lastTop.current = element.scrollTop
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [empty, reading])

  // The chat's own running cost, added up from the turns' own lines rather than
  // kept anywhere — see `totalOf`. Null for a chat with no usage lines at all,
  // which is every chat written before there were any.
  const total = totalOf(lines)
  // With the context window where it stands *now* rather than where the last
  // turn left it: main sends that per reply, so it moves while a turn works.
  const line = chatLine(total, context)
  const detail = total
    ? usageDetail({ ...total, context: context ?? total.context })
    : undefined

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        depth.current += 1
        setDropping(true)
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return
        // Without this the drop is refused and Chromium navigates the window to
        // the file instead, which takes the whole studio with it.
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
      }}
      onDragLeave={(event) => {
        if (!carriesFiles(event)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDropping(false)
      }}
      onDrop={onDrop}
    >
      {/* Over the pane rather than around it: a border on the container would
          move the transcript by a pixel as the pointer came in. */}
      {dropping && (
        <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-lg border-2 border-dashed border-ring bg-background/70">
          <p className="text-xs text-muted-foreground">
            Drop to write the path into your message
          </p>
        </div>
      )}

      {/* Above the transcript rather than beside the composer: it is a fact
          about the conversation, not a control over the next turn. Draws
          nothing at all for a chat no card names — see `ChatCardChip`. */}
      <ChatCardChip chatId={chatId} />

      <div
        ref={box}
        onScroll={(event) => {
          const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
          // Reaching the bottom pins; only scrolling *up* unpins. Content
          // growing under a still view fires a scroll event too, and treating
          // that as leaving the bottom is what stopped the pane following a
          // turn that was still rendering.
          if (scrollHeight - scrollTop - clientHeight < 8) pinned.current = true
          else if (scrollTop < lastTop.current - 1) pinned.current = false
          lastTop.current = scrollTop
        }}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          empty ? "grid place-items-center px-6" : "px-4 py-4"
        )}
      >
        {reading ? (
          <div
            ref={content}
            className="mx-auto flex w-full max-w-2xl flex-col gap-3"
          >
            <ChatTranscriptSkeleton />
          </div>
        ) : empty ? (
          // Where this chat is, which is what somebody with three checkouts of
          // one project open needs before they ask for anything.
          <div className="w-full max-w-md">
            <WorktreeWelcome place={place} />
          </div>
        ) : (
          <div
            ref={content}
            className="mx-auto flex w-full max-w-2xl flex-col gap-3"
          >
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
            {sending && !ask && <ChatSkeleton startedAt={startedAt} />}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t p-3">
        <div className="mx-auto w-full max-w-2xl space-y-1.5">
          <ChatComposer
            // One field per chat: its draft is that chat's, and a field kept
            // across a switch is one draft shared by every conversation.
            key={chatId}
            ref={composer}
            initialDraft={seeded ?? ""}
            // The field on its way out — switching chats, or this panel being
            // taken down — hands back what was in it, and that is what makes
            // coming back to a chat find the sentence you left in it.
            onLeave={(text) => keepDraft(chatId, text)}
            sending={sending}
            onSend={(text) => {
              // Before the send, so the draft cannot outlive the message: the
              // field empties itself, and this is what stops a rebuild of it
              // putting the sent text back.
              clearDraft(chatId)
              void send(chatId, text)
            }}
            onStop={() => stop(chatId)}
            placeholder={
              ask
                ? "Answer above to carry on…"
                : sending
                  ? // Said rather than left to be discovered: the field is live
                    // while a turn runs, and somebody who last used this app a
                    // version ago has every reason to think it is not.
                    "Type ahead — this goes when the turn ends…"
                  : placeholderFor(options.permission, "this project")
            }
            options={options}
            onOptions={(next) => setOptions(chatId, next)}
            attachRoot={root}
          />

          {/* Said plainly rather than left implicit: a turn here edits files
              and runs commands without asking, in the working tree the user
              has open. It has to follow the permission rather than describe the
              usual one — a caption that lies about the turn is worse than none,
              in either direction. */}
          <div className="flex items-baseline justify-between gap-3 px-1 text-[0.7rem]">
            <p
              className={cn(
                "min-w-0",
                options.permission === "full"
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {ask
                ? "The turn is waiting on your answer. Stop ends it instead."
                : captionFor(options.permission)}
            </p>

            {/* Beside the caption rather than at the end of the transcript: the
                per-turn lines are up there, and what belongs here is the one
                number somebody compares against `/cost` in a terminal — this
                chat, so far. */}
            {line && (
              <p
                title={detail}
                className="shrink-0 text-muted-foreground/80 tabular-nums"
              >
                {line}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
