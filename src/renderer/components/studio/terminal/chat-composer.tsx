import {
  useCallback,
  useEffect,
  useMemo,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import {
  ArrowUp,
  ImageOff,
  Paperclip,
  RotateCw,
  Slash,
  Square,
  X,
} from "lucide-react"

import {
  claudeModelKey,
  claudePermissionModeKey,
  type ClaudeModel,
  type ClaudePermissionMode,
  type ClaudeSlashCommand,
} from "@shared/api"
import {
  CLAUDE_MODEL_IDS,
  CLAUDE_MODELS,
  CLAUDE_PERMISSION_MODE_IDS,
  CLAUDE_PERMISSION_MODES,
} from "@/lib/terminal/catalog"
import { IconButton } from "../icon-button"
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

    return crepe
    // Built once and kept, with no dependency on `commands`: it reads the
    // list through a ref, and `claudeProjectId` is fixed for as long as a
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
function useSlashCommands(projectId: string | null) {
  const commands = useRef<ClaudeSlashCommand[]>([])
  const lastFetch = useRef(0)

  const refresh = useCallback(() => {
    if (projectId === null) return
    if (Date.now() - lastFetch.current < 5_000) return
    lastFetch.current = Date.now()

    window.desktop
      .claudeCommands(projectId)
      .then((found) => {
        commands.current = found
      })
      // A project directory that has gone away is the realistic cause, and a
      // composer with no `/` menu is a far better answer to it than a broken
      // one — the editor itself is unaffected either way.
      .catch(() => {})
  }, [projectId])

  useEffect(refresh, [refresh])

  return {
    enabled: projectId !== null,
    read: useCallback(() => commands.current, []),
    refresh,
  }
}

/**
 * A project's choice of model or permission mode, remembered across runs.
 *
 * `applied` is what the value was when this composer mounted, which is what
 * the session running above it was started with — the main process reads
 * these same keys when it builds the CLI's command line. Keeping the two
 * apart is what lets the UI say "restart to apply" only when it is true.
 */
function usePersistedChoice<T extends string>(
  key: string | null,
  allowed: Set<string>,
  fallback: T,
  /**
   * What the running session is really on, when something can see it.
   *
   * The permission mode has this and the model does not: the mode can be
   * cycled with Shift+Tab at the CLI's own prompt, and the CLI records each
   * change in the transcript the chat view is already tailing. Without it this
   * control would go on showing the mode the session *started* in.
   */
  observed?: T | null
) {
  const [value, setValue] = useState<T>(fallback)
  const [applied, setApplied] = useState<T>(fallback)

  useEffect(() => {
    if (key === null) return
    let cancelled = false

    void window.desktop.getSetting(key).then((stored) => {
      // A value this build does not know is treated as unset rather than
      // passed along: it would reach the CLI as a flag it rejects, and a
      // session that refuses to start is a poor way to learn that.
      if (cancelled || stored === null || !allowed.has(stored)) return
      setValue(stored as T)
      setApplied(stored as T)
    })

    return () => {
      cancelled = true
    }
  }, [key, allowed])

  /**
   * Follows the session when the mode is changed somewhere else.
   *
   * Adjusted during render rather than from an effect — React's own pattern
   * for a value that has to track a prop — and keyed on `observed` *changing*
   * rather than on every report of it: the transcript repeats the current mode
   * with each batch, and re-applying it would wipe a choice made here that is
   * still waiting for a restart. A real change is the session's own, so it
   * wins over that pending choice; the control would otherwise be claiming a
   * mode the session is not in.
   */
  const [seen, setSeen] = useState<T | null>(observed ?? null)
  if (observed !== undefined && observed !== null && observed !== seen) {
    setSeen(observed)
    setValue(observed)
    setApplied(observed)
  }

  /*
   * Remembered as well as shown, and this is not optional: the mode a session
   * starts in is read from this key, so a control that displayed the cycled
   * mode without storing it would promise one thing and restart into another.
   */
  useEffect(() => {
    if (observed === undefined || observed === null || key === null) return
    void window.desktop.setSetting(key, observed)
  }, [observed, key])

  const choose = useCallback(
    (next: T) => {
      setValue(next)
      if (key !== null) void window.desktop.setSetting(key, next)
    },
    [key]
  )

  return {
    value,
    /** True once the choice differs from what the running session got. */
    pending: value !== applied,
    choose,
    markApplied: setApplied,
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
  claudeProjectId = null,
  runsSlashCommands = false,
  onApplyModel,
  onApplyPermissionMode,
  onRestart,
  permissionMode = null,
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
  /** The project this is a Claude Code session for, or null for a kind that
   * is not one. Turns on the model and permission controls, which work for
   * any Claude session because they reach the CLI as startup flags. */
  claudeProjectId?: string | null
  /**
   * Whether a `/…` line handed to `onSend` is *run* by the other end rather
   * than read as message text. True for a `claude` session, whose composer
   * writes into the CLI's own prompt; false for `claude-gui`, which feeds it
   * stream-json instead — a difference that decides both whether the `/`
   * menu is worth offering and whether a model change can apply live.
   */
  runsSlashCommands?: boolean
  /**
   * Applies a setting to the session already running. Absent means the other
   * end has no way to be told mid-flight, and the choice waits for the next
   * session — which is the only thing "Restart to apply" ever appears for.
   *
   * The two kinds differ here: a GUI session takes both over its stream-json
   * transport, while a terminal one takes only the model, through the CLI's
   * own `/model`.
   */
  onApplyModel?: (model: ClaudeModel) => void
  onApplyPermissionMode?: (mode: ClaudePermissionMode) => void
  /** Starts the session over, for a choice that could not be applied live.
   * Absent when there is nothing to restart. */
  onRestart?: () => void
  /** The mode the session is really in, when the caller can see it — a
   * `claude` session's transcript reports every change, Shift+Tab included.
   * Null for a kind with no such report. */
  permissionMode?: ClaudePermissionMode | null
}) {
  return (
    <MilkdownProvider>
      <ComposerBody
        permissionMode={permissionMode}
        onSend={onSend}
        disabled={disabled}
        busy={busy}
        onInterrupt={onInterrupt}
        claudeProjectId={claudeProjectId}
        runsSlashCommands={runsSlashCommands}
        onApplyModel={onApplyModel}
        onApplyPermissionMode={onApplyPermissionMode}
        onRestart={onRestart}
      />
    </MilkdownProvider>
  )
}

function ComposerBody({
  permissionMode,
  onSend,
  disabled,
  busy,
  onInterrupt,
  claudeProjectId,
  runsSlashCommands,
  onApplyModel,
  onApplyPermissionMode,
  onRestart,
}: {
  permissionMode: ClaudePermissionMode | null
  onSend: (text: string) => void
  disabled: boolean
  busy: boolean
  onInterrupt?: () => void
  claudeProjectId: string | null
  runsSlashCommands: boolean
  onApplyModel?: (model: ClaudeModel) => void
  onApplyPermissionMode?: (mode: ClaudePermissionMode) => void
  onRestart?: () => void
}) {
  const [text, setText] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [loading, getInstance] = useInstance()

  const model = usePersistedChoice<ClaudeModel>(
    claudeProjectId && claudeModelKey(claudeProjectId),
    CLAUDE_MODEL_IDS,
    "default"
  )
  const permission = usePersistedChoice<ClaudePermissionMode>(
    claudeProjectId && claudePermissionModeKey(claudeProjectId),
    CLAUDE_PERMISSION_MODE_IDS,
    "default",
    permissionMode
  )

  const canSend =
    !disabled && !loading && (text.trim() !== "" || attachments.length > 0)

  /**
   * Remembers the choice, and applies it to the running session when that is
   * possible at all.
   *
   * `default` needs no special case: both ways of applying one of these take
   * it as a value in its own right — `/model default` resets a terminal
   * session, and the control protocol answers a `default` permission mode
   * with `{ mode: "default" }`. Only a setting with no `apply` at all is
   * left waiting for a restart.
   */
  function choose<T extends ClaudeModel | ClaudePermissionMode>(
    setting: { choose: (next: T) => void; markApplied: (next: T) => void },
    apply: ((next: T) => void) | undefined,
    next: T
  ) {
    setting.choose(next)
    if (!apply) return

    // Not gated on `disabled`: both callers already no-op when there is no
    // live session to talk to, and in that case the choice is applied
    // anyway — whatever starts next reads these same settings on its way up.
    // Gating here would instead leave "Restart to apply" showing for a
    // session that had not even started yet.
    apply(next)
    setting.markApplied(next)
  }

  /** Whether the running session is still on something other than what is
   * selected — and so whether restarting would actually change anything.
   * In practice only a terminal session's permission mode ever gets here. */
  const pending = model.pending || permission.pending

  function restart() {
    permission.markApplied(permission.value)
    model.markApplied(model.value)
    onRestart?.()
  }

  /**
   * Types a `/` for the person who did not know they could.
   *
   * The menu is keyed off the text in the document, not off any button, so
   * this genuinely just inserts the character and hands focus back — the
   * same path as typing it, including the rule that it only opens a menu at
   * the start of a message.
   */
  function insertSlash() {
    const editor = getInstance()
    if (!editor) return

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.focus()
      view.dispatch(view.state.tr.insertText("/"))
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
   * Milkdown inserts the exact same kind of dead `blob:` reference. Unlike a
   * dropped file, pasted clipboard image data has no real path on disk to
   * attach, so this only ever discards it — never silently lets a broken
   * reference through. A paste that isn't an image (the overwhelmingly
   * common case: normal text) is left alone entirely.
   */
  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    const hasImage = [...event.clipboardData.items].some((item) =>
      item.type.startsWith("image/")
    )
    if (!hasImage) return
    event.preventDefault()
    event.stopPropagation()
  }

  function send() {
    if (!canSend) return
    const editor = getInstance()
    if (!editor) return

    const markdown = editor.action(getMarkdown()).trim()
    const paths = attachments.map((attachment) => attachment.path).join("\n")
    const message = [markdown, paths].filter(Boolean).join("\n\n")

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
          send()
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
            slashCommandsFor={runsSlashCommands ? claudeProjectId : null}
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

          {runsSlashCommands && claudeProjectId !== null && (
            <IconButton
              label="Commands and skills"
              onClick={insertSlash}
              disabled={disabled}
            >
              <Slash />
            </IconButton>
          )}

          {claudeProjectId !== null && (
            <>
              <BarSelect
                label="Model"
                value={model.value}
                onChange={(next) =>
                  choose(model, onApplyModel, next as ClaudeModel)
                }
                options={CLAUDE_MODELS}
              />
              <BarSelect
                label="Permission mode"
                value={permission.value}
                onChange={(next) =>
                  choose(
                    permission,
                    onApplyPermissionMode,
                    next as ClaudePermissionMode
                  )
                }
                options={CLAUDE_PERMISSION_MODES}
              />

              {/* In practice only ever the permission mode: it is the one
                setting this app keeps as a startup flag on purpose, so that a
                per-project choice does not end up in the user's own
                `~/.claude/settings.json` (see `agentCommandWith`). Everything
                else has already taken effect by the time this would have
                rendered. */}
              {pending && onRestart && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={restart}
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                  title="Restarts the session with this setting. The conversation is resumed, not lost."
                >
                  <RotateCw className="size-3" />
                  Restart to apply
                </Button>
              )}
            </>
          )}

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
              onClick={send}
            >
              <ArrowUp />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * One of the composer bar's two dropdowns — the same `Select` the project
 * switcher in `studio.tsx` uses, and set up the same way.
 *
 * `items` is not optional dressing: without it Base UI renders the raw value
 * in the trigger, so this would read "opusplan" or "acceptEdits" instead of
 * the label. Passing it is also what lets each row carry a description the
 * trigger does not repeat.
 */
function BarSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  options: { id: string; label: string; description?: string }[]
}) {
  const items = useMemo(
    () => options.map((option) => ({ value: option.id, label: option.label })),
    [options]
  )

  return (
    <Select
      items={items}
      value={value}
      // Base UI (what this Select is built on) types a cleared selection as
      // null; neither of these two is clearable — there is always a model
      // and always a mode — so nothing meaningful is being dropped.
      onValueChange={(next) => {
        if (next !== null) onChange(next)
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="max-w-44 min-w-0">
        <SelectValue />
      </SelectTrigger>
      {/* Same treatment as the project switcher: a row that carries a
          description is wider than the trigger it opens from. */}
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        className="w-auto min-w-(--anchor-width)"
      >
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            <span className="flex flex-col gap-0.5">
              <span>{option.label}</span>
              {option.description && (
                <span className="text-xs text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
