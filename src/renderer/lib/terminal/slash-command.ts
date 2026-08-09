/**
 * The CLI's own bookkeeping around a slash command, unwrapped.
 *
 * A `/…` line is not stored as the person typed it. The CLI expands it into a
 * user turn made of pseudo-tags — `<command-name>`, `<command-message>`,
 * `<command-args>`, and a separate turn per `<local-command-stdout>` — so a
 * transcript read back by `claudeGuiReadHistory` carries markup that was never
 * meant to be read, and which markdown shows verbatim because none of it is
 * valid HTML the renderer would swallow.
 *
 * Parsed here rather than in `electron/claude-gui.ts` so that both sides of the
 * same message get one treatment: history arrives wrapped, while a command
 * sent from the composer is appended as the bare `/name args` the user typed,
 * and only a parser that accepts both can draw them identically.
 */

/** One piece of a user turn, in the order it appeared. */
export type UserPart =
  | { kind: "text"; text: string }
  /** A slash command, `name` without its leading `/`. */
  | { kind: "command"; name: string; args: string }
  /** What a command printed locally, without ever reaching the model. */
  | { kind: "output"; text: string }

/**
 * The pseudo-tags a wrapped turn is built from.
 *
 * Matched as a set rather than one at a time because a turn can mix them, and
 * their order is not fixed — built-in commands write `name` first, project
 * commands `message` first.
 */
const WRAPPER =
  /<(command-name|command-message|command-args|command-contents|local-command-stdout|local-command-stderr|local-command-caveat)>([\s\S]*?)<\/\1>/g

/**
 * A bare slash command as typed: the same shape the composer's `/` menu fires
 * on, and the same one the CLI itself recognises — a name at the very start of
 * the message, then whitespace before anything else. `/Users/me/notes` is
 * excluded by that rule rather than by a special case, since the `/` after
 * `Users` is neither part of the name charset nor the whitespace that has to
 * follow it.
 */
const TYPED = /^\/([A-Za-z0-9:_-]+)(?:[ \t]+|\n)?([\s\S]*)$/

/** SGR colours, which a command's stdout carries for the terminal it thought
 * it was printing to (`Set model to \x1b[1mOpus 5\x1b[22m`). */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g

function pushText(parts: UserPart[], raw: string): void {
  const text = raw.trim()
  if (text !== "") parts.push({ kind: "text", text })
}

/**
 * One user turn as the pieces worth drawing.
 *
 * Two of the wrapper's tags are dropped on purpose: `command-message` only
 * repeats the name, and `local-command-caveat` is an instruction addressed to
 * the model, not something the person wrote or saw. A turn that held nothing
 * else comes back empty, which is the caller's cue to draw nothing at all.
 */
export function parseUserMessage(source: string): UserPart[] {
  const parts: UserPart[] = []
  let at = 0

  WRAPPER.lastIndex = 0
  for (
    let match = WRAPPER.exec(source);
    match !== null;
    match = WRAPPER.exec(source)
  ) {
    pushText(parts, source.slice(at, match.index))
    at = match.index + match[0].length

    const body = match[2] ?? ""
    switch (match[1]) {
      case "command-name":
        parts.push({
          kind: "command",
          name: body.trim().replace(/^\//, ""),
          args: "",
        })
        break

      case "command-args":
      case "command-contents": {
        const args = body.trim()
        if (args === "") break
        // Belongs to the call just opened; on its own — a shape this has not
        // been seen in, but cheap to survive — it is still text the user sent.
        const last = parts[parts.length - 1]
        if (last?.kind === "command") last.args = args
        else pushText(parts, args)
        break
      }

      case "local-command-stdout":
      case "local-command-stderr": {
        const text = body.replace(ANSI, "").trim()
        if (text !== "") parts.push({ kind: "output", text })
        break
      }
    }
  }
  pushText(parts, source.slice(at))

  // Nothing was wrapped, so this is a message as typed — which may still be a
  // command, and reads as one in the pane only if it is recognised here too.
  if (parts.length === 1 && parts[0]?.kind === "text") {
    const typed = TYPED.exec(parts[0].text)
    if (typed?.[1]) {
      return [
        { kind: "command", name: typed[1], args: (typed[2] ?? "").trim() },
      ]
    }
  }

  return parts
}
