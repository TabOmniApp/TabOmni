# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**TabOmni**: an Electron studio that collapses a project's tooling into one tab
strip — its folders, its databases, its HTTP endpoints, its notes, and the agent
and shell sessions run against them. The premise is that those are four or
five separate applications today, each with a window layout of its own, and
that switching between them costs more than any one of them saves.

There is one **workspace**, holding any number of **folders** — directories
already on this machine, worked on where they are. It is deliberately not
switchable: someone working across a frontend and its API has two folders open
at once, and a switch would take one of them, and every tab and session opened
against it, off the screen. Databases, requests, cookies and notes belong to
the workspace; what is per folder is what is genuinely per
repository — a session's cwd and a branch name. Sign-in will bring a
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
`ProcessManager`, `TerminalManager`, `ClaudeGuiManager`). Notable pieces:

- **`store.ts`** — all state on disk under `~/.tabomni`: `manifest.json` for the
  workspace/databases/settings, and `workspace/` for the panels' own files
  (requests, notes, cookies, per-database Docker data). A folder's own files
  are never under here — the manifest records an absolute path and they are read
  where they are. Database passwords are encrypted in the manifest and stripped
  field-by-field before a record crosses to the renderer.
- **`daemon.ts` + `daemon-client.ts`** — ptys live in a detached, per-machine
  daemon spoken to over a Unix socket/named pipe with newline-delimited JSON.
  They no longer outlive the app: `TerminalManager.killAll()` is awaited on
  quit, and nothing reattaches, so a session always runs the command the
  current build would give it rather than whatever flags it happened to be
  started with. What carries across a launch is the _conversation_, reopened
  with `--resume`. `daemon.ts` gets its own esbuild entry point and is
  `asarUnpack`ed.
