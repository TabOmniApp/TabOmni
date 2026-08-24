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
  shell — the dock's Terminal tab — so `terminalCreate` takes a folder, a size
  and an optional worktree and no command at all. `daemon.ts` gets its own
  esbuild entry point and is `asarUnpack`ed.
- **There was a `transcript.ts`**, and it is gone with the panel it fed: the
  chat view of a `claude` session tailed the transcript the interactive CLI
  writes at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, which is what
  made Chat and Terminal two views of one conversation. That whole shape went —
  the sessions, their chat view, `--session-id`, the mirroring IPC and
  `hasTranscript`. An agent conversation is a worktree's chat now
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
  store's `readChat` and the panel went with it. A worktree's chat is the chat
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
section — the worktree chats' — takes the pane and leaves the panel alone, since
the row that was clicked is in the left column already showing. No panel store
clears itself any more: there is no
switch to clear for, and the only one that follows the folders at all is the
dock's shell store, which drops a removed folder's or checkout's shells. Every code editor is
Monaco, set up once in `lib/monaco.ts` and always behind a `lazy` so its ~4 MB
of grammars stays out of the launch bundle. What a panel adds to it lives with
that panel: the Explorer's grammars and TypeScript wiring in
`lib/files/monaco.ts`, whose hovers and go-to-definition come from a real
`tsserver` per Explorer root in `src/main/tsserver.ts` (that root's own
`typescript`, and nothing if it has none — a checkout resolves against its own
`node_modules`, not another branch's); the SQL console's schema completion in
`lib/db/sql-completion.ts`, which Monaco ships no language service for; and the
request body's own grammar in `lib/http/body-language.ts`, because a body full
of `{{variables}}` is a template rather than the JSON it looks like. The dock's
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
whichever checkout the left column has clicked. `section-tabs.tsx` and the rail's
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

**A project's rows are its `git worktree` checkouts**, and clicking one opens a
chat in it — `main/git.ts` has the operations (`worktrees`, `addWorktree`,
`removeWorktree` with `--force` but keeping the branch), and
`parseWorktrees`/`worktreeSlug` are the pure halves with `test/worktrees.ts`
behind them. `addWorktree` passes **`-b` only for a branch that is not there
yet** and checks an existing one out instead: it was `-b` unconditionally, and
with `removeWorktree` keeping the branch on purpose that made removing a checkout
and re-making it under the same name a permanent `fatal: a branch named 'x'
already exists`. `from` is ignored for a reused branch rather than reset onto it,
and the `reused` flag is why the record then leaves `from` unset.
`test/worktree-git.ts` drives both over a real repository. They live under `~/.tabomni/workspace/worktrees/<folderId>/<slug>`
rather than beside the repository, so removing them all leaves a project's
directory untouched. `terminalCreate` resolves
`resolveWorktreeDir(id) ?? resolveFolderDir(folderId)` — an **id**, never a path,
and the `??` is what keeps a shell whose checkout has gone still startable.
A worktree's chat is hosted by the app rather than
read off a transcript — one `query()` of the agent SDK per turn,
in that checkout's directory, drawn with its own rows and composer
(`ChatMessage` and `ChatComposer` in `components/studio/worktree/`, which were
the assistant panel's until that panel went and came here with it)
(`lib/worktree-chat/store.ts` over the `worktree` pane, which is in `PANELS`
and always grouped **by worktree**, so the outer tab is the branch and the inner
strip is its chats). Edits and `Bash` are pre-approved
(`--permission-mode acceptEdits`) because nothing here answers a prompt yet and
the directory is a branch of its own; the composer says so out loud.
**A chat can also be in a project's own working tree** — `New chat here` on a
project row's menu and on the title-bar crumb's, with the project as the cwd. A
chat's place is `folderId` + a nullable `worktreeId` on the record (`ChatPlace`
and `chatRootId` in `@shared/api`, which is where a record older than the pair is
read, the way `chatOptions` is), and `worktreeId ?? folderId` is a chat's root id
— the same key `FileRoot.id` and the dock's shells use, so its scope and its
group need no translation. `createWorktreeChat` takes the pair. What does **not**
change is the permission table: narrowing it here would make `Edits` mean two
things depending on where it was picked. What changes is that nothing claims
isolation — `SYSTEM_PROMPTS` in `main/worktree-chat.ts` tells the turn where it
really is, and `captionFor` in `chat-pane.tsx` says "in this project's own
working tree" rather than "in this branch only". The cwd resolve is deliberately
**not** the `??` chain `terminalCreate` uses: a chat whose checkout was removed
must not have its next turn land in the project with edits pre-approved. **The composer
has a toolbar**, inside its own box: a model, an effort and a permission, held
per chat as `options` on the record (`WorktreeChatOptions` in `@shared/api`,
`setWorktreeChatOptions` writing it) and read at send time, so the checkout being
refactored is on Opus at `max` and the chat asking where a function is called is
on Haiku at `low`. `null` for either of the first two leaves the user's own
`claude` deciding, which is not the same as naming today's default here.
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
fold, except an error and a refusal, which are the turn saying it did _less_ than
was asked and cannot be behind something somebody has to know to open.
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
the row already on screen. That last one is **the only line in a chat that is
not append-only**: `recordResult` patches the held lines synchronously and only
those, because every other write there is a read-modify-write with an `await` in
the middle — safe for an append, not for a change to a line the same turn is
appending after.

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
the checkout's `.claude/settings.local.json`, and it is offered only when the SDK
had a rule to suggest. **`AskUserQuestion` arrives down the same callback** — the
model's own multiple-choice question, and it reaches the app by _not_ being
pre-approved, which is why `REFUSED_ASKING` names it in the other four modes:
there, a question nobody can answer is a stalled turn. It is answered by
_allowing_ the call with the picks merged into its input, questions included,
which is why `AskDecision.input` merges rather than replaces. `titleFor` is what
the card actually reads — the SDK documents a rendered `title` and does not send
one for a plain SDK run — and `asked`/`decided`/`said`/`titleFor` are the pure
half, tested in `test/chat-ask.ts`. The `+` at
the end of the toolbar is `Attach file` (⌘U, the OS picker over `pickFiles`,
written into the draft relative to the checkout — `relativeTo` in
`lib/files/paths.ts`, tested in `test/attach-paths.ts`) and `Mention…`, which
types the `@` the menu already answers. The workspace's
MCP servers come with it: the config, the three
`tabomni-*` servers pre-approved by name (plus `ToolSearch`),
`--strict-mcp-config`, and two `delete_*` tools refused — a branch is
not where a saved request lives, so isolation does not cover deleting one. A
server from the user's own `claude` joins them only by being switched on in
Settings › MCP, copied into that config rather than inherited from it (see
**MCP: the workspace as tools** below). The
config alone was not enough and looked like it was: `--mcp-config` says the
tools exist, `--allowed-tools` says they may be called without a prompt nobody
is there to answer. An `--append-system-prompt` says the `tabomni-*` tools
belong to the workspace rather than to this checkout. A chat's id **is** the
CLI's session id, so whether the next turn is `--session-id` or `--resume` is
`started` on the record rather than a `Set` in the process — one rebuilt empty
every launch re-offered a used id, which the CLI refuses as _already in use_,
and the refused turn is the one that would have recorded it. Written only once
the process is up, and a turn refused that way is retried once as a resume,
which is also what heals a chat written before the field existed. Removing a worktree deletes its chats. Empty state is
`WorktreeWelcome`. A project row points the dock's shell at that project and a
worktree row at that checkout, so the terminal beside a chat is in the branch the
chat is editing.

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
agent half is a worktree's chat, and what was left is a shell beside the work,
which is a dock tab. **One shell per place**, keyed by `worktreeId ?? folderId`:
clicking a project in the column points the dock at that project's shell,
clicking a worktree row at that checkout's. A cwd cannot be moved once a pty has
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

**The strip is per checkout.** A file tab and a chat tab belong to a **root** —
a project folder or one of its `git worktree` checkouts — and are in the strip
only while that root is the one being worked in (`rootOf` on each entry in
`PANELS`, `activeRootId`/`inScope`/`openInScope` in `lib/panels.ts`, over the
`shownRootOf` the Explorer and the title-bar crumb already resolve through, so
all three agree including the fallbacks). A table, a saved request and a note
have no `rootOf` and never leave: they are the workspace's by deliberate design,
and a half-written query should not vanish because somebody changed branch.

**In the strip is not open.** The tab stays open, its editor keeps its document
and its unsaved edits, and coming back to that checkout shows it again — the same
line `lib/files/roots.ts` was split along (`shownRootOf` is what is drawn,
`fileRootsOf` is what may be read), one level up. Three consequences worth
knowing: a drag hands back only what the strip was drawing, so `reorderTabs`
writes it into the slots those tabs already hold (`orderWhere` in
`lib/tab-groups.ts`, tested in `test/tab-groups.ts`) rather than handing a
partial list to a `reorder` that would close the rest; `Close others` and
`Close all` stop at the checkout's edge, since a menu cannot close tabs it was
not opened over; and moving the context can leave the pane showing something the
strip no longer holds, which `reconcileScope` answers — called from an effect in
`studio.tsx` rather than from `setActive`, because a store reaching into
`lib/panels.ts` would be a cycle. Most moves need it anyway: a worktree row opens
a chat in that checkout, and selecting a file or chat tab moves the context to
_its_ root rather than the other way round (`useFiles.reveal`,
`useWorktreeChats.select`).

**Grouped tabs: one tab per folder.** A panel's tabs can be gathered under the
folder each belongs to, so the workbench strip holds one tab per folder and a
second strip inside it holds that folder's own. `groupOf` on each entry in
`PANELS` is what a folder means per panel — the Explorer root a file sits in
(folder or checkout, so two branches' copies of one file are two tabs),
the checkout a chat is in, the folder in the panel's own tree a request or a note is
filed under, the schema a table belongs to (the Database panel groups by schema
rather than by connection, since only one connection's tabs are ever open, and
its query tabs gather under `NO_GROUP` as **Queries**) — and everything else is written once around it in `lib/panels.ts`:
a group's strip id is `api:@<folderId>` (`GROUP` in `lib/tabs.ts`, marked so a
folder open as an API tab cannot collide with the group its requests gather
into), and `groupIds`/`orderGroups`/`orderWithin` in `lib/tab-groups.ts` are the
pure half, tested in `test/tab-groups.ts`. It is **off** until switched on in
Settings › Tabs (`groupTabs` under `workbench.settings`), and that now goes for
**every** panel including the worktree chats. Those used to set an
`alwaysGroups`, on the argument that a chat tab stands for a conversation in a
checkout rather than for something the user opened; what that actually bought was
two tab strips on screen at once whenever a chat was open — the outer one the
branch, the inner one its chats — for a panel nobody had asked to group. The
field is gone rather than left unused, `grouper` reads only the setting, and a
chat is one tab in the one strip, with its branch — or, for a chat in a project's
own working tree, the project's name — on the tab's hover line (`tab-items.tsx`)
since the label cannot carry it. A second chat in a place is
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
chat with a checkout under it is about one repository — did not survive a worktree
chat being handed the same three servers on the same terms. What is left on disk
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

**The user's own `claude` servers can be added to that config**, one switch each
under `Your own servers` in the same dialog. `--strict-mcp-config` still holds
and is the reason this exists: a turn sees the file this app wrote and nothing
else, so the ClickUp somebody set up in the terminal was unreachable from the
chat editing the branch the ticket is about, with nothing on screen saying why.
`main/user-mcp.ts` reads `~/.claude.json` — the top-level `mcpServers` and
`projects.<dir>.mcpServers` both, since a checkout is inside none of those
directories and matching by one would hide exactly the servers a chat wants —
and the ones switched on are **copied** into `~/.tabomni/mcp.json` beside the
three, never inherited, with this app's own written last so a name it
pre-approves cannot be taken. A repository's `.mcp.json` is deliberately not
read. The setting is one key holding a JSON array of names
(`MCP_USER_SERVERS_KEY`), and `mcpUserServerNames` in `@shared/api` is the one
place that encoding lives, since the dialog and main both read it; anything that
does not parse is none of them. What a server is to a turn is **per permission
mode** and is `withUserServers` in `main/worktree-chat.ts`: pre-approved under
`edits`, **refused outright** under `plan`/`read` (nothing says which of a
server's tools read and which file a ticket, and unlisted is askable, which in
those modes is a stall), on neither list under `ask` so the card comes up, and
nothing under `full`. `ipc.ts` strips a server's own config — it holds the
tokens — before the listing crosses to the renderer, the way a database's
password is stripped. `test/user-mcp.ts` covers the pure halves. See the MCP
section of `docs/design.md`.

The four kinds are Explorer, Database, API and Notes — `SECTION_IDS` in
`lib/sections.ts` is the list and `components/studio/section-marks.tsx` puts a
label, an icon and a hue against each. They are no longer four ways of filling
one box: Database, Notes and API are sections of the left column and the
Explorer is the right-hand panel (see The left column above — there was an
activity rail before that, and a row of tabs after it, and both are gone). **There is no Terminal section, and no Terminal panel**: a
shell is a dock tab now (see The dock above). What draws in a pane with no
sidebar of its own is a worktree's chat, opened from the left column, so `Pane`
is `Section | "worktree"` and `showPane` leaves the sections alone for it. Those
chats are the one panel that is **always grouped** — one tab per checkout, that
checkout's chats in the strip inside it, and the `+` at its end starts another in
the same branch. Closing the tab closes every chat in it. There is no git panel, no code search, no specs panel and
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
files of the project and `git worktree` checkout being worked in, flat, with no
root row and no other project beside it — every checkout as a root was three
copies of one repository in one column, and every project as a heading was a
list to scroll past before the files somebody has open. Clicking a project or
worktree row in the column moves the tree, the chat and the dock's shell
together. **There is no bar above the list and no root row**: the left column
already says which project and branch are selected, so a strip repeating it was
chrome answering a question already on screen — what it carried, the root's own
menu (`New file`, `Refresh`, `Collapse all`, `Copy path`, `Reveal`,
`Add folder`, `Rename`, `Remove folder`), is the right-click on the empty space
under the tree, which is the only part of the panel that is about the checkout
rather than about a file in it. A tree long enough to fill the column leaves
only the list's bottom padding to right-click, which is known and accepted.
`FileTree` keeps the root path in `expanded` so it is read and watched without
being a row.
`activeFolderId` + `checkout` on `lib/projects.ts` is that selection —
per-project memory of the branch, so coming back lands where you left.
`lib/files/roots.ts` holds both lists and the difference matters:
`shownRootOf` is what the tree draws, `fileRootsOf` is every root there is —
what may be read, which tabs survive, which checkout a path belongs to — so
switching does not close the tabs of the place being left (both pure and
tested in `test/file-roots.ts`; `FileRoot.id` is `worktreeId ?? folderId`, the
shells' key). A checkout lives under `~/.tabomni/workspace/worktrees/` rather
than in the project, so it is inside no folder and has to be named as a root or
every read of it is refused: `fileRoots` in `src/main/ipc.ts` is main's list of
them all, feeding the gate, the watchers, the palette's walk and the tsservers
at once. Its
`files:*` calls all go through `insideAny` in `src/main/files.ts`, which is what
keeps an absolute path from the renderer inside the roots the workspace was
pointed at; deleting is `shell.trashItem` rather than `unlink`. Rows are
coloured by git and lettered at the end (`M`, `U`, `A`, `D`, `C`; ignored has
none) in the editors' own decoration colours — new green, modified tan, deleted
and conflicted red, ignored greyed — from one `git status` per root (`workingTree` in `src/main/git.ts`, held in
`lib/files/git-status.ts`, re-read on the watchers' events and on Refresh), so a
checkout is coloured by its own uncommitted work. A
wholly untracked or ignored directory arrives as one entry and is read as a
prefix, so `node_modules` costs one line. **The panel's header is two tabs —
`All files` and `Changes`** (`explorerTab` on `useStudio`, remembered with the
strip; `ExplorerTabButton` in `file-tree.tsx`). It was the word `Explorer` and a
row of buttons, which named the panel to somebody already looking at it, and
after an agent's turn the other list is the one being asked for. The bar under
them — project, branch, checkout picker — is shared, since both tabs are about
the same checkout. **The only button left is `Refresh`** — every other action is
on a menu over the thing it acts on (`New file` and `Collapse all` on the root
bar's menu or a directory row's, `Add folder` on the empty space under the tree
and in the File menu), and Refresh is the one that is about the panel rather
than about anything in it. An empty workspace draws the `Add folder` button
where the files would be, since the header no longer holds one. The tab carries the count, read for the
checkout on screen whichever tab is showing (`useWatchChanges`, called by the
panel and not by the list, for exactly that reason). **The list is the tab and
the diff is a pane of its own**: `changes` in `PANES`, `changes-pane.tsx` over
`lib/files/changes.ts`, one tab per checkout whose id **is** the root's — so
`rootOf` is the identity and the tab is in the strip only while that checkout is
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
real repository behind both it and `fileAtHead`. The file is shown as a **diff**:
`diff` is a `Viewer` beside `text` and the rest, so the same file opened from the
tree is an ordinary tab with the right-click menu switching back, and it is
Monaco's diff editor over the file's own model on the right (⌘S saves) and
`git show HEAD:<path>` on the left (`file-diff.tsx`, `monaco-diff.tsx`). **Both
sides are read-only**: a diff is read, and an editable right half over a left
half that refuses every keystroke is a pane that behaves two ways at once —
editing is the `Edit` half of the toggle in the header, one click and the same
buffer. The right side is still the file's own model, so the diff shows unsaved
edits and ⌘S still saves.
The header draws the path **relative to its root** with the absolute one on the
hover line, since a checkout's own is forty characters of
`~/.tabomni/workspace/worktrees/<uuid>/<branch>/` before it says anything about
the file; `Copy path` and `Reveal` still use the absolute one. Two
editors can hold one path's model — a file tab and the `Changes` diff of
it — so `modelFor` counts holders and `releaseModel` disposes at zero; before
that, whichever unmounted first took the buffer from the other. A
deleted file is why the diff is drawn ahead of the cannot-open notice: it has no
row in the tree, it is a row in Changes, and its diff is the whole of it
removed. The diff's toolbar is in the pane header beside the
path: `Diff | Edit` over the same `views` field, plus inline/side-by-side and
whitespace, the last two under `workbench.settings` (`diffSideBySide`,
`diffWhitespace`) and applied with `updateOptions`. Picking side by side also
clears `useInlineViewWhenSpaceIsLimited`, since Monaco otherwise falls back to
unified below 900px and overrules the button that was just pressed. **The diff is
also the one editor unmounted rather than hidden**: the panes are stacked and
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

**`@` is a worktree chat's**, and it inserts a **name** rather than a chip: the
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
agent conversation in this app is one the app itself holds — a worktree's
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
