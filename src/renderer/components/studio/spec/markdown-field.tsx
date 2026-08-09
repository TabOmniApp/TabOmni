import { useEffect, useRef } from "react"
import { Crepe } from "@milkdown/crepe"
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react"

import "@milkdown/crepe/theme/common/style.css"
import "../milkdown-theme.css"
import "./spec-prose.css"

/**
 * One of a spec's prose sections, edited as markdown.
 *
 * Crepe — the same editor the chat composer uses, themed by the same
 * `chat-composer.css` — rather than a textarea of raw markdown beside a
 * preview. The rest of this panel is edited in place, and a section that made
 * the author switch to writing `##` by hand would be the one part of the
 * document that behaved like a different application.
 *
 * Unlike the composer, `Table` and `BlockEdit` are on: a spec's processing
 * section is exactly where a table of cases and a `/` block menu earn their
 * keep, and there is no CLI on the other end for a `/` to be meant for.
 */
export function MarkdownField({
  value,
  placeholder,
  onChange,
}: {
  /** Read once, at mount. The editor owns the text after that — see below. */
  value: string
  placeholder: string
  onChange: (markdown: string) => void
}) {
  return (
    <MilkdownProvider>
      <Editor value={value} placeholder={placeholder} onChange={onChange} />
    </MilkdownProvider>
  )
}

function Editor({
  value,
  placeholder,
  onChange,
}: {
  value: string
  placeholder: string
  onChange: (markdown: string) => void
}) {
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  /**
   * The text the editor starts from.
   *
   * Held in a ref so the editor is built exactly once. This component is
   * deliberately uncontrolled: `value` comes back from the store on every
   * keystroke, and feeding that back in would move the caret to the end of the
   * document as you type. Switching to another spec remounts this — the
   * workspace keys it on the file path — which is the only time a new document
   * needs to be loaded.
   */
  const initial = useRef({ value, placeholder })

  useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue: initial.current.value,
      features: {
        [Crepe.Feature.Toolbar]: true,
        [Crepe.Feature.BlockEdit]: true,
        [Crepe.Feature.Placeholder]: true,
        [Crepe.Feature.LinkTooltip]: true,
        [Crepe.Feature.Cursor]: true,
        [Crepe.Feature.ListItem]: true,
        [Crepe.Feature.Table]: true,
        // A spec has no use for these, and each one is a paste or a keystroke
        // away from a block the author cannot get back out of.
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.CodeMirror]: false,
        [Crepe.Feature.TopBar]: false,
        [Crepe.Feature.AI]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: initial.current.placeholder },
      },
    })

    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown) => onChangeRef.current(markdown))
    })

    return crepe
  }, [])

  return (
    <div className="spec-prose">
      <Milkdown />
    </div>
  )
}
