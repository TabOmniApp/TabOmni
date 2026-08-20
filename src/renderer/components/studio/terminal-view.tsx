import { useEffect, useRef } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import { Terminal } from "@xterm/xterm"
import { useTheme } from "next-themes"

import "@xterm/xterm/css/xterm.css"

/*
 * xterm takes hex, not the theme's CSS variables, so these are the dark
 * palette's own greys written out — `#1e1e1e` is `--background` and `#414141`
 * is `--accent`. A terminal filling a pane must be the pane's own colour: at
 * anything else it reads as a window floating in the studio rather than part
 * of it. Kept in step by hand, which is the price of a canvas renderer.
 */
const darkTheme = {
  background: "#1e1e1e",
  foreground: "#e4e4e7",
  cursor: "#e4e4e7",
  selectionBackground: "#414141",
}

const lightTheme = {
  background: "#ffffff",
  foreground: "#27272a",
  cursor: "#27272a",
  selectionBackground: "#e4e4e7",
}

/**
 * A path as one word of a command line.
 *
 * A pasted `Screenshot 2026-08-10 at 10.37.38 AM.png` is three arguments to
 * any shell reading it, and the system terminals answer that by quoting rather
 * than by backslash-escaping — the `'…'` a pasted screenshot arrives wrapped
 * in. Inside single quotes nothing needs escaping but a single quote itself,
 * which has to leave and come back.
 *
 * Left alone when there is nothing to quote, so the common path stays
 * something a person can read and edit.
 */
