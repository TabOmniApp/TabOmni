import { randomUUID } from "node:crypto"

import {
  DEFAULT_CHAT_OPTIONS,
  type AssistantMessage,
  type WorktreeChat,
  type WorktreeChatEvent,
  type WorktreeChatOptions,
} from "../shared/api"
import { collapse, lineId, runPrintTurn, type PrintRun } from "./claude-print"

/**
 * A worktree's chats: `claude -p` per turn, in that checkout's directory.
 *
 * **Why print mode and not a pty.** A session's chat view tails the transcript
 * the interactive CLI writes, and that is the right shape for a session: the
 * terminal and the chat are two views of one conversation, and a permission
 * prompt is answered in the terminal. A worktree's chat is not that. It is a
 * conversation the app is *hosting* — its own message model, its own composer,
 * its own tool-call rows — and hosting one means driving the CLI rather than
 * reading after it. `--output-format stream-json` is what makes that possible.
 *
 * This is the **only** `claude` the app spawns. There was a workspace assistant
 * beside it — one conversation, read-only, in no folder at all — and it was
 * removed; what `CLAUDE.md` has always refused is something else and still is:
 * features calling the CLI as a helper, an AI filter or an import button,
 * because a helper turn is a turn nobody asked for. This is a conversation
 * somebody is having. The reader it drives the CLI through is
 * `claude-print.ts`.
 *
 * **What it may do, and why.** A worktree is an isolated checkout on a branch of
 * its own — that is the entire reason to make one — so this runs with edits
 * pre-approved and `Bash` allowed. Print mode has nobody to ask, so a turn that
 * met a prompt would simply fail; the choice is between saying up front what is
 * allowed and having a chat that cannot change anything. Isolation is what makes
 * the first honest: the worst case is a branch, and the branch is not the one
 * the user has checked out.
 *
 * The workspace's MCP servers are handed over, which is the thing no other
 * agent-in-an-editor has: the databases, the saved requests and the notes, in
 * the same conversation as the code: the config, the servers pre-approved,
 * `--strict-mcp-config` so the user's own `claude` servers are not pulled into a
 * conversation this app is hosting, and two `delete_*` tools refused. See
 * `ALLOWED_TOOLS` and `DISALLOWED_TOOLS`.
 *
 * **What the chat's own toolbar decides** is on the record rather than here:
 * `WorktreeChatOptions` is a model, an effort and a plan switch per chat, and a
 * turn is built from whatever it said when the message was sent. Only the last
 * of the three changes what a turn may do — see `PLAN_TOOLS` for why plan mode
 * is a tool list and not `--permission-mode plan`.
 */

/** One turn in flight, and the conversation it belongs to. */
type Live = {
  run: PrintRun | null
  /** Set while spawning, so a second send cannot start a second process before
   * the first has a `PrintRun` to kill. */
  starting: boolean
}

export type WorktreeChatSource = {
  /** The MCP config for the servers that are switched on, or null. */
  mcpConfig: () => Promise<string | null>
  /** The directory a worktree id names, or null when the record has gone. */
  worktreeDir: (worktreeId: string) => Promise<string | null>

  chats: () => Promise<WorktreeChat[]>
  saveChats: (chats: WorktreeChat[]) => Promise<void>
  readChat: (id: string) => Promise<AssistantMessage[]>
  writeChat: (id: string, messages: AssistantMessage[]) => Promise<void>
  deleteChat: (id: string) => Promise<void>
}

/**
 * Pre-approved for a worktree chat.
 *
 * Read the class comment before widening this. It is broad on purpose — a chat
 * that cannot edit a file is not a coding chat — and it is only defensible
 * because the directory it runs in is a branch of its own.
 *
 * `--permission-mode acceptEdits` covers the edit tools; these are the ones that
 * would otherwise still be asked about, and in print mode "asked about" means
 * "refused".
 *
 * The `tabomni-*` servers are named as servers rather than as their tools, so a
 * tool added to one later is covered. Handing the
 * config over is not enough on its own — `--mcp-config` says the tools exist and
 * `--allowed-tools` says they may be used without asking, and a turn that had
 * only the first would meet a prompt nobody is there to answer. That was the
 * gap: this chat was given the workspace's servers and could not call them.
 * `ToolSearch` is on the list because a CLI configured to defer tools reaches an
 * MCP tool through it, and being asked to approve a search for a tool is another
 * prompt nobody can answer.
 */
