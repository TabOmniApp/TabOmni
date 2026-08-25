# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**TabOmni**: an Electron studio that collapses a project's tooling into one tab
strip — its folders, its databases, its HTTP endpoints, its notes, and the agent
conversations run against them. The premise is that those are four or
five separate applications today, each with a window layout of its own, and
that switching between them costs more than any one of them saves.

There is one **workspace**, holding any number of **folders** — directories
already on this machine, worked on where they are. It is deliberately not
switchable: someone working across a frontend and its API has two folders open
at once, and a switch would take one of them, and every tab opened
against it, off the screen. Databases, requests, cookies and notes belong to
the workspace; what is per folder is what is genuinely per
repository — a shell's cwd, a run command and a branch name. Sign-in will bring a
second workspace; until then `DEFAULT_WORKSPACE_ID` is a constant.

One package, no workspaces. `src/main/` is the Electron main process,
`src/preload/` the one bridge script, `src/renderer/` the React app, and
`src/shared/` the contract between the two. The shadcn/ui components live in
`src/renderer/components/ui/` like any other component.

`docs/design.md` is the design document for the app itself — how the
workspace's data lives on disk, how the Claude Code chat view works, how the
filter builder and the note preview behave. Read it before changing those
areas.

## Commands

```bash
bun install
bun run dev      # scripts/dev.mjs: esbuild main, start Vite, launch Electron at it
bun run test     # `bun test` is Bun's own runner and would find nothing
bun run lint
bun run typecheck
bun run build    # bundle main/preload/daemon + vite build the renderer
bun run format   # prettier over the whole repo; format:check is what CI runs
```

`typecheck` runs three TypeScript projects, because the three environments do
not share globals: `tsconfig.main.json` (Node), `tsconfig.renderer.json` (DOM),
and `tsconfig.test.json`, which is the one that sees both.

A `Makefile` wraps the packaging targets — `make dmg` (this machine's arch),
`make dmg-arm64` / `dmg-x64` / `dmg-universal`, `make app` (unpacked `.app`,
faster for a smoke test), `make help` for the rest. Builds are unsigned unless
`SIGN=1`. `bun run package` does the same via electron-builder.

### Tests

Plain `bun` scripts under `test/`, no test framework — see
`test/harness.ts` for the reasoning. `bun run test` runs
`scripts/test.mjs`, which discovers every `.ts` in that directory
(skipping `harness.ts` and `*.local.*`), so adding a test is dropping a file in
— there is no list to keep in step. Run one directly while working on it:

```bash
bun test/transcript.ts
```

`test/transcript.ts` appends to a real file while the mirror watches it and
`test/files.ts` creates, renames and indexes real ones, rather than checking
either against a hand-written sample. Between them they cover the chat view's
tail (a read landing mid-line, a multi-byte character split across two reads, a
file truncated under the watcher) and the Explorer's own reads and writes.

## The IPC contract — the one rule that matters

The Electron main process (`src/main/`) and the renderer
(`src/renderer/`) **never import each other**. Everything crossing
between them is:

1. a method on `DesktopApi` in `src/shared/api.ts` (types only, no runtime code),
2. a channel name in the `IPC` map at the bottom of that same file,
3. a thunk in `src/preload/index.ts`,
4. a handler in `src/main/ipc.ts`.

Adding or changing a call means touching all four. That is deliberate — the
alternative is two sides that disagree about what a call returns. The renderer
reaches the contract through the `@shared/*` alias (`@/*` is `src/renderer`).

## Main-process architecture (`src/main/`)

`main.ts` creates the window and calls `registerIpc()`; `ipc.ts` owns every
handler and the long-lived managers (`Store`, `SqlConnections`, `DockerRuntime`,
`ProcessManager`, `TerminalManager`, `WorktreeChats`). Notable pieces:

- **`store.ts`** — all state on disk under `~/.tabomni`: `manifest.json` for the
  workspace/databases/settings, and `workspace/` for the panels' own files
  (requests, notes, cookies, per-database Docker data). A folder's own files
  are never under here — the manifest records an absolute path and they are read
  where they are. Database passwords are encrypted in the manifest and stripped
  field-by-field before a record crosses to the renderer.
- **`daemon.ts` + `daemon-client.ts`** — ptys live in a detached, per-machine
  daemon spoken to over a Unix socket/named pipe with newline-delimited JSON.
  They no longer outlive the app: `TerminalManager.killAll()` is awaited on
  quit, and nothing reattaches. What a pty runs is now only the user's own login
  shell — the dock's Terminal tab — so `terminalCreate` takes a folder and a
  size and no command at all. `daemon.ts` gets its own
  esbuild entry point and is `asarUnpack`ed.
- **There was a `transcript.ts`**, and it is gone with the panel it fed: the
  chat view of a `claude` session tailed the transcript the interactive CLI
  writes at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, which is what
  made Chat and Terminal two views of one conversation. That whole shape went —
  the sessions, their chat view, `--session-id`, the mirroring IPC and
  `hasTranscript`. An agent conversation is a project's chat now
  (`worktree-chat.ts`), which the app hosts rather than reads.
- **`preview.ts` + `note-html.ts` + `note-blocks.ts`** — a note, served as a
  finished page on loopback. Server-rendered on purpose: the page has to be
  readable by something that fetches rather than renders, which rules out
  BlockNote's own HTML export (a method on an editor, so a DOM). Port picked by
  the OS, a per-run secret in the path, and a link that lives only as long as
  the app run. See the Preview section of `docs/design.md`.
- **`http.ts`** — API requests are sent from the main process, so there is no
  page origin, no CORS preflight, and forbidden headers go out as typed. The
  cookie jar in `cookies.json` is the panel's own, not Chromium's.
- **`claude-bin.ts`** — which `claude` this app runs, and all that is left of an
  `agent-tools.ts` that also said how each kind of session installed itself and
  whether it was present. Sessions were kinds because a picker offered them;
  that panel is gone, and what runs the CLI now offers no choice.
- **There was an `assistant.ts`**, and it is gone with the panel it fed: the
  workspace assistant was a chat behind the button in the title bar — one
  conversation, `claude -p` per turn, in an empty directory of the app's own with
  every folder reached by `--add-dir`, and read-only by denylist. It is deleted
  rather than hidden: the seven `assistant:*` channels, `AssistantChat`, the
  store's `readChat` and the panel went with it. A project's chat is the chat
  the app has now, and it was already handed the same MCP servers on the same
  terms. See the assistant, removed section of `docs/design.md`.

**`worktree-chat.ts` is the only `claude` in the app**, and `claude-agent.ts` is
the runner under it — the SDK half, not the policy, kept apart even
with one caller left. What the old "only one `claude -p`" rule was against is
still refused: the Data tab's AI filter and the API panel's AI import went
through an `askClaude` in `ai-cli.ts`, and all of it — the two features and that
helper — was removed rather than left hidden, because a chat is a conversation
the user is having and not a helper other features call. Nothing runs the CLI in
a pty any more either.

A turn is **`@anthropic-ai/claude-agent-sdk`**, not a `spawn` of `claude -p`.
It was the latter (`claude-print.ts`, deleted) reading
`--output-format stream-json` a line at a time, and the reason to move is
`canUseTool`: print mode had nobody to answer a permission prompt, so a turn
that met one stalled — which is the constraint the composer's permission picker
was built around. It is wired now, as the `Ask` permission — see **Asking**
below. Four things about the SDK are not visible from the option names, and all
four are in `claude-agent.ts` with the comment saying why:
`pathToClaudeCodeExecutable` is still the **user's own** `claude` (their login,
their `CLAUDE_BIN`); the MCP config goes over as the **path** through `extraArgs`
rather than the SDK's `mcpServers` option, which serialises the config — and this
run's secret — onto a command line every process on the machine can read;
`bypassPermissions` is refused unless `allowDangerouslySkipPermissions` is set
beside it; and `appendSystemPrompt` is no longer a flag but an `initialize` frame
on stdin, so it will not be in the argument list next time somebody looks there.
The SDK also **throws** an error result after delivering it as a message, so the
`finished` guard is what stops one failure being reported twice. `main.cjs` gets
its own esbuild build for it — the package is ESM and its `import.meta.url`
becomes `{}` under a CJS bundle, so a `define`/banner points it at a real file
URL, and that banner cannot go near the sandboxed preload.