function shellWord(path: string): string {
  if (/^[\w@%+=:,./-]+$/.test(path)) return path
  return `'${path.replaceAll("'", `'\\''`)}'`
}

export type TerminalHandle = {
  write: (chunk: string) => void
  onData: (listener: (data: string) => void) => void
  /** Size after the initial fit — use it to size the PTY you attach. */
  cols: number
  rows: number
}

type TerminalViewProps = {
  /**
   * Called once the terminal is on screen. Return a teardown function; it runs
   * when the terminal unmounts.
   */
  onReady: (terminal: TerminalHandle) => undefined | (() => void)
  /** Called whenever the terminal is resized, so a PTY can be kept in sync. */
  onResize?: (size: { cols: number; rows: number }) => void
}

/**
 * A single xterm.js surface that keeps itself fitted to its container.
 * Owning the lifecycle here keeps the callers (output log, interactive shell)
 * down to a few lines each.
 */
export function TerminalView({ onReady, onResize }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const { resolvedTheme } = useTheme()
  const terminalRef = useRef<Terminal | null>(null)

  // xterm outlives every render, so callbacks are reached through refs.
  const onReadyRef = useRef(onReady)
  const onResizeRef = useRef(onResize)
  useEffect(() => {
    onReadyRef.current = onReady
    onResizeRef.current = onResize
  }, [onReady, onResize])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      /*
       * The list from `index.css`'s `--font-mono`, written out rather than
       * referenced: this string is handed to a canvas `ctx.font`, where a CSS
       * variable is not a value but a parse error — the whole declaration is
       * dropped and the atlas is rasterised in some default face at the wrong
       * metrics. The DOM renderer put it in real CSS, so `var()` worked there
       * and hid this until the day something else measured the font.
       */
      fontFamily:
        'ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      // Room to read, nothing more. The seams this used to have to avoid came
      // from the text renderer stretching box-drawing glyphs across a taller
      // cell; the renderer below draws them to whatever the cell is.
      lineHeight: 1.2,
      scrollback: 5_000,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    // Makes the preview URL that the dev server prints clickable.
    terminal.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault()
        window.open(uri, "_blank", "noreferrer")
      })
    )
    terminal.open(host)

    /*
     * The default renderer draws each cell as text, so a border made of `─`
     * comes out as a row of dashes: the glyph is narrower than the cell it
     * sits in, and the leftover pixels are the gaps. This one draws
     * box-drawing characters itself, to the exact size of the cell, which is
     * what joins them up — the same thing every other terminal does.
     *
     * WebGL rather than the canvas renderer: canvas has no release for
     * xterm 6 (its latest still asks for `^5.0.0`), and this is the one the
     * xterm authors point at anyway.
     *
     * Best-effort: a machine that cannot give it a context keeps the text
     * renderer, which is a working terminal with seams in its lines.
     */
    try {
      const webgl = new WebglAddon()
      // The context can be taken away — a GPU driver reset, a machine waking
      // up. Disposing hands the terminal back to the text renderer instead of
      // leaving it painting nothing.
      webgl.onContextLoss(() => webgl.dispose())
      terminal.loadAddon(webgl)
    } catch {
      // Left on the default renderer.
    }

    /*
     * Shift+Enter, sent as ESC CR.
     *
     * A pty carries bytes, not modifiers: Enter is one byte whether or not
     * Shift was down, which is why anything that takes a multi-line prompt has
     * to be told about the modifier by some other sequence. ESC CR is the one
     * both ends of this panel already read as a newline — zsh binds `\e^M` to
     * `self-insert-unmeta`, so a shell tab gets a continuation line, and it is
     * what `claude /terminal-setup` writes into iTerm2's and VS Code's keymaps
     * for the agent CLIs. There is no user keymap to write here, so the
     * terminal sends it itself and the key works without a setup step.
     */
    terminal.attachCustomKeyEventHandler((event) => {
      const plainShiftEnter =
        event.key === "Enter" &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      if (!plainShiftEnter) return true

      /*
       * Every event for this key has to be claimed, not just the keydown.
       * Refusing the keydown makes xterm return before it sets its own
       * `_keyDownHandled`, so it never calls `preventDefault` and the browser
       * goes on to fire `keypress` — where xterm reads Enter's char code and
       * sends a bare CR. Letting that one through appends the newline and then
       * submits the line, which on screen is indistinguishable from having
       * pressed Enter, and is exactly what this key looked like it was doing.
       */
      if (event.type !== "keydown") return false

      event.preventDefault()
      terminal.input("\x1b\r")
      return false
    })

    terminalRef.current = terminal

    const refit = () => {
      // Fitting a zero-sized element throws; skip until it has a layout.
      if (host.clientWidth === 0 || host.clientHeight === 0) return
      try {
        fit.fit()
      } catch {
        // Ignore transient measurement failures during layout changes.
      }
    }

    let disposed = false

    /*
     * A pasted file, typed in as its path — any file, not only a picture.
     *
     * That substitution is the whole of what a terminal can do with a file on
     * the clipboard: the process on the other end of the pty reads bytes, so a
     * file is named to it rather than handed over. It is also all the system
     * terminals do, and what someone pasting into this one is asking for.
     *
     * Two sources, one for each way a file reaches a clipboard: copied in
     * Finder it has a real path already, and `getPathForFile` gives it without
     * copying anything; a screenshot taken straight to the clipboard has no
     * file behind it at all, says so with an empty string, and main has to
     * write it out before there is anything to name.
     *
     * Capture phase, because xterm's own paste handler sits on the textarea
     * inside this host and would otherwise get there first. Only a file is
     * intercepted — a text paste is left to it untouched.
     */
    /**
     * Types the paths in as one command line's worth of words.
     *
     * The trailing space is what a real terminal adds to a dragged-in file: it
     * ends the path, so whatever is typed next is not read as part of it.
     */
    const insertPaths = (paths: (string | null)[]) => {
      // The pane can be closed while a file is being written out, and `input`
      // on a disposed terminal throws.
      if (disposed) return

      const line = paths
        .filter((path): path is string => Boolean(path))
        .map(shellWord)
        .join(" ")
      if (!line) return

      terminal.input(`${line} `)
    }

    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.items ?? [])].filter(
        (item) => item.kind === "file"
      )
      if (files.length === 0) return

      event.preventDefault()
      event.stopPropagation()

      // `getAsFile` reads the event itself, so it cannot be left until the
      // promises below have settled.
      const resolving = files.map((item) => {
        const file = item.getAsFile()
        const onDisk = file ? window.desktop.getPathForFile(file) : ""
        return onDisk
          ? Promise.resolve<string | null>(onDisk)
          : window.desktop.clipboardImagePath()
      })

      void Promise.all(resolving).then(insertPaths)
    }
    host.addEventListener("paste", onPaste, { capture: true })

    /*
     * Dropping a file types its path in, the same substitution the paste above
     * makes, with the tint macOS Terminal draws while something is over it.
     *
     * The tint is toggled by hand on a sibling element rather than held in
     * React state: a re-render of this component would tear the xterm instance
     * down and take the session with it.
     *
     * `dragleave` fires every time the pointer crosses into a child element as
     * well as when it finally leaves, so the depth is counted rather than
     * trusted — otherwise the tint flickers off the moment the pointer moves
     * over the terminal's own rows.
     */
    const overlay = overlayRef.current
    const showDropTarget = (on: boolean) =>
      overlay?.classList.toggle("hidden", !on)
    let dragDepth = 0

    const carriesFiles = (event: DragEvent) =>
      [...(event.dataTransfer?.types ?? [])].includes("Files")

    const onDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      dragDepth += 1
      showDropTarget(true)
    }

    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      // Without this the drop is refused, the cursor shows the "no" badge, and
      // Chromium navigates the window to the dropped file instead.
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    }

    const onDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      dragDepth = Math.max(0, dragDepth - 1)
      if (dragDepth === 0) showDropTarget(false)
    }

    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      event.stopPropagation()
      dragDepth = 0
      showDropTarget(false)

      // A dropped file always has a path — there is a real file behind it, so
      // none of the clipboard's "bytes with nothing to name" case applies.
      insertPaths(
        [...(event.dataTransfer?.files ?? [])].map((file) =>
          window.desktop.getPathForFile(file)
        )
      )
    }

    host.addEventListener("dragenter", onDragEnter)
    host.addEventListener("dragover", onDragOver)
    host.addEventListener("dragleave", onDragLeave)
    host.addEventListener("drop", onDrop)

    let observer: ResizeObserver | undefined
    let disposeResize: { dispose: () => void } | undefined
    let teardown: (() => void) | undefined

    /*
     * Two frames, not zero: a sibling `ResizablePanel` can still be settling
     * its own final pixel size for a frame or two after this effect runs, so
     * fitting immediately can measure a host that hasn't reached the size it
     * is about to keep. The pty this hands off to only gets told about that
     * one measurement — `terminalCreate`/`agentInstall` are called once,
     * right below, with whatever `cols`/`rows` this produces — and a CLI's
     * own TUI (Claude Code, most of all) draws its first frame, cursor
     * included, against the size it read at startup. It doesn't re-query
     * until a real resize reaches it, which is why the fix so far has been
     * "wait, or resize the pane": either one is what finally sends the
     * correct size down. Waiting a couple of frames before that first fit is
     * what makes the first frame already right, instead of only correcting
     * itself once something else happens to trigger a resize.
     */
    let innerRafId = 0
    const outerRafId = requestAnimationFrame(() => {
      innerRafId = requestAnimationFrame(() => {
        if (disposed) return

        refit()

        observer = new ResizeObserver(refit)
        observer.observe(host)

        disposeResize = terminal.onResize(({ cols, rows }) => {
          onResizeRef.current?.({ cols, rows })
        })

        teardown = onReadyRef.current({
          write: (chunk) => terminal.write(chunk),
          onData: (listener) => {
            terminal.onData(listener)
          },
          cols: terminal.cols,
          rows: terminal.rows,
        })
      })
    })

    return () => {
      disposed = true
      // Whichever of these never got to fire — cancelling the other is a
      // harmless no-op.
      cancelAnimationFrame(outerRafId)
      cancelAnimationFrame(innerRafId)
      host.removeEventListener("paste", onPaste, { capture: true })
      host.removeEventListener("dragenter", onDragEnter)
      host.removeEventListener("dragover", onDragOver)
      host.removeEventListener("dragleave", onDragLeave)
      host.removeEventListener("drop", onDrop)
      teardown?.()
      disposeResize?.dispose()
      observer?.disconnect()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = resolvedTheme === "dark" ? darkTheme : lightTheme
  }, [resolvedTheme])

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {/* Shown only while a file is being dragged over, by the effect above
          rather than by a render — see the drag handlers for why. Inert, so it
          cannot become the `dragleave` the drop is waiting on. */}
      <div
        ref={overlayRef}
        className="pointer-events-none absolute inset-0 hidden bg-primary/10 ring-2 ring-primary/50 ring-inset"
      />
    </div>
  )
}