const ALLOWED_TOOLS = [
  "mcp__tabomni-database",
  "mcp__tabomni-api",
  "mcp__tabomni-notes",
  "ToolSearch",
  "Read",
  "Glob",
  "Grep",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Task",
]

/**
 * The two the workspace's own tools are refused.
 *
 * Refused for a reason that survives the isolation argument rather than being
 * covered by it: a worktree is a branch, and a saved request is not in any
 * branch. Deleting one is a change to the
 * workspace that no checkout contains and no `git checkout` undoes, there is no
 * trash to fetch it back from, and print mode has nobody to ask first. The chat
 * can still write and change requests — that is the panel being useful — and
 * `delete_folder` cascades, which is what makes it the sharpest of the nine.
 *
 * Bash could do worse to the files in the checkout, and that is the point of
 * the distinction: those files are a branch, and this is not.
 */
const DISALLOWED_TOOLS = [
  "mcp__tabomni-api__delete_request",
  "mcp__tabomni-api__delete_folder",
]

/**
 * Plan mode: everything that reads, and nothing that writes.
 *
 * **Why not `--permission-mode plan`.** That is the CLI's own plan mode, and it
 * ends by asking — `ExitPlanMode` is a prompt, and print mode has nobody to
 * answer it. A turn started that way spends itself trying to leave: it writes
 * the plan to a file it may not write, calls a tool that is disabled, and comes
 * back `is_error` with an apology instead of a plan. So plan mode here is the
 * thing somebody actually wanted from it — a turn that cannot change anything —
 * built out of the tool list, which print mode *can* enforce.
 *
 * `Bash` is not on it, and that is the whole of the guarantee: a command can
 * write, and no reading of an argument list decides which ones do. What it costs
 * is `git log` and `rg`, and `Glob` and `Grep` are the same reconnaissance
 * without a shell.
 */
const PLAN_TOOLS = [
  "mcp__tabomni-database__list_databases",
  "mcp__tabomni-database__list_tables",
  "mcp__tabomni-database__query",
  "mcp__tabomni-api__list_requests",
  "mcp__tabomni-api__get_request",
  "mcp__tabomni-notes__list_notes",
  "mcp__tabomni-notes__read_note",
  "ToolSearch",
  "Read",
  "Glob",
  "Grep",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Task",
]

/**
 * Refused in plan mode, named rather than merely left off `PLAN_TOOLS`.
 *
 * Both halves are needed for the same reason they are on an ordinary turn:
 * `--allowed-tools` says what may be used without asking and leaves everything
 * else askable, and in print mode "askable" is a turn that stalls. Naming the
 * write tools is what turns a stall into a refusal the model can plan around.
 *
 * The workspace's own writers are on it too, not just the checkout's: a plan is
 * a plan whichever panel it would have changed, and saving a request or a note
 * is a change to the workspace rather than to this branch — the one kind of
 * change no `git checkout` takes back.
 */
const PLAN_REFUSED = [
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
  "mcp__tabomni-api__create_request",
  "mcp__tabomni-api__update_request",
  "mcp__tabomni-api__create_folder",
  "mcp__tabomni-api__update_folder",
  "mcp__tabomni-api__delete_request",
  "mcp__tabomni-api__delete_folder",
  "mcp__tabomni-notes__create_note",
]

/**
 * What a plan-mode turn is told, on top of `SYSTEM_PROMPT`.
 *
 * Said as well as enforced: a model that discovers it cannot write by being
 * refused spends a tool call finding out, and one that was told up front spends
 * it reading instead.
 */
const PLAN_PROMPT =
  "This turn is read-only: describe what you would change and why, in enough detail that it could be carried out, and do not modify anything. The editing tools and the shell are unavailable on purpose, so do not try them."

