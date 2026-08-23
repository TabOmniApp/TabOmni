import { useState } from "react"
import { Check, ShieldQuestion } from "lucide-react"

import type {
  ChatAskQuestion,
  WorktreeChatAnswer,
  WorktreeChatAsk,
} from "@shared/api"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The card a turn waits behind.
 *
 * Above the composer rather than in the transcript, and the composer is disabled
 * under it: the turn is *held* — the CLI is sitting on a tool call until this is
 * answered — so a chat that let you type a second message here would be offering
 * something it cannot do. It is the one thing on screen with anything to say.
 *
 * Two shapes, because the CLI asks two different things (see `WorktreeChatAsk`).
 * A **permission** is yes or no about something the model is trying to do, and
 * the wording comes from the CLI, which knows which argument of a call matters.
 * A **question** is `AskUserQuestion` — the model wrote the options and one of
 * them is the answer — which is the shape somebody who has used the interactive
 * CLI will recognise.
 *
 * Nothing here has a timeout. A question that answered itself after a while
 * would be this app deciding, and the turn is still stoppable from the composer.
 */
export function ChatAsk({
  ask,
  onAnswer,
}: {
  ask: WorktreeChatAsk
  onAnswer: (answer: WorktreeChatAnswer) => void
}) {
  if (ask.kind === "questions") {
    // Keyed by ask, so a second question in the same chat gets a fresh set of
    // picks: remounting is how that state is cleared, rather than an effect
    // watching the id and resetting it a render later.
    return <Questions key={ask.id} ask={ask} onAnswer={onAnswer} />
  }

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-2.5">
      <p className="flex items-baseline gap-1.5 text-xs">
        <ShieldQuestion className="size-3.5 shrink-0 translate-y-0.5 text-primary" />
        <span className="min-w-0">{ask.title}</span>
      </p>

      {/* The argument on its own line and in mono: it is usually a path or a
          command, and both are read character by character. Left out when the
          sentence above already ends in it, which is the common case — the
          title is built from this very argument (`titleFor`), and printing it
          twice reads as two different things being asked about. */}
      {ask.summary && !ask.title.includes(ask.summary) && (
        <p className="mt-1 truncate pl-5 font-mono text-[0.7rem] text-muted-foreground">
          {ask.summary}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-5">
        <Button size="sm" onClick={() => onAnswer({ kind: "allow" })}>
          Allow
        </Button>
        {/* Offered only where accepting it would do something — the SDK does
            not always have a rule to remember. See `WorktreeChatAsk.always`. */}
        {ask.always && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAnswer({ kind: "allow", always: true })}
          >
            Always allow
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAnswer({ kind: "deny" })}
        >
          Deny
        </Button>
      </div>
    </div>
  )
}

/**
 * `AskUserQuestion`: the model's own questions, with its own options.
 *
 * Every question has to be answered before anything goes back, because the tool
 * takes them together — so the button is disabled until they all are, rather
 * than sending a partial set the model would have to ask about again.
 *
 * A multi-select question is the reason picks are held as arrays here and in the
 * contract: one shape for both, so nothing has to branch on `multiSelect` twice
 * and disagree with itself.
 */
function Questions({
  ask,
  onAnswer,
}: {
  ask: Extract<WorktreeChatAsk, { kind: "questions" }>
  onAnswer: (answer: WorktreeChatAnswer) => void
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({})

  function toggle(question: ChatAskQuestion, label: string) {
    setPicked((was) => {
      const current = was[question.question] ?? []
      if (!question.multiSelect) {
        return { ...was, [question.question]: [label] }
      }
      return {
        ...was,
        [question.question]: current.includes(label)
          ? current.filter((entry) => entry !== label)
          : [...current, label],
      }
    })
  }

  const answered = ask.questions.every(
    (question) => (picked[question.question] ?? []).length > 0
  )

  return (
    <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-2.5">
      {ask.questions.map((question) => (
        <div key={question.question}>
          <p className="flex items-baseline gap-1.5 text-xs">
            <ShieldQuestion className="size-3.5 shrink-0 translate-y-0.5 text-primary" />
            <span className="min-w-0">{question.question}</span>
          </p>
          {question.multiSelect && (
            <p className="pl-5 text-[0.65rem] text-muted-foreground">
              Pick as many as apply
            </p>
          )}

          <div className="mt-1.5 space-y-1 pl-5">
            {question.options.map((option) => {
              const on = (picked[question.question] ?? []).includes(
                option.label
              )
              return (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => toggle(question, option.label)}
                  className={cn(
                    "flex w-full items-baseline gap-1.5 rounded-md border px-2 py-1 text-left transition-colors",
                    on
                      ? "border-primary/50 bg-primary/10"
                      : "border-transparent hover:bg-accent"
                  )}
                >
                  <Check
                    className={cn(
                      "size-3 shrink-0 translate-y-0.5",
                      on ? "text-primary" : "text-transparent"
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium">
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="block text-[0.7rem] text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className="pl-5">
        <Button
          size="sm"
          disabled={!answered}
          onClick={() => onAnswer({ kind: "answers", answers: picked })}
        >
          Answer
        </Button>
      </div>
    </div>
  )
}
