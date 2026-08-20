import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react"
import { editorViewCtx } from "@milkdown/kit/core"
import { getMarkdown, replaceAll } from "@milkdown/kit/utils"
import { Crepe } from "@milkdown/crepe"
import {
  Milkdown,
  MilkdownProvider,
  useEditor,
  useInstance,
} from "@milkdown/react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import {
  ArrowUp,
  AtSign,
  ImageOff,
  Paperclip,
  Slash,
  Square,
  X,
} from "lucide-react"

import { type ClaudeSlashCommand } from "@shared/api"
import { IconButton } from "../icon-button"
import { linkAttr } from "@milkdown/kit/preset/commonmark"
import { expandMentions, mentionKindOf } from "@/lib/terminal/mention-text"
import { lookupMention } from "@/lib/terminal/mentions"
import { composerMention, configureComposerMention } from "./composer-mention"
import { claudeSlash, configureClaudeSlash } from "./composer-slash"
import "@milkdown/crepe/theme/common/style.css"
import "../milkdown-theme.css"
import "./chat-composer.css"

type Attachment = {
  path: string
  name: string
  dataUrl: string | null
  error: string | null
}

const PLACEHOLDER = "Please enter..."

/**
 * The composer's editing surface — Crepe, Milkdown's own batteries-included
 * WYSIWYG editor, rather than the bare `Editor` core: it already ships a
 * selection-triggered formatting toolbar, so that does not have to be
 * hand-built and hand-maintained here. `chat-composer.css`
 * maps its `--crepe-*` theme variables onto this app's own tokens instead of
 * importing one of Crepe's bundled visual themes, so it reads as part of the
 * app rather than a themed third-party widget.
 *
 * Only markdown ever leaves this component (via `onMarkdownChange`, and
 * `getMarkdown()` at send time) — the destination is still a CLI's
 * plain-text stdin, which never renders any of this; the WYSIWYG editing is
 * purely for the person typing.
 */
function ComposerEditor({
  onMarkdownChange,
  slashCommandsFor,
}: {
  onMarkdownChange: (markdown: string) => void
  /** The project whose commands and skills the `/` menu offers — null both
   * for a session that is not Claude Code and for one whose other end would
   * read a `/…` line as text rather than run it. */
  slashCommandsFor: string | null
}) {
  const onChangeRef = useRef(onMarkdownChange)
  useEffect(() => {
    onChangeRef.current = onMarkdownChange
  }, [onMarkdownChange])

  const commands = useSlashCommands(slashCommandsFor)

  useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue: "",
      features: {
        [Crepe.Feature.Toolbar]: true,
        // Off: this is the feature that provides the `/` slash menu (and the
        // block handle alongside it — Crepe ships the two together). A `/`
        // typed here is meant for the CLI on the other end of this composer,
        // whose own skills/commands it addresses, not for an editor menu.
        [Crepe.Feature.BlockEdit]: false,
        [Crepe.Feature.Placeholder]: true,
        [Crepe.Feature.LinkTooltip]: true,
        [Crepe.Feature.Cursor]: true,
        [Crepe.Feature.ListItem]: true,
        // Attachments are handled entirely outside the editor (drag-and-drop
        // onto the composer, or the attach button) — Crepe's own image
        // block would just be a second, conflicting way to drop a file in.
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.Table]: false,
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.CodeMirror]: false,
        [Crepe.Feature.TopBar]: false,
        [Crepe.Feature.AI]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: PLACEHOLDER },
      },
    })
    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown) => onChangeRef.current(markdown))
    })

    // Added to Crepe's own editor rather than replacing it: everything else
    // Crepe brings (toolbar, placeholder, the commonmark preset) still
    // applies, and only the meaning of `/` is this app's own.
    if (commands.enabled) {
      crepe.editor
        .config((ctx) => configureClaudeSlash(ctx, commands.read))
        .use(claudeSlash)
    }

    // `@` is the studio's own: the tables, requests and notes the other
    // panels are holding, one line of context each. Offered to every kind of
    // session rather than only to `claude` — what it sends is plain text, and a
    // shell being told what a table's columns are is a comment at worst.
    crepe.editor.config(configureComposerMention).use(composerMention)

    /*
     * A mention is a link to `tabomni://mention/…`, and Milkdown renders a
     * link's `href` through an allowlist of schemes — ours is not one, so the
     * attribute reaches the DOM empty and CSS has nothing to select on. (The
     * mark still holds it, which is why the send path can still expand it.)
     *
     * `linkAttr` is the preset's own hook for adding attributes to a rendered
     * link, so the kind travels as `data-mention` instead, which is what
     * `chat-composer.css` colours the chip by. Composed with whatever is already
     * set rather than replacing it: Crepe's link tooltip configures this too.
     */
    crepe.editor.config((ctx) => {
      const existing = ctx.get(linkAttr.key)
      ctx.set(linkAttr.key, (mark) => {
        const kind = mentionKindOf(mark.attrs.href)
        return {
          ...existing(mark),
          ...(kind === null ? {} : { "data-mention": kind }),
        }
      })
    })

    return crepe
    // Built once and kept, with no dependency on `commands`: it reads the
    // list through a ref, and `claudeFolderId` is fixed for as long as a
    // session's pane exists (its kind and project cannot change under it).
    // Rebuilding the editor would throw away whatever is half-typed.
  }, [])

  return (
    <div className="composer-prose h-full" onFocusCapture={commands.refresh}>
      <Milkdown />
    </div>
  )
}

