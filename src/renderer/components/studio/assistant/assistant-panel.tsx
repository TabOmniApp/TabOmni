import { useEffect, useRef } from "react"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import {
  ChevronLeft,
  MessageSquarePlus,
  MessagesSquare,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react"

import {
  toolLabel,
  useAssistant,
  type AssistantMessage,
} from "@/lib/assistant/store"
import { relativeTime } from "@/lib/relative-time"
import { useSettings } from "@/lib/settings"
import { IconButton } from "../icon-button"
import { MarkdownView } from "../markdown-view"
import { PanelHeader } from "../panel-header"
import { AssistantComposer, MentionText } from "./assistant-composer"

/**
 * The chat beside the workbench.
 *
 * Not a Terminal session and deliberately shaped unlike one: a session is the
 * CLI in a pty with a folder under it, and this is a conversation about the
 * *workspace* — the databases, the saved requests, the notes, which belong to no
 * folder in particular. That is also why it is a panel on the right rather than
 * a tab: it is meant to be read beside whatever is open, the way somebody asks a
 * question about the table they are looking at.
 *
 * What it can do is the MCP switches in Settings plus reading — see
 * `main/assistant.ts` for why that allowlist is the whole of it in print mode.
 * When every switch is off, the notice below says so rather than letting
 * somebody ask three questions before working out that nothing is connected.
 *
 * Which is also what `@` in its composer means here: the panels are reachable
 * through those tools, so a mention is the thing's *name*, tinted, rather than
 * the line of context the chat composer's `@` pastes in. See
 * `assistant-composer.tsx`.
 */
export function AssistantPanel() {
  const view = useAssistant((state) => state.view)
  const messages = useAssistant((state) => state.messages)
  const sending = useAssistant((state) => state.sending)
  const send = useAssistant((state) => state.send)
  const stop = useAssistant((state) => state.stop)
  const toggle = useAssistant((state) => state.toggle)
  const showList = useAssistant((state) => state.showList)
  const newChat = useAssistant((state) => state.newChat)
  const chats = useAssistant((state) => state.chats)
  const chatId = useAssistant((state) => state.chatId)

  const mcp = useSettings((state) => state.mcp)
  const connected = Object.values(mcp).filter(Boolean).length

  const tail = useRef<HTMLDivElement>(null)

  // The newest message, whether it is a reply or the user's own line. `end` so
  // a long answer sits with its last paragraph on screen, which is where the
  // reading is.
  useEffect(() => {
    tail.current?.scrollIntoView({ block: "end" })
  }, [messages, view])

  const title =
    view === "list"
      ? "Assistant"
      : (chats.find((chat) => chat.id === chatId)?.title ?? "New chat")

  return (
    <div className="flex h-full min-w-0 flex-col border-l">
      <PanelHeader title={title}>
        {view === "chat" && chats.length > 0 && (
          // Back to the list rather than a second list beside the chat: the
          // panel is narrow, and one thing at a time is what fits in it.
          <IconButton
            label="All chats"
            disabled={sending}
            onClick={() => void showList()}
          >
            <ChevronLeft />
          </IconButton>
        )}
        <IconButton
          label="New chat"
          disabled={sending}
          onClick={() => void newChat()}
        >
          <MessageSquarePlus />
        </IconButton>
        <IconButton label="Close assistant" onClick={toggle}>
          <X />
        </IconButton>
      </PanelHeader>

      {view === "list" ? (
        <ChatList />
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <Empty connected={connected} />
          ) : (
            messages.map((message) => <Message key={message.id} of={message} />)
          )}
          {sending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3" />
              Thinking…
            </div>
          )}
          <div ref={tail} />
        </div>
      )}

      {/* The composer is the chat's, not the list's: a message typed with a
          list on screen has no conversation to belong to. */}
      <div className={cn("shrink-0 border-t p-2", view === "list" && "hidden")}>
        <AssistantComposer
          sending={sending}
          onSend={(text) => void send(text)}
          onStop={() => void stop()}
        />
      </div>
    </div>
  )
}

