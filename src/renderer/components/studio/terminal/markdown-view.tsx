import { useEffect, useRef, useState } from "react"

import { markdownRenderer } from "@/lib/terminal/markdown"
import "./markdown-view.css"

/**
 * One markdown message, rendered.
 *
 * The DOM comes from `markdownRenderer()` and is put in place imperatively
 * rather than as React children: it is a `DocumentFragment` built by
 * ProseMirror's serializer, and asking React to own nodes it did not create is
 * how the two end up fighting over the same subtree.
 *
 * If rendering fails for any reason the message is shown as plain text — the
 * same thing this pane did before it could format anything. A failure costs
 * the formatting and nothing else, and says so in the console, which
 * `electron/main.ts` mirrors into the dev terminal.
 */
export function MarkdownView({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
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
  }, [source])

  if (failed)
    return <p className="text-sm break-words whitespace-pre-wrap">{source}</p>

  return <div ref={host} className="markdown-prose text-sm" />
}
