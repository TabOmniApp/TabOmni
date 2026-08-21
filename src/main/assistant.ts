import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import path from "node:path"

import type {
  AssistantChat,
  AssistantEvent,
  AssistantMessage,
} from "../shared/api"
import { agentCommand } from "./agent-tools"
import { dataDir } from "./data-dir"
import { environment, locate } from "./shell-env"

/**
 * The workspace assistant: one conversation, `claude -p` per turn.
 *
 * **Why this is not a Terminal session.** A session is the interactive CLI in a
 * pty, and a pty has a working directory — which makes every session a
 * conversation about one folder. The MCP servers are about the *workspace*: its
 * databases, its saved requests, its notes belong to no folder in particular, so
 * asking about them from inside a folder's session is the wrong shape. This is
 * the other shape: a chat beside the workbench rather than inside a repository.
 * It runs in an empty directory of the app's own and reaches every folder in the
 * workspace through `--add-dir`, so no folder is the one it is "in" — see
 * `assistantDir` for why every directory that already existed was the wrong
 * answer.
 *
 * **Print mode, and what that costs.** `claude -p` is a process per turn, so
 * there is nothing to reattach to and nothing to interrupt except a kill.
 * Continuity is the CLI's own: this holds a session id, passes `--session-id`
 * on the first turn and `--resume` afterwards, and the CLI writes the same
 * transcript file it would for a session — which is also why a conversation
 * survives a reload of the window while the app is up.
 *
 * There were `claude -p` one-shots in this app before, behind an `askClaude`
 * that the Data tab's AI filter and the API panel's AI import both went
 * through, and all of it was deleted rather than left hidden. This is not that
 * helper coming back: it is one long-lived conversation the user is talking to,
 * with a panel of its own, and nothing else in the app calls it.
 *
 * **Held here, not in the renderer.** The panel closes, the window reloads, a
 * turn takes a minute: none of those should end the turn or lose the thread. So
 * the process, the session id and the transcript belong to the main process and
 * the panel is a view of the events.
 *
 * **Chats are kept**, listed in `chats.json` with their lines in
 * `chats/<id>.json` — the split the notes have, so sending a message rewrites
 * one chat rather than all of them. Written here rather than by the panel
 * because this is what sees every event: a reply that arrived while the panel
 * was closed is still in the chat when it is opened again. Deleting one takes
 * its lines with it and leaves the CLI's own transcript alone, which is a
 * conversation on disk like any other.
 */

/**
 * What the assistant may use without being asked: the workspace's own tools,
 * and reading.
 *
 * Naming a server rather than its tools covers whatever that server offers,
 * including tools added to it later. `ToolSearch` is in here because a CLI
 * configured to defer tools reaches an MCP tool through it, and being asked to
 * approve a search for a tool is a prompt nobody can answer in print mode.
 */
const ALLOWED_TOOLS = [
  "mcp__tabomni-database",
  "mcp__tabomni-api",
  "mcp__tabomni-notes",
  "Read",
  "Glob",
  "Grep",
  "ToolSearch",
]

/**
 * What it may not use at all.
 *
 * This is the list that matters, and it is a *deny* list because the CLI has no
 * allow-only mode: `--allowed-tools` says "do not ask about these", not "refuse
 * everything else". Asked to write a file, a print-mode turn with only an
 * allowlist went ahead and wrote it — there is nobody to prompt, and the absence
 * of a prompt is not the absence of permission.
 *
 * A chat window beside the workbench answers questions about the workspace.
 * Everything that changes something outside this conversation is refused here:
 * running commands, editing files, git worktrees, scheduled runs, notifications,
 * anything that reaches the network or another agent. Editing and running is
 * what the Terminal panel is for, where the session is interactive and can be
 * watched and answered.
 *
 * The workspace's own panels are the exception, and always were — a note
 * written or a request saved through the MCP servers lands in a panel the user
 * is looking at, which is the point of the thing. The two deletions are back on
 * the list, though; see the note beside them.
 *
 * What is left over is reading — `Read`, `Glob`, `Grep`, `LSP` — plus the
 * workspace's own MCP tools. Being a deny list, it is worth re-reading against
 * `claude --help` when the CLI gains tools: the way to see what a turn actually
 * has is the `tools` array on its first `system` line.
 */
