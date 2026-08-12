# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**TabOmni**: an Electron studio that collapses a project's tooling into one tab
strip — its folders, its databases, its HTTP endpoints, its mail and webhooks,
and the agent and shell sessions run against them. The premise is that those are four or
five separate applications today, each with a window layout of its own, and
that switching between them costs more than any one of them saves.

There is one **workspace**, holding any number of **folders** — directories
already on this machine, worked on where they are. It is deliberately not
switchable: someone working across a frontend and its API has two folders open
at once, and a switch would take one of them, and every tab and session opened
against it, off the screen. Databases, requests, cookies and the two capture
servers belong to the workspace; what is per folder is what is genuinely per
repository — a session's cwd and a branch name. Sign-in will bring a
second workspace; until then `DEFAULT_WORKSPACE_ID` is a constant.

One package, no workspaces. `src/main/` is the Electron main process,
`src/preload/` the one bridge script, `src/renderer/` the React app, and
`src/shared/` the contract between the two. The shadcn/ui components live in
`src/renderer/components/ui/` like any other component.

`docs/design.md` is the design document for the app itself — how the
workspace's data lives on disk, how the Claude Code chat view works, how the
filter builder and the capture servers behave. Read it before changing those
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
`test/inbox.ts` holds a real SMTP conversation over a real socket, rather than
checking either parser against a hand-written sample. They cover the chat
view's tail (a read landing mid-line, a multi-byte character split across two
reads, a file truncated under the watcher) and the two capture servers (a
`DATA` terminator straddling two packets, a dot-stuffed line, a boundary that
also occurs inside a part's own content).

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
  (requests, cookies, captures, per-database Docker data). A folder's own files
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

AI features (`ai-filter.ts`, `ai-import.ts`) both go through `askClaude` in
`ai-cli.ts`, which shells out to `claude -p` — the CLI already installed for the
Terminal panel — rather than an API needing a key. What comes back is treated as
untrusted: every proposed filter condition is checked
against the columns and operators that actually exist, so a hallucinated column
yields one fewer condition rather than a broken clause.

## Renderer (`src/renderer/`)

React 19 + Vite + Tailwind v4. `components/studio/` is split by panel
(`terminal`, `api`, `db`, `inbox`), and each panel's logic and zustand
store live in the matching `lib/` directory (`lib/terminal/store.ts`,
`lib/db/explorer-store.ts`, …) with `lib/store.ts` holding the studio-wide
state and `lib/workspace.ts` the thin repo over the workspace calls — all
relative to `src/renderer/`. Selecting anything brings its own sidebar to the rail
(`showPane` moves both), opens whatever holds it — each panel's own `select`
does that, since what "holds" a thing differs per panel — and `SideRow` scrolls
the active row into view for all of them. The rail moving the sidebar still
leaves the pane alone; only the other direction is coupled. No panel store
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

The activity rail is Explorer, Database, API, Mail, Webhooks, Terminal and
Notes, and `components/studio/activity-bar.tsx` is the one list that says so.
There is no git panel, no code search and no specs panel: all three were removed
rather than left hidden, and the only thing git is still asked is each folder's
branch name, shown beside the folder in the Explorer and Terminal sidebars.

Explorer is the workspace's folders as directories — expanded a level at a
time, nothing hidden, nothing watched (Refresh is the header button). Its
`files:*` calls all go through `insideAny` in `src/main/files.ts`, which is what
keeps an absolute path from the renderer inside the folders the workspace was
pointed at; deleting is `shell.trashItem` rather than `unlink`. `⌘P` searches files too — the one index in the palette
(`files:index` walks the workspace once per run; `lib/files/search.ts` shortlists
before cmdk scores). Images open in an image view, and the files that are
honestly two things — an SVG, and a `.md`, which opens in the editor and has a
rendered **Markdown preview** beside it — are switched between from their
right-click menu (`lib/files/viewers.ts` is the one place that decides, and
`components/studio/markdown-view.tsx` is the renderer the chat view uses too). Rows carry a vendored vscode-icons file-type icon —
`lib/files/icon-names.ts` maps a name to one, `assets/file-icons/README.md`
says what is checked in and why it is a subset. A file tab is
addressed by its own absolute path, and `lib/files/paths.ts` is the one place
that splits one — it accepts both separators, unlike `lib/runtime/tree.ts`,
which is for paths this app made up. See the Explorer section of
`docs/design.md`.

Notes is a workspace-wide scratchpad — folders and markdown files, filed and
right-clicked the way the API panel's requests are. `lib/tree.ts` is the tree
both sidebars are built from (nesting, the drag-reparent cycle guard, the
delete count, the ancestor chain a selection is revealed through); `lib/http/folders.ts` delegates to it and keeps only the
cascading headers and params that are the API panel's own. A note's listing is
`notes.json` and its text is `notes/<id>.md` beside it, so typing rewrites one
note rather than all of them and what is left on disk is readable without this
app. The editor is Crepe — the same Milkdown editor as the chat composer, and
themed by the same `milkdown-theme.css`, so it follows the theme toggle without
a second palette. See the Notes section of `docs/design.md` before changing it.

`/drawing` in a note opens an Excalidraw canvas — shapes, arrows, freehand,
images — in a dialog, and leaves the finished drawing in the note as an exported
SVG. The scene is its own `workspace/drawings/<id>.excalidraw` file and the note
holds only the id, in a ```drawing fence; `drawing-node.ts` is the ProseMirror
node behind that fence, and the comment on
`keepDrawingFencesOutOfCodeBlocks` is the one thing to read before touching it.
Excalidraw is loaded on demand and its fonts are served by this app rather than
from a CDN — see the `excalidraw-fonts` plugin in `vite.config.ts`.

The workspace's folders are listed, added and removed in that same sidebar
(`components/studio/terminal/terminal-sidebar.tsx`), rather than in a menu of
their own above the rail. Terminal is the only panel that works _in_ a folder —
a session is a pty in its directory — while the databases, requests and
captures belong to the workspace as a whole, so folder management sits beside
the one thing it changes. The File menu's `add-folder` command opens the same
dialog, which is what a rail with the Terminal section hidden falls back to.

Mail and Webhooks are the other end of the API panel: two servers on loopback —
an SMTP sink and a catch-all HTTP endpoint — catching the mail the project sends
and the callbacks fired at it. `src/main/inbox.ts` is both servers and
`src/main/mime.ts` the parser; neither pulls in a dependency, so the studio
does not behave differently depending on what the user happened to have
installed. A captured request can be replayed verbatim at any URL.

They are **two rail sections and one implementation**, which is why
`components/studio/inbox/` and `lib/inbox/store.ts` are singular while the rail
is not. The panels are separate because they replace separate applications and
are read in different frames of mind; the servers, the capped list of captures
and the file holding it are one of each, and two stores would mean two
subscriptions to the same event. `CaptureList` and `ServerSettings` take a
`server` prop; each panel starts, stops and clears only its own. See
`docs/design.md`.

## Conventions

- Prettier: no semicolons, double quotes, 80 columns, es5 trailing commas.
- Comments explain **why**, not what — which failure a constant was written
  against, why an approach was rejected. A comment restating the line below it is
  noise. Match the density and tone of the surrounding code.
- `*.local.*` is gitignored scratch. Use that suffix for repros and one-off
  experiments instead of leaving files untracked or committing them.
- Changes under `electron/` or `shared/` need `bun dev` restarted; only the
  renderer hot-reloads.
