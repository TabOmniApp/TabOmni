import { useEffect, useRef } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Claude } from "@/components/ui/svgs/claude"
import { severitySummary, useReview } from "@/lib/files/review"

/**
 * A whole-diff review while it runs, and what it left behind when it stops.
 *
 * **The turn is the only thing in this app that works for minutes with nothing
 * to show for it.** A chat draws every line as it arrives; a review answers
 * once, at the end, with comments scattered across files that may not be open
 * — so between the click and the answer there was a disabled button and
 * nothing else, which reads as an app that has hung rather than one that is
 * reading twelve files. This is that gap filled: the tool calls as they go
 * out (`ReviewProgressEvent`, pushed from `review-agent.ts`), then a sentence
 * saying how many comments were left.
 *
 * A dialog rather than a line in a bar under the diff, which is where this used
 * to be said: that bar lived under a file that had been picked, and the button
 * that starts a review is in the Explorer's header — so a reviewer who has not
 * opened a file yet was watching a strip that was not on screen. The bar has
 * since gone entirely, and this is now the only place a run reports itself.
 * It closes on the user's word rather than on the turn ending:
 * the count is the point of it, and a dialog that vanished at the moment it
 * had something to say would be one nobody ever read.
 *
 * It does **not** draw the findings. Those are comments, in the files they are
 * about — see `reviewAll` in `lib/files/review.ts` — and a list of them here
 * would be the report this whole feature exists not to produce.
 */
export function ReviewProgressDialog() {
  const open = useReview((state) => state.progressOpen) !== null
  const running = useReview((state) => state.reviewing) !== null
  const progress = useReview((state) => state.progress)
  const found = useReview((state) => state.reviewFound)
  const error = useReview((state) => state.reviewError)
  /* What it found, by severity — the one thing a count of comments cannot say,
     and the thing that decides whether the diff is read now or after lunch.
     Empty when nothing came back rated, which draws as nothing. */
  const summary = severitySummary(useReview((state) => state.reviewFoundBy))

  /* The last line, kept in view. A review of twenty files sends more lines
   * than the box is tall, and a log that has to be scrolled to see what is
   * happening now is a log that answers the wrong question. */
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" })
  }, [progress.length])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) useReview.getState().closeProgress()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {running ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <Claude className="size-4 shrink-0" />
            )}
            {running ? "Reviewing changes…" : "Review finished"}
          </DialogTitle>
          <DialogDescription>
            {running
              ? "Claude is reading every changed file in this checkout. What it finds is left as comments on the lines it names."
              : error
                ? error
                : found === 0
                  ? "Nothing was left to comment on."
                  : `${found} comment${found === 1 ? "" : "s"} left on the lines they are about${summary ? ` — ${summary}` : ""}. Open a changed file to read them — the Changes tree says which files have any.`}
          </DialogDescription>
        </DialogHeader>

        {/* The turn's own tool calls. Empty until the first one arrives, which
            is a second or two of a spinner and a heading — saying "starting…"
            in a box that is about to fill would be a line that is wrong by the
            time it is read. */}
        {progress.length > 0 && (
          <div className="max-h-56 overflow-y-auto rounded-md border bg-muted/30 p-2">
            {progress.map((line, at) => (
              <p
                key={`${at}-${line}`}
                className="truncate font-mono text-[0.7rem] text-muted-foreground"
                title={line}
              >
                {line}
              </p>
            ))}
            <div ref={end} />
          </div>
        )}

        <DialogFooter>
          {/* One button, and it says different things because it means them:
              a review still running is left running when this is closed — the
              turn is main's and nothing here can stop it — and closing after
              it has finished is simply done reading. */}
          <Button
            variant={running ? "outline" : "default"}
            size="sm"
            onClick={() => useReview.getState().closeProgress()}
          >
            {running ? "Run in background" : "Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