const DISALLOWED_TOOLS = [
  // Running things.
  "Bash",
  "BashOutput",
  "KillShell",
  "Monitor",
  "Skill",
  "SlashCommand",
  "Task",
  // Changing things.
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "EnterWorktree",
  "ExitWorktree",
  "DesignSync",
  "Artifact",
  "ShareOnboardingGuide",
  // Reaching outside this machine, or outside this turn.
  "WebFetch",
  "WebSearch",
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
  "PushNotification",
  "RemoteTrigger",
  "SendMessage",
  "ListAgents",
  // Deleting somebody's saved requests. The rest of the workspace's own MCP
  // tools are allowed above and stay allowed — writing a note or saving a
  // request is what this panel is for, and the panel it lands in is right
  // there. These two are the ones with nothing to undo them: the API panel has
  // no trash, `delete_folder` takes the requests inside with it, and a print
  // turn has nobody to ask. Ask for a request to be deleted in a Terminal
  // session, where the CLI prompts and the answer is yours.
  "mcp__tabomni-api__delete_request",
  "mcp__tabomni-api__delete_folder",
]

/**
 * The directory the turn runs in: an empty one of the app's own.
 *
 * A process has to have a directory, and every candidate that already existed
 * was wrong. The first workspace folder is what this used to use, and it made
 * the assistant answer "I am working in ~/code/that-one" — which is the exact
 * thing the panel exists not to be, a conversation about one repository. The
 * data directory itself is worse: `Read` is allowed, and `manifest.json` is in
 * there.
 *
 * So it is an empty directory, created on demand, holding nothing. The folders
 * arrive as `--add-dir` instead, none of them privileged over the others, and
 * the CLI's transcripts for these chats land under a project of their own
 * rather than mixed into a repository's.
 */
function assistantDir(): string {
  return path.join(dataDir(), "assistant")
}

/**
 * What the model is told about where it is.
 *
 * Without this the CLI's own answer to "which folder are you working in?" is
 * the empty directory above, which is true and useless. It is also the only
 * place the workspace's shape can be stated: the panels are MCP tools, and a
 * tool list says what a tool does, not what the thing it belongs to *is*.
 */
function systemPrompt(folders: string[]): string {
  return [
    "You are the workspace assistant inside TabOmni, a desktop studio.",
    "You have no working directory: this process runs in an empty scratch directory that holds nothing and is not a project.",
    "Never describe yourself as working in, or being in, a folder — you are attached to a workspace, which is a set of folders none of which is current.",
    folders.length > 0
      ? `Those folders are readable, and equally so: ${folders.join(", ")}.`
      : "The workspace has no folders added yet, so there are no files to read.",
    "The workspace's databases, saved HTTP requests and notes are the `tabomni-*` MCP tools; prefer them over guessing.",
    "You cannot run commands or change files. Say so plainly if asked, and suggest a Terminal session in the app instead.",
  ].join(" ")
}

/** What the assistant needs from the rest of the app, injected the way
 * `NoteSource` and `McpSource` are. */
export type AssistantSource = {
  /** The MCP config for the servers that are switched on, or null. */
  mcpConfig: () => Promise<string | null>
  /** Every folder the workspace is pointed at, in order. Empty is allowed: the
   * assistant is about the workspace's own panels, which exist without one. */
  folders: () => Promise<string[]>

  chats: () => Promise<AssistantChat[]>
  saveChats: (chats: AssistantChat[]) => Promise<void>
  readChat: (id: string) => Promise<AssistantMessage[]>
  writeChat: (id: string, messages: AssistantMessage[]) => Promise<void>
  deleteChat: (id: string) => Promise<void>
}

export class Assistant {
  private child: ChildProcess | null = null
  /**
   * The chat being talked to, or null when the next message starts one.
   *
   * The id is minted here rather than taken from the CLI so that the first turn
   * already has one — `--session-id` on the first call and `--resume` after it,
   * the same pair `agent-tools.ts` chooses between for a session. It is also the
   * chat's id, so the record and the CLI's transcript name the same thing.
   */
  private chatId: string | null = null
  /** Whether this chat has been started with the CLI yet. A chat reopened from
   * disk has, which is what makes the next message `--resume` rather than a
   * `--session-id` the CLI would refuse as already used. */
  private started = false
  /** The chat's lines, held so a turn's events can be appended and written
   * without reading the file back on every one of them. */
  private messages: AssistantMessage[] = []

  constructor(
    private readonly source: AssistantSource,
    private readonly emit: (event: AssistantEvent) => void
  ) {}

  /** Whether a turn is in flight. */
  get busy(): boolean {
    return this.child !== null
  }

