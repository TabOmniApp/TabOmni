import { useEffect, useState } from "react"
import { BookMarked, Check, GraduationCap, Loader2 } from "lucide-react"

import type { LearningProposal } from "@shared/learnings"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useSettings } from "@/lib/settings"

/**
 * The learning loop's whole UI: what one chat taught, proposed, and saved one
 * press at a time.
 *
 * Opened from the chat's own row (`Distill learnings…` in its context menu),
 * and the turn starts the moment it opens — the menu item *is* the question,
 * and a dialog that opened onto a second button would be asking it twice. What
 * comes back is a list, and every write out of it is one press of Save on one
 * proposal: a skill lands under `.claude/skills/`, a memory as a bullet in the
 * project's `CLAUDE.md`, and either way the next chat in the project finds it
 * because the user's own `claude` reads both. See `shared/learnings.ts` for the
 * shapes and `docs/design.md` § Distilling learnings for the argument.
 *
 * "Nothing worth keeping" is drawn as the answer it is, not as an error: most
 * conversations teach nothing, and the turn is told to say so with an empty
 * list rather than invent a lesson.
 */
export function DistillDialog({
  chatId,
  chatTitle,
  folderId,
  onClose,
}: {
  chatId: string
  chatTitle: string
  folderId: string
  onClose: () => void
}) {
  const [proposals, setProposals] = useState<LearningProposal[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Per proposal, by index: what Save did — where it wrote, that it is still
   * writing, or why it refused. Absent is "not saved yet". */
  const [saved, setSaved] = useState<
    Record<number, { path: string } | { saving: true } | { failed: string }>
  >({})

  useEffect(() => {
    let stale = false
    const settings = useSettings.getState()
    // The review's own model and profile, because it is the review's own CLI —
    // one read-only `claude` with one place to be configured.
    void window.desktop
      .distillLearnings(
        chatId,
        folderId,
        settings.reviewModel,
        settings.reviewEffort,
        settings.reviewProfileId
      )
      .catch((failed: unknown) => ({
        error: failed instanceof Error ? failed.message : String(failed),
      }))
      .then((answer) => {
        if (stale) return
        if ("error" in answer) setError(answer.error)
        else setProposals(answer.proposals)
      })
    return () => {
      stale = true
    }
  }, [chatId, folderId])

  async function save(index: number, proposal: LearningProposal) {
    setSaved((current) => ({ ...current, [index]: { saving: true } }))
    const answer = await window.desktop
      .saveLearning(folderId, proposal)
      .catch((failed: unknown) => ({
        error: failed instanceof Error ? failed.message : String(failed),
      }))
    setSaved((current) => ({
      ...current,
      [index]:
        "error" in answer ? { failed: answer.error } : { path: answer.path },
    }))
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Distill learnings</DialogTitle>
          <DialogDescription>
            What “{chatTitle}” taught about this project, proposed by the
            read-only Claude. Nothing is written until you save it.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : proposals === null ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              <span>Reading the conversation…</span>
            </div>
          ) : proposals.length === 0 ? (
            <p className="py-4 text-xs text-muted-foreground">
              Nothing worth keeping — this conversation taught nothing the
              project has not already written down.
            </p>
          ) : (
            proposals.map((proposal, index) => {
              const state = saved[index]
              return (
                <div
                  key={`${proposal.kind}-${proposal.name}`}
                  className="space-y-1.5 rounded-md border p-3"
                >
                  <div className="flex items-center gap-2">
                    {proposal.kind === "skill" ? (
                      <GraduationCap className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <BookMarked className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {proposal.name}
                    </span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground uppercase">
                      {proposal.kind}
                    </span>
                    {state && "path" in state ? (
                      <span className="flex shrink-0 items-center gap-1 text-[0.7rem] text-muted-foreground">
                        <Check className="size-3 text-primary" />
                        {state.path}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        disabled={state !== undefined && "saving" in state}
                        onClick={() => void save(index, proposal)}
                      >
                        {state && "saving" in state ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          "Save"
                        )}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {proposal.description}
                  </p>
                  <pre className="max-h-40 overflow-y-auto rounded bg-muted/50 p-2 text-[0.7rem] whitespace-pre-wrap">
                    {proposal.body}
                  </pre>
                  {state && "failed" in state && (
                    <p className="text-xs text-destructive">{state.failed}</p>
                  )}
                </div>
              )
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