/**
 * Every chat, newest first — what the panel opens onto once there is more than
 * nothing to open onto.
 *
 * A row is the first thing that was asked and when it was last answered, which
 * between them are what somebody looking for yesterday's conversation is
 * actually scanning for. Deleting is on the row rather than inside the chat: it
 * is the list you are in when you decide a chat is finished with.
 */
function ChatList() {
  const chats = useAssistant((state) => state.chats)
  const chatId = useAssistant((state) => state.chatId)
  const sending = useAssistant((state) => state.sending)
  const openChat = useAssistant((state) => state.openChat)
  const deleteChat = useAssistant((state) => state.deleteChat)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
      {sending && (
        <p className="px-1.5 py-2 text-[0.7rem] text-muted-foreground">
          An answer is still being written — this list is read-only until it
          lands.
        </p>
      )}
      {chats.map((chat) => (
        <div
          key={chat.id}
          className={cn(
            "group flex items-center gap-1 rounded-md pr-1",
            chat.id === chatId ? "bg-accent/60" : "hover:bg-accent/40"
          )}
        >
          <button
            type="button"
            disabled={sending}
            onClick={() => void openChat(chat.id)}
            className="min-w-0 flex-1 px-1.5 py-1.5 text-left outline-none disabled:opacity-60"
          >
            <span className="flex items-center gap-1.5">
              <MessagesSquare className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate text-xs">{chat.title}</span>
            </span>
            <span className="block pl-[1.125rem] text-[0.7rem] text-muted-foreground">
              {relativeTime(Date.parse(chat.updatedAt))}
            </span>
          </button>
          {/* Shown on hover, like the tab strip's close button: a delete that is
              always visible in a list is a delete that gets pressed. */}
          <span className="opacity-0 group-hover:opacity-100">
            <IconButton
              label={`Delete "${chat.title}"`}
              disabled={sending}
              onClick={() => void deleteChat(chat.id)}
            >
              <Trash2 />
            </IconButton>
          </span>
        </div>
      ))}
    </div>
  )
}

/** What the panel says before anything has been asked — including the one thing
 * worth knowing first, which is whether it is connected to anything. */
function Empty({ connected }: { connected: number }) {
  return (
    <div className="space-y-2 px-1 py-6 text-xs leading-relaxed text-muted-foreground">
      <p className="font-medium text-foreground">
        A conversation about this workspace
      </p>
      <p>
        It reads the panels rather than a folder: ask about a table, a saved
        request, or something a note says. Answers come from Claude Code, so it
        uses whichever of the workspace&apos;s tools you have turned on.
      </p>
      {connected === 0 ? (
        <p className="flex items-start gap-1.5 text-amber-600 dark:text-amber-500">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
          <span>
            No workspace tools are switched on, so it can only read files. Turn
            them on in Settings › MCP (⌘,).
          </span>
        </p>
      ) : (
        <p>
          {connected} of 3 workspace tools switched on. A change takes effect on
          the next message.
        </p>
      )}
    </div>
  )
}

function Message({ of }: { of: AssistantMessage }) {
  if (of.role === "user") {
    // The one thing given a bubble: in a column this narrow, whose line it is
    // has to be readable without reading it.
    return (
      <div className="ml-4 rounded-lg rounded-br-sm bg-accent/60 px-2.5 py-1.5 text-xs">
        <MentionText text={of.text} />
      </div>
    )
  }

  if (of.role === "tool") {
    return (
      <div className="flex items-baseline gap-1.5 px-1 font-mono text-[0.7rem] text-muted-foreground">
        <Wrench className="size-3 shrink-0 translate-y-0.5" />
        <span className="shrink-0">{toolLabel(of.name)}</span>
        {of.summary && (
          <span className="truncate opacity-70">{of.summary}</span>
        )}
      </div>
    )
  }

  if (of.role === "error") {
    return (
      <p
        className={cn(
          "rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-1.5",
          "text-xs whitespace-pre-wrap text-destructive"
        )}
      >
        {of.text}
      </p>
    )
  }

  // The same renderer the chat view uses for a reply, so a table or a code
  // block reads here the way it does there.
  return <MarkdownView source={of.text} className="px-1 text-xs" />
}
