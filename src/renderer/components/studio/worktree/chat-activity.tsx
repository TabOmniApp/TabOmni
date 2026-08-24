import { useState } from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { summaryOf, type ChatBlock } from "@/lib/worktree-chat/activity"
import { ChatMessage } from "./chat-message"
import { marksOf, toolMark } from "./chat-marks"

/**
 * A turn's working, as one line that opens.
 *
 * **Closed by default, and that is the whole point.** A finished turn is read
 * for its answer; the seven tool calls under it are read when something looks
 * wrong, which is a different visit. Neither is served by a switch in Settings
 * that has to be found and flipped between the two — so the rows are always
 * there and always one click away.
 *
 * Open state is this component's own rather than the store's. A fold somebody
 * opened is a thing they are doing right now, not a preference; it belongs to
 * the mounted row the way a text selection does, and putting it in the store
 * would be a chat's file growing a field about how somebody was reading it.
 *
 * The marks after the summary are which *kinds* of tool ran, deduplicated —
 * scanning a closed transcript for "did this turn touch the shell" is the
 * question a fold would otherwise have to be opened to answer.
 */
export function ChatActivity({
  of,
}: {
  of: Extract<ChatBlock, { kind: "activity" }>
}) {
  const [open, setOpen] = useState(false)
  const marks = marksOf(of.lines)

  return (
    <div className={cn(open && "space-y-3")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left",
          "text-[0.7rem] text-muted-foreground outline-none",
          "hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        )}
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="truncate">{summaryOf(of.counts)}</span>
        {/* Hidden once it is open: the rows below say the same thing in full,
            and a summary beside them is the same fact twice. */}
        {!open && marks.length > 0 && (
          <span aria-hidden className="flex shrink-0 items-center gap-1">
            {marks.map((name) => (
              <span key={name} className="contents">
                {toolMark(name, "size-3 opacity-70")}
              </span>
            ))}
          </span>
        )}
      </button>

      {open && of.lines.map((line) => <ChatMessage key={line.id} of={line} />)}
    </div>
  )
}