/**
 * What the model is told about where it is.
 *
 * Short, because the CLI can see the working directory for itself. What it
 * cannot see is what the `tabomni-*` tools are attached to: a tool
 * list says what a tool does, not that the databases and requests it reaches
 * belong to the workspace this checkout is part of.
 */
const SYSTEM_PROMPT = [
  "You are a chat in a `git worktree` checkout inside TabOmni, a desktop studio: this directory is a working tree of the user's project on a branch of its own, so edits and commands here cannot disturb the branch they have checked out elsewhere.",
  "The workspace's databases, saved HTTP requests and notes are the `tabomni-*` MCP tools, and they belong to the whole workspace rather than to this checkout; prefer them over guessing.",
].join(" ")

export class WorktreeChats {
  /** A turn per chat, keyed by chat id. Several chats can be answering at once
   * — that is the point of a worktree per piece of work. */
  private readonly live = new Map<string, Live>()

  /**
   * Chats the CLI has been started on during *this* run.
   *
   * A write-through cache in front of `started` on the record, and not a
   * duplicate of it: the listing is rewritten by a read-modify-write on every
   * appended line, so a turn's first answer could read the listing before
   * `markStarted` had saved and write it back afterwards, dropping the flag it
   * never saw. Both writers OR this in, which is what makes the order between
   * them stop mattering.
   */
  private readonly started = new Set<string>()

  /** Each chat's lines, held so a turn's events can be appended and written
   * without reading the file back on every one of them. Dropped when a chat is
   * deleted; kept otherwise, since a chat somebody is switching between is a
   * chat they are about to read again. */
  private readonly messages = new Map<string, AssistantMessage[]>()

  constructor(
    private readonly source: WorktreeChatSource,
    private readonly emit: (event: WorktreeChatEvent) => void
  ) {}

  list(): Promise<WorktreeChat[]> {
    return this.source.chats()
  }

  /**
   * A new, empty chat in a worktree.
   *
   * Made up front rather than on the first message, because the row has to exist
   * for somebody to type into: the tab is opened by clicking `+`, and a tab that
   * only appears once you have said something is a `+` that does nothing.
   */
  async create(worktreeId: string): Promise<WorktreeChat> {
    const now = new Date().toISOString()
    const chat: WorktreeChat = {
      id: randomUUID(),
      worktreeId,
      // Named by its first message, once there is one. Until then this is what
      // the tab says — Conductor's own new tab says the same thing.
      title: "Untitled",
      createdAt: now,
      updatedAt: now,
    }
    await this.source.saveChats([...(await this.source.chats()), chat])
    this.messages.set(chat.id, [])
    return chat
  }

  /** What was said in a chat. Read from disk the first time and cached after. */
  async read(id: string): Promise<AssistantMessage[]> {
    const held = this.messages.get(id)
    if (held) return held

    const messages = await this.source.readChat(id)
    this.messages.set(id, messages)
    return messages
  }

  async delete(id: string): Promise<void> {
    this.live.get(id)?.run?.kill()
    this.live.delete(id)
    this.messages.delete(id)
    this.started.delete(id)

    await this.source.saveChats(
      (await this.source.chats()).filter((chat) => chat.id !== id)
    )
    await this.source.deleteChat(id)
  }

  /** Every chat of a worktree, for removing them with it. */
  async deleteFor(worktreeId: string): Promise<void> {
    const chats = await this.source.chats()
    for (const chat of chats.filter(
      (entry) => entry.worktreeId === worktreeId
    )) {
      await this.delete(chat.id)
    }
  }