- **`transcript.ts`** — the chat view of a `claude` session. There is no second
  process: a session is always the interactive CLI in a pty, and the chat tails
  the transcript the CLI writes at
  `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. Sessions are started
  with `--session-id` so the file for a tab is known rather than guessed at.
  Reading a file, not driving the CLI, is what makes Chat and Terminal two
  views of one conversation — and is why replies arrive a message at a time and
  permission prompts are answered in the terminal view.
- **`preview.ts` + `note-html.ts` + `note-blocks.ts`** — a note, served as a
  finished page on loopback. Server-rendered on purpose: the page has to be
  readable by something that fetches rather than renders, which rules out
  BlockNote's own HTML export (a method on an editor, so a DOM). Port picked by
  the OS, a per-run secret in the path, and a link that lives only as long as
  the app run. See the Preview section of `docs/design.md`.
- **`http.ts`** — API requests are sent from the main process, so there is no
  page origin, no CORS preflight, and forbidden headers go out as typed. The
  cookie jar in `cookies.json` is the panel's own, not Chromium's.
- **`agent-tools.ts`** — what each agent session kind runs, how it installs, and
  whether it is present. The picker is built from it so it cannot offer
  something that would not start.

- **`assistant.ts`** — the workspace assistant: the chat panel behind the button
  in the title bar, one conversation, `claude -p` per turn in
  `--output-format stream-json`. It is the counterpart to a Terminal session
  rather than a smaller one — a session has a folder under it, and this is about
  the workspace, so it gets the MCP servers, `--add-dir` for every folder, and
  `--strict-mcp-config` (a session keeps the user's own servers; this panel is
  the app's). **Read-only by denylist**: `--allowed-tools` only pre-approves,
  so `--disallowed-tools` is what actually refuses Bash, the edit tools and
  everything reaching outside the turn. See the comment on `DISALLOWED_TOOLS`
  before changing it, and the Assistant section of `docs/design.md`.

`assistant.ts` is the _only_ `claude -p` in the app. The Data tab's AI filter
and the API panel's AI import went through an `askClaude` in `ai-cli.ts`, and
all of it — the two features and that helper — was removed rather than left
hidden; the assistant is a conversation the user is having, not a helper other
features call. Nothing else spawns `claude` outside a pty, and a Terminal
session still runs it interactively in one.

## Renderer (`src/renderer/`)

React 19 + Vite + Tailwind v4. `components/studio/` is split by panel
(`terminal`, `api`, `db`, `note`, `files`), and each panel's logic and zustand
store live in the matching `lib/` directory (`lib/terminal/store.ts`,
`lib/db/explorer-store.ts`, …) with `lib/store.ts` holding the studio-wide
state and `lib/workspace.ts` the thin repo over the workspace calls — all
relative to `src/renderer/`. Selecting anything brings its own sidebar to the rail
(`showPane` moves both), opens whatever holds it — each panel's own `select`
does that, since what "holds" a thing differs per panel — and `SideRow` scrolls
the active row into view for all of them. The rail moving the sidebar still
leaves the pane alone; only the other direction is coupled. A pane that is not a
rail section — the sessions' — takes the pane and leaves the sidebar alone, since
the row that was clicked is in the sidebar already showing. No panel store
clears itself any more: there is no
switch to clear for, and the only one that follows the folders at all is the
Terminal store, which drops a removed folder's sessions. Every code editor is
Monaco, set up once in `lib/monaco.ts` and always behind a `lazy` so its ~4 MB
of grammars stays out of the launch bundle. What a panel adds to it lives with
that panel: the Explorer's grammars and TypeScript wiring in
`lib/files/monaco.ts`, whose hovers and go-to-definition come from a real
`tsserver` per folder in `src/main/tsserver.ts` (the folder's own `typescript`,
and nothing if it has none); the SQL console's schema completion in
`lib/db/sql-completion.ts`, which Monaco ships no language service for; and the
request body's own grammar in `lib/http/body-language.ts`, because a body full
of `{{variables}}` is a template rather than the JSON it looks like. Terminals
are xterm.

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
nothing else — no tab, no rail section: `components/studio/settings-dialog.tsx`,
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

**The assistant** is the chat panel on the right, opened from the button in the
title bar: `components/studio/assistant/assistant-panel.tsx` over
`lib/assistant/store.ts`, with the chats themselves held by `main/assistant.ts`
(listing in `chats.json`, lines in `chats/<id>.json`) so a turn survives the
panel being closed. It opens on the list of chats — straight onto the composer
only when there are none — and a chat is deleted from its row. It is the way to
use the MCP servers below without being inside a folder's session: the turn runs
in an empty `~/.tabomni/assistant` with every folder reached by `--add-dir`, so
no folder is current, and an `--append-system-prompt` says so.

**MCP: the workspace as tools.** `src/main/mcp.ts` serves the Database, API and
Notes panels to an agent session as three MCP servers — one streamable-HTTP
server on loopback with a per-run secret, bound the way `preview.ts` binds its
own, three tools apiece. Each is **off** until switched on in Settings › MCP
(`mcp.database` / `mcp.api` / `mcp.notes`; the keys are in `@shared/api` because
main answers with them too), and a `claude` session is started with
`--mcp-config ~/.tabomni/mcp.json` naming whichever are on. Every call rechecks
the setting, so turning one off stops a running session using it. A request an
agent sends is resolved by `@shared/http-request` — the same substitution and
folder cascade the API panel uses, moved there so there is one of it. `test/mcp.ts`
drives it over a real socket. See the MCP section of `docs/design.md`.

The activity rail is Explorer, Database, API and Notes — four sections,
`SECTION_IDS` in `lib/rail.ts` is the list and `components/studio/activity-bar.tsx`
puts a label and an icon against each. **There is no Terminal section**: a
session is started and listed in the Explorer sidebar and draws in a pane with
no sidebar of its own, so `Pane` is `Section | "terminal"` and `showPane` leaves
the rail alone for it. There is no git panel, no code search, no specs panel and
no webhook catcher either: all four were removed rather than left hidden, and the
only thing git is still asked is each folder's branch name, shown beside the
folder in the Explorer tree. The sidebar itself closes — `⌘B`, **View ›
Sidebar**, or a click on the rail icon already showing; `sidebar` on the studio
store, remembered with the strip, and the panel is collapsed rather than
unmounted so its width survives. `⌘B` is refused inside anything
`contenteditable`, where it is bold (`isEditingRichText` in `lib/shortcuts.ts`).

Explorer is the workspace's folders as directories — expanded a level at a
time, nothing hidden, and watched only where it is expanded: one non-recursive
`fs.watch` per open folder (`src/main/watch.ts`, driven by the `expanded` set
through `lib/files/watch.ts`), closed again when the row is collapsed. Refresh
is still the header button, for the filesystems `fs.watch` is quiet on and for
the palette's index, which nothing watches. Its
`files:*` calls all go through `insideAny` in `src/main/files.ts`, which is what
keeps an absolute path from the renderer inside the folders the workspace was
pointed at; deleting is `shell.trashItem` rather than `unlink`. Rows are
coloured by git and lettered at the end (`M`, `U`, `A`, `D`, `C`; ignored has
none) in the editors' own decoration colours — new green, modified tan, deleted
and conflicted red, ignored greyed — from one `git status` per folder (`workingTree` in `src/main/git.ts`, held in
`lib/files/git-status.ts`, re-read on the watchers' events and on Refresh). A
wholly untracked or ignored directory arrives as one entry and is read as a
prefix, so `node_modules` costs one line. A deleted file has no row at all, so
it is its **tab** that says `deleted`, either because git says so or because
the listing the tree holds no longer mentions it. `⌘P` searches files too — the one index in the palette
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

**`@` in the chat composer** offers what the other panels hold — a table with
its columns, a saved request resolved against the active environment, a note —
as a **chip**: the thing's own name in that panel's colour, which
`expandMentions` swaps for one line of context when the message is sent. The chip
is a link to `tabomni://mention/<kind>:<id>`, and its kind reaches the DOM as
`data-mention` because Milkdown empties an unknown scheme's href.
`lib/terminal/mention-text.ts` holds the rules (and is the testable half),
`lib/terminal/mentions.ts` the catalogue that reads the three stores, and
`components/studio/terminal/composer-mention.tsx` the menu, built on the same
`@milkdown/plugin-slash` machinery as the `/` menu. Nothing runs a query. **What a turn changed**
comes from the same transcript: `writtenPaths` in `lib/terminal/touched.ts` reads
the write tools' own arguments, a strip under the conversation lists the files,
and `syncPaths` in the files store re-reads exactly those — kept beside the
watchers because it names a file as the tool call is recorded, without their
debounce, and works where `fs.watch` does not. Both are in the Terminal sessions part of
`docs/design.md`.