/**
 * Keeps the `/` menu's list of commands to hand, without the editor ever
 * having to wait on it: `read` answers with whatever has arrived so far — an
 * empty list until the first fetch lands, which simply means no menu yet.
 *
 * Refreshed when the composer takes focus, throttled, because the answer
 * genuinely does change while the app is open: writing a new command file
 * (often the very thing the session was asked to do) should not need a
 * restart to show up.
 */
function useSlashCommands(folderId: string | null) {
  const commands = useRef<ClaudeSlashCommand[]>([])
  const lastFetch = useRef(0)

  const refresh = useCallback(() => {
    if (folderId === null) return
    if (Date.now() - lastFetch.current < 5_000) return
    lastFetch.current = Date.now()

    window.desktop
      .claudeCommands(folderId)
      .then((found) => {
        commands.current = found
      })
      // A project directory that has gone away is the realistic cause, and a
      // composer with no `/` menu is a far better answer to it than a broken
      // one — the editor itself is unaffected either way.
      .catch(() => {})
  }, [folderId])

  useEffect(refresh, [refresh])

  return {
    enabled: folderId !== null,
    read: useCallback(() => commands.current, []),
    refresh,
  }
}

/**
 * A composer for `claude` sessions, so a multi-line, markdown, or
 * image-carrying message does not have to be typed straight into the raw
 * terminal — Send hands the finished text to `onSend`, which is what
 * actually injects it into the session (see `terminal-session-view.tsx`'s
 * `sendToTerminal`, using bracketed paste so a multi-line message lands as
 * one message rather than several separately-submitted lines).
 */
export function ChatComposer({
  onSend,
  disabled = false,
  busy = false,
  onInterrupt,
  claudeFolderId = null,
  runsSlashCommands = false,
}: {
  onSend: (text: string) => void
  disabled?: boolean
  /** Whether a turn is in flight — draws the stop button next to Send, and is
   * all `onInterrupt` is worth calling for. Not `disabled`: the whole point of
   * queueing (`claude-gui-session.tsx`'s `send`) is that writing the next
   * message and stopping the current turn are two different, unrelated acts,
   * and this composer stays open for both while a turn runs. */
  busy?: boolean
  /** Ends the turn in progress — Escape while typing does the same thing.
   * Absent for a kind with no such turn to end, a terminal session: there the
   * composer only ever injects text into an interactive prompt, which has no
   * concept of a turn this side could ask to stop. */
  onInterrupt?: () => void
  /** The folder this is a Claude Code session for, or null for a kind that is
   * not one. Turns on the `/` menu, which is built from that CLI's own
   * commands and skills. */
  claudeFolderId?: string | null
  /**
   * Whether a `/…` line handed to `onSend` is *run* by the other end rather
   * than read as message text. True for a `claude` session, whose composer
   * writes into the CLI's own prompt; false for `claude-gui`, which feeds it
   * stream-json instead — a difference that decides whether the `/` menu is
   * worth offering.
   */
  runsSlashCommands?: boolean
}) {
  return (
    <MilkdownProvider>
      <ComposerBody
        onSend={onSend}
        disabled={disabled}
        busy={busy}
        onInterrupt={onInterrupt}
        claudeFolderId={claudeFolderId}
        runsSlashCommands={runsSlashCommands}
      />
    </MilkdownProvider>
  )
}