  chats(): Promise<AssistantChat[]> {
    return this.source.chats()
  }

  /** Puts the assistant back on a chat, and hands over what was said in it. */
  async open(id: string): Promise<AssistantMessage[]> {
    if (this.child) throw new Error("The assistant is still answering.")

    this.chatId = id
    this.started = true
    this.messages = await this.source.readChat(id)
    return this.messages
  }

  /** Leaves whichever chat is open: the next message starts a new one. */
  new(): void {
    if (this.child) this.stop()
    this.chatId = null
    this.started = false
    this.messages = []
  }

  async delete(id: string): Promise<AssistantChat[]> {
    if (this.chatId === id) this.new()

    const left = (await this.source.chats()).filter((chat) => chat.id !== id)
    await this.source.saveChats(left)
    // After the listing, not before: a chat whose lines are gone but which is
    // still listed is a row that opens onto nothing.
    await this.source.deleteChat(id)
    return left
  }

  async send(prompt: string): Promise<void> {
    if (this.child) throw new Error("The assistant is still answering.")

    const command = agentCommand("claude")
    // The same lookup the session picker's status uses: a GUI app inherits
    // almost none of the user's PATH, so where `claude` is has to be asked of
    // their own login shell rather than of `process.env`.
    const binary = command ? await locate(command) : null
    if (!binary) {
      this.emit({
        type: "done",
        error:
          "Claude Code is not installed, or not on the PATH your shell gives it. Install it with: npm install -g @anthropic-ai/claude-code",
      })
      return
    }

    const [mcpConfig, folders] = await Promise.all([
      this.source.mcpConfig(),
      this.source.folders(),
    ])

    await this.record({ id: lineId(), role: "user", text: prompt })

    const args = [
      "-p",
      prompt,
      // One JSON object per line, which is what makes a reply arrive a message
      // at a time rather than in one lump at the end. `--verbose` is not
      // optional: the CLI refuses the streaming format in print mode without
      // it.
      "--output-format",
      "stream-json",
      "--verbose",
      "--allowed-tools",
      ALLOWED_TOOLS.join(","),
      "--disallowed-tools",
      DISALLOWED_TOOLS.join(","),
      ...(this.started
        ? ["--resume", this.chatId!]
        : ["--session-id", this.chatId!]),
      // Strictly this workspace's servers, unlike a Terminal session, which
      // keeps whatever the user has configured for themselves. A session is
      // their `claude`; this panel is the app's, and every extra server on it
      // is a tool the model has to sift through to reach the three that are the
      // point of the panel — the user's own were most of a hundred of them.
      ...(mcpConfig ? ["--mcp-config", mcpConfig, "--strict-mcp-config"] : []),
      // Every folder in the workspace, none of them the directory the process
      // runs in — this conversation is not about a repository.
      ...folders.flatMap((folder) => ["--add-dir", folder]),
      "--append-system-prompt",
      systemPrompt(folders),
    ]

    const cwd = assistantDir()
    // Created rather than assumed: the CLI refuses to start in a directory that
    // is not there, and this one belongs to nobody until the first question.
    await mkdir(cwd, { recursive: true })

    const child = spawn(binary, args, {
      cwd,
      // No shell: the prompt is one argument and a shell would make the user's
      // own words part of a command line.
      shell: false,
      env: environment(),
      stdio: ["ignore", "pipe", "pipe"],
    })
    this.child = child
    // From here the CLI owns this id, so the next turn resumes it rather than
    // asking for it again — including a turn that comes after a failed one.
    this.started = true

    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      // Kept rather than reported as it arrives: the CLI writes warnings here
      // on a turn that goes on to succeed, and only a failing exit makes them
      // worth showing.
      stderr = (stderr + chunk.toString("utf8")).slice(-4000)
    })

    this.read(child)

    child.on("error", (error) => {
      this.child = null
      this.emit({ type: "done", error: error.message })
    })

    child.on("close", (code) => {
      // A kill is the user's own Stop; it has already been reported.
      const stopped = this.child === null
      this.child = null
      if (stopped) return
      // `result` normally reports the end of the turn; this is the case where
      // the process died before writing one.
      if (code !== 0) {
        this.emit({
          type: "done",
          error: stderr.trim() || `claude exited with code ${code}`,
        })
      }
    })
  }

  stop(): void {
    const child = this.child
    if (!child) return
    this.child = null
    child.kill("SIGTERM")
    this.emit({ type: "done", error: null })
  }

  /** Kills a turn in flight, for shutdown. */
  async dispose(): Promise<void> {
    this.child?.kill("SIGTERM")
    this.child = null
  }

  /**
   * Appends one line to the chat and writes it down.
   *
   * The listing is touched on the same pass: a chat's first user line is also
   * its title and the moment it becomes a row in the panel, and every line
   * afterwards moves it up the list. Fire-and-forget at the call sites — a
   * failed write costs the record of a line, and a turn is not worth abandoning
   * over one; the writes are serialised by the store's own queue, so the file
   * cannot be interleaved.
   */
  private async record(message: AssistantMessage): Promise<void> {
    const id = (this.chatId ??= randomUUID())
    this.messages = [...this.messages, message]

    try {
      await this.source.writeChat(id, this.messages)

      const chats = await this.source.chats()
      const now = new Date().toISOString()
      const existing = chats.find((chat) => chat.id === id)
      const updated: AssistantChat = existing
        ? { ...existing, updatedAt: now }
        : {
            id,
            title: title(message),
            createdAt: now,
            updatedAt: now,
          }
      await this.source.saveChats([
        updated,
        ...chats.filter((chat) => chat.id !== id),
      ])
    } catch (error) {
      console.error("Could not write the chat", error)
    }
  }

  /** Reads the CLI's newline-delimited JSON, a whole line at a time. */
  private read(child: ChildProcess): void {
    let pending = ""

    child.stdout?.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8")

      // A read can land mid-line, and one line can be a long message: what is
      // left over waits for the next chunk rather than being parsed and
      // dropped.
      let newline = pending.indexOf("\n")
      while (newline !== -1) {
        const line = pending.slice(0, newline).trim()
        pending = pending.slice(newline + 1)
        if (line) this.line(line)
        newline = pending.indexOf("\n")
      }
    })
  }

  private line(line: string): void {
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line) as Record<string, unknown>
    } catch {
      // Not a crash: the CLI prints the odd un-tagged line, and a turn is not
      // worth failing over one of them.
      return
    }

    if (event.type === "assistant") {
      const message = event.message as { content?: unknown } | undefined
      for (const block of asArray(message?.content)) {
        if (block.type === "text" && typeof block.text === "string") {
          if (block.text.trim()) {
            void this.record({
              id: lineId(),
              role: "assistant",
              text: block.text,
            })
            this.emit({ type: "text", text: block.text })
          }
        }
        if (block.type === "tool_use" && typeof block.name === "string") {
          const tool = {
            id: lineId(),
            role: "tool" as const,
            name: block.name,
            summary: summarise(block.input),
          }
          void this.record(tool)
          this.emit({ type: "tool", name: tool.name, summary: tool.summary })
        }
      }
      return
    }

    if (event.type === "result") {
      const failed = event.is_error === true || event.subtype !== "success"
      this.child = null
      const error = failed
        ? typeof event.result === "string" && event.result.trim()
          ? event.result
          : `The turn ended as "${String(event.subtype)}".`
        : null

      if (error) void this.record({ id: lineId(), role: "error", text: error })
      this.emit({ type: "done", error })
    }
  }
}