There was a **Conversations** section under the tree — every `claude` transcript
the workspace's folders had on disk, read-only in a tab of the Explorer pane with
a `Resume` that handed one to a real session. It is gone, deleted rather than
hidden: no list, no read-only view, no store, and the Explorer pane's tabs are
files again. `listSessions` in `src/main/transcript.ts` stays, because the chat
view's **Past sessions** drawer reads the same directory `--resume` reads — that
drawer, inside a running session, is now the only way to a conversation this app
did not start. See the Conversations, removed section of `docs/design.md`.

**The workspace's folders belong to Explorer**, and are added, renamed and
removed there and nowhere else (`components/studio/files/file-tree.tsx`) — the
list that says what the workspace is pointed at is the one that changes it. The
Terminal sidebar used to carry the same three actions on a second copy of the
folder list — and then stopped existing altogether: **Sessions** is now a
section under the tree (`components/studio/files/sessions-list.tsx`), listing the
workspace's sessions under the folder each runs in, with the closed ones dimmed
below. A folder's right-click menu in the tree also holds `New session here…`.
Both that and the list's `+` open the picker `studio.tsx` mounts off `picking` in
`lib/terminal/store.ts` — mounted there rather than in the sidebar, which the
rail unmounts when it moves. The File menu's `add-folder` command opens the same
Add folder dialog, which is what a rail with the Explorer section hidden falls
back to.

Notes is a workspace-wide scratchpad — folders and markdown files, filed and
right-clicked the way the API panel's requests are. `lib/tree.ts` is the tree
both sidebars are built from (nesting, the drag-reparent cycle guard, the
delete count, the ancestor chain a selection is revealed through); `lib/http/folders.ts` delegates to it and keeps only the
cascading headers and params that are the API panel's own. A note's listing is
`notes.json` and its text is `notes/<id>.md` beside it, so typing rewrites one
note rather than all of them and what is left on disk is readable without this
app. A picture dropped, pasted or uploaded into a note is a file of the
workspace's own under `workspace/note-files/`, and the note holds a
`note-file://` URL for it — `shared/note-files.ts` is that URL's shape,
`main/protocol.ts` serves it to the renderer and the preview server inlines it
for a browser that has never heard of the scheme. The editor is Crepe — the same Milkdown editor as the chat composer, and
themed by the same `milkdown-theme.css`, so it follows the theme without
a second palette. See the Notes section of `docs/design.md` before changing it.

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
nothing of either is left in the code, the rail, the contract or the `@` menu.
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
