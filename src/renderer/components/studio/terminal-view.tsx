import { useEffect, useRef } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import { Terminal } from "@xterm/xterm"
import { useTheme } from "next-themes"

import "@xterm/xterm/css/xterm.css"

const darkTheme = {
  background: "#0b0b0d",
  foreground: "#e4e4e7",
  cursor: "#e4e4e7",
  selectionBackground: "#3f3f46",
}

const lightTheme = {
  background: "#ffffff",
  foreground: "#27272a",
  cursor: "#27272a",
  selectionBackground: "#e4e4e7",
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

  return <div ref={hostRef} className="h-full w-full" />
}
