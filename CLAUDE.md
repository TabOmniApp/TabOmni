# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Tabula**: an Electron studio that collapses a project's tooling into one tab
strip — its file tree, its databases, its HTTP endpoints, its specs, and the
agent and shell sessions run against it. The premise is that those are four or
five separate applications today, each with a window layout of its own, and
that switching between them costs more than any one of them saves.

One package, no workspaces. `src/main/` is the Electron main process,
`src/preload/` the one bridge script, `src/renderer/` the React app, and
`src/shared/` the contract between the two. The shadcn/ui components live in
`src/renderer/components/ui/` like any other component.

`docs/design.md` is the design document for the app itself — how a
project's data lives on disk, how the Claude Code chat view works, how the
filter builder and the spec canvas behave. Read it before changing those areas.

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

- **`store.ts`** — all project state on disk under `~/.tabula`: `manifest.json`
  for projects/databases/settings, `projects/<id>/` for a scaffolded project's
  `source/` and per-database data. Database passwords are encrypted in the
  manifest and stripped field-by-field before a record crosses to the renderer.
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
- **`project-files.ts`** — the single definition of what belongs to a project
  (skipped dirs, binary extensions, size ceiling), imported by `store.ts`
  rather than restated where a project's tree is walked.
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
(`terminal`, `api`, `db`, `spec`, `inbox`), and each panel's logic and zustand
store live in the matching `lib/` directory (`lib/terminal/store.ts`,
`lib/db/explorer-store.ts`, …) with `lib/store.ts` holding the studio-wide
state — all relative to `src/renderer/`. Editors are CodeMirror 6; terminals
are xterm.

`components/ui/` is shadcn/ui. Add to it with the CLI rather than by hand:
`bunx shadcn@latest add dialog`. Vite's root is `src/renderer`, so `index.html`
and `public/` are there too.

The activity rail is Database, API, Mail, Webhooks, Specs and Terminal, and
`components/studio/activity-bar.tsx` is the one list that says so. There is no
git panel and no code search: both were removed rather than left hidden, and
the only thing git is still asked is the branch name in the system bar.

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

The Specs panel (`src/renderer/components/studio/spec/`, `lib/spec/`) edits `*.spec.json`
files in the project's own repository rather than state under `~/.tabula`.
It opens as a read-only page (`spec-preview.tsx`) with an Edit button that swaps
in the form — never a JSON editor. The overview holds a canvas
(`spec-canvas.tsx`): one figure with any number of screenshots on it, and
numbered markers dragged in from a palette, measured throughout in percentages
of the canvas _width_ so it scales as one picture. In the form the header and
item table are typed fields, while Detail processing and Link API are markdown
edited with Crepe — the same Milkdown editor as the chat composer, sharing
`components/studio/milkdown-theme.css` and keeping its own sizing stylesheet.
`lib/spec/schema.ts` also migrates the panel's older structured shape to
markdown on open; see `docs/design.md`.

## Conventions

- Prettier: no semicolons, double quotes, 80 columns, es5 trailing commas.
- Comments explain **why**, not what — which failure a constant was written
  against, why an approach was rejected. A comment restating the line below it is
  noise. Match the density and tone of the surrounding code.
- `*.local.*` is gitignored scratch. Use that suffix for repros and one-off
  experiments instead of leaving files untracked or committing them.
- Changes under `electron/` or `shared/` need `bun dev` restarted; only the
  renderer hot-reloads.