function ComposerBody({
  onSend,
  disabled,
  busy,
  onInterrupt,
  claudeFolderId,
  runsSlashCommands,
}: {
  onSend: (text: string) => void
  disabled: boolean
  busy: boolean
  onInterrupt?: () => void
  claudeFolderId: string | null
  runsSlashCommands: boolean
}) {
  const [text, setText] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [loading, getInstance] = useInstance()

  const canSend =
    !disabled && !loading && (text.trim() !== "" || attachments.length > 0)

  /**
   * Types a `/` for the person who did not know they could.
   *
   * The menu is keyed off the text in the document, not off any button, so
   * this genuinely just inserts the character and hands focus back — the
   * same path as typing it, including the rule that it only opens a menu at
   * the start of a message.
   */
  function insertSlash() {
    insertTrigger("/")
  }

  /**
   * Types `@` for the person who did not know they could.
   *
   * A leading space when there is text already, because the mention query only
   * fires at the start of a word — typing the button's `@` onto the end of
   * "why is" would otherwise be a character that opens nothing.
   */
  function insertMention() {
    insertTrigger("@", { spaceBefore: true })
  }

  function insertTrigger(
    character: string,
    { spaceBefore = false }: { spaceBefore?: boolean } = {}
  ) {
    const editor = getInstance()
    if (!editor) return

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.focus()

      // The character before the caret, read *within* the paragraph rather than
      // by document position: position 0 is before the paragraph node itself,
      // and `doc.textBetween` across that boundary throws — which took the whole
      // action with it and inserted nothing at all.
      const { $from } = view.state.selection
      const before =
        $from.parentOffset > 0
          ? $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset)
          : ""
      const pad = spaceBefore && before !== "" && before !== " " ? " " : ""
      view.dispatch(view.state.tr.insertText(pad + character))
    })
  }

  function addPaths(paths: string[]) {
    const fresh = paths
      .filter((path) => path !== "")
      .map((path): Attachment => ({
        path,
        name: path.split("/").pop() ?? path,
        dataUrl: null,
        error: null,
      }))
    if (fresh.length === 0) return

    setAttachments((current) => [...current, ...fresh])

    for (const attachment of fresh) {
      window.desktop
        .readImageDataUrl(attachment.path)
        .then((dataUrl) => updateAttachment(attachment.path, { dataUrl }))
        .catch((error: unknown) =>
          updateAttachment(attachment.path, {
            error: error instanceof Error ? error.message : String(error),
          })
        )
    }
  }

  function updateAttachment(path: string, patch: Partial<Attachment>) {
    setAttachments((current) =>
      current.map((attachment) =>
        attachment.path === path ? { ...attachment, ...patch } : attachment
      )
    )
  }

  function removeAttachment(path: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.path !== path)
    )
  }

  async function pickImages() {
    addPaths(await window.desktop.pickImages())
  }

  /**
   * Registered for the *capture* phase (see `onDropCapture` below), so this
   * runs before Milkdown's own contentEditable ever sees the drop — left to
   * it, dropping an image file there is still a real drop as far as the
   * browser is concerned, and ProseMirror's default handling for it inserts
   * a plain `<img>` pointing at a `blob:` URL: a reference to bytes held in
   * this page's own memory, gone the moment the page reloads and never
   * something a CLI in another process could read in the first place. Only
   * intervening when the drop actually carries an image file leaves every
   * other kind of drop — reordering selected text within the doc, most of
   * all — to Milkdown exactly as before.
   */
  function onDrop(event: DragEvent<HTMLDivElement>) {
    const files = [...event.dataTransfer.files].filter((file) =>
      file.type.startsWith("image/")
    )
    if (files.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    setDragOver(false)
    if (disabled) return

    addPaths(files.map((file) => window.desktop.getPathForFile(file)))
  }

  /**
   * Same reasoning as `onDrop`, for Cmd/Ctrl+V of an image (a screenshot
   * copied to the clipboard, say) instead of a dragged file — otherwise
   * Milkdown inserts the exact same kind of dead `blob:` reference.
   *
   * This used to discard the image instead of attaching it, because a
   * screenshot carries no path: it reaches the page as a `File` that
   * `getPathForFile` answers about with an empty string, and there was
   * nothing to reference it by. `clipboardImagePath` is that missing half —
   * main writes the clipboard's own bytes out under a name — so a pasted
   * image now ends up in the state a dropped one does. A file copied in
   * Finder still needs none of it and is attached where it already lives.
   *
   * A paste that isn't an image (the overwhelmingly common case: normal
   * text) is left alone entirely.
   */
  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    const image = [...event.clipboardData.items].find(
      (item) => item.kind === "file" && item.type.startsWith("image/")
    )
    if (!image) return

    event.preventDefault()
    event.stopPropagation()
    if (disabled) return

    const file = image.getAsFile()
    const onDisk = file ? window.desktop.getPathForFile(file) : ""
    if (onDisk) {
      addPaths([onDisk])
      return
    }

    void window.desktop.clipboardImagePath().then((path) => {
      if (path) addPaths([path])
    })
  }

  /**
   * Sends what the composer holds, with every `@` chip replaced by the context
   * it stands for.
   *
   * Async only for that expansion — a note's body may be a file that has not been
   * read yet. The editor is cleared after it, so the message that goes and the
   * message that disappears are the same one.
   */
  async function send() {
    if (!canSend) return
    const editor = getInstance()
    if (!editor) return

    const markdown = editor.action(getMarkdown()).trim()
    const expanded = await expandMentions(markdown, lookupMention)
    const paths = attachments.map((attachment) => attachment.path).join("\n")
    const message = [expanded, paths].filter(Boolean).join("\n\n")

    onSend(message)
    editor.action(replaceAll(""))
    setText("")
    setAttachments([])
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-muted/20 transition-colors",
        dragOver && "bg-primary/10"
      )}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      // Capture phase: this has to run before Milkdown's own contentEditable
      // sees the drop/paste at all, not after — see the doc comments on
      // `onDrop`/`onPaste` above for why.
      onDropCapture={onDrop}
      onPasteCapture={onPaste}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault()
          void send()
          return
        }
        // Bubbles up from the editor and everything else in the composer —
        // the same reach Cmd/Ctrl+Enter above already has, and enough for
        // this: the one time Escape is worth reading as "stop", the person's
        // focus just came from typing the message they want the turn to make
        // room for. The `/` menu's own Escape (`composer-slash.tsx`) is a
        // window-level *capture* listener, so it runs first and, if the menu
        // is open, stops the event before it ever reaches here — closing the
        // menu takes one Escape, stopping the turn the next.
        if (event.key === "Escape" && busy && onInterrupt) {
          event.preventDefault()
          onInterrupt()
        }
      }}
    >
      {/* One card holding the text and its controls, rather than a bordered
          box with a separate toolbar bolted under it: the whole thing is one
          input, and the focus ring belongs around all of it. */}
      <div className="m-2 flex min-h-0 flex-1 flex-col rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring/50">
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((attachment) => (
              <AttachmentChip
                key={attachment.path}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment.path)}
              />
            ))}
          </ul>
        )}

        {/* `overflow-x-hidden`, deliberately not `overflow-auto` on both axes:
            a horizontal scrollbar on a text box a few lines tall (one long
            unbroken URL pasted in is enough to trigger it) reads as broken. */}
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pt-2.5">
          <ComposerEditor
            onMarkdownChange={setText}
            slashCommandsFor={runsSlashCommands ? claudeFolderId : null}
          />
        </div>

        <div className="flex shrink-0 items-center gap-1 px-2 pt-1 pb-2">
          <IconButton
            label="Attach images"
            onClick={() => void pickImages()}
            disabled={disabled}
          >
            <Paperclip />
          </IconButton>

          {runsSlashCommands && claudeFolderId !== null && (
            <IconButton
              label="Commands and skills"
              onClick={insertSlash}
              disabled={disabled}
            >
              <Slash />
            </IconButton>
          )}

          {/* For every kind of session: what this inserts is text, and the
              panels it reads are the workspace's rather than a session's. */}
          <IconButton
            label="Mention a table, request or note"
            onClick={insertMention}
            disabled={disabled}
          >
            <AtSign />
          </IconButton>

          {/* `ml-auto` on the wrapper rather than on Send itself, so Stop —
              rendered only once there is a turn worth stopping — sits right
              beside it instead of opening a second gap of its own. */}
          <div className="ml-auto flex items-center gap-1">
            {busy && onInterrupt && (
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Stop"
                title="Stop the current turn  (Esc)"
                className="size-8 rounded-full"
                onClick={onInterrupt}
              >
                <Square className="size-3" />
              </Button>
            )}

            <Button
              size="icon"
              aria-label="Send"
              title="Send  (⌘↵)"
              className="size-8 rounded-full"
              disabled={!canSend}
              onClick={() => void send()}
            >
              <ArrowUp />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment
  onRemove: () => void
}) {
  return (
    <li className="group relative size-14 shrink-0">
      <div className="size-14 overflow-hidden rounded-md border bg-background">
        {attachment.dataUrl ? (
          <img
            src={attachment.dataUrl}
            alt={attachment.name}
            className="size-full object-cover"
          />
        ) : attachment.error ? (
          <div
            className="flex size-full items-center justify-center text-muted-foreground"
            title={attachment.error}
          >
            <ImageOff className="size-4" />
          </div>
        ) : (
          <div className="flex size-full items-center justify-center">
            <Spinner className="size-4" />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.name}`}
        title={attachment.name}
        className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-destructive"
      >
        <X className="size-2.5" />
      </button>
    </li>
  )
}