  async send(id: string, prompt: string): Promise<void> {
    const existing = this.live.get(id)
    if (existing?.starting || existing?.run) {
      throw new Error("That chat is still answering.")
    }

    const chats = await this.source.chats()
    const chat = chats.find((entry) => entry.id === id)
    if (!chat) throw new Error("That chat no longer exists.")

    const cwd = await this.source.worktreeDir(chat.worktreeId)
    if (!cwd) {
      // The checkout has been removed under the chat. The conversation is still
      // readable — it is on disk — but there is nowhere to run a turn.
      this.finish(id, "That worktree has been removed.")
      return
    }

    this.live.set(id, { run: null, starting: true })
    await this.append(id, { id: lineId(), role: "user", text: prompt })

    // Off the record rather than off a `Set` in this process: the CLI's session
    // outlives the app's run, so a chat sent to before a restart has to come
    // back as `--resume`.
    await this.run(
      id,
      cwd,
      prompt,
      chat.started === true || this.started.has(id),
      // Read at send time rather than held: the toolbar writes to the record,
      // and a turn takes whatever it said when the message was sent.
      chat.options ?? DEFAULT_CHAT_OPTIONS
    )
  }

  /**
   * The model, effort and plan switch for one chat.
   *
   * Whole rather than a patch, so two controls changed in quick succession
   * cannot merge into a state neither of them asked for. A read-modify-write of
   * the listing like every other change to it — the store's own queue serialises
   * them, so this cannot interleave with the line a turn is appending.
   *
   * A turn already in flight keeps the options it started with: they are the
   * process's argument list, and there is nothing to change it to.
   */
  async setOptions(id: string, options: WorktreeChatOptions): Promise<void> {
    const chats = await this.source.chats()
    if (!chats.some((chat) => chat.id === id)) return

    await this.source.saveChats(
      chats.map((chat) => (chat.id === id ? { ...chat, options } : chat))
    )
  }

  /**
   * One turn, with the user's line already written down.
   *
   * Apart from `send` because of the retry below: a turn that has to be started
   * again must not append the prompt a second time.
   */
  private async run(
    id: string,
    cwd: string,
    prompt: string,
    resume: boolean,
    options: WorktreeChatOptions
  ): Promise<void> {
    const run = await runPrintTurn(
      {
        cwd,
        prompt,
        sessionId: id,
        resume,
        // Both null unless the toolbar says otherwise, which leaves the user's
        // own `claude` deciding — see `PrintTurn`.
        model: options.model,
        effort: options.effort,
        allowedTools: options.plan ? PLAN_TOOLS : ALLOWED_TOOLS,
        disallowedTools: options.plan ? PLAN_REFUSED : DISALLOWED_TOOLS,
        // `acceptEdits` either way, plan mode included: it is what stops the
        // *permitted* tools stalling on a prompt, and what makes a plan-mode
        // turn read-only is the tool list, not the mode. See `PLAN_TOOLS`.
        permissionMode: "acceptEdits",
        // The workspace's own servers, and only those: a chat here is the app's
        // rather than the user's `claude`.
        mcpConfig: await this.source.mcpConfig(),
        strictMcp: true,
        appendSystemPrompt: options.plan
          ? `${SYSTEM_PROMPT} ${PLAN_PROMPT}`
          : SYSTEM_PROMPT,
      },
      {
        onMessage: (message) => void this.append(id, message),
        onDone: (error) => {
          /*
           * The CLI already has this session — start the turn again as a
           * resume.
           *
           * This is what a chat written before `started` was a field looks
           * like: the id was used in an earlier run of the app, nothing on the
           * record says so, and the turn that would have written it down is the
           * one being refused. Guessing from the transcript instead would be
           * guessing — a chat can hold lines from a turn that died before the
           * CLI opened anything — so the answer is taken from the CLI, which is
           * the only party that knows.
           *
           * Once, and only for a turn that did not already resume, so a genuine
           * failure is still reported rather than run twice.
           */
          if (error !== null && !resume && isSessionTaken(error)) {
            void this.run(id, cwd, prompt, true, options)
            return
          }
          this.finish(id, error)
        },
      }
    )

    // From here the CLI owns this id, so the next turn resumes it rather than
    // asking for it again — including a turn that comes after a failed one, and
    // including one after a restart, which is why this is written down.
    //
    // Only once the process is actually up: `runPrintTurn` hands back null when
    // it could not spawn at all, and a session the CLI never opened must not be
    // resumed on the next try.
    if (run) await this.markStarted(id)

    // Only on success: a turn that could not spawn has already been finished
    // by `onDone`, and putting a dead entry back would leave the chat looking
    // busy to the next `send`.
    if (run) this.live.set(id, { run, starting: false })
  }