## Renderer (`src/renderer/`)

React 19 + Vite + Tailwind v4. `components/studio/` is split by panel
(`worktree`, `api`, `db`, `note`, `files`), and each panel's logic and zustand
store live in the matching `lib/` directory (`lib/worktree-chat/store.ts`,
`lib/db/explorer-store.ts`, …) with `lib/store.ts` holding the studio-wide
state and `lib/workspace.ts` the thin repo over the workspace calls — all
relative to `src/renderer/`. Selecting anything brings its own list to the right-hand
panel (`showPane` moves both), opens whatever holds it — each panel's own `select`
does that, since what "holds" a thing differs per panel — and `SideRow` scrolls
the active row into view for all of them. The rail moving the sidebar still
leaves the pane alone; only the other direction is coupled. A pane that is not a
section — the chats' — takes the pane and leaves the panel alone, since
the row that was clicked is in the left column already showing. No panel store
clears itself any more: there is no
switch to clear for, and the only one that follows the folders at all is the
dock's shell store, which drops a removed folder's shells. Every code editor is
**CodeMirror**, set up once in `lib/editor.ts` and always behind a `lazy` so
neither it nor a language parser is in the launch bundle. It was Monaco, which
was CodeMirror before that, and the round trip is on the record because both
moves were argued rather than fashionable: the case _for_ Monaco was one stack
across the app and the editor people already know; the case for coming back is
that almost everything the Monaco version needed a workaround for was a
workaround for Monaco. The three biggest are named where they live — see the
diff pane, `lib/db/sql-completion.ts` and `lib/http/body-language.ts` below —
and what it costs is one thing, stated plainly: **`.ts` files no longer get
syntax squiggles.** Monaco carried a TypeScript worker for them; Lezer parses
and does not diagnose. The `tsserver` that could answer better is already
running and was deliberately not wired up as part of a migration.

