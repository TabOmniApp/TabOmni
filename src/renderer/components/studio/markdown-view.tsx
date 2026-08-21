import { useEffect, useRef, useState } from "react"
import { markdownToHTML } from "@blocknote/core"

import { cn } from "@/lib/utils"
import { sanitizeHtml } from "@/lib/markdown/sanitize"
import { markdownRenderer } from "@/lib/terminal/markdown"
import "./markdown-view.css"

/**
 * Some markdown, rendered — a chat message, or a `.md` file in the Explorer.
 *
 * At the studio's root rather than in either panel because it is now both, and
 * one stylesheet means a heading looks the same wherever it was read from. What
 * differs between the two is the type scale a document wants and a message does
 * not, which is what `className` is for.
 *
 * The DOM is put in place imperatively rather than as React children: it is a
 * fragment built outside React, and asking React to own nodes it did not create
 * is how the two end up fighting over the same subtree.
 *
 * If rendering fails for any reason the message is shown as plain text — the
 * same thing this pane did before it could format anything. A failure costs
 * the formatting and nothing else, and says so in the console, which
 * `electron/main.ts` mirrors into the dev terminal.
 */

/**
 * **There are two parsers here, and `rawHtml` is which.** A chat message is
 * Milkdown's — this app's markdown stack, so an agent's reply is formatted by
 * the same parser that reads what the user types into the composer next to it.
 * A file is BlockNote's, and the reason is the HTML in it: Milkdown's schema has
 * one node for raw HTML and it renders as its own source text, so a `<details>`
 * in a README comes out as the characters `<details>`. BlockNote's converter
 * passes markup through, which is what a file needs — every other reader of that
 * file renders it, GitHub included — and it is the parser the **Markdown
 * editor** already reads the same file with, so the two views of a `.md` agree
 * about what it says rather than nearly agreeing.
 *
 * Markup that came out of a repository does not go on the page as it was
 * written: `lib/markdown/sanitize.ts` is the allowlist it goes through first,
 * and the reason there is one. A chat message deliberately does not get this —
 * an agent's reply is output, not a document, and there is nothing in it that
 * has to be markup.
 */
export function MarkdownView({
  source,
  className,
  rawHtml = false,
}: {
  source: string
  className?: string
  /** Whether the markup in this document is part of it. True for a file. */
  rawHtml?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // The file's own pipeline, and synchronous: `markdownToHTML` is a string
    // function rather than an editor, so there is nothing to wait for and no
    // frame where the document is missing.
    if (rawHtml) {
      const node = host.current
      if (!node) return
      try {
        node.replaceChildren(sanitizeHtml(markdownToHTML(source)))
      } catch (error) {
        console.error("Could not render markdown", error)
        // The same fallback as `failed` below, put in place rather than flagged:
        // this branch is synchronous, and a setState here would be a second
        // render of the whole document to say the first one did not work.
        const plain = document.createElement("p")
        plain.className = "break-words whitespace-pre-wrap"
        plain.textContent = source
        node.replaceChildren(plain)
      }
      return
    }

    let alive = true

    void markdownRenderer()
      .then((render) => {
        if (!alive) return
        // A `failed` render has already replaced the host with plain text.
        const node = host.current
        if (!node) return
        node.replaceChildren(render(source))
      })
      .catch((error: unknown) => {
        if (!alive) return
        console.error("Could not render markdown", error)
        setFailed(true)
      })

    return () => {
      alive = false
    }
  }, [source, rawHtml])

  if (failed)
    return (
      <p className={cn("text-sm break-words whitespace-pre-wrap", className)}>
        {source}
      </p>
    )

  return <div ref={host} className={cn("markdown-prose text-sm", className)} />
}