let lines = 0

/** An id for one line of a chat, unique within this run. Not a UUID: it never
 * leaves the chat's own file and is only there so a list can be keyed. */
function lineId(): string {
  return `l${(lines += 1)}`
}

/** A chat's name: the first thing asked, on one line and short enough for a
 * row in a narrow panel. */
function title(first: AssistantMessage): string {
  const text = "text" in first ? first.text : "Chat"
  const collapsed = collapse(text)
  return collapsed.length > 60 ? `${collapsed.slice(0, 59)}…` : collapsed
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
}

/**
 * One line describing what a tool was called with.
 *
 * The panel draws a tool call as a single row, so this is the row: the argument
 * that says which thing it was about — a statement, a request's name, a path —
 * rather than the whole input, which for a query is longer than the answer.
 */
function summarise(input: unknown): string {
  if (typeof input !== "object" || input === null) return ""
  const record = input as Record<string, unknown>

  for (const key of [
    "sql",
    "request",
    "note",
    "database",
    "file_path",
    "pattern",
    "name",
  ]) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) {
      return collapse(value)
    }
  }
  return collapse(JSON.stringify(record))
}

function collapse(text: string): string {
  const line = text.replaceAll(/\s+/g, " ").trim()
  return line.length > 120 ? `${line.slice(0, 119)}…` : line
}