A language is a _dynamic import_ rather than a grammar in the bundle
(`@codemirror/language-data`, 143 of them, resolved in `lib/editor-languages.ts`),
so an editor opens in plain text and colours a frame later, and a run that opens
one JSON file fetches one parser rather than four megabytes of them. There are no
workers and no `MonacoEnvironment`: Lezer parses incrementally on the main
thread, so the five bundled worker entry points and the `app://`-origin wiring
that kept a desktop app off a CDN are gone with them. What a panel adds lives
with that panel: the Explorer's shared buffers in `lib/files/documents.ts` and
its TypeScript wiring in `lib/files/typescript.ts`, whose hovers and
go-to-definition come from a real `tsserver` per Explorer root in
`src/main/tsserver.ts` (that root's own `typescript`, and nothing if it has none
— each project resolves against its own `node_modules`, not another's); the
SQL console's schema completion in `lib/db/sql-completion.ts`, which is
`lang-sql` handed a schema and is the one feature the move to Monaco is on record
as having cost; and the request body's `{{variables}}`, which are a decoration
over the real JSON parser in `lib/http/body-language.ts` rather than the
hand-written grammar Monaco's JSON _service_ forced.

**One copy of `@codemirror/view`, enforced twice.** A CodeMirror extension is
identified by the object it was built from, so two copies of that package are two
`EditorView.theme` facets and an extension that is silently inert — no error, the
theme simply does not apply. Milkdown depends on the same packages and this
install resolves thirteen nested copies at the _same version_, which is why
neither the package manager nor `tsc` sees a conflict. `package.json` pins the
version exactly and `resolve.dedupe` in `vite.config.ts` pins the module; read
the comments on both before touching either. The dock's
terminal is xterm, over the one `TerminalView` in `components/studio/`.

**The left column: the window's left edge.**
`components/studio/workspace-sidebar.tsx` is Conductor's left sidebar, widened
to what this app has: `Search`, then `Projects` / `Database` / `Notes` / `API`
as four folding sections. `project/projects-section.tsx` is the first of them —
the workspace's folders, each opening onto its `git worktree` checkouts. It
never goes away, which is the
point — reaching any of the four is a click in a list already on screen — and
`lib/projects.ts` holds the two things it remembers (whether the column is
showing, which projects are shut) under `projects.column`. The button in the
title bar collapses it; `⌘B` is still the panel sidebar's, and deliberately not
both. Folders are added, renamed and removed in **Explorer**, not here.
**The left column is `Projects` and nothing else, for now.** It stacked four —
`Projects`, `Database`, `Notes`, `API`, each folding, as many open at once as
there was room for (`workspace-sidebar.tsx`, over `shutSections` on
`lib/projects.ts`) — and the three panel lists are **hidden** rather than
removed: `SIDEBAR_SECTIONS` in `lib/projects.ts` is the one line that says which
are drawn, and putting one back is adding its id to it. Nothing else changed
with them: the three panels, their stores, their panes and their tabs all still
work, and `⌘P` indexes every table, request and note, which is what the empty
states now point at (`nothing-open.tsx`). With one section left it is drawn
without a chevron and takes the whole column, which is Conductor's own left
sidebar — the projects and their branches, and nothing competing for the height.
It took two moves to get the four there in the first place.
The **activity rail** went first — Conductor's left is navigation and the
contents of what is being worked on are on the right — which put all four lists
behind tabs on the right-hand panel; that was one box too few, since a tab strip
shows one list at a time and "what does this workspace hold" is a question about
seeing several at once. So three came left and **the Explorer kept the right-hand
panel, alone and without tabs**: a file tree is the contents of the thing being
worked on rather than a list of what the workspace holds, and it follows
whichever project the left column has clicked. `section-tabs.tsx` and the rail's
order/hidden store are gone with the tabs; what survives is the _kind_ —
`lib/sections.ts` for the ids, `section-marks.tsx` for the label, icon and hue
six other files read, since a hue that means "table" means it wherever a table is
listed.

**There was a task layer over that column**, and it is gone — deleted rather
than hidden, the way the Mail and Terminal panels went. A task was a name and
members taken from any panel (a file, a table, a request, a note), listed under
the project it was filed in, with a dashboard grid behind `Home`, crumbs across
the title bar and `Add what is open` at the end of its members. What went with
it: `lib/task/`, `components/studio/task/`, `test/tasks.ts`,
`TaskRecord`/`TaskMember` and the `tasks:list`/`tasks:save` channels in the
contract, the `show-tasks` menu command and `⌘E`. Nothing reads
`workspace/tasks.json` any more and nothing deletes it, the way `mail.json`
outlived its panel.

**A project's rows are its chats**, and clicking one opens it; the `+` on the
row and `New chat here` on its menu (and on the title-bar crumb's) start
another. **There was a `git worktree` layer between the two** — a project's rows
were its checkouts, a chat lived in one, and `main/git.ts` cut and removed them
— and it is **gone**, deleted rather than hidden: `worktrees`/`addWorktree`/
`removeWorktree`/`parseWorktrees`/`worktreeSlug`, the `worktrees:*` channels,
`WorktreeRecord`, `lib/worktree/store.ts`, the New worktree dialog,
`test/worktrees.ts` and `test/worktree-git.ts` are all out, and so is the
nullable `worktreeId` that ran through `ChatPlace`, `FileRoot`, the dock's
shells, `gitStatus`, `gitChanges`, `terminalCreate` and `startProcess`. What it
cost was paid on every use — a branch to name and a directory to remove
afterwards, before a question about the project already on screen — and the
isolation was wanted on few of them. Checkouts already on disk under
`~/.tabomni/workspace/worktrees/` are left alone the way `mail.json` was, and a
chat written in one has a `worktreeId` naming nothing, which `chatRootId` reads
as null: it keeps its lines and is not listed. The names in the code did not
change with it — `WorktreeChats`, `worktree-chat.ts`, the `worktree` pane,
`worktree-chats.json` — because renaming the files would lose every chat already
written, and renaming the rest is a rename for its own sake.
A chat is hosted by the app rather than
read off a transcript — one `query()` of the agent SDK per turn,
in the project's directory, drawn with its own rows and composer
(`ChatMessage` and `ChatComposer` in `components/studio/worktree/`, which were
the assistant panel's until that panel went and came here with it)
(`lib/worktree-chat/store.ts` over the `worktree` pane, which is in `PANELS`
and grouped under the project when grouping is on). Edits and `Bash` are
pre-approved (`--permission-mode acceptEdits`), and **nothing claims isolation**:
the directory is the working tree the user has checked out, `SYSTEM_PROMPT` in
`main/worktree-chat.ts` tells the turn so, and `captionFor` in `chat-pane.tsx`
says "in this project's own working tree" under the composer. The permission
table is not narrowed for it — narrowing it would make `Edits` mean two things
depending on where it was picked, and `Plan` and `Ask` are in the picker for
exactly this. A chat's place is `folderId` on the record (`ChatPlace` and
`chatRootId` in `@shared/api`, which is where a record older than the field is
read, the way `chatOptions` is), and that id is a chat's root id — the same key
`FileRoot.id` and the dock's shells use, so its scope and its group need no
translation. The cwd resolve is deliberately **not** a fallback chain: a chat
whose folder has left the workspace finishes with a line saying so rather than
running its next turn in whichever directory happens to be readable. **The composer
has a toolbar**, inside its own box: a model, an effort and a permission, held
per chat as `options` on the record (`WorktreeChatOptions` in `@shared/api`,
`setWorktreeChatOptions` writing it) and read at send time, so the project being
refactored is on Opus at `max` and the chat asking where a function is called is
on Haiku at `low`. **The model rows are the user's own `claude`'s**, not a list
in this file: `agentModels` (`main/agent-models.ts`, one `claude` and no tokens —
`supportedModels()` is a control request over the SDK's stdin channel, held for
the run, `~2.7s` cold and almost all of that the login shell) answers with the
`value`, `displayName`, `description` and effort levels of every model that
account offers, which is how the picker knows about `Opus (1M context)` and a
Fable that wants credits on the machine that has them and not on the one that
does not. `CHAT_MODEL_FALLBACK` is the three aliases a picker draws when the ask
failed, and `AgentModel.efforts` is three-valued on purpose — a list, `[]` for a
model that takes none (Haiku 4.5), and **null for nobody having asked** — because
`[]` on a fallback row would take the effort picker away from every model. The
effort picker is per model over `chatEfforts` and is not drawn at all where the
model takes none, and picking a model clears an effort it does not accept.
**A new chat opens on `default`, not on `null`** (`DEFAULT_CHAT_OPTIONS`): null
passes no `--model`, which runs the turn on whatever `~/.claude/settings.json`
says, and that is how every chat here came to be on Opus with nothing on screen
saying so — 596 of 596 messages, against 81% in the same user's terminal. `null`
is still a row, last, called `Inherit`, and a record that says it keeps it; a
record with no options at all gets what a new chat gets (`test/chat-options.ts`
says which of those two is which).
**Permission is one picker rather than a picker and a plan toggle** —
`Plan` / `Read only` / `Ask` / `Edits` / `Full access`, since plan mode _is_ a
permission and two controls over one question can be put into a state neither
means. What
each runs as is `PERMISSIONS` in `main/worktree-chat.ts`, one entry per mode
holding the tool list, the refusals, the `--permission-mode` and what the turn is
told, so a turn cannot be assembled half in one mode and half in another. It
never reads `Default`: a turn runs at whatever it says, and `edits` is what it
says until somebody changes it. `full` is `bypassPermissions` with no allowed
list — the escape hatch for a turn reaching for a tool this app never listed,
which with nothing there to approve it is a stall — and it is the one mode where
the two `delete_*` refusals are a request rather than a guarantee. **Plan mode is
a tool list, not `--permission-mode plan`** — that mode ends by asking,
`ExitPlanMode` is a prompt, and a turn started that way spends itself trying to
leave and comes back `is_error` with an apology instead of a plan; so
`READ_TOOLS`/`WRITE_REFUSED` in `main/worktree-chat.ts` are the read-only half
this app _can_ enforce, `Bash` off it because a command can write, and they are
what `read` runs as too — the two differ in what the turn is told, not in what it
may do. A record older than the picker carries `plan: true`, and `chatOptions` in
`@shared/api` is the one place that is read: both sides of the contract go
through it, so the toolbar cannot say `Edits` over a turn that ran as a plan.

**What a turn looks like.** A turn's working is **folded** into one line — `7
tool calls, 13 messages, 1 subagent`, with a mark per kind of tool — and its
answer is not: everything the turn produced except its last word goes behind the
fold, except an error and a refusal — which are the turn saying it did _less_ than
was asked and cannot be behind something somebody has to know to open — and what
the turn **cost**, which is about the turn rather than in it.
`lib/worktree-chat/activity.ts` is the pure half (`blocksOf`/`countsOf`/
`summaryOf`, tested in `test/chat-activity.ts`), `chat-activity.tsx` draws it
closed by default with the open state its own rather than the store's, and
`showToolCalls`/`showThinking` now decide what is _inside_ the fold. A **tool
row** is four things rather than a string — a mark, the model's own
`description` where the tool carries one, the file as a chip with its file-type
icon, and what came back — because they are read at different speeds;
`chat-marks.tsx` holds the glyphs, in its own file for the reason
`section-marks.tsx` is. Three of those came from main throwing less away:
`describeCall` in `main/claude-agent.ts` pulls the path, the description and the
argument apart instead of collapsing the input to one string (which also stopped
every subagent row being 120 characters of the prompt's JSON — `Task` names
none of the keys `summarise` looks for), the `thinking` blocks are read again
after a spell where nothing drew them, and a tool's **result** is filled into
the row already on screen. **An edit's row says how much it moved, not what the CLI said about it**
(`changeOf` in `main/claude-agent.ts`, `stat`/`change` on the tool line): the
result of an `Edit` is a sentence naming the absolute path the chip beside it is
already showing, and it was the widest thing in the row. `+3 −1` is the same fact
in the form a reader wants, and **clicking the row** (not the chip — a chip is 90px of a
600px row) opens a popover with the `-`/`+` lines themselves, footed with what it
is: this call's change, the file's own diff being in `Changes`. A popover on a
click rather than a tooltip on hover because the content is code — it has to stay
up, scroll and take a selection, and this app's tooltip is the inverted
`bg-primary` chip meant for a few words — read off the call's **input**, since that is where both sides are,
capped, and not a computed diff. The sentence comes back when the call _failed_,
which is the one time it is the thing worth reading. That last one is **the only
line in a chat that is not append-only**: `recordResult` patches the held lines synchronously and only
those, because every other write there is a read-modify-write with an `await` in
the middle — safe for an append, not for a change to a line the same turn is
appending after.

**What a turn cost is a line of the chat** — `Opus 5 · 39.1k prompt, 96% cached ·
1.9k out · $0.31`, `role: "usage"` in `@shared/api`, written by the same `append`
as every other line and drawn unfolded. The numbers were read and dropped, which
left the app unable to say why an afternoon of turns came to what it came to: the
CLI's transcript is not this app's to read, so nothing kept them. `usageOf` in
`main/claude-agent.ts` takes them off the result line's **`modelUsage`** and not
its `usage`, which the SDK documents as the main loop alone — `Task` is
pre-approved, so a turn that ran a subagent spent what the subagent spent — with
`thinking` the one figure that has to come off `usage` and is therefore a floor.
The **cached share** is on the line rather than in the hover, because that is
what actually decides the price: the prompt is the same size either way, a read
is billed at a tenth and a write at a quarter over, and the same trivial turn in
this repo measured $0.0049 warm against $0.0788 cold. A `0% cached` turn that is
not a chat's first is this app having asked for a prefix nothing else shares —
its own `appendSystemPrompt`, its own tool list, or an hour since the last turn
that shared one. A line rather than a field on the record because a chat holds
several turns on several models; the chat's total is summed off those lines
(`lib/worktree-chat/usage.ts`, pure, `test/chat-usage.ts`) and drawn beside the
caption under the composer, and a chat with no usage lines has no total rather
than a total of zero.

**Asking.** `ask` is the mode that stops: `READ_TOOLS` stay pre-approved, so
reading never interrupts, and a write, a command or a tool this app never listed
comes back through the SDK's `canUseTool` as a card above the composer
(`chat-ask.tsx`, `asks` on the store, `WorktreeChatAsk` in `@shared/api`). Its
`--permission-mode` is **`manual`** and not `default` — this CLI's mode list no
longer has a `default`, and the SDK passes the string straight through, so naming
the one that is gone fails the turn on its argument list. The turn is genuinely
_held_ while the card is up: the promise `WorktreeChats.ask` returns is the pause,
nothing times it out, and the composer says so instead of a spinner. A question
is in memory only, keyed by an ask id an answer has to name, and it dies with the
turn — `finish` and `dispose` both settle the outstanding ones, or the CLI is
left waiting on a promise nobody will resolve. Answering appends a
`role: "ask"` line (`Allowed Bash: npm test`), which main composes and emits as
a `decision` event so the sentence has one author. `Always allow` echoes the
SDK's own `suggestions` back as `updatedPermissions`, which writes a rule into
the project's `.claude/settings.local.json`, and it is offered only when the SDK
had a rule to suggest. **`AskUserQuestion` arrives down the same callback** — the
model's own multiple-choice question, and it reaches the app by _not_ being
pre-approved, which is why `REFUSED_ASKING` names it in the other four modes:
there, a question nobody can answer is refused rather than left to stall. It is
answered by _allowing_ the call with the picks merged into its input, questions
included, which is why `AskDecision.input` merges rather than replaces.
`titleFor` is what the card actually reads — the SDK documents a rendered
`title` and does not send one for a plain SDK run — and
`asked`/`decided`/`said`/`titleFor` are the pure half, tested in
`test/chat-ask.ts`.

**The other four modes have a `canUseTool` too now**, and `orgApproving` in
`main/claude-agent.ts` is it: `matchedAskRule` on the SDK's own callback
context is set when an account's own policy on a connector — a claude.ai
ClickUp, say — forces the prompt regardless of `bypassPermissions` or an
`allowedTools` entry that matched, and without a `canUseTool` at all such a
call was simply refused with nobody there to ask. `orgApproving` allows
exactly the calls carrying that flag and refuses everything else the way an
absent `canUseTool` used to, which is this app's own call rather than the
account holder's: `plan` and `read` cannot see whether the connector's tool
reads or writes, so a plan turn that reaches one is trusting that policy
rather than this app's read-only guarantee. `ask` needs none of this — its
`onAsk` already puts every unlisted call in front of somebody. The `+` at
the end of the toolbar is `Attach file` (⌘U, the OS picker over `pickFiles`,
written into the draft relative to the project — `relativeTo` in
`lib/files/paths.ts`, tested in `test/attach-paths.ts`) and `Mention…`, which
types the `@` the menu already answers. The workspace's
MCP servers come with it: the config, the three
`tabomni-*` servers pre-approved by name (plus `ToolSearch`),
and two `delete_*` tools refused — a branch is
not where a saved request lives, so isolation does not cover deleting one. No
`--strict-mcp-config` goes with it, so whatever the user's own `claude` is
configured with — `~/.claude.json`, a repository's `.mcp.json`, enabled
plugins, claude.ai connectors — joins them the same way it would running
plain `claude` in that directory, with nothing to switch on in Settings (see
**MCP: the workspace as tools** below). The
config alone was not enough and looked like it was: `--mcp-config` says the
tools exist, `--allowed-tools` says they may be called without a prompt nobody
is there to answer. An `--append-system-prompt` says the `tabomni-*` tools
belong to the workspace rather than to this project. A chat's id **is** the
CLI's session id, so whether the next turn is `--session-id` or `--resume` is
`started` on the record rather than a `Set` in the process — one rebuilt empty
every launch re-offered a used id, which the CLI refuses as _already in use_,
and the refused turn is the one that would have recorded it. Written only once
the process is up, and a turn refused that way is retried once as a resume,
which is also what heals a chat written before the field existed. A chat's
listing and its lines are `workspace/worktree-chats.json` and
`workspace/worktree-chats/<id>.json` — written as the turn happens, listed in
the left column under the project each is in, which is what makes one from last
week findable when the tab strip only holds this run's. Empty state is
`WorktreeWelcome`. A project row, and each of its chats, points the dock's shell
at that project, so the terminal beside a chat is in the directory the chat is
editing.

**The dock** is the lower half of the right-hand column — `Run` and `Terminal`,
the tail of Conductor's own `Setup / Run / Terminal`:
`components/studio/dock.tsx` over `lib/dock.ts`, which owns whether it is open
and which tab it holds. There was an `Assistant` tab in front of both, and it
went with that panel; the button at the right of the title bar is the dock's own
toggle now, since the chevron in its strip is otherwise a one-way door. It is
**collapsed rather than unmounted**, which the shell is the reason for: a pty
taken out of the tree ends, it does not hide.

**`Terminal` is where every shell now lives** (`lib/shell/store.ts`,
`dock-terminal.tsx`). There was a Terminal _panel_ — a pane, a tab strip, an
agent picker, and a chat view tailing the CLI's transcript — and it is gone: the
agent half is a project's chat, and what was left is a shell beside the work,
which is a dock tab. **One shell per place**, keyed by the folder id: clicking a
project in the column, or one of its chats, points the dock at that project's
shell. A cwd cannot be moved once a pty has
started, so following the project can only mean a second pty — a `cd` sent into
the first would land in whatever is half-typed, do nothing while a command ran,
and leave one scrollback holding three projects. A click only records the
_target_; the pty is started by the panel while it is on screen, so nothing
spawns behind a collapsed dock. Not remembered across a launch, unlike the
sessions it replaced: a shell here is ad-hoc.

`Run` is one command per folder (`lib/run/store.ts`,
`run-panel.tsx`) — per folder, since `bun run dev` is a
property of a repository. It is the first caller of `ProcessManager` in
`src/main/process.ts`, whose own comment had been calling itself "the seam" since
before this existed; the contract, the folder→cwd resolution and the
`stopAll()` on quit were all already there. The command is whitespace-split
because `ProcessManager` runs `shell: false` on purpose. See the Dock section of
`docs/design.md`.

**The strip is per project.** A file tab and a chat tab belong to a **root** —
a project folder — and are in the strip
only while that root is the one being worked in (`rootOf` on each entry in
`PANELS`, `activeRootId`/`inScope`/`openInScope` in `lib/panels.ts`, over the
`shownRootOf` the Explorer and the title-bar crumb already resolve through, so
all three agree including the fallbacks). A table, a saved request and a note
have no `rootOf` and never leave: they are the workspace's by deliberate design,
and a half-written query should not vanish because somebody changed branch.

**A single click in Explorer is a look, not an open.** It opens the _preview_
tab — italic, one at a time, `previewId` on the files store — and the next click
replaces it rather than adding a tab beside it; a double click on the row or on
the tab, or the first keystroke in the file (`keep`, called from `setText` so
every route to an edit goes through one place), keeps it. Only the tree previews:
`⌘P`, a definition jumped to and `Open with` are all somebody asking for a
particular file, so `opening` — the pure half, tested in `test/files-store.ts` —
takes the flag rather than defaulting to it. Nothing about it is remembered
across a launch, since a tab that survived a restart is one the workspace kept.

**In the strip is not open.** The tab stays open, its editor keeps its document
and its unsaved edits, and coming back to that project shows it again — the same
line `lib/files/roots.ts` was split along (`shownRootOf` is what is drawn,
`fileRootsOf` is what may be read), one level up. Three consequences worth
knowing: a drag hands back only what the strip was drawing, so `reorderTabs`
writes it into the slots those tabs already hold (`orderWhere` in
`lib/tab-groups.ts`, tested in `test/tab-groups.ts`) rather than handing a
partial list to a `reorder` that would close the rest; `Close others` and
`Close all` stop at the project's edge, since a menu cannot close tabs it was
not opened over; and moving the context can leave the pane showing something the
strip no longer holds, which `reconcileScope` answers — called from an effect in
`studio.tsx` rather than from `setActive`, because a store reaching into
`lib/panels.ts` would be a cycle. Most moves need it anyway: a project row opens
a chat in it, and selecting a file or chat tab moves the context to
_its_ root rather than the other way round (`useFiles.reveal`,
`useWorktreeChats.select`).

**Grouped tabs: one tab per folder.** A panel's tabs can be gathered under the
folder each belongs to, so the workbench strip holds one tab per folder and a
second strip inside it holds that folder's own. `groupOf` on each entry in
`PANELS` is what a folder means per panel — the Explorer root a file sits in
(the folder it sits in, longest match), the project a chat is in, the folder in
the panel's own tree a request or a note is
filed under, the schema a table belongs to (the Database panel groups by schema
rather than by connection, since only one connection's tabs are ever open, and
its query tabs gather under `NO_GROUP` as **Queries**) — and everything else is written once around it in `lib/panels.ts`:
a group's strip id is `api:@<folderId>` (`GROUP` in `lib/tabs.ts`, marked so a
folder open as an API tab cannot collide with the group its requests gather
into), and `groupIds`/`orderGroups`/`orderWithin` in `lib/tab-groups.ts` are the
pure half, tested in `test/tab-groups.ts`. It is **off** until switched on in
Settings › Tabs (`groupTabs` under `workbench.settings`), and that now goes for
**every** panel including the chats. Those used to set an
`alwaysGroups`, on the argument that a chat tab stands for a conversation in a
place rather than for something the user opened; what that actually bought was
two tab strips on screen at once whenever a chat was open — the outer one the
place, the inner one its chats — for a panel nobody had asked to group. The
field is gone rather than left unused, `grouper` reads only the setting, and a
chat is one tab in the one strip, with its project on the tab's hover line
(`tab-items.tsx`) since the label cannot carry it. A second chat in a place is
still started from that row in the left column, or `New chat here` on
its menu. Closing a folder's tab closes
everything under it; the inner strip's ✕, a sidebar row's ✕ and ⌘W all close one
tab, through `closePanelTab`. What a tab _looks_ like is
`components/studio/tab-items.tsx`, shared by both strips, and
`components/studio/group-tabs.tsx` is the inner one, drawn by `studio.tsx` above
the pane rather than by any panel.

`components/studio/splash.tsx` is the launch screen — the studio drawn in
miniature, assembling — and the workbench is held back until it has finished,
then crossfaded in. Its easings and keyframes are CSS rather than a library, in
`styles/motion.css`, which is where an animation added anywhere else should go
too. Nothing else in the studio animates beyond what shadcn's own components
bring. See the Motion section of `docs/design.md`.

`components/ui/` is shadcn/ui. Add to it with the CLI rather than by hand:
`bunx shadcn@latest add dialog`. Vite's root is `src/renderer`, so `index.html`
and `public/` are there too.

**Settings…** in the application menu (⌘,, and File off macOS) opens a dialog and
nothing else — no tab, no section: `components/studio/settings-dialog.tsx`,
sections down the left and one section's rows on the right, with
`lib/settings.ts` the store, which writes each change straight to the workspace's
settings. It holds the theme, the chat view's `showToolCalls`/`showThinking`
(still under their old `claudeGui.*` keys, and now on the store so the dialog and
the chat's own header cannot disagree), and `tabsPlacement` under
`workbench.settings`: the tab strip as the row above the pane, or the same tabs
as a column on its right — `orientation` on `TabStrip`, handed in by
`studio.tsx`, which puts the column in a resizable panel of its own and falls
back to the row when nothing is open. See the Settings and Vertical tabs
sections of `docs/design.md`.

**There was an assistant panel** on the right — one chat about the whole
workspace, opened from the button in the title bar and drawn as the dock's first
tab, its turns held by `main/assistant.ts` so one survived the panel being
closed. It is **gone**, deleted rather than hidden the way the Mail and Terminal
panels went: `assistant-panel.tsx`, `lib/assistant/store.ts`,
`main/assistant.ts`, the `assistant:*` channels and `AssistantChat` are all out.
The argument it was built on — that the MCP servers are the _workspace's_ and a
chat with one repository under it is about that repository — did not survive a
project's chat being handed the same three servers on the same terms. What is left on disk
is left alone, as `mail.json` was: nothing reads `workspace/chats.json`,
`workspace/chats/` or `~/.tabomni/assistant` any more, and nothing deletes them.
Its rows and its composer moved to the chat that uses them (see The left column
above) and the title bar's button became the dock's toggle. See the assistant,
removed section of `docs/design.md`.

**MCP: the workspace as tools.** `src/main/mcp.ts` serves the Database, API and
Notes panels to an agent turn as three MCP servers — one streamable-HTTP
server on loopback with a per-run secret, bound the way `preview.ts` binds its
own, three tools apiece — nine for the API panel, which also **writes**:
`create_request` / `update_request` / `delete_request` and the same three for
the folders they are filed under, saving the collection the agent has been
reading, as typed (`{{baseUrl}}/users` keeps its variables) and never sent,
since `send_request` is still the only tool that makes a request. Deleting a
folder cascades to its subfolders and their requests, from the
`descendantFolderIds` the sidebar uses, which moved to `@shared/tree` for it;
the two `delete_*` tools are the only MCP tools a chat is refused
(there is no trash and a print turn has nobody to ask). Each is
**off** until switched on in Settings › MCP
(`mcp.database` / `mcp.api` / `mcp.notes`; the keys are in `@shared/api` because
main answers with them too), and a turn is started with
`--mcp-config ~/.tabomni/mcp.json` naming whichever are on. Every call rechecks
the setting, so turning one off stops a turn already in flight using it. A request an
agent sends is resolved by `@shared/http-request` — the same substitution and
folder cascade the API panel uses, moved there so there is one of it, and
`METHODS` moved there too once main could save a request the picker has to draw.
A request or folder written is announced (`http:changed` → `reread` on the API
store, which also closes a tab whose record has gone), which matters because
that panel saves the whole collection at once — a window holding a stale list
would write it back over the agent's request.
`test/mcp.ts` drives it over a real socket.

**The user's own `claude` servers are reachable too, with nothing to switch
on.** There was a fence here — `--strict-mcp-config` meant a turn saw the file
this app wrote and nothing else, so a server had to be copied into it by name
from a `Your own servers` list in Settings › MCP, one switch each, before a
chat could reach it, and a claude.ai connector could not be reached that way at
all since it has no config file to copy. All of that — `main/user-mcp.ts`,
the plugin-reading walk over `installed_plugins.json`, `MCP_USER_SERVERS_KEY`,
`withUserServers`, the `Also use my claude's own configuration` switch and
`MCP_INHERIT_KEY` — is deleted rather than kept behind a flag. A turn is
started with `--mcp-config` naming this app's own three and **no**
`--strict-mcp-config` beside it, which is what that flag was for: without it
the CLI **merges** the given file with whatever it would already have found
running plain `claude` in that directory — `~/.claude.json`, a repository's
own `.mcp.json`, enabled plugins, a claude.ai connector, all of it. Install and
inspect a server with `claude mcp add` / `claude mcp list` the way it always
was; a chat here picks it up with nothing to do in this app at all.

What that costs is the one thing the fence used to buy: `Plan` and `Read only`
can no longer refuse an inherited server _by name_, since this app has no name
for one it did not copy in. They still refuse everything they know about —
`WRITE_REFUSED`, the shell, the workspace's own writers — and an unlisted tool
from a server the CLI picked up on its own is refused too, by `orgApproving`
in `main/claude-agent.ts` (see **Asking** above). The one exception even there
is `matchedAskRule`: a connector an account has set to require approval —
a claude.ai ClickUp, say — is allowed through in every mode, `Plan` and `Read
only` included, because `orgApproving` cannot see whether that connector's
tool reads or writes and chooses to honour the account's own policy over this
app's read-only guarantee. `Ask` is unaffected either way — its `onAsk`
already puts every unlisted call in front of somebody, `matchedAskRule` ones
included.

The four kinds are Explorer, Database, API and Notes — `SECTION_IDS` in
`lib/sections.ts` is the list and `components/studio/section-marks.tsx` puts a
label, an icon and a hue against each. They are no longer four ways of filling
one box: Database, Notes and API are sections of the left column and the
Explorer is the right-hand panel (see The left column above — there was an
activity rail before that, and a row of tabs after it, and both are gone). **There is no Terminal section, and no Terminal panel**: a
shell is a dock tab now (see The dock above). What draws in a pane with no
sidebar of its own is a project's chat, opened from the left column, so `Pane`
is `Section | "worktree"` and `showPane` leaves the sections alone for it. Those
chats group under their project like every other panel's tabs when grouping is
on — one tab per project, its chats in the strip inside it, and the `+` at its
end starts another in the same project. There is no git panel, no code search, no specs panel and
no webhook catcher either: all four were removed rather than left hidden, and the
only thing git is still asked is each folder's branch name, shown beside the
folder in the Explorer tree. The right-hand panel itself closes — `⌘B`, **View ›
Sidebar**, or dragging its handle shut; `sidebar` on the studio store,
remembered with the strip, and the panel is collapsed rather than unmounted so
its width survives. A section tab does _not_ double as a close, unlike the rail
icon it replaced: the tabs are inside the panel, so a click that shut it would
be a click that took the thing clicked off the screen. `⌘B` is refused inside anything
`contenteditable`, where it is bold (`isEditingRichText` in `lib/shortcuts.ts`).

Explorer is the workspace's folders as directories — expanded a level at a
time, nothing hidden, and watched only where it is expanded: one non-recursive
`fs.watch` per open folder (`src/main/watch.ts`, driven by the `expanded` set
through `lib/files/watch.ts`), closed again when the row is collapsed. Refresh
is still the header button, for the filesystems `fs.watch` is quiet on and for
the palette's index, which nothing watches. **The tree is one place**: the
files of the project being worked in, flat, with no root row and no other
project beside it — every project as a heading was a list to scroll past before
the files somebody has open. Clicking a project row in the column, or one of its
chats, moves the tree, the chat and the dock's shell together. **There is no bar above the list and no root row**: the left column
already says which project and branch are selected, so a strip repeating it was
chrome answering a question already on screen — what it carried, the root's own
menu (`New file`, `Refresh`, `Collapse all`, `Copy path`, `Reveal`,
`Add folder`, `Rename`, `Remove folder`), is the right-click on the empty space
under the tree, which is the only part of the panel that is about the project
rather than about a file in it. A tree long enough to fill the column leaves
only the list's bottom padding to right-click, which is known and accepted.
`FileTree` keeps the root path in `expanded` so it is read and watched without
being a row.
`activeFolderId` on `lib/projects.ts` is that selection, remembered across a
launch so coming back lands where you left.
`lib/files/roots.ts` holds both lists and the difference matters:
`shownRootOf` is what the tree draws, `fileRootsOf` is every root there is —
what may be read, which tabs survive, which project a path belongs to — so
switching does not close the tabs of the place being left (both pure and
tested in `test/file-roots.ts`; `FileRoot.id` is the folder's id, the shells'
key). `fileRoots` in `src/main/ipc.ts` is main's list of
them all, feeding the gate, the watchers, the palette's walk and the tsservers
at once. Its
`files:*` calls all go through `insideAny` in `src/main/files.ts`, which is what
keeps an absolute path from the renderer inside the roots the workspace was
pointed at; deleting is `shell.trashItem` rather than `unlink`. Rows are
coloured by git and lettered at the end (`M`, `U`, `A`, `D`, `C`; ignored has
none) in the editors' own decoration colours — new green, modified tan, deleted
and conflicted red, ignored greyed — from one `git status` per root (`workingTree` in `src/main/git.ts`, held in
`lib/files/git-status.ts`, re-read on the watchers' events and on Refresh), so a
project is coloured by its own uncommitted work. A
wholly untracked or ignored directory arrives as one entry and is read as a
prefix, so `node_modules` costs one line. **The panel's header is two tabs —
`All files` and `Changes`** (`explorerTab` on `useStudio`, remembered with the
strip; `ExplorerTabButton` in `file-tree.tsx`). It was the word `Explorer` and a
row of buttons, which named the panel to somebody already looking at it, and
after an agent's turn the other list is the one being asked for. The bar under
them — the project and its branch — is shared, since both tabs are about the
same project. **The only button left is `Refresh`** — every other action is
on a menu over the thing it acts on (`New file` and `Collapse all` on the root
bar's menu or a directory row's, `Add folder` on the empty space under the tree
and in the File menu), and Refresh is the one that is about the panel rather
than about anything in it. An empty workspace draws the `Add folder` button
where the files would be, since the header no longer holds one. The tab carries the count, read for the
project on screen whichever tab is showing (`useWatchChanges`, called by the
panel and not by the list, for exactly that reason). **The list is the tab and
the diff is a pane of its own**: `changes` in `PANES`, `changes-pane.tsx` over
`lib/files/changes.ts`, one tab per project whose id **is** the root's — so
`rootOf` is the identity and the tab is in the strip only while that project is
the one being worked in. A row calls `openPath`, which picks the file and puts
that one tab on screen, drawn by the exported `FilePane` a file tab uses, read
through the files store without joining `openIds` so reviewing spawns no tabs.
Twelve changed files are twelve clicks and **one** tab, which is the whole
argument: the sidebar list this replaced opened a _file_ tab per row, so a turn
left twelve tabs to close, and that is what moved it into a pane in the first
place. What is refused either way is the list in both places — the pane held one
beside the diff while the header was a title, and a second copy of it now would
be one question answered twice. The data is `changes()` in `src/main/git.ts` —
the same `git status` the colours come from, with the ignored dropped and
`git diff --numstat HEAD` for the `+112 −8`, an untracked file counted by being
read under a cap since it is in no diff — re-read off `useGitStatus`'s own
debounce rather than a second set of timers, with `test/git-changes.ts` over a
real repository behind both it and `fileAtHead`. **A review is left on that diff and becomes a chat.** A `+` column against the
code picks a line — held down and dragged for a range, shift-click as the second
way — a box at the foot of the pane takes the remark, and one button opens a new chat in that project with the whole
review **written into its composer, unsent** (the ellipsis on `Ask AI to fix…`) —
a prompt assembled from eight remarks is the kind that wants a sentence added
before it goes, and the threads are kept rather than cleared since the composer
holds only their text. That draft is `drafts` on the worktree-chat store, which
also made **a composer's draft per chat**: it was one local `useState` in a pane
that was never keyed, so a half-written message followed you into the next chat
you clicked. **A comment is a thread**: a
range holds notes, each with an author (`you` / `agent`), and `Reply` adds one —
which is what makes an agent leaving its own review comments (`comment` with
`author: "agent"`) the same model rather than a migration. In the prompt a
one-note thread is that note unattributed and a longer one is the exchange,
labelled `Reviewer` / `Assistant` — `lib/files/review.ts` is the
store and the prompt (`reviewPrompt`, tested in `test/review.ts`),
`lib/files/review-marks.ts` the gutter, the tints and the threads themselves,
`review-panel.tsx` the bar at the foot of the pane. Five things are deliberate: the picker is a **gutter** rather than the
code, since both sides are read-only and a selection there is somebody copying a
line; the remarks live in the bar at the foot of the pane and **not** in the diff —
they were block widgets under their lines for a while, built from plain DOM, and
came out again because a diff with three comments in it is a diff pushed apart in
three places; what the diff keeps is a bubble in the column and a tint on the
range, and a list also reads back a thread in a file that is not open; the lines are the **new side's**, because those
are what an agent can open the file at; the quoted lines are captured **when
the comment is written**, since a snippet resolved at send time would quote
something the remark was never about; and the range is painted while dragged but
the box waits for the release (`settled`), because a box opened mid-gesture
inserts height between the rows and moves them out from under the pointer still
choosing them. `reviewRootId` is what puts the column in
this pane's diff and not in a file tab's, and `create` on the worktree-chat store
takes a draft and hands back the new chat's id, so the review can be written into
it. A thread inside a **collapsed** unchanged region is not drawn, because those
lines are not on screen either.

The file is shown as a **diff**:
`diff` is a `Viewer` beside `text` and the rest, so the same file opened from the
tree is an ordinary tab with the right-click menu switching back, and it is
CodeMirror's merge view over the file's own buffer on the right and
`git show HEAD:<path>` on the left (`file-diff.tsx`, `codemirror-diff.tsx`).
**Both sides are read-only**: a diff is read, and an editable right half over a
left half that refuses every keystroke is a pane that behaves two ways at once —
editing is the `Edit` half of the toggle in the header, one click and the same
buffer. The right side is still the file's own buffer, so the diff shows unsaved
edits. ⌘S is claimed by `changes-pane.tsx` rather than by the editor, which is
the one thing the stack change moved: Monaco's read-only diff was still
focusable and took the key itself, and a genuinely non-editable CodeMirror view
holds no focus to bind one on.
The header draws the path **relative to its root** with the absolute one on the
hover line, since a repository somewhere deep under `~` spends forty characters
saying nothing about the file; `Copy path` and `Reveal` still use the absolute one. Two
editors can hold one path's buffer — a file tab and the `Changes` diff of it —
and `lib/files/documents.ts` is the registry that had to be _written_ rather than
ported, since Monaco owned its documents and CodeMirror deliberately does not.
It counts holders and drops the buffer at zero, forwards what is typed in one
view to every other view on the same path, and hands an editable view's undo
history and caret to the next one — which is what carries an editing session
across the `Diff | Edit` switch. Sharing the _document_ live and the _history_
by handover is the distinction to keep: only one view of a path can ever be
typed into, because a diff is read-only on both sides. A
deleted file is why the diff is drawn ahead of the cannot-open notice: it has no
row in the tree, it is a row in Changes, and its diff is the whole of it
removed. The diff's toolbar is in the pane header beside the
path: `Diff | Edit` over the same `views` field, plus inline/side-by-side and
whitespace, the last two under `workbench.settings` (`diffSideBySide`,
`diffWhitespace`). Side-by-side and inline are two different constructions —
`MergeView` against `unifiedMergeView` — so that toggle rebuilds the view where
Monaco took an `updateOptions`, and with it goes the
`useInlineViewWhenSpaceIsLimited` clause that existed only because Monaco
second-guessed the button below 900px. Whitespace is all-or-nothing
(`highlightWhitespace`), where Monaco drew the marks inside a selection.
**The diff is also the one editor unmounted rather than hidden**: the panes are stacked and
hidden with `invisible` to keep editing state, a diff has none worth keeping, and
one left live painted its bands through whatever pane was showing. `visible` in
`file-workspace.tsx` means the active tab **of the panel being looked at**
(`pane === "files"`) for the same reason. A deleted file has no row at all, so
it is its **tab** that says `deleted` — `isDeleted` in `lib/files/store.ts`, and
the two sources are not either-or: git says so for a tracked file, the tree's
listing is the only thing that knows an _untracked_ one has gone, and a listing
can be stale, so a file git currently calls `U`, `A` or `M` **exists** whatever a
listing read before it was written still says (tested in `test/files-store.ts`,
after a file an agent had just created was opened from Changes and its tab said
`deleted`). `⌘P` searches files too — the one index in the palette
(`files:index` walks the workspace once per run; `lib/files/search.ts` shortlists
before cmdk scores). Images open in an image view, and the files that are
honestly more than one thing — an SVG; a `.md`, which opens in the editor and
has a rendered **Markdown preview** and a **Markdown editor** beside it; and a
`.note`, which opens in that same block editor — are switched between from their
right-click menu (`lib/files/viewers.ts` is the one place that decides, and
`components/studio/markdown-view.tsx` is the renderer the chat view uses too).
`New note…` on a folder creates a `.note`: the same editor as the Notes panel
over a file in a repository rather than a record under `~/.tabomni`, so it saves
like every other file tab (dirty, ⌘S, flushed on close) and its drawings and
dropped pictures still live in the workspace. The `blocks` viewer is one pane
for both files and `components/studio/files/file-blocks.tsx` is where they part:
a `.note` is written as indented blocks (a body that is not them is read as
markdown rather than overwritten), a `.md` is printed back through
`blocksToMarkdownLossy`, which reflows the whole file — so the text editor stays
the `.md` default, and frontmatter, `/drawing` and dropped pictures are all kept
out of a `.md` because it cannot hold them. `lib/files/block-doc.ts` is the pure
half of that and the one with a test. Rows carry a vendored vscode-icons file-type icon —
`lib/files/icon-names.ts` maps a name to one, `assets/file-icons/README.md`
says what is checked in and why it is a subset. A file tab is
addressed by its own absolute path, and `lib/files/paths.ts` is the one place
that splits one — it accepts both separators, unlike `lib/runtime/tree.ts`,
which is for paths this app made up. See the Explorer section of
`docs/design.md`.

**`@` is a chat's**, and it inserts a **name** rather than a chip: the
turn carries the workspace's MCP servers, and every one of those tools takes a
thing by name, so a name is something the agent can look up when it needs to.
`lib/mention-text.ts` holds the rules for what a mention _is_ (and is the
testable half, `test/mentions.ts`), `lib/mentions.ts` is the catalogue that reads
the three stores, and `lib/worktree-chat/mention-text.ts` (tested by
`test/chat-mentions.ts`) + `chat-composer.tsx` are the plain-text half over them.
There was a richer `@` in a chat composer — chips linking to
`tabomni://mention/<kind>:<id>`, `expandMentions` swapping each for a line of
context, built on Milkdown's slash machinery — and it went with the session
panel, along with `writtenPaths`/`touched.ts` and the strip of files a turn had
changed, which read the transcript nothing tails any more.

**Nothing reads the CLI's transcripts any more.** There was a **Conversations**
section under the tree, a **Past sessions** drawer, and then the whole session
chat view: all of it is gone, deleted rather than hidden, and so are
`main/transcript.ts`, the mirroring IPC, `hasTranscript` and `--session-id`. An
agent conversation in this app is one the app itself holds — the workspace's
`worktree-chats.json` — and a conversation the CLI wrote is reachable with
`claude --resume` and not from here. See the
Conversations, removed and The chat view sections of `docs/design.md`.

**The workspace's folders belong to Explorer**, and are added, renamed and
removed there and nowhere else (`components/studio/files/file-tree.tsx`) — the
list that says what the workspace is pointed at is the one that changes it. The
Terminal sidebar used to carry the same three actions on a second copy of the
folder list, and then stopped existing; a **Sessions** section under the tree
replaced it, and that is gone too, along with `New session here…` on a folder's
menu. **Nothing in Explorer starts a terminal**: a shell is a dock tab, pointed
at whichever project the left column last had clicked, so there is one place to
open one and one place to find it. The File menu's `add-folder` command opens the
same Add folder dialog, which is what a hidden Explorer section falls back to.

Notes is a workspace-wide scratchpad — folders and markdown files, filed and
right-clicked the way the API panel's requests are. `lib/tree.ts` is the tree
both sidebars are built from (nesting, the drag-reparent cycle guard, the
delete count, the ancestor chain a selection is revealed through) — its two
functions about the shape of the tree rather than the drawing of it,
`descendantFolderIds` and `isDescendant`, are in `@shared/tree` and re-exported
from there, since main deletes a request folder too (`main/mcp.ts`);
`lib/http/folders.ts` delegates to it and keeps only the
cascading headers and params that are the API panel's own. A note's listing is
`notes.json` and its text is `notes/<id>.md` beside it, so typing rewrites one
note rather than all of them and what is left on disk is readable without this
app. A picture dropped, pasted or uploaded into a note is a file of the
workspace's own under `workspace/note-files/`, and the note holds a
`note-file://` URL for it — `shared/note-files.ts` is that URL's shape,
`main/protocol.ts` serves it to the renderer and the preview server inlines it
for a browser that has never heard of the scheme. The editor is BlockNote
(`note/block-editor.tsx`), themed by pointing its own `--bn-*` variables at this
app's tokens in `note-editor.css`, so it follows the theme without a second
palette. It used to be Crepe, sharing `milkdown-theme.css` with a chat composer
that no longer exists — that stylesheet went with it, and `@milkdown/kit` is
still here for `lib/markdown/renderer.ts`, which renders markdown to plain DOM
for reading. See the Notes section of `docs/design.md` before changing it.

`/drawing` in a note opens an Excalidraw canvas — shapes, arrows, freehand,
images — in a dialog, and leaves the finished drawing in the note as an exported
SVG. The scene is its own `workspace/drawings/<id>.excalidraw` file and the note
holds only the id, in a ```drawing fence; `drawing-node.ts` is the ProseMirror
node behind that fence, and the comment on
`keepDrawingFencesOutOfCodeBlocks` is the one thing to read before touching it.
Excalidraw is loaded on demand and its fonts are served by this app rather than
from a CDN — see the `excalidraw-fonts` plugin in `vite.config.ts`.

There was a **Mail** panel — an SMTP sink on loopback catching the mail the
project sends — and a **Webhooks** panel beside it before that. Both are gone,
deleted rather than hidden, as the git, code search and specs panels were:
nothing of either is left in the code, the sections, the contract or the `@`
menu.
What is left is a workspace's own `workspace/mail.json` and its `inbox.config`
setting, which this app no longer reads and does not delete — removing a feature
is not a reason to delete somebody's captured mail. See the Mail, removed section
of `docs/design.md`.

## Conventions

- Prettier: no semicolons, double quotes, 80 columns, es5 trailing commas.
- Comments explain **why**, not what — which failure a constant was written
  against, why an approach was rejected. A comment restating the line below it is
  noise. Match the density and tone of the surrounding code.
- `*.local.*` is gitignored scratch. Use that suffix for repros and one-off
  experiments instead of leaving files untracked or committing them.
- Changes under `electron/` or `shared/` need `bun dev` restarted; only the
  renderer hot-reloads.
