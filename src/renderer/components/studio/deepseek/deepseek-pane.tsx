import { useEffect, useRef, useState } from "react"
import { Bot, Plus, RefreshCw, Square } from "lucide-react"

import { useDeepseekChats } from "@/lib/deepseek/store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { IconButton } from "../icon-button"
import { MarkdownView } from "../markdown-view"

/**
 * The DeepSeek Harness chat pane.
 *
 * One conversation with a running `dsh web`, drawn like a worktree chat but
 * hosted by the gateway rather than by a `claude` this app spawned: the main
 * process forwards the gateway's event stream, and this pane renders the
 * session's lines from it. The composer's send is the only thing that names a
 * session — one is created on the first send, so the pane works before the
 * gateway has anything but a status to show.
 */
export function DeepSeekPane() {
  const status = useDeepseekChats((state) => state.status)
  const sessionId = useDeepseekChats((state) => state.sessionId)
  const sending = useDeepseekChats((state) => state.sending)
  const messages = useDeepseekChats((state) => state.messages)
  const refreshStatus = useDeepseekChats((state) => state.refreshStatus)
  const newSession = useDeepseekChats((state) => state.newSession)
  const send = useDeepseekChats((state) => state.send)
  const stop = useDeepseekChats((state) => state.stop)

  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  // Follows the newest line, but only while it is already at the bottom —
  // yanking the view down while somebody reads further up makes a transcript
  // unusable. Same rule as the worktree chat.
  useEffect(() => {
    const element = box.current
    if (element && atBottom.current) element.scrollTop = element.scrollHeight
  }, [messages, sending])

  const empty = messages.length === 0
  const reachable = status?.reachable === true

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <Bot className="size-4 shrink-0" />
        <span className="text-xs font-medium">DeepSeek</span>
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            reachable ? "bg-emerald-500" : "bg-destructive"
          )}
        />
        {reachable ? (
          <>
            <span className="min-w-0 truncate font-mono text-[0.7rem] text-muted-foreground">
              {status?.baseUrl}
            </span>
            <span className="shrink-0 text-[0.7rem] text-muted-foreground/70">
              v{status?.describe?.version}
            </span>
            {sessionId && (
              <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground/70">
                {sessionId.slice(0, 8)}…
              </span>
            )}
          </>
        ) : (
          <span className="min-w-0 truncate text-xs text-destructive">
            {status ? status.error : "Checking for a gateway…"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label="Check the gateway again"
            onClick={() => void refreshStatus()}
          >
            <RefreshCw className="size-3.5" />
          </IconButton>
          <IconButton
            label="Start a new session"
            disabled={sending}
            onClick={newSession}
          >
            <Plus className="size-3.5" />
          </IconButton>
        </div>
      </div>

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
          <div className="max-w-md space-y-1 text-center">
            <p className="text-xs text-muted-foreground">
              {reachable
                ? "Ask DeepSeek anything. The turn runs in the gateway's project directory, and a session is started with your first message."
                : `No DeepSeek Harness gateway at ${status?.baseUrl ?? "the default URL"}. Start one with \`dsh web\`, or set the dshBaseUrl setting.`}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
            {messages.map((message, index) =>
              message.role === "user" ? (
                <div key={index} className="ml-4">
                  <div className="rounded-lg rounded-br-sm bg-accent/60 px-2.5 py-1.5 text-xs whitespace-pre-wrap">
                    {message.text}
                  </div>
                </div>
              ) : message.role === "error" ? (
                <p key={index} className="px-1 text-xs text-destructive">
                  {message.text}
                </p>
              ) : (
                <div key={index} className="min-w-0">
                  <MarkdownView
                    source={message.text}
                    className="max-w-none text-xs"
                  />
                  {message.streaming && (
                    <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-foreground/60" />
                  )}
                </div>
              )
            )}
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
        <div className="mx-auto w-full max-w-2xl">
          <Composer
            disabled={!reachable}
            sending={sending}
            onSend={(text) => void send(text)}
            onStop={stop}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * The field and its one button: Enter sends, ⇧⏎ makes a new line, and while a
 * turn is in flight the button is Stop instead of Send.
 */
function Composer({
  disabled,
  sending,
  onSend,
  onStop,
}: {
  disabled: boolean
  sending: boolean
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [draft, setDraft] = useState("")

  const send = (): void => {
    if (draft.trim() === "") return
    onSend(draft)
    setDraft("")
  }

  return (
    <div className="flex items-end gap-2">
      <Textarea
        value={draft}
        rows={1}
        disabled={disabled}
        placeholder={
          disabled
            ? "No gateway reachable"
            : sending
              ? "The turn is running…"
              : "Ask DeepSeek…"
        }
        onChange={(event) => setDraft(event.target.value)}
        onInput={(event) => {
          // Grow with the draft up to the max height, then scroll inside it —
          // a field that stays one line tall makes a long message unreadable
          // while it is being written.
          const element = event.currentTarget
          element.style.height = "auto"
          element.style.height = `${Math.min(element.scrollHeight, 160)}px`
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            if (!disabled && !sending) send()
          }
        }}
        className="max-h-40 min-h-9 flex-1 resize-none text-xs"
      />
      {sending ? (
        <Button variant="outline" size="sm" onClick={onStop}>
          <Square className="size-3" />
          Stop
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={send}
          disabled={disabled || draft.trim() === ""}
        >
          Send
        </Button>
      )}
    </div>
  )
}
