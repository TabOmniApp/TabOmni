# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

This file is the **operating manual**: the commands, the contracts, and the
handful of constraints that cost a debugging session if you do not know them.
It is deliberately short, because every turn in this repository pays for it.

**`docs/design.md` is the design document** — what each panel does and why, how
the workspace's data lives on disk, every argument that was had and every
feature that was removed. Read the relevant section there before changing an
area's behaviour. When the two disagree, `design.md` is the fuller account.

## What this is

**TabOmni**: an Electron studio that collapses a project's tooling into one tab
strip — its folders, its databases, its HTTP endpoints, its notes, and the agent
conversations run against them.

There is one **workspace**, holding any number of **folders** — directories
already on this machine, worked on where they are. It is deliberately not
switchable. Databases, requests, cookies and notes belong to the workspace;
what is per folder is what is genuinely per repository — a shell's cwd, a run
command, a branch name. Sign-in will bring a second workspace; until then
`DEFAULT_WORKSPACE_ID` is a constant.

One package, no monorepo workspaces. `src/main/` is the Electron main process,
`src/preload/` the one bridge script, `src/renderer/` the React app, and
`src/shared/` the contract between the two.

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

A `Makefile` wraps packaging — `make dmg` (this machine's arch), `make
dmg-arm64` / `dmg-x64` / `dmg-universal`, `make app` (unpacked `.app`, faster
for a smoke test), `make help` for the rest. Unsigned unless `SIGN=1`.

### Tests

Plain `bun` scripts under `test/`, no test framework — see `test/harness.ts` for
the reasoning. `bun run test` runs `scripts/test.mjs`, which discovers every
`.ts` in that directory (skipping `harness.ts` and `*.local.*`), so adding a
test is dropping a file in. Run one directly while working on it:

```bash
bun test/transcript.ts
```

The tests that touch the world do so for real rather than against a fixture:
`test/files.ts` creates, renames and indexes real files, and `test/git-changes.ts`
drives a real repository.

## The IPC contract — the one rule that matters

The main process (`src/main/`) and the renderer (`src/renderer/`) **never import
each other**. Everything crossing between them is:

1. a method on `DesktopApi` in `src/shared/api.ts` (types only, no runtime code),
2. a channel name in the `IPC` map at the bottom of that same file,
3. a thunk in `src/preload/index.ts`,
4. a handler in `src/main/ipc.ts`.

Adding or changing a call means touching all four. That is deliberate — the
alternative is two sides that disagree about what a call returns. The renderer
reaches the contract through the `@shared/*` alias; `@/*` is `src/renderer`.

## Main process (`src/main/`)

`main.ts` creates the window and calls `registerIpc()`; `ipc.ts` owns every
handler and the long-lived managers (`Store`, `SqlConnections`, `DockerRuntime`,
`ProcessManager`, `TerminalManager`, `WorktreeChats`).

- **`store.ts`** — all state on disk under `~/.tabomni`: `manifest.json` for the
  workspace/databases/settings, `workspace/` for the panels' own files. A
  folder's own files are never under here — the manifest records an absolute
  path and they are read where they are. Database passwords are encrypted in the
  manifest and stripped field-by-field before a record crosses to the renderer.
- **`daemon.ts` + `daemon-client.ts`** — ptys live in a detached, per-machine
  daemon over a Unix socket/named pipe with newline-delimited JSON.
  `TerminalManager.killAll()` is awaited on quit and nothing reattaches.
  `daemon.ts` gets its own esbuild entry point and is `asarUnpack`ed.
- **`preview.ts` + `note-html.ts` + `note-blocks.ts`** — a note served as a
  finished page on loopback. Server-rendered because the page has to be readable
  by something that fetches rather than renders, which rules out BlockNote's own
  HTML export. OS-picked port, per-run secret in the path, link lives only as
  long as the app run.
- **`http.ts`** — API requests are sent from the main process, so there is no
  page origin, no CORS preflight, and forbidden headers go out as typed. The
  cookie jar in `cookies.json` is the panel's own, not Chromium's.
- **`files.ts`** — every `files:*` call goes through `insideAny`, which is what
  keeps an absolute path from the renderer inside the roots the workspace was
  pointed at. Deleting is `shell.trashItem`, never `unlink`. `fileRoots` in
  `ipc.ts` is main's one list of roots, feeding the gate, the watchers, the
  palette's walk and the tsservers at once.
- **`git.ts`** — `workingTree` for the tree's colours, `changes()` for the
  Changes tab (`git status` with the ignored dropped, plus a `git diff
--numstat` per side of the index), `fileAtHead` for the diff's left side, and
  `stage` / `unstage` / `discard` for the list's menu. No git panel exists and
  **nothing commits** — that line is deliberate, see `docs/design.md`. `discard`
  answers with the paths it could not restore instead of deleting them: they go
  to the trash in `ipc.ts`, because this module stays free of `electron` so the
  tests can import it.
- **`tsserver.ts`** — one per Explorer root, using _that root's own_
  `typescript`, and nothing if it has none.
- **`mcp-servers.ts`** — which MCP servers the user's own `claude` has, asked of
  it over the SDK's control channel (`mcpServerStatus()`) in a project's own
  directory, for the listing in Settings › MCP, plus `removeMcpServer`, which
  runs the CLI's own `claude mcp remove`. **This app serves no MCP server of its
  own**: the three that served the Database, API and Notes panels are deleted —
  see `docs/design.md`. What it does still say about MCP is which _tools_ a chat
  may call, from `MCP_DISABLED_TOOLS_KEY`, handed over as `disallowedTools`.

### `worktree-chat.ts` + `claude-agent.ts` — the only `claude` in the app

`worktree-chat.ts` is the policy, `claude-agent.ts` the SDK runner under it. A
chat is `@anthropic-ai/claude-agent-sdk`, not a `spawn` of `claude -p`. Five
things are not visible from the option names:

1. `pathToClaudeCodeExecutable` is the **user's own** `claude` (their login,
   their `CLAUDE_BIN`), located through their login shell — a GUI app inherits
   almost none of their `PATH`.
2. No `--mcp-config` goes over at all, so a turn gets exactly the servers the
   CLI finds for itself in that directory. There used to be one, through
   `extraArgs` rather than the SDK's `mcpServers` option, which serialises a
   config onto a command line every process on the machine can read.
3. `appendSystemPrompt` is an `initialize` frame on stdin, not a flag.
4. The SDK throws only when the **process** ends, not on an error result — that
   is true of streaming input; with a string prompt it threw after delivering
   the result as a message too. The `finished` guard on `onExit` is what keeps
   one death being reported once.
5. `main.cjs` gets its own esbuild build — the package is ESM and its
   `import.meta.url` becomes `{}` under a CJS bundle, so a `define`/banner
   points it at a real file URL. That banner must not go near the sandboxed
   preload.

**What the CLI is handed is identical on every turn of every mode**, and this is
load-bearing rather than tidiness. `allowedTools`, `disallowedTools` and a
per-mode `appendSystemPrompt` are all part of the request's **cached prefix** —
tool definitions sit ahead of the system prompt — so expressing a mode in them
meant changing mode mid-chat threw the prefix away. Measured here against a 43k
prompt: **42,345 tokens re-written and none read**, against 103 for a turn that
changed nothing. So no `allowedTools` at all, one `permissionMode` (`manual`),
one system prompt, and a `disallowedTools` that is **not** a mode's business —
the workspace's switched-off MCP tools, identical on every turn until somebody
changes the setting; the mode is applied in-process by `permits`,
which `deciding` in `claude-agent.ts` consults, and the mode's own sentence goes
at the head of the **message**. A switch now costs 100–170 tokens.

Two traps behind that, worth knowing before adding a tool list back:

- A bare tool name on `allowedTools` **auto-approves before `canUseTool` is
  consulted** (the SDK warns on stderr), so a mode's own callback is never
  reached for anything that mode listed.
- `permissionMode: "bypassPermissions"` skips `canUseTool` entirely, which makes
  any refusal named beside it a request rather than a guarantee.

`PERMISSIONS` is the one table of the five modes — `Plan` / `Read only` / `Ask`
/ `Edits` / `Full access` — each holding what it permits, what the turn is told,
and whether it may stop to ask. Plan mode is a permit list, **not**
`--permission-mode plan`: that mode ends by asking, `ExitPlanMode` is a prompt,
and a turn started that way spends itself trying to leave.

`Ask` is the mode that stops: an unpermitted call comes back through
`canUseTool` as a card above the composer, and the promise `WorktreeChats.ask`
returns **is** the pause — nothing times it out. `endTurn` and `dispose` both
settle outstanding asks, or the CLI waits on a promise nobody will resolve.

**A chat is one CLI held open, not a process per message.** `query()` is given
an async iterable (`Inbox`), which is the SDK's streaming input mode, so a
message sent while a turn is running is pushed to the same process and the CLI
queues it — that is what makes the composer live mid-answer, and `Stop` an
`interrupt()` rather than a kill. Four consequences to know before touching it:

- `result` ends a **turn** (`onTurn`); the session ends when the stream does
  (`onExit`). They were one `onDone`.
- `modelUsage` and `total_cost_usd` are the **session's running total** on every
  result. `usageOf` subtracts the previous result, per model, and reads a
  backwards total as a reset rather than a refund.
- Whether a chat is busy is main's to say — the `busy` event, off the CLI's
  `session_state_changed` where there is one. A turn ending is not the chat
  going quiet: another message may already be queued.
- Model and effort move under a running session (`setModel`,
  `applyFlagSettings`), and the permission never went to the CLI at all. `cwd`,
  `CLAUDE_CONFIG_DIR` and the switched-off MCP tools **cannot** — a change to any
  of them closes the session and opens another (`signatureOf`).

A session with nothing to do for `IDLE_MS` is closed, silently: the alternative
is a `claude` per conversation resident all day, and reopening costs exactly
what every message used to.

A chat's id **is** the CLI's session id, so whether a session opens with
`sessionId` or `resume` is `started` on the record rather than a `Set` in the
process. A chat's lines are `workspace/worktree-chats/<id>.json`, listed in
`workspace/worktree-chats.json`. The cwd resolve is deliberately **not** a
fallback chain: a chat whose folder has left the workspace finishes with a line
saying so rather than running its next turn in whichever directory is readable.

No MCP config is passed, so whatever the user's own `claude` is configured with —
`~/.claude.json`, a repository's `.mcp.json`, enabled plugins, claude.ai
connectors — reaches a turn the way it would running plain `claude` in that
directory, minus whatever Settings › MCP has switched off. The cost is that
`Plan` and `Read only` cannot refuse a server _by name_, since this app
configures none and so has no name for one; an unlisted tool is still refused by
`deciding`.

A switched-off tool is a **wire** name (`mcp__claude_ai_ClickUp__clickup_search`),
not the name the listing shows: the CLI normalises a server's configured name
into it, so `wireServer` in `lib/worktree-chat/mcp-servers.ts` is what an entry
has to be built through or it matches nothing. Verified against the CLI's `init`
frame: two named tools disallowed are two tools **absent from the model's list**,
not refused on use.

## Renderer (`src/renderer/`)

React 19 + Vite + Tailwind v4. `components/studio/` is split by panel
(`worktree`, `api`, `db`, `note`, `files`), and each panel's logic and zustand
store live in the matching `lib/` directory, with `lib/store.ts` holding the
studio-wide state and `lib/workspace.ts` the thin repo over the workspace calls.
`components/ui/` is shadcn/ui — add to it with the CLI (`bunx shadcn@latest add
dialog`), not by hand. Vite's root is `src/renderer`, so `index.html` and
`public/` are there too.

The shape, in one pass: the **left column** (`workspace-sidebar.tsx`) is
`Projects` and nothing else for now — `SIDEBAR_SECTIONS` in `lib/projects.ts` is
the one line saying which sections are drawn, and putting `Database` / `Notes` /
`API` back is adding an id to it; those panels, stores and tabs all still work.
The **right-hand panel** is Explorer, with `All files` and `Changes` tabs. The
**dock** below it is `Run` and `Terminal`, collapsed rather than unmounted
because a pty taken out of the tree ends. A project's rows are its **chats**.

### Constraints that bite

- **One copy of `@codemirror/view`, enforced twice.** A CodeMirror extension is
  identified by the object it was built from, so two copies of that package are
  two `EditorView.theme` facets and an extension that is silently inert — no
  error, the theme simply does not apply. Milkdown depends on the same packages
  and this install resolves thirteen nested copies at the _same version_, so
  neither the package manager nor `tsc` sees a conflict. `package.json` pins the
  version exactly and `resolve.dedupe` in `vite.config.ts` pins the module.
  **Read the comments on both before touching either.**
- **Every editor is CodeMirror**, set up once in `lib/editor.ts` and always
  behind a `lazy`. A language is a _dynamic import_ rather than a bundled
  grammar (`lib/editor-languages.ts`, 143 of them), so an editor opens in plain
  text and colours a frame later. There are no workers. The one thing this costs
  is that **`.ts` files get no syntax squiggles** — Lezer parses and does not
  diagnose.
- **`lib/files/documents.ts` is a document registry that had to be written**,
  because Monaco owned its documents and CodeMirror deliberately does not. Two
  editors can hold one path's buffer (a file tab and the `Changes` diff of it);
  it counts holders, drops the buffer at zero, forwards edits between views on
  the same path, and hands an editable view's undo history and caret to the next
  one. Only one view of a path can ever be typed into — a diff is read-only on
  both sides.
- **The diff is the one editor unmounted rather than hidden.** The panes are
  stacked and hidden with `invisible` to keep editing state; a live diff painted
  its bands through whatever pane was showing.
- **`PANELS` in `lib/panels.ts` is where a tab's identity lives.** `rootOf` says
  which project a tab belongs to (it is in the strip only while that project is
  active); `groupOf` says what a folder means per panel when grouping is on. A
  table, a saved request and a note have no `rootOf` and never leave the strip.
  `reconcileScope` is called from an effect in `studio.tsx`, not from `setActive`
  — a store reaching into `lib/panels.ts` would be a cycle.
- **`lib/files/roots.ts` holds two lists and the difference matters**:
  `shownRootOf` is what the tree draws, `fileRootsOf` is every root there is —
  what may be read, which tabs survive, which project a path belongs to.
- **`lib/files/paths.ts` is the one place a file path is split.** It accepts both
  separators, unlike `lib/runtime/tree.ts`, which is for paths this app made up.
- **`@shared/tree`** holds `descendantFolderIds` and `isDescendant`. They are
  shared because main used to delete a request folder too (through the MCP server
  that is now gone); the renderer is the only reader left, through
  `lib/tree.ts`, which re-exports them.
- **Excalidraw fonts are served by this app**, not from a CDN — see the
  `excalidraw-fonts` plugin in `vite.config.ts`. A drawing's scene is its own
  `workspace/drawings/<id>.excalidraw` file and the note holds only the id, in a
  ```drawing fence; read the comment on `keepDrawingFencesOutOfCodeBlocks`
  before touching `drawing-node.ts`.
- **A picture in a note is a file of the workspace's own** under
  `workspace/note-files/`, addressed by a `note-file://` URL — `shared/note-files.ts`
  is the shape, `main/protocol.ts` serves it, and the preview server inlines it
  for a browser that has never heard of the scheme.
- **Animation is CSS**, in `styles/motion.css`, and an animation added anywhere
  else should go there too.

### Pure halves, where the tests are

Logic worth testing is split out from the drawing: `lib/worktree-chat/activity.ts`
(`test/chat-activity.ts`), `lib/worktree-chat/usage.ts` (`test/chat-usage.ts`),
`lib/files/review.ts` (`test/review.ts`), `lib/tab-groups.ts`
(`test/tab-groups.ts`), `lib/files/roots.ts` (`test/file-roots.ts`),
`lib/files/block-doc.ts`, `lib/worktree-chat/mention-text.ts`
(`test/chat-mentions.ts`), `lib/worktree-chat/mcp-servers.ts` with
`main/mcp-servers.ts`'s own `readServer` (`test/mcp-servers.ts`). Put new logic on that side of the line.

## Conventions

- Prettier: no semicolons, double quotes, 80 columns, es5 trailing commas.
- Comments explain **why**, not what — which failure a constant was written
  against, why an approach was rejected. A comment restating the line below it is
  noise. Match the density and tone of the surrounding code.
- `*.local.*` is gitignored scratch. Use that suffix for repros and one-off
  experiments instead of leaving files untracked or committing them.
- Changes under `src/main/`, `src/preload/` or `src/shared/` need `bun dev`
  restarted; only the renderer hot-reloads.
- Removing a feature means **deleting** it — its store, its channels, its tests,
  its types — rather than hiding it, and recording the argument in
  `docs/design.md`. What is already on a user's disk is left alone: nothing
  reads `workspace/mail.json` or `workspace/tasks.json` any more, and nothing
  deletes them either.
