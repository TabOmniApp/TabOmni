import { randomUUID } from "node:crypto"

import {
  chatOptions,
  type AssistantMessage,
  type ChatAskOption,
  type ChatAskQuestion,
  type ChatPermission,
  type ChatPlace,
  type WorktreeChat,
  type WorktreeChatAnswer,
  type WorktreeChatAsk,
  type WorktreeChatEvent,
  type WorktreeChatOptions,
} from "../shared/api"
import {
  collapse,
  lineId,
  runAgentTurn,
  summarise,
  type AgentRun,
  type AskDecision,
  type AskRequest,
} from "./claude-agent"

/**
 * A project's chats: one agent turn at a time, in that project's directory.
 *
 * **Why the app drives the CLI and does not read after it.** A session's chat
 * view tails the transcript the interactive CLI writes, and that is the right
 * shape for a session: the terminal and the chat are two views of one
 * conversation, and a permission prompt is answered in the terminal. A
 * a project's chat is not that. It is a conversation the app is *hosting* — its
 * own message model, its own composer, its own tool-call rows — and hosting one
 * means driving. `@anthropic-ai/claude-agent-sdk` is what it drives through,
 * which was `claude -p` and `--output-format stream-json` until the SDK could do
 * the one thing print mode could not: hand a permission request back to the
 * host. See `claude-agent.ts`.
 *
 * This is the **only** `claude` the app runs. There was a workspace assistant
 * beside it — one conversation, read-only, in no folder at all — and it was
 * removed; what `CLAUDE.md` has always refused is something else and still is:
 * features calling the CLI as a helper, an AI filter or an import button,
 * because a helper turn is a turn nobody asked for. This is a conversation
 * somebody is having.
 *
 * **What it may do, and why.** A chat runs in the user's own working tree,
 * which is the case the isolation argument does *not* cover: there was a
 * `git worktree` layer here — a checkout on a branch of its own, which is what
 * made pre-approving edits honest — and it is gone, so the default is `edits`
 * over the files the user is actually working in. Nothing claims otherwise: the
 * turn is told where it really is (`SYSTEM_PROMPT`), the caption under the
 * composer says the project, and the picker is the user's to set — `Plan` and
 * `Ask` are there for exactly this. Four of the five modes in `PERMISSIONS`
 * decide up front, because a mode that stops to ask was impossible until the
 * turn moved to the SDK. `ask` is the one that does, and in the other four a
 * prompt is still a turn that stalls — which is why they name their refusals
 * rather than leaving anything merely unlisted.
 *
 * The workspace's MCP servers are handed over, which is the thing no other
 * agent-in-an-editor has: the databases, the saved requests and the notes, in
 * the same conversation as the code: the config, the servers pre-approved,
 * a strict config so the user's own `claude` servers are not pulled into a
 * conversation this app is hosting, and two `delete_*` tools refused. See
 * `ALLOWED_TOOLS` and `DISALLOWED_TOOLS`.
 *
 * A server the user has configured in their own `claude` can be added to that
 * config from Settings › MCP — copied in by name, never inherited, which is
 * what keeps the strict flag meaning something. What one is to a turn is per
 * mode and is `withUserServers`, not a fourth thing to remember: pre-approved
 * where writing is, refused outright in the two read-only modes, and a card in
 * `ask`.
 *
 * **What the chat's own toolbar decides** is on the record rather than here:
 * `WorktreeChatOptions` is a model, an effort and a permission per chat, and a
 * turn is built from whatever it said when the message was sent. Only the last
 * of the three changes what a turn may do, and `PERMISSIONS` is the whole of
 * that — including why plan mode is a tool list and not `--permission-mode
 * plan`.
 */

/** One turn in flight, and the conversation it belongs to. */
type Live = {
  run: AgentRun | null
  /** Set while spawning, so a second send cannot start a second process before
   * the first has an `AgentRun` to kill. */
  starting: boolean
}