  stop(id: string): void {
    const live = this.live.get(id)
    if (!live?.run) return
    live.run.kill()
  }

  /** Kills every turn in flight, for shutdown. */
  dispose(): void {
    for (const live of this.live.values()) live.run?.kill()
    this.live.clear()
  }

  /**
   * Writes down that the CLI has this id now.
   *
   * A read-modify-write of the listing like every other change to it — the
   * store's own queue serialises them, so this cannot interleave with the title
   * the same turn is about to set.
   */
  private async markStarted(id: string): Promise<void> {
    if (this.started.has(id)) return
    this.started.add(id)

    try {
      const chats = await this.source.chats()
      if (!chats.some((chat) => chat.id === id)) return
      await this.source.saveChats(
        chats.map((chat) =>
          chat.id === id ? { ...chat, started: true } : chat
        )
      )
    } catch (error) {
      // Worth a line in the log and not worth failing the turn over: the cost
      // is one refused `--session-id` on the next launch, and the turn that is
      // running right now is fine.
      console.error("Could not record that the chat has started", error)
    }
  }

  private finish(id: string, error: string | null): void {
    this.live.delete(id)
    if (error) {
      void this.append(id, { id: lineId(), role: "error", text: error })
    }
    this.emit({ chatId: id, type: "done", error })
  }

  /**
   * Appends one line, writes it down, and tells the renderer.
   *
   * The listing is touched on the same pass: a chat's first user line is also
   * its title, and every line afterwards moves it up the list. A failed write
   * costs the record of a line and is not worth abandoning a turn over — the
   * store's own queue serialises them, so the file cannot be interleaved.
   *
   * **The user's own line is written but not announced.** A `text` event is a
   * line of the answer — it carries no role, because everything streaming out
   * of a turn is the model's — so emitting the prompt through it drew the
   * question a second time in the answer's own style, under the bubble the
   * composer had already put on screen. The only window that could receive it
   * is the one that typed it, and that window has it.
   */
  private async append(id: string, message: AssistantMessage): Promise<void> {
    const messages = [...(await this.read(id)), message]
    this.messages.set(id, messages)

    if (message.role !== "user") {
      this.emit(
        message.role === "tool"
          ? {
              chatId: id,
              type: "tool",
              name: message.name,
              summary: message.summary,
            }
          : message.role === "error"
            ? { chatId: id, type: "done", error: message.text }
            : { chatId: id, type: "text", text: message.text }
      )
    }

    try {
      await this.source.writeChat(id, messages)

      const chats = await this.source.chats()
      const existing = chats.find((chat) => chat.id === id)
      if (!existing) return

      const titled =
        existing.title === "Untitled" && message.role === "user"
          ? titleOf(message.text)
          : existing.title

      await this.source.saveChats(
        chats.map((chat) =>
          chat.id === id
            ? {
                ...chat,
                title: titled,
                // OR'd in rather than carried through: this listing may have
                // been read before `markStarted` saved — see `started`.
                started: chat.started === true || this.started.has(id),
                updatedAt: new Date().toISOString(),
              }
            : chat
        )
      )
    } catch (error) {
      console.error("Could not write the chat", error)
    }
  }
}

/**
 * Whether the CLI refused an id because it already has that session.
 *
 * Matched on the text because that is all there is: the CLI exits non-zero with
 * a message, and there is no code to switch on. Deliberately narrow — it is the
 * trigger for running a turn a second time, and a looser test would rerun turns
 * that failed for some other reason.
 */
function isSessionTaken(error: string): boolean {
  return /session id .* is already in use/i.test(error)
}

/** A chat's name: the first thing asked, on one line and short enough for a tab
 * in a strip. */
function titleOf(text: string): string {
  const line = collapse(text)
  if (!line) return "Untitled"
  return line.length > 40 ? `${line.slice(0, 39)}…` : line
}