/**
 * The MCP config a turn is handed, and what is in it.
 *
 * The names come back beside the path because the two halves are answered in
 * different places and have to agree: `mcp.ts` writes the file, and this file
 * decides what a turn may call without asking. A config naming a server no tool
 * list mentions is the gap that was already fixed once for the workspace's own
 * three — the tools exist and the turn stalls trying to use them — so a server
 * added to the file has to arrive with its name attached.
 */
export type McpHandover = {
  /** The file `--mcp-config` is pointed at. */
  path: string
  /** The user's own servers written into it, by config name — `clickup` for
   * tools called `mcp__clickup__…`. Empty for a config holding only this app's
   * own three. */
  userServers: string[]
}

export type WorktreeChatSource = {
  /** The MCP config for the servers that are switched on, or null. */
  mcpConfig: () => Promise<McpHandover | null>
  /** The directory a project names, or null when it has left the workspace —
   * what a chat runs in. */
  folderDir: (folderId: string) => Promise<string | null>

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
 * The tool a turn asks a question with.
 *
 * Not a permission but a delivery mechanism: it reaches this app by *not* being
 * pre-approved, so the request comes through `canUseTool` and the questions
 * arrive with it. Which means it is only usable in the one mode that has a
 * `canUseTool` at all — `REFUSED_ASKING` is what keeps the other four from
 * reaching for something nobody there can answer.
 */
const ASK_TOOL = "AskUserQuestion"

/**
 * `AskUserQuestion` refused, for every mode that cannot answer it.
 *
 * Named rather than merely left off an allow list, for the reason every refusal
 * here is: an unlisted tool is *askable*, and in a mode with nobody to ask that
 * is a turn that stalls rather than one that gets on with it. A model told no
 * writes something instead of a question.
 */
const REFUSED_ASKING = [ASK_TOOL]

/**
 * The read-only half: everything that reads, and nothing that writes.
 *
 * What both `plan` and `read` run as — they differ in what the turn is *told*,
 * not in what it may do, since "describe the change" and "answer the question"
 * are the same permission and different requests.
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
const READ_TOOLS = [
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
 * Refused by both read-only modes, named rather than merely left off
 * `READ_TOOLS`.
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
const WRITE_REFUSED = [
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
 * The same tools as `PLAN_PROMPT` and a different request.
 *
 * Read-only without asking for a plan: somebody wanting to know where a
 * function is called does not want a numbered list of changes back, and a turn
 * told to plan will find something to propose whether or not it was asked.
 */
const READ_PROMPT =
  "This turn is read-only: answer the question, and do not modify anything. The editing tools and the shell are unavailable on purpose, so do not try them. Only lay out a plan of changes if that is what was asked for."

/**
 * What an asking turn is told, on top of `SYSTEM_PROMPT`.
 *
 * Said because the alternative is a model working around the prompts rather than
 * through them: one that finds a write refused and does not know a person is
 * reading will rephrase, retry, or settle for describing the change. Told that
 * somebody is there, it asks once and carries on.
 */
const ASK_PROMPT =
  "Reading is pre-approved here; writing a file or running a command will stop and ask the user, who is present and will answer. Go ahead and use those tools when the work needs them rather than working around them — a request is a short pause, not a refusal. Use AskUserQuestion when a choice is genuinely the user's to make."

/**
 * What each permission actually runs as.
 *
 * One table rather than a conditional per flag, because the five differ along
 * four axes at once — the tool list, the refusals, what the turn is told and
 * whether it may stop to ask — and a turn assembled from four separate ternaries
 * is one edit away from a mode that says `read` and allows `Bash`.
 *
 * `acceptEdits` for three of the five, the read-only pair included: the mode is
 * what stops the *permitted* tools stalling on a prompt nobody can answer, and
 * what makes those two read-only is the tool list. See `READ_TOOLS`.
 */
const PERMISSIONS: Record<
  ChatPermission,
  {
    /** Pre-approved. Undefined means nothing is pre-approved because nothing is
     * asked — only `full`, which is what its mode already says. */
    allowed?: string[]
    refused: string[]
    mode: string
    /** Appended to `SYSTEM_PROMPT`, when the mode is worth saying out loud. */
    prompt?: string
    /** Whether a turn may stop and put the question on screen. The one mode
     * that does is the reason `canUseTool` is wired at all. */
    asks?: boolean
    /** What a server switched on from the user's own `claude` config is to this
     * mode. See `withUserServers`. */
    userServers: "allow" | "refuse" | "ask"
  }
> = {
  plan: {
    allowed: READ_TOOLS,
    refused: [...WRITE_REFUSED, ...REFUSED_ASKING],
    mode: "acceptEdits",
    prompt: PLAN_PROMPT,
    userServers: "refuse",
  },
  read: {
    allowed: READ_TOOLS,
    refused: [...WRITE_REFUSED, ...REFUSED_ASKING],
    mode: "acceptEdits",
    prompt: READ_PROMPT,
    userServers: "refuse",
  },
  /*
   * The one that stops and asks.
   *
   * `manual` rather than `default`: the CLI's list of modes has no `default` any
   * more — it is `manual` for "prompt about everything" and `auto` for the
   * classifier — and the SDK passes whichever string it is given straight
   * through, so naming the one that is gone would fail the turn on the argument
   * list.
   *
   * `READ_TOOLS` is still pre-approved under it, which is the difference between
   * a mode somebody can work in and one that asks four times before it has
   * finished reading a file. So what actually reaches the screen is the writes,
   * the shell, and anything this app never listed — which is the set worth being
   * asked about.
   *
   * Nothing is refused except the workspace's two `delete_*`: in every other
   * mode a refusal is what a stall would otherwise be, and here there is
   * somebody to say no, so saying it up front would be taking their answer for
   * them. `AskUserQuestion` is left off both lists on purpose — being unlisted
   * is how the question gets here. See `ASK_TOOL`.
   */
  ask: {
    allowed: READ_TOOLS,
    refused: DISALLOWED_TOOLS,
    mode: "manual",
    prompt: ASK_PROMPT,
    asks: true,
    userServers: "ask",
  },
  edits: {
    allowed: ALLOWED_TOOLS,
    refused: [...DISALLOWED_TOOLS, ...REFUSED_ASKING],
    mode: "acceptEdits",
    userServers: "allow",
  },
  /*
   * Nothing is asked, including about tools this app never listed.
   *
   * `ALLOWED_TOOLS` is broad but it is still a list, and a turn that reaches
   * for something not on it — `BashOutput` after a background command, a skill,
   * a tool a newer CLI grew — meets a prompt, and in print mode that is a turn
   * that stalls. This is the escape hatch for exactly that, and it is a choice
   * somebody makes per chat rather than the default, because "no list at all"
   * should not be what a chat opens on.
   *
   * The two `delete_*` are still named. Whether `bypassPermissions` honours a
   * deny list is the CLI's business rather than this app's, so this is the one
   * mode where that refusal is a request and not a guarantee — which is what
   * picking `Full access` means and what its tooltip says.
   */
  full: {
    refused: [...DISALLOWED_TOOLS, ...REFUSED_ASKING],
    mode: "bypassPermissions",
    // Nothing to say: this is the mode with no allow list, and a refusal here
    // would be the one thing `Full access` promises not to do.
    userServers: "ask",
  },
}

/**
 * A mode's two tool lists, with the user's own servers folded in.
 *
 * Written as a function over the table rather than as more entries in it,
 * because what a third-party server is to a mode does not follow from the
 * mode's own lists: those name tools this app ships and knows the shape of, and
 * a server somebody added is a name with an unknown set behind it.
 *
 * - **`allow`** — pre-approved by server name, the way the `tabomni-*` three
 *   are, so a tool added to it later is covered without a release here.
 * - **`refuse`** — the read-only pair. The whole server goes, not some of it:
 *   nothing in a config file says which of `clickup`'s tools read and which
 *   file a ticket, and a read-only mode that lets a turn find out by calling one
 *   is not read-only. Named rather than left off `READ_TOOLS` for the reason
 *   every refusal here is named — unlisted is *askable*, and in a mode with
 *   nobody to ask that is a turn that stalls.
 * - **`ask`** — neither list, which is exactly how a question reaches the
 *   screen. In `ask` mode that is the point: the card comes up and somebody
 *   answers it. In `full` there is no allow list at all and nothing is asked.
 *
 * `allowed` stays undefined when the mode has none, since an empty array is a
 * list that allows nothing rather than the absence of one.
 */
export function withUserServers(
  permission: { allowed?: string[]; refused: string[]; userServers: string },
  servers: string[]
): { allowed?: string[]; refused: string[] } {
  const tools = servers.map((name) => `mcp__${name}`)
  if (tools.length === 0 || permission.userServers === "ask") {
    return { allowed: permission.allowed, refused: permission.refused }
  }
  return permission.userServers === "allow"
    ? {
        allowed: permission.allowed ? [...permission.allowed, ...tools] : tools,
        refused: permission.refused,
      }
    : {
        allowed: permission.allowed,
        refused: [...permission.refused, ...tools],
      }
}

/**
 * What the model is told about where it is.
 *
 * Short, because the CLI can see the working directory for itself. What it
 * cannot see is what the `tabomni-*` tools are attached to: a tool
 * list says what a tool does, not that the databases and requests it reaches
 * belong to the workspace this checkout is part of.
 */
const WORKSPACE_PROMPT =
  "The workspace's databases, saved HTTP requests and notes are the `tabomni-*` MCP tools, and they belong to the whole workspace rather than to this directory; prefer them over guessing."

/**
 * What the turn is told it is in, and what that costs it.
 *
 * There is exactly one kind of place now: the project's own working tree. There
 * were two while chats could be in a `git worktree` checkout, and the sentence
 * that differed was a *claim* — "edits here cannot disturb the branch you have
 * checked out elsewhere" — which is false here and is the one line worth
 * getting right, since it decides how freely a turn reaches for `Bash` and how
 * much it bothers to ask.
 */
const SYSTEM_PROMPT = [
  "You are a chat in a project inside TabOmni, a desktop studio: this directory is the user's own working tree on whatever branch they have checked out, so edits and commands here change the files they are working in. There is no isolation to fall back on — prefer the smallest change that does the job, and say what you are about to do before doing anything wide-reaching.",
  WORKSPACE_PROMPT,
].join(" ")

export class WorktreeChats {
  /** A turn per chat, keyed by chat id. Several chats can be answering at once,
   * which is the point of keying everything here by chat id. */
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

  /**
   * Questions a turn has stopped on, keyed by ask id.
   *
   * By ask rather than by chat, even though a chat has one at a time: an answer
   * names the question it is answering, so a card left on screen after its
   * question was withdrawn cannot decide the next one. `answered` is what the
   * turn is waiting on — calling it is what lets the CLI move.
   *
   * In memory only. What is on the other end is a held tool call in a running
   * process, so there is nothing about it worth writing down: a reload loses the
   * question, and the turn is ended with Stop.
   */
  private readonly asks = new Map<
    string,
    {
      /** Kept beside the resolver so the line recording the decision can say
       * what was decided *about*: an answer on its own is a bare "Allowed". */
      ask: WorktreeChatAsk
      answered: (decision: AskDecision) => void
    }
  >()

  constructor(
    private readonly source: WorktreeChatSource,
    private readonly emit: (event: WorktreeChatEvent) => void
  ) {}

  list(): Promise<WorktreeChat[]> {
    return this.source.chats()
  }

  /**
   * A new, empty chat in a project's own working tree.
   *
   * Made up front rather than on the first message, because the row has to exist
   * for somebody to type into: the tab is opened by clicking `+`, and a tab that
   * only appears once you have said something is a `+` that does nothing.
   */
  async create(place: ChatPlace): Promise<WorktreeChat> {
    const now = new Date().toISOString()
    const chat: WorktreeChat = {
      id: randomUUID(),
      folderId: place.folderId,
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

  async send(id: string, prompt: string): Promise<void> {
    const existing = this.live.get(id)
    if (existing?.starting || existing?.run) {
      throw new Error("That chat is still answering.")
    }

    const chats = await this.source.chats()
    const chat = chats.find((entry) => entry.id === id)
    if (!chat) throw new Error("That chat no longer exists.")

    /*
     * The chat's own project, and nothing else.
     *
     * No fallback chain: a chat whose folder has left the workspace has nowhere
     * to run, and the nearest directory that happens to be readable is not it —
     * a turn landing in a project this chat was never pointed at, with edits
     * pre-approved, is a diff nobody asked for.
     */
    const cwd = chat.folderId
      ? await this.source.folderDir(chat.folderId)
      : null
    if (!cwd) {
      // The place has gone out from under the chat. The conversation is still
      // readable — it is on disk — but there is nowhere to run a turn.
      this.finish(id, "That project is no longer in the workspace.")
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
      // and a turn takes whatever it said when the message was sent. Through
      // `chatOptions`, which is where a record older than either field is
      // brought up to date.
      chatOptions(chat.options),
      SYSTEM_PROMPT
    )
  }

  /**
   * A turn has stopped on something. Put it on screen and wait.
   *
   * The promise this returns *is* the pause: the CLI is holding the tool call
   * until it settles, and nothing on this side times it out — somebody has to
   * read the question, and a question that answered itself after thirty seconds
   * would be this app deciding.
   *
   * Two shapes out of one callback, because the CLI asks two different things
   * through it: `AskUserQuestion` is the model asking the user to choose, and
   * everything else is the model asking to be allowed. They are told apart by
   * tool name, which is the only thing that distinguishes them.
   */
  private ask(chatId: string, request: AskRequest): Promise<AskDecision> {
    const id = randomUUID()
    const questions =
      request.toolName === ASK_TOOL ? asked(request.input) : null

    const ask: WorktreeChatAsk = questions
      ? { id, chatId, kind: "questions", questions }
      : {
          id,
          chatId,
          kind: "tool",
          // The CLI's own sentence when there is one, and `titleFor` otherwise
          // — which is most of the time, so it is not really a fallback.
          title: request.title ?? titleFor(request.toolName, request.input),
          name: request.toolName,
          summary: summarise(request.input),
          always: request.canRemember,
        }

    return new Promise<AskDecision>((resolve) => {
      const settle = (decision: AskDecision) => {
        if (!this.asks.delete(id)) return
        resolve(decision)
      }

      this.asks.set(id, { ask, answered: settle })
      // The turn ending under a question — Stop, or the process dying — leaves
      // the CLI with nothing to receive an answer, so the wait has to end too or
      // this promise is held for the life of the app.
      request.signal.addEventListener("abort", () =>
        settle({ allow: false, message: "The turn was stopped." })
      )
      this.emit({ chatId, type: "ask", ask })
    })
  }

  /**
   * What the user said, back to the turn that is waiting.
   *
   * Silent about an id nothing is waiting on: a card can be answered twice — a
   * click and the keyboard, or a window that had not yet heard the turn was
   * stopped — and the second one has nothing left to decide.
   *
   * The decision is written into the conversation before it is handed over,
   * which is the part worth keeping: the question is gone once it is answered,
   * and a transcript that shows a turn editing a file with no sign of anybody
   * allowing it is a transcript that is missing the reason.
   */
  answer(askId: string, answer: WorktreeChatAnswer): void {
    const pending = this.asks.get(askId)
    if (!pending) return

    void this.append(pending.ask.chatId, {
      id: lineId(),
      role: "ask",
      text: said(pending.ask, answer),
    })
    pending.answered(decided(answer))
  }

  /**
   * The model, effort and permission for one chat.
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
    options: WorktreeChatOptions,
    /** Which of `SYSTEM_PROMPTS` this place is. Handed in rather than read off
     * the record again, so the retry below cannot pick the other one. */
    system: string
  ): Promise<void> {
    // Falls back rather than trusting the record: options come off disk, and a
    // chat written by a newer build naming a mode this one has never heard of
    // would otherwise run with `undefined` for the whole argument list.
    const permission = PERMISSIONS[options.permission] ?? PERMISSIONS.edits

    // The config and the tool lists out of one read, so the servers written
    // into the file are the ones the lists were built from. Asked per turn
    // rather than held, because Settings can be changed between two messages in
    // the same chat.
    const mcp = await this.source.mcpConfig()
    const tools = withUserServers(permission, mcp?.userServers ?? [])

    const run = await runAgentTurn(
      {
        cwd,
        prompt,
        sessionId: id,
        resume,
        // Both null unless the toolbar says otherwise, which leaves the user's
        // own `claude` deciding — see `AgentTurn`.
        model: options.model,
        effort: options.effort,
        // Every one of these four out of one entry, so a turn cannot be
        // assembled half in one mode and half in another. See `PERMISSIONS`.
        allowedTools: tools.allowed,
        disallowedTools: tools.refused,
        permissionMode: permission.mode,
        // Strict, still: what is in that file is what this app put there — its
        // own servers, plus whichever of the user's `claude` servers Settings
        // switched on. Nothing is inherited from the directory the CLI happens
        // to be started in. See `user-mcp.ts`.
        mcpConfig: mcp?.path ?? null,
        strictMcp: true,
        appendSystemPrompt: permission.prompt
          ? `${system} ${permission.prompt}`
          : system,
        // Only where the mode says so, and its absence is what stops the other
        // four ever pausing: handing this over is what makes the CLI ask.
        ...(permission.asks
          ? { onAsk: (request: AskRequest) => this.ask(id, request) }
          : {}),
      },
      {
        onMessage: (message) => void this.append(id, message),
        onToolResult: (toolId, result, failed) =>
          this.recordResult(id, toolId, result, failed),
        // A line like any other, so it is written down and read back with the
        // rest of the conversation rather than held for the window that
        // happened to be open when the turn ended.
        onUsage: (usage) =>
          void this.append(id, { id: lineId(), role: "usage", usage }),
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
            void this.run(id, cwd, prompt, true, options, system)
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
    // Only once the CLI is actually up: `runAgentTurn` hands back null when it
    // could not be started at all, and a session the CLI never opened must not
    // be resumed on the next try. It resolves on the CLI's first message rather
    // than on the call returning, because `query()` is lazy — see its comment.
    if (run) await this.markStarted(id)

    /*
     * Only on success, and only while the turn is still running.
     *
     * A turn that could not be started has already been finished by `onDone`,
     * and putting a dead entry back would leave the chat looking busy to the
     * next `send` — for ever, since nothing else clears it. `finish` deletes the
     * entry `send` put there, so its absence is the test.
     *
     * Both halves matter now in a way only the first used to: this resolves once
     * the CLI is *talking*, and the `markStarted` above is a file write, so a
     * short turn can reach its result while that write is in flight. Before the
     * SDK this returned before the process had said anything, which made the
     * same race a much narrower one.
     */
    if (run && this.live.has(id)) this.live.set(id, { run, starting: false })
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
    // Nothing is going to answer these now, and each one is a promise a turn is
    // still awaiting — see `asks`.
    for (const pending of [...this.asks.values()]) {
      pending.answered({ allow: false, message: "The app is closing." })
    }
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
    /*
     * Any question this chat was holding goes with the turn.
     *
     * Belt and braces beside the abort listener in `ask`: that fires when the
     * SDK's own signal trips, and this covers the ends that do not go through
     * it — a result that arrived while a request was outstanding, a process that
     * died. An entry left here would be a card on screen answering into
     * nothing, and `answer` would write a decision line for a turn that is over.
     */
    for (const pending of [...this.asks.values()]) {
      if (pending.ask.chatId !== id) continue
      // `answered` is what removes the entry — deleting it here first would
      // trip its own once-only guard and leave the promise unresolved.
      pending.answered({ allow: false, message: "The turn ended." })
    }

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
  /**
   * What a tool call came back with, onto the line that call already wrote.
   *
   * **Synchronous over the held lines, and only those.** Every other write here
   * is a read-modify-write with an `await` in the middle, and that is safe for
   * an append because the store's queue serialises the files; it is not safe for
   * a change to a line the same turn is appending after. Between a turn's first
   * message and its last the lines are in memory by definition — `append` put
   * them there — so a patch that finds nothing held is a patch for a chat no
   * turn is running in, which is a result for a call that cannot still be
   * outstanding.
   *
   * A call whose line has no `toolId` is left alone: that is a line written
   * before ids existed, read back off disk, and there is nothing to match it by.
   */
  private recordResult(
    id: string,
    toolId: string,
    result: string,
    failed: boolean
  ): void {
    const messages = this.messages.get(id)
    if (!messages) return

    let found = false
    const next = messages.map((line) => {
      if (found || line.role !== "tool" || line.toolId !== toolId) return line
      found = true
      return { ...line, result, failed }
    })
    if (!found) return
    this.messages.set(id, next)

    this.emit({ chatId: id, type: "tool-result", toolId, result, failed })

    // Written without awaiting, like the line itself: losing the record of what
    // a tool returned is not worth abandoning a turn over.
    void this.source.writeChat(id, next).catch((error: unknown) => {
      console.error("Could not write the chat", error)
    })
  }

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
              toolId: message.toolId,
              title: message.title,
              path: message.path,
              stat: message.stat,
              change: message.change,
            }
          : message.role === "error"
            ? { chatId: id, type: "done", error: message.text }
            : message.role === "ask"
              ? { chatId: id, type: "decision", text: message.text }
              : message.role === "thinking"
                ? { chatId: id, type: "thinking", text: message.text }
                : message.role === "usage"
                  ? { chatId: id, type: "usage", usage: message.usage }
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
 * What the card says a turn is trying to do.
 *
 * The SDK documents a rendered `title` and in practice does not send one for a
 * plain SDK run — it comes from the bridge the interactive CLI uses — so this is
 * what somebody actually reads before deciding, not a fallback that never fires.
 * Which is why it is a sentence per tool rather than the tool's name: "Claude
 * wants to use Bash" over a card, with the command on the line below, asks
 * somebody to work out what they are being asked.
 *
 * A verb per tool this app pre-approves *anywhere*, because those are the ones
 * that can reach here; anything else gets its name, which is the honest answer
 * for a tool this app has never heard of.
 */
export function titleFor(tool: string, input: Record<string, unknown>): string {
  const named = (key: string) => {
    const value = input[key]
    return typeof value === "string" && value.trim() ? collapse(value) : null
  }

  const path = named("file_path") ?? named("path") ?? named("notebook_path")
  switch (tool) {
    case "Bash":
      return `Claude wants to run ${named("command") ?? "a command"}`
    case "Write":
      return `Claude wants to create ${path ?? "a file"}`
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `Claude wants to edit ${path ?? "a file"}`
    case "Read":
      return `Claude wants to read ${path ?? "a file"}`
    case "WebFetch":
      return `Claude wants to fetch ${named("url") ?? "a page"}`
    case "WebSearch":
      return `Claude wants to search the web for ${named("query") ?? "something"}`
    default:
      return `Claude wants to use ${tool}`
  }
}

/**
 * The questions out of an `AskUserQuestion` call, or null.
 *
 * Null for anything that does not have them, which is what makes the call a
 * permission request instead: the tool name says which kind it is, and this says
 * whether the payload agrees. A newer CLI that changes the shape lands here
 * rather than in the pane.
 */
export function asked(
  input: Record<string, unknown>
): ChatAskQuestion[] | null {
  const questions = Array.isArray(input.questions) ? input.questions : []
  const read = questions.flatMap((entry): ChatAskQuestion[] => {
    const question = entry as Record<string, unknown>
    const options = Array.isArray(question.options) ? question.options : []
    if (typeof question.question !== "string" || options.length === 0) return []

    return [
      {
        question: question.question,
        header:
          typeof question.header === "string"
            ? question.header
            : question.question,
        options: options.flatMap((value): ChatAskOption[] => {
          const option = value as Record<string, unknown>
          if (typeof option.label !== "string") return []
          return [
            {
              label: option.label,
              description:
                typeof option.description === "string"
                  ? option.description
                  : "",
            },
          ]
        }),
        multiSelect: question.multiSelect === true,
      },
    ]
  })

  // A question with no answerable option is not a question: it would draw a
  // card with nothing to click, and the turn would wait for ever.
  return read.some((question) => question.options.length > 0) ? read : null
}

/**
 * The answer, as the SDK wants it back.
 *
 * `AskUserQuestion` is answered by **allowing the call with the answers written
 * into its input** — an odd shape until you notice it is the same channel a
 * permission travels down, so the tool "runs" with what the user picked. The
 * original questions have to go back with it, which the SDK is explicit about.
 *
 * The labels are joined rather than passed as an array: a single-select question
 * wants one string, and joining a one-element list gives exactly that, so there
 * is one path instead of a branch on `multiSelect` that could disagree with the
 * one in the pane.
 */
export function decided(answer: WorktreeChatAnswer): AskDecision {
  if (answer.kind === "allow") {
    return { allow: true, remember: answer.always === true }
  }
  if (answer.kind === "deny") {
    return {
      allow: false,
      // Read by the model, which is the point: "no" on its own invites another
      // attempt at the same thing.
      message:
        "The user declined this. Do not try it again; say what you would need instead, or carry on with the rest of the work.",
    }
  }
  return {
    allow: true,
    input: {
      answers: Object.fromEntries(
        Object.entries(answer.answers).map(([question, labels]) => [
          question,
          labels.join(", "),
        ])
      ),
    },
  }
}

/**
 * The line a decision leaves in the conversation.
 *
 * Written for somebody reading the chat back later, so it names the thing rather
 * than the mechanism: what was allowed, what was refused, what was chosen. The
 * pane draws it as a note rather than as anybody's message, because it is
 * neither side speaking.
 */
export function said(ask: WorktreeChatAsk, answer: WorktreeChatAnswer): string {
  if (ask.kind === "questions") {
    if (answer.kind !== "answers") return "Question dismissed"
    return ask.questions
      .map((question) => {
        const picked = answer.answers[question.question] ?? []
        return `${question.header}: ${picked.join(", ") || "no answer"}`
      })
      .join(" · ")
  }

  const what = ask.summary ? `${ask.name}: ${ask.summary}` : ask.name
  if (answer.kind === "deny") return `Refused ${what}`
  // `always` only reads as "remembered" where there was a rule to remember —
  // see `WorktreeChatAsk.always`.
  const remembered = answer.kind === "allow" && answer.always && ask.always
  return remembered
    ? `Allowed ${what}, and will not ask again`
    : `Allowed ${what}`
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
