# desktop

The studio as an Electron app: a workspace points at real directories on disk
rather than rows in a browser database, and every tool over them — database,
API, terminal, agent, notes — is a tab in one window rather than an
application of its own.

## Layout

| Path            | What it is                                                    |
| --------------- | ------------------------------------------------------------- |
| `src/main/`     | Main process: storage, databases, terminals, IPC.             |
| `src/preload/`  | The one bridge script, sandboxed.                             |
| `src/shared/`   | The typed IPC contract, imported by both sides (`@shared/*`). |
| `src/renderer/` | Renderer: the Vite + React studio.                            |
| `test/`         | Plain `bun` scripts, no test framework.                       |

## The workspace

There is exactly one workspace, and it holds any number of **folders** —
directories already on this machine, worked on where they are. Nothing is
copied into the studio and nothing is written into them that you did not ask
for; the manifest records an absolute path and the files stay yours.

```
~/.tabomni/
  manifest.json     the workspace, its folders, its databases, settings
  workspace/
    requests.json   the API panel's collection
    environments.json
    folders.json    the groups those requests are filed under
    cookies.json
    notes.json      the Notes panel's listing
    note-folders.json
    notes/<note-id>.md   one note's own markdown
    db/<db-id>/     one Docker-managed database's own data
```

**There is no switching.** That is the point of the design rather than a
missing feature: someone working on a frontend and the API behind it has two
folders open, not two applications to alternate between, and a switch would
take one of them — along with every tab, shell and connection opened against
it — off the screen. Adding a folder brings its files into view; removing one
takes its shells and its chats with it and leaves the directory untouched.

Everything else belongs to the workspace rather than to a folder: the
databases, the saved requests, the cookie jar, the notes. A
project's database is generally the same database its frontend and its API both
talk to, and filing it under one of the two would only decide which panel is
allowed to see it. What _is_ per folder is what is genuinely per repository — a
shell's working directory, a run command and a branch name.

Sign-in is what will bring a second workspace. Until then the studio always
holds this one, which is why its id is a constant rather than something the
manifest has to be read to learn.

## The left column

What the workspace **holds**, stacked: `Search`, then `Projects`, `Database`,
`Notes` and `API` as four folding sections, as many open at once as there is
room for (`workspace-sidebar.tsx`). It is the whole of the left edge and it does
not go away while you work, which is the point: reaching any of the four is a
click in a list already on screen rather than a trip through one.

**It took two moves to arrive at this, and the first went too far.** The
activity rail went first — Conductor's left column is navigation and the
_contents_ of the thing being worked on are on the **right** — which put
Explorer, Database, API and Notes behind a row of tabs on the right-hand panel.
That fixed the real problem (the left of the window was three columns deep
before anything being worked on) and introduced a smaller one: a tab strip shows
exactly one list, and "what does this workspace hold" is a question about seeing
several at once. Four ways of filling one box is not four lists.

So three of them came left as sections, and **the Explorer kept the right-hand
panel**, alone and without tabs — a strip of four tabs with one tab on it is a
row of chrome that answers nothing. The asymmetry is the point rather than an
oversight: a file tree is the contents of the thing being worked on rather than
a list of what the workspace holds, it is far the deepest of the four, and it
follows whichever checkout this column has clicked. The other three are lists of
records the workspace owns, and they are short.

A folded section is a bare `PanelHeader` this column draws; an open one is the
panel's own component, unchanged, with the fold handed to its own header
(`open`/`onToggle` on `PanelHeader`, so there is one header rather than a second
bar drawn above each panel's). The panel is unmounted while folded, which it can
afford to be: none of the three holds a pty, a turn in flight or an editor —
what they hold is a store each, which outlives the component. Open sections
share what is left of the column evenly and scroll inside themselves; sized to
their contents instead, a long list of notes would push the projects off the
bottom.

`section-tabs.tsx` went with the tabs, and so did the rail's remembered order and
hidden set — folding is what hiding was for, and four labelled sections need no
arranging. What survives both bars is the _kind_: `lib/sections.ts` holds the
ids and `section-marks.tsx` the label, icon and hue, because a hue that means
"table" has to mean it wherever a table is listed.

**The right column stacks** the Explorer over the dock, the way Conductor stacks
its file list over its `Setup / Run / Terminal`. `⌘B` closes it, and the left
column closes on its own button in the title bar. Two keys for two columns,
deliberately: one that took both would leave the workbench with no edges at all.

**A project's rows are its worktrees**, and clicking one opens a chat in it —
see Worktrees below. A project row carries a `+` that makes another checkout,
shown on hover, because a column of projects each wearing a permanent one is a
column of plus signs. Projects fold, and which are shut is remembered
(`lib/projects.ts`, under `projects.column` with whether the column itself is
showing).

Clicking a project row also points the dock's `Terminal` tab at that project,
and clicking a worktree row at that checkout, so a shell opened beside a chat is
in the branch the chat is editing.

Adding, renaming and removing a folder is **Explorer's**, not this column's: the
list that says what the workspace is pointed at is the one that changes it.
This column is a way to get somewhere, and with no folders it says so and points
at Explorer.

### Tasks, removed

There was a layer above the workbench here — a **task**: a name, a line about
what it was for, and members taken from any panel, so `debug checkout` was the
`create-order` request, the `orders` table, a file in `api/` and a note. The
column listed them under the project each was filed in, `Home` opened a grid of
cards (`⌘E`, **View › All tasks**), `Home › debug checkout` ran across the title
bar, and `Add what is open` filed whatever the pane was showing.

All of it is gone, deleted rather than hidden, the way the Mail and Terminal
panels went: `lib/task/`, `components/studio/task/`, the crumbs, the dashboard,
the member chips, `test/tasks.ts`, `TaskRecord`/`TaskMember` in the contract,
the `tasks:list` / `tasks:save` channels and the `show-tasks` menu command. What
the column keeps is what it was always navigating — the projects and their
branches — and the state it needs for that moved to `lib/projects.ts`.

A workspace that used the feature still has its `workspace/tasks.json` on disk.
Nothing reads it and nothing deletes it, for the reason `mail.json` survives its
own panel: removing a feature is not a reason to throw away what somebody wrote
with it.

## Worktrees

A project's rows are its `git worktree` checkouts, and clicking one opens a chat
in it.

This is the isolation Conductor is built on, and it is git's own: a second
working tree on a branch of its own, sharing the single object store. **Nothing
is copied** — that is the whole point over duplicating a directory — so two
agents can work on one project at once without standing on each other's files,
index and branch.

`main/git.ts` holds the operations: `worktrees()` reads
`git worktree list --porcelain`, `addWorktree()` is `add -b`, `removeWorktree()`
is `remove --force`. `parseWorktrees` and `worktreeSlug` are the pure halves and
are tested (`test/worktrees.ts`), because the shape of git's output and the
turning of a branch name into a path segment are the two parts that break
quietly.

**Three decisions in those operations.** `add -b` always makes a new branch: two
checkouts of one branch is a state git refuses anyway, and a new worktree is a
place to do something not yet done. `remove --force` goes ahead over uncommitted
changes — it is called from a row somebody already confirmed, and a refusal they
cannot act on from here is worse — but the **branch is kept**, because the
commits are the work and removing a directory is not a reason to drop them. And
`listWorktrees` reconciles against git on every read, so a checkout removed by
hand drops out of the record rather than leaving a list that lies.

### Its chat is `claude -p`

Clicking a worktree opens a chat in it, and the app **hosts** that conversation
rather than reading one.

There was a session panel that did the opposite: its chat view tailed the
transcript the interactive CLI writes, so the terminal and the chat were two
views of one conversation and the app was a _reader_ (see Terminal sessions,
removed). This is the other shape — its own message model, its own composer, its
own tool-call rows. Hosting one means driving the CLI, which is
`@anthropic-ai/claude-agent-sdk` (`main/claude-agent.ts`, driven by
`main/worktree-chat.ts`).

The rows and the composer are its own — `ChatMessage` and `ChatComposer`, beside
the pane in `components/studio/worktree/`. They were the assistant panel's until
that panel was removed (see The assistant, removed) and came here with it, which
is where they belong now: this is the only chat in the app.

It is also the **only** `claude` the app runs. What this document's old
"only one" rule was actually against is still refused: features calling the CLI
as a helper — an AI filter, an import button — because a helper turn is a turn
nobody asked for. A worktree chat is a conversation somebody is having.
`claude-agent.ts` stays a file of its own even with one caller left, for the
part that matters: what the SDK hands back moves between versions, and a reader
of it tangled into a store and a session id is one nobody wants to re-read when
it moves. Policy is not in there — where a turn runs and what it may do are the
caller's.

**Why the SDK rather than `claude -p`.** It was a `spawn` of the CLI in print
mode, reading `--output-format stream-json` a line at a time, and the one thing
wrong with that shape is not something parsing fixes: a turn that met a
permission prompt had nobody to answer it, so it stalled or failed. That is the
constraint the permission picker below was designed around. The SDK's
`canUseTool` is the missing half — it hands the request back to the host and
waits, indefinitely if need be — so a chat here _can_ ask, the way the
interactive CLI does. That is the `Ask` permission; see Asking below.

Four things about the swap are worth knowing, because none of them are visible
from the option names:

- **The CLI is still the thing that runs.** `pathToClaudeCodeExecutable` is the
  user's own `claude`, located through the same login shell as before
  (`claude-bin.ts`, `shell-env.ts`), so a turn uses their install and their
  login rather than a second copy of the CLI with an authentication story of its
  own. A path that does not end in a JS extension is spawned directly, so both
  the npm and the native installs work.
- **The MCP servers go over as a file, not as the SDK's `mcpServers` option.**
  That option looks like the obvious way to do it and it serialises the config
  onto the CLI's command line — and these URLs carry the run's secret, which a
  command line publishes to every process on the machine. The path goes through
  `extraArgs` instead, which is the same flag pointing at the same `0600` file
  `mcp.ts` already wrote.
- **`bypassPermissions` needs a second opt-in.** The SDK refuses the mode unless
  `allowDangerouslySkipPermissions` is set beside it, so `Full access` passes
  both.
- **The appended system prompt is no longer a flag.** The SDK runs the CLI in
  `--input-format stream-json` and sends `appendSystemPrompt` in the
  `initialize` frame on stdin. It arrives; it is simply not in the argument list
  any more, which matters the next time somebody goes looking for it there.

The SDK also **throws** where the old reader only read: an error result is
delivered as a message and _then_ raised as an exception. So the row is already
drawn and `onDone` already called by the time it lands, and the guard in
`runAgentTurn` is what keeps one failure from being reported twice.

`main.cjs` is the only one of the three bundles that carries the SDK, and it has
an esbuild build of its own for it: the package is ESM and reaches for
`import.meta.url` to build a `require`, which esbuild's CJS output turns into
`{}` — `createRequire(undefined)`, which throws the first time it is used. A
`define` points it at a real file URL through a banner, and the banner cannot go
anywhere near the preload, which is sandboxed and has no `require` of node
builtins. It is bundled rather than left external because `files` in
package.json is `dist-electron` and `dist-renderer`: a `require` of
node_modules resolves in dev and is missing from a packaged app.

**What a turn may do, and why.** Edits are pre-approved
(`--permission-mode acceptEdits`) and `Bash` is on the allowed list — that is
what a chat opens on, and the toolbar's permission picker below is how it is
narrowed or widened per chat. Nothing here answers a prompt yet,
so a turn that met one would not pause — it would fail —
and the choice is between saying up front what is allowed and having a chat that
cannot change anything. What makes the first honest is the isolation: the worst
case is a branch, and it is not the branch the user has checked out. The composer
says so in as many words rather than leaving it implicit.

**The composer's toolbar.** Inside the box, under the field: which model
answers, how much effort a turn gets, and how much it is allowed to do, with a
`+` menu and the send button at the other end. They are `WorktreeChatOptions` on the chat's own
record — per chat rather than per workspace, because that is the unit somebody
thinks in: the checkout being refactored wants Opus at `max`, and the chat asking
where a function is called wants Haiku at `low`. A turn is built from whatever
they said when the message was sent, and a turn already in flight keeps what it
started with — they are its argument list, and there is nothing to change it to.

The model and effort pickers offer **Default**, and it is the one they start on:
`null` means whichever model and effort the user's own `claude` is configured
for. Naming today's default here instead would be this app quietly overriding a
setting of theirs, and a list of full model names would go stale every time the
CLI learned a newer one — so the entries are aliases (`opus`, `sonnet`), which
the CLI resolves and refuses loudly when it cannot.

**Permission is one picker, not a picker and a toggle.** There was a plan toggle
beside the other two and it is gone into this: plan mode _is_ a permission — the
read-only one, asked a particular way — and two controls over one question can be
put into a state neither of them means ("plan, with full access"). So the third
control is `Plan` / `Read only` / `Ask` / `Edits` / `Full access`, held as `permission`
on `WorktreeChatOptions`, and `PERMISSIONS` in `main/worktree-chat.ts` is the one
table saying what each runs as — the tool list, the refusals, the
`--permission-mode` and what the turn is told, out of one entry, so a turn cannot
be assembled half in one mode and half in another. It is the only control here
that never reads **Default**, because there is no such thing: a turn runs at
whatever this says, and `Edits` is what it says until somebody changes it.

Four of the five decide up front, which is what print mode forced and what a
chat that never interrupts still wants. **Read only** is what `default` used to
have to become, back when a turn that may not write without a prompt may as well
have been told so up front; it is still the right mode for a question, and now
it is a choice rather than a workaround.
**Full access** is `bypassPermissions` with no allowed list at all, and it exists
for the failure the list itself causes: `ALLOWED_TOOLS` is broad but it is still
a list, and a turn reaching for something not on it — `BashOutput` after a
background command, a skill, a tool a newer CLI grew — meets a prompt nobody can
answer. It is a choice per chat rather than the default, drawn in the destructive
colour, and the one mode where the two `delete_*` refusals are a request rather
than a guarantee: whether `bypassPermissions` honours a deny list is the CLI's
business and not this app's.

**Plan mode is a tool list rather than `--permission-mode plan`.** That is the
CLI's own plan mode and it ends by asking: leaving it is `ExitPlanMode`, which is
a prompt, and print mode has nobody to answer one. A turn started that way spends
itself trying to get out — it writes the plan to a file it may not write, calls a
tool that is disabled, and comes back `is_error` with an apology where the plan
should be. So plan mode here is the thing somebody wanted from it, built out of
the half print mode can enforce: `READ_TOOLS` is everything that reads and
`WRITE_REFUSED` names every writer, the workspace's own included, since saving a
request is the one kind of change no `git checkout` takes back. `Bash` is on
neither list — a command can write, and no reading of an argument list decides
which ones do — and what that costs is `git log` and `rg`, which `Glob` and
`Grep` are the same reconnaissance without a shell. Those two lists are what
**Read only** runs as as well: the two modes differ in what the turn is _told_,
not in what it may do, since a model asked where a function is called should not
get a numbered list of changes back. The caption under the composer and the
field's own placeholder follow the picker, because a line that says edits run
without asking is a lie about a turn that cannot make one — and so is the
reverse.

**Asking.** `Ask` is the mode that stops. `READ_TOOLS` stay pre-approved under
it, so reading never interrupts — the difference between a mode somebody can work
in and one that asks four times before it has finished reading a file — and what
reaches the screen is the writes, the shell, and anything this app never listed,
which is the set worth being asked about. Its `--permission-mode` is **`manual`**
and not `default`: this CLI's mode list no longer has a `default` (it is `manual`
for "prompt about everything" and `auto` for the classifier), and the SDK passes
whichever string it is handed straight through, so naming the one that is gone
would fail the turn on its argument list. Nothing is refused except the
workspace's two `delete_*` — in every other mode a refusal is what a stall would
otherwise be, and here there is somebody to say no, so refusing up front would be
taking their answer for them.

The turn is genuinely **held** while the card is up. The promise
`WorktreeChats.ask` returns _is_ the pause: the CLI is sitting on the tool call
until it settles, nothing on this side times it out, and the composer says as
much instead of showing a spinner — a question that answered itself after thirty
seconds would be this app deciding. What that costs is care about the ends: a
question is in memory only, keyed by an ask id an answer has to name, and it dies
with the turn, so `finish` and `dispose` both settle whatever is outstanding or
the CLI is left waiting on a promise nobody will resolve. It is lost on a window
reload, like `sending` in the store and for the same reason — what is on the other
end is a process, not a record — and Stop is what ends a turn whose question has
gone.

Answering appends a `role: "ask"` line — `Allowed Bash: npm test`, or `Refused`
one — which main composes and emits as a `decision` event, so the sentence has
one author rather than a renderer spelling its own version of it. A refusal shows
even with tool calls switched off, because it changed what the turn did.
`Always allow` echoes the SDK's own `suggestions` back as `updatedPermissions`,
which writes a rule into the checkout's `.claude/settings.local.json` — remembered
for that branch, gone when the branch is — and it is offered only where the SDK
had a rule to suggest, since a button that did nothing would be worse than no
button.

**`AskUserQuestion` comes down the same callback**: the model's own
multiple-choice question, the thing anyone who has used the interactive CLI will
recognise. It reaches the app by _not_ being pre-approved, which is the whole
mechanism, and it is why `REFUSED_ASKING` names it in the other four modes — there
a question is a turn waiting on nobody. It is answered by **allowing the call**
with the picks merged into its input, the original questions included, which the
SDK requires and which is why `AskDecision.input` merges rather than replaces.
Picks are arrays in the contract and in the pane whether or not a question is
multi-select, so nothing branches on `multiSelect` twice and disagrees with
itself, and every question has to be answered before any of them goes back
because the tool takes them together.

`titleFor` is what a permission card actually reads. The SDK documents a rendered
`title` — "Claude wants to read foo.txt" — and does not send one for a plain SDK
run, so this is the sentence rather than a fallback, and it is a verb per tool
because "Claude wants to use Bash" over a card asks somebody to work out what
they are being asked. `asked`, `decided`, `said` and `titleFor` are the pure half,
tested in `test/chat-ask.ts`: each of them sits between two things no compiler
can check against each other — a tool input the CLI wrote, one the SDK reads
back, and a line somebody reads next week — and each fails silently.

A record written before the picker carries `plan: true/false` and no
`permission`. `chatOptions` in `@shared/api` is where that is read: it fills the
defaults in, turns a `true` into `plan`, refuses a mode this build has never
heard of, and never hands back the legacy field. Both sides of the contract go
through it — main builds the argument list out of the same reading the composer
draws — because a toolbar saying `Edits` over a turn that ran as a plan is the
one disagreement worth a function to make impossible.

The `+` menu is two items. **Attach file** (⌘U) is the OS picker, and what it
leaves in the draft is a path relative to the checkout — plain text, not a
mention, for the same reason `@` inserts a name: the turn runs in this directory
with `Read`, so a path is already something the agent can open, and print mode
takes a prompt rather than an upload. A file from somewhere else keeps its
absolute path, since a `../..` chain reads like a path in this checkout and is
not one (`relativeTo` in `lib/files/paths.ts`, `test/attach-paths.ts`).
**Mention…** types the `@`, which is all it has to do — the menu that follows is
the one a typed `@` opens.

The workspace's MCP servers are handed over, which is the thing an agent in an
editor cannot have: the databases, the saved requests and the notes, in the same
conversation as the code: the config, the three `tabomni-*` servers pre-approved
by name, `--strict-mcp-config` so the user's own `claude` servers are not pulled
into a conversation this app is hosting, and two `delete_*` tools refused.

Passing `--mcp-config` alone was not enough and looked like it was. That flag
says the tools exist; `--allowed-tools` says they may be used without asking,
and a print turn that meets a permission prompt has nobody to answer it. So the
chat was being handed the workspace and quietly could not call it. A server is
named rather than its tools, so one added to it later is covered, and
`ToolSearch` is on the list because a CLI configured to defer tools reaches an
MCP tool through it, and being asked to approve a search for a tool is another
prompt nobody can answer.

The two refusals are there for a reason that survives the isolation argument
rather than being covered by it. A worktree is a branch; a
saved request is not in any branch. Deleting one — and `delete_folder` cascades —
is a change to the workspace that no checkout contains, that no `git checkout`
undoes, and that there is no trash to fetch back from. `Bash` in the same turn
could do worse to the files in the checkout, and that is precisely the
distinction: those files are a branch, and the workspace's records are not.

**A chat's id is the CLI's session id, and that outlives the app's run.** So
whether the next turn is `--session-id` or `--resume` is written on the chat's
record (`started`), not held in memory: a `Set` rebuilt empty on every launch
re-offered an id the CLI already had, which it refuses as _already in use_ —
and the turn that would have recorded the id is the one being refused, so the
chat is stuck for good rather than for once.

Two things make it right rather than nearly right. The flag is written only once
the process is actually up, since a session the CLI never opened must not be
resumed. And a turn refused with _already in use_ is **started again as a
resume**, once, only if it was not already one: that is what a chat written
before the field existed looks like, and the CLI is the only party that knows
which of the two it wanted — guessing from the transcript would be guessing,
because a chat can hold lines from a turn that died before anything was opened.
The retry does not write the prompt down twice, which is why running a turn is a
method of its own.

An `--append-system-prompt` says where the turn is. Short, because the CLI can
see the working directory for itself. What it cannot see is that the `tabomni-*`
tools are the whole workspace's rather than this checkout's.

**Several at once.** `WorktreeChats` keys everything by chat id — a turn per chat,
lines per chat — because a worktree exists so a piece of work can run in
isolation, and two of them answering in parallel is the point rather than an edge
case. Removing a worktree deletes its chats: they are conversations about a
directory that will not exist, and a turn in one could not run anywhere.

The chats are the `worktree` pane, registered in `PANELS` like any other and
**always grouped** — grouped by worktree, so the outer tab is the branch and the
strip inside it is that checkout's conversations. That is the tab strip in
Conductor's screenshots, and it came from the grouping machinery rather than
from a second strip.

### Where they live

`~/.tabomni/workspace/worktrees/<folderId>/<branch-slug>` — **not** beside the
repository. A project's directory is somebody else's, and the rule everywhere
else here is that the studio writes nothing into it that was not asked for; this
way removing every worktree leaves that directory exactly as it was. It is also
where Conductor puts its own (`~/conductor/workspaces/…`), so a project can hold
both without either noticing.

The branch is slugged because it is a path segment and a branch name is not one:
`feature/orders` would be two directories deep, `..` would be a directory above
the one intended. `worktreeSlug` is that, and the traversal cases are what its
test is mostly about.

### Running in one

A turn runs in the checkout, and so does anything else pointed at one:
`terminalCreate` and `startProcess` both take a `worktreeId`, and main resolves
`resolveWorktreeDir(id) ?? resolveFolderDir(folderId)`.

An **id**, never a path. The renderer does not get to name a directory main has
not already written down — the same rule `insideAny` in `main/files.ts` is for.
The `??` is also the fallback that matters: a shell whose worktree has since been
removed runs in the folder rather than failing to start.

The chats **group by worktree** rather than by folder (`lib/panels.ts`), so the
workbench strip holds one tab per checkout and the strip inside it holds that
checkout's conversations — which is the tab strip Conductor shows above a
conversation, and the `+` at its end starts another chat in the same branch. The
tab is named for the branch; the directory is bookkeeping.

A chat's empty state is `WorktreeWelcome` — which branch, cut from what, and the
path — because somebody with three checkouts of one project open needs to know
which one they are about to change. It says **nothing was copied**, on purpose:
that is the whole point of `git worktree` over duplicating a directory.

## The dock

The lower half of the right-hand column: `Run` and `Terminal` — the tail of
Conductor's own `Setup / Run / Terminal` under its file list.
`components/studio/dock.tsx` is the strip, `lib/dock.ts` is whether it is open
and which tab it holds, and the chevron in its corner collapses it — a close
button would be wrong, because this is one of two halves a column is split into
and collapsing gives the other the whole of it.

The two tabs are what this app actually has to put there: the things that are
_about_ what is on screen rather than things that were opened. There was an
`Assistant` tab in front of them, and the button at the right of the title bar
opened the dock on it; that button is the dock's own toggle now, because the
chevron is otherwise a one-way door (see The assistant, removed).

The dock is **collapsed rather than unmounted**, and the shell is the reason. A
pty taken out of the React tree ends; it does not hide. While the dock held only
a conversation the main process owned and a log, unmounting it cost nothing — the
moment it held a terminal, closing the dock would have killed whatever was
running in it.

### Terminal

A shell in the project the column last had clicked (`lib/shell/store.ts`,
`dock-terminal.tsx`).

**This is where the Terminal panel went.** There was a panel — a pane of its own,
a tab per project in the strip, an agent picker, and a chat view tailing the
CLI's transcript — built on the premise that a session _was_ the work and could
not be demoted into a corner. A worktree's chat is that work now, hosted rather
than tailed, and what was left of the panel is what Conductor's tab always
was: a shell beside the work. So the panel is gone, and this is the whole of it.

**One shell per place**, keyed by `worktreeId ?? folderId`. Clicking a project
row points the dock at that project's shell; clicking one of its worktree rows
points it at that checkout's, so the terminal beside a chat is in the branch the
chat is editing. A pty's cwd is fixed when it starts and cannot be moved, so
"the terminal follows the project" can only mean a second pty. A `cd` sent into
the first would be worse than a second one: it lands in whatever is half-typed at
the prompt, does nothing at all while a command is running, and leaves one
scrollback holding three projects' history.

Clicking a row only records the **target**. The pty is started by the panel while
it is on screen, which is what keeps a process from being spawned behind a
collapsed dock because a row in a list was clicked — showing the tab is the
asking. Every shell then stays mounted, hidden rather than unmounted, so
switching project does not kill the command left running in the last one.

Not remembered across a launch, unlike the sessions this replaced. A shell here
is ad-hoc — something opened beside the work for one command — and replaying five
of them on every launch would be a surprise rather than a convenience. A folder
removed from the workspace, or a worktree removed from a project, takes its shell
with it.

### Run

One command per folder (`lib/run/store.ts`, `run-panel.tsx`): the dev server or
the test watcher, so that changing something and seeing whether it still builds
does not mean leaving for a terminal.

It called nothing new into being. `ProcessManager` in `src/main/process.ts` has
been in the app since before this panel, and its own comment said so — "nothing
calls `start` yet: this is the seam". The whole contract was already there,
`startProcess` already took a folder id and resolved the cwd in main, and
`processes.stopAll()` was already awaited on quit. This is the caller.

Per **folder**: `bun run dev` is a property of a repository, not of what you
happen to be doing in it, so two branches of one folder still mean one command
rather than the same one typed twice. The
commands live in one settings key holding a map, so reading them is one call at
launch.

The command is split on whitespace and nothing cleverer. `ProcessManager` runs
with `shell: false` on purpose — a shell would make a project's path part of a
command line — so there is no shell to do quoting, and writing a quote-aware
tokeniser would be inventing one in the renderer. `bun run dev`, `npm start`,
`make watch` is what a run script is; anything needing a quoted argument wants a
script in the repository, which this can then run.

The log keeps its last 2000 lines and follows the bottom **only while it is
already there** — yanking the view down while somebody reads further up is the
one behaviour that makes a log unusable. Both panels stay mounted once shown, so
switching tabs does not throw away a log the process behind it is still writing
to.

## The tab strip

One strip for the whole workbench, above whichever panel is showing, rather
than one per panel: a table, a request, a note and a chat sit side by side,
and clicking any of them goes to the panel that shows it. Leaving
Database for API used to take the tables off the screen — still open, but
nothing said so. `components/studio/workspace-tabs.tsx` assembles it from the
four panel stores; the order across panels is `tabOrder` on the studio store,
since a request between two tables is a position none of those four has
anywhere to record.

**One strip means one set of tab rules, and `lib/panels.ts` is where they are.**
Each panel is entered there as six small functions — what it has open, which of
those it would show, and select, close, close-others, reorder — and everything
the strip does is written once against that list rather than six times against
six stores. What stays in the component is what a tab genuinely looks like to
its own panel: its label, its icon and the line it shows on hover.

That is what lets a close answer for the whole strip. A panel still picks its own
next tab while it has one — closing one of two tables goes to the other table,
not off to whatever happens to sit beside it — but the tab it cannot answer for
is its last, and closing that used to leave the pane on the Database panel's
"pick a table" notice with two of another panel's tabs still in the strip,
because the only store asked was the one that had just emptied. Now the tab
beside the closed one takes over, whichever panel it belongs to (`neighbour` in
`lib/tabs.ts`, tested there).

**The lists follow what the pane is showing.** Because a tab can be picked from
the strip, from `⌘P`, or by jumping to a definition, the thing on screen is
regularly one its list has scrolled past or folded away — and a list marking a
row nobody can see has marked nothing. So selecting anything opens whatever
holds it and scrolls the row into view.

What it no longer has to do is _bring the list up_. That was the job while one
box on the right held four lists behind tabs; every list is on screen at once
now — three sections of the left column, the Explorer on the right — so
`showPane` sets the pane and nothing else. A worktree's chat is the one pane with
no list at all, which is why `Pane` in `lib/store.ts` is `Section` plus
`worktree`: `Section` in `lib/sections.ts` is the four kinds the workspace holds,
and a chat is a conversation in a checkout rather than one of them.

The scrolling half is one place: `SideRow` is every sidebar's row, and it
scrolls itself into view when it becomes the active one — `block: "nearest"`, so
a row already on screen is left exactly where it is rather than the list
centring itself on every click. The opening half cannot be shared, because what
"holds" a thing differs per panel: a directory chain in the Explorer, a folder
chain in API and Notes (`ancestorFolderIds` in `lib/tree.ts`), the workspace
checkout a chat is in, the branch a table belongs to.

Each panel does it in its own `select`, not in an effect beside the list. That
is what keeps the fold state honest in both directions: it only ever _opens_, so
a folder somebody shut stays shut unless what they picked is inside it, and the
folder holding the current selection can still be collapsed by hand — which a
version derived during render could not allow. It is also why API's and Notes'
folds moved out of their components and into their stores: a list cannot open a
folder for a selection made in another panel.

**The strip comes back on a reload.** It used not to: one panel remembered its
tabs and the others remembered nothing, so a reload left one strip intact and
emptied the rest. Each panel writes its own record under a settings
key of its own — `http.tabs`, `db.tabs`, `note.tabs`, plus `workbench.strip` for
the cross-panel order and the pane on screen — because what identifies a tab is
the panel's business: a schema-qualified table name here, a note id there.
`lib/tab-memory.ts` is only the reading and writing, which was the same several
times over.

Every record is reconciled against what actually exists, never trusted: a
request deleted since, a note deleted since, a table that has been dropped. For
the API and Notes panels that happens as they are restored, in the first
`refresh()` — the moment those panels know what their ids mean. Each panel restores once, so a later refresh cannot reopen what has been
closed since.

The Database panel restores earlier than that, and deliberately: **nothing reads
a database until its branch in the tree is opened**, so restoring from its
`refresh()` left the strip empty on launch and filled it in only once a table was
clicked. Its tabs go back the moment a database becomes the open one, from the
record alone — a remembered tab carries the whole `Relation`, which is all a tab
needs — and the reconcile against the live schema happens whenever that schema is
eventually read, by the same filter that handles a table dropped while the app is
running.

Its tabs are kept per database (`db.selected` remembers which one was open, or
they would have nothing to be restored into), and a query tab keeps its SQL but
not its results: a restored console with an empty buffer would be worse than no
tab, and a result belongs to a connection that has since closed. The one
statement a restored strip sends on its own is the page of the table that was on
screen, since an empty grid under a table's own tab reads as a table with no
rows.

Because the strip belongs to the workbench, so does an empty one. A panel is
drawn only when it has a tab to draw; otherwise the pane shows a single notice
(`nothing-open.tsx`). The panels each answering for themselves meant the Database
panel's "No table selected" spoke for all of them, since `database` is the pane a
fresh launch starts on — somebody who opened the studio to read a note was told
to pick a table.

The notice has two things to say, and which one depends on the strip. With tabs
in it, they are what to pick and it points up at them. With none, there is
nothing above to point at, so it points at the sidebar — and so follows the
**rail**, not the pane: the pane is where the last tab was, and with no tabs
there is no last one, so the sidebar on screen is the only thing that could be
acted on from there.

**A panel switched away from is hidden, not unmounted.** A pty is the case that
forced it — one taken out of the tree ends rather than hides, which is why the
dock is collapsed rather than unmounted too — and the panels turned out to want
the same for a smaller reason: a strip that keeps every panel's tabs on screen is an invitation
to switch, and everything a panel held that its store did not was thrown away
each time. Leaving Database for Notes and coming back gave a result grid scrolled
to the top, a SQL editor with no undo history and the query split back at its
default height; a note came back as a fresh ProseMirror over the same text. None
of that is state a store has any business holding — a scroll offset and an undo
stack belong to the view — so the view is what stays.

A panel is still built the first time it is shown, since a panel nobody has
opened is a connection nobody is reading, and `mounted` in `studio.tsx` is that
list. The hiding is `invisible` rather than `hidden`: `display: none` destroys the
scrolling boxes inside, which would put that grid back at the top by another
route, and it is what the dock stacks its own shells with.

**And the same one level down: a tab switched away from is hidden, not
unmounted.** The rule was only ever half applied — Explorer and Notes
stacked their tabs, and the others rebuilt one pane per click, so keeping
Database on screen while reading a table cost nothing and moving between two of
its tables cost everything. Every panel now draws one pane per open tab and
hides the rest, so switching tabs is as cheap as switching panels: the same
scroll offsets, the same undo stacks, the same sub-tab open, the same split
where it was dragged to.

For a table that also meant giving the store somewhere to keep what a tab is
showing. The Database store held one set of rows, one page, one order and one
filter for whichever table was on screen, and cleared all of it on the way to
the next — so a hidden pane would have been a pane drawing another table's
data. `RelationView` in `lib/db/explorer-store.ts` is that state, keyed
"schema.table" and dropped when the tab closes. A tab is read once, and read
again only when it is picked after the schema has been read again (`stale`) —
marking the other tabs rather than re-reading them on the spot, since a DDL
statement would otherwise cost one round trip per open tab for pages nobody is
looking at.

The panes' _actions_ still address the selected table rather than taking a
relation of their own: every pane but one is hidden, so the table that can be
paged, sorted or filtered is always the selected one, and a second way to say
so would be a second thing to keep in step.

### Grouped tabs

**One tab per folder, with that folder's own tabs in a strip inside it.** A
repository with eight files open, a dev server running in it and an agent
working beside them is one thing being worked on. As eleven tabs it is eleven,
and they are eleven in a strip five panels share — the table somebody is
actually comparing against has been scrolled off the end, and switching between
two files of one project means reading past a note and four tables to find the
other one. Grouped, the outer strip answers "which folder" and the inner one
"which of its tabs", and the two questions stop sharing a row.

It is **off** by default and switched on in Settings › Tabs. The strip somebody
already has is the one they chose, and a preference that rearranges every open
tab the first time the app launches is not a default. **No panel is an
exception.** The worktree chats were one for a while — grouped whatever the
setting said, on the argument that a chat tab stands for a conversation in a
checkout rather than for something the user opened, so grouping was how that
panel stopped spending the strip. What it bought in practice was two tab strips
stacked on screen the moment a chat was open, in a window whose setting said
tabs were not grouped: the outer strip the branch, the inner one its chats, for
a panel nobody had asked to fold. So the exception is gone, `grouper` reads the
setting and nothing else, and a chat is one tab among the rest — with the branch
on its hover line, because the label is the chat's title and cannot carry both.

What a folder _is_ differs per panel, and `groupOf` is each one's answer: the
Explorer root a file sits in — a workspace folder or one of its checkouts, the
longest match, since a folder added inside another is still a project of its own
— the checkout a chat is in, the folder in the
panel's own tree a request or a note is filed under, the schema a table belongs
to. A file in a worktree groups under the **branch** rather than under the
project it was cut from, because the same `src/index.ts` open on two branches is
two tabs, and one folder tab holding both would put the same name in a strip
twice. A request at the top level of its tree is filed under a real place rather
than nowhere, so its group is named for the panel — "Requests", "Notes" — rather
than "Ungrouped".

The Database panel is the one whose grouping is not a folder at all. Its unit is
the **schema**, because the connection — the obvious analogue of a project —
would have given exactly one tab every time: only one database's tabs are open
at a time, remembered per database and swapped in when you switch between them.
So `public` and `auth` are two tabs, and the query console's own, which belong
to no schema, gather into one more named **Queries**. That group is `NO_GROUP`,
which is safe here because a schema always has a name.

Everything else is written once around that. A group's strip id is
`api:@<folderId>` — the marker matters, because a folder in the API panel can be
open as a tab _and_ be the group its requests gather into, and without it one id
would mean both. `lib/tab-groups.ts` is the pure half — which folders a list
falls into, how a drag in each strip rearranges it — and is what
`test/tab-groups.ts` asks about without needing five stores.

A folder's tab carries the folder's name, the icon of the tab it is showing, the
dot if anything filed under it is unsaved, and how many tabs it holds from the
second onwards. Its hover line is the folder and the tab on screen. Coming back
to it lands on the tab it was left on — a Map in `lib/panels.ts` kept by
watching the panels rather than written by the strip, because a tab is just as
often picked from a sidebar, from `⌘P` or by jumping to a definition. It is a
convenience that can be wrong without consequence, so nothing draws from it and
nothing is written to disk for it.

Dragging a folder's tab moves everything filed under it, keeping their order;
dragging inside the tab reorders that folder's own and cannot move another
folder's, because the members are written back into the slots the folder already
occupies. The two strips answer two questions, and a drag in one has no business
being visible in the other.

**Closing.** A folder's tab closes everything under it — the tab is the folder,
and there is nothing left of it once its members have gone. Everything outside
the strip still closes one thing: the ✕ in the inner strip, the ✕ on a row in a
sidebar, and `⌘W`. `⌘W` in particular is deliberately the tab on screen rather
than the folder holding it — it has always closed one thing, and a key that
suddenly closed eight files because they share a project would be the same key
doing something else. Closing the last member still takes the folder's tab with
it, which is the only way that tab was ever going to go. `closePanelTab` in
`lib/panels.ts` is the one way in for all three.

### Vertical tabs

The strip is a row above the pane by default and can be a column beside it
instead — **Settings › Tab strip › Vertical tabs**. What pays for the switch is
the label: a row gives every tab the same narrow box and truncates the names in
it, which is fine for a handful and useless for the fifteen a morning in a
repository produces, while a column gives each one a whole line and reads as a
list of what is open. It sits between the pane and the sections'
panel, so it reads as the pane's own tabs rather than as part of either
column.

Both are one `TabStrip` with an `orientation`, not two components: the drag, the
middle-click, the context menu, the dirty dot and scrolling the active tab back
into view are the same either way, and only the axis differs — which edge the
drop line is drawn on, which way the tabs stack, and the scrolling. A row scrolls
sideways, which Chromium will not do under a wheel on a box that cannot also
scroll down, so it keeps the native wheel listener and the drawn thumb; a column
is scrolled by the wheel already and keeps the scrollbar the platform draws.

**The column is resizable**, because how much of a file name fits is the whole
point of it. `studio.tsx` puts the pane and the strip in a nested
`ResizablePanelGroup` and the strip takes its width from its own panel — the
drag, the keyboard-reachable handle and the minimum all come with it, as they do
for the sidebar. Like the sidebar's, that width is the panel's for the run and is
not written down; what is remembered is the placement.

The strip falls back to the row when nothing is open. A row with no tabs takes no
height, and a preference for tabs on the right should not turn that into a blank
band down the side of an empty workbench — so `orientation` is handed to
`WorkspaceTabs` by the workbench rather than read from the settings store there,
since the box the strip goes in is what decides.

## Search

`⌘P` opens a search over everything the workspace can open — a file, a table, a
request, a worktree's chat, a note — and picking one opens its tab and goes to
the panel that shows it.
`components/studio/command-palette.tsx` is the whole of it.

It exists because the strip and the sidebars only answer a question the
rail is already pointed at. A table in a collapsed branch, a request three
folders deep and a note filed last week are each a trip through a panel the
user is not in and is not going back to, and the sidebar they moved to is
still there when they arrive. The palette is the way in that leaves the
sidebar where it was — for the same reason nothing else here switches it,
`select` on each panel's own store is what it calls, so a table opened from
the palette behaves exactly like one opened from the tree.

**It only opens things.** A commands half would be the second place every
action is written down, and every action the studio has already sits in the
header or the context menu of the panel it belongs to, beside the thing it
acts on.

Rows are matched on their own strings — a name, a URL, a sender — each scored
separately and the best taken, rather than one string of them all: a query is
about a name _or_ a URL, and concatenating them lets a match straddle the two,
so `user get` would find `GET /users` through a gap of nothing. cmdk's `value`
carries an id instead and is deliberately never scored, or a query of hex
letters (`cafe`, `dad`) would match whichever note's uuid happened to contain
them.

**Files are the one index.** Everything else the palette lists is already in a
panel's store, but a folder's files are not: the Explorer's tree holds the
directories somebody expanded, which is a handful out of a repository, while
`⌘P` has to find a file nobody has opened a folder of. So the workspace is
walked the first time the palette is opened — never at launch, and never at all
in a run where `⌘P` is not pressed — and held for the rest of it. The
Explorer's Refresh re-walks it, which is also the answer to "I made this file
in a terminal a minute ago and the palette cannot see it".

Adding or removing a folder is the one thing that drops the index by itself: a
walk that never saw that folder is not stale, it is wrong, and the alternative
was a palette that could not find anything in a folder just added until the app
was restarted. The files store watches the studio's folder list for that —
beside the pruning it already does there — and re-walks straight away only if
the index has been built, so a run where `⌘P` was never pressed still never
walks. Everything else that changes under a folder is Refresh's job, as before.

The walk skips what a package manager or a build left behind
(`IGNORED_DIRECTORIES` in `main/files.ts` — `node_modules`, `.git`, `dist`,
`target`, `.venv`, …) and stops at 20,000 files. Both are ceilings rather than
promises: the tree shows everything, and is the way to whatever the index did
not reach. A fixed list rather than `.gitignore`, which would mean parsing the
format, honouring nesting and negation, and then explaining why a file plainly
visible in the tree is missing from the palette.

Those files are cut to a shortlist before cmdk sees them (`lib/files/search.ts`).
cmdk scores every row it holds on every keystroke, which is right for a menu of
commands and not for twenty thousand paths, so a cheap subsequence pass runs
first — `slfs` finds `src/lib/files/store.ts`, and a typed `/` is not something
the path has to match literally — and hands on forty rows to be ranked against
the tables and notes beside them. Picking one opens the file **and** expands the
tree down to it: somebody who found a file this way generally wants to see what
sits next to it.

What the palette lists otherwise is what the panels list, read from their stores
rather than from an index. The one visible consequence is the databases:
**a database's tables are searchable once its branch has been read**, because
until then nothing in this app knows their names, and reading every database on
the chance that `⌘P` is pressed would dial every server the workspace has. That
is also the one row that can fail — a table in a database the workspace is not
on has to move there first, which dials a server — so the palette stays open
and says why, the tree's "unreachable" dialog being the tree's.

## The window shortcuts

`⌘P` opens the search above, `⌘W` closes the tab the pane is showing, `⌘S` writes
the Explorer's open file and `⌘B` shows or hides the sidebar — each answered by a
`keydown` listener in the renderer rather than by an accelerator in the
application menu. `lib/shortcuts.ts` is the predicate they share.

They are the page's rather than the menu's because a registered accelerator is
handled in the main process, before the page sees the key at all, and each of
these needs what only the renderer knows: the palette owns its own dialog, which
tab is the current one is worked out in `workspace-tabs.tsx` from whichever panel
is on screen — no store holds it — and whether `⌘B` is the sidebar or a bold
word depends on where the caret is. The File menu still lists **Close tab ⌘W**
and the View menu **Sidebar ⌘B**, both with `registerAccelerator: false`, so the
key is displayed and the item works without the menu taking the keystroke.
Closing the _window_ moved to `⇧⌘W`, the move an editor makes and for the same
reason: a window holds every panel's tabs, and losing it to a keystroke aimed at
one of them takes everything running in it too.

Both are claimed on the capture phase, ahead of whatever has focus. `Mod-P` is
otherwise Chromium's print, and a palette that also sent the window to a printer
is one nobody presses twice; `⌘W` is taken early so that an editor with a focus
trap of its own cannot swallow it. **Off macOS the dock's shell keeps both**:
there the shortcuts are `Ctrl+P` and `Ctrl+W`, which are readline's before they
are ours — one walks a shell's history and the other deletes the word behind the
cursor — and a shell's editing keys have no second way to be pressed, while the
menu item and the palette do. Nothing is given up on macOS, where xterm never
sends `⌘` to the process.

With an empty strip `⌘W` is left alone rather than swallowed: there is no tab to
close, and doing nothing is quieter than a window vanishing under a keystroke
meant for a tab.

**`⌘B` is the one that has to ask where the caret is.** The other three mean
nothing to a text editor; `⌘B` is bold in every one there has ever been, and this
studio has two on screen at once — a note, and a `.md` opened in the block
editor. So `isEditingRichText` refuses the key inside anything
`contenteditable`, which is what those three have in common, and the sidebar
keeps it everywhere else: in Monaco, which has no binding for it, and in a plain
field, which has nothing to bold. The trade is one-sided — the panel has the
View menu and a drag; bolding a word has only the key.

**Three things do the same toggle**, and all three go through `sidebar` on the
studio store: the key, **View › Sidebar**, and dragging the panel's handle past
its minimum. What is _not_ one of them is a section tab: the rail's icons closed
the sidebar when you clicked the one already showing, and a tab cannot inherit
that, because the tabs live inside the panel — clicking one to close it would be
clicking a thing in order to take it off the screen. Which is also why nothing
here has to un-mark a tab for a closed panel: with the panel shut there are no
tabs on screen to mark.

The panel is **collapsed, not unmounted** (`usePanelRef().collapse()`, since
`ResizablePanel` has no `collapsed` prop): the width somebody dragged it to comes
back on expand, where a sidebar taken out of the group would return at its
default. Dragging the handle past the minimum closes it too, so the state follows
the panel as well as driving it — with the mount call ignored, because a launch
that remembered a closed sidebar would otherwise read the panel's own starting
width as a drag and open it. Which sidebar it _would_ show is still `section`, so
hiding and showing comes back to the same list, and the state is remembered with
the strip: a workbench that forgets hands the space back every launch.

## Settings

**Settings…** in the application menu — ⌘, — opens a dialog, and there is
nothing else to it: no settings tab in the strip, no section, no page.
What is in it is about the workbench rather than about anything in the
workspace, so it has nothing to be a tab _of_ — and two of the settings there
are about the tab strip itself, which a tab would be a poor place to hold the
switch for.

The item carries a gear, which the standard items around it get from the system
and a custom one has to be handed. **Drawn as an outline, not a solid**: the
items around it are SF Symbols at the menu's own weight — thin strokes with air
inside them — and a filled shape beside them reads as a heavier icon in a darker
ink, even though a template image has no ink of its own. So it is the gear's
outline at a ~1.1px stroke, in a circle that stops short of its 16pt box the way
theirs do. It is generated —
`scripts/menu-icon.mjs` draws it into `resources/menu-settings.png` and its @2x,
the way the DMG background is drawn — and it is a **template image**: black, with
the gear in the alpha channel, so macOS tints it to whatever the row is drawn in
rather than leaving a black icon on a dark menu. The two files reach the built
app as data URLs inlined by esbuild (`loader: { ".png": "dataurl" }`), because
`resources/` is not packaged: a path read at runtime would resolve in dev and be
missing from the `.app`.

The menu item claims its accelerator, unlike **Close tab** and **Sidebar**:
those two need what only the renderer knows, and this one does not — nothing on
screen wants the comma, not a terminal, where `Ctrl+,` is unbound, and not an
editor. Off macOS, where there is no application menu, it is in File, where the
editors put it.

**Sections down the left, one section's rows on the right** — the shape every
settings window of this kind has, and for a reason that is not imitation: it is
what keeps the dialog the same size as the list grows. A single scrolling column
is fine for the four settings there are today and stops being fine at ten, and
the list of sections is also the only thing that says what _kinds_ of preference
exist without reading all of them. A row is a name, a sentence and its control at
the far end of the line; a control too big for the end of a line — the tab
strip's two pictures — takes the line below instead, which is the same row rather
than a second kind of row.

There are four sections: **Appearance** (the theme, which the `d` key still
toggles — the header's moon button was removed when this row took its place, and
with it the last clickable thing in the title bar), **Tabs** (the placement
above, and whether tabs are gathered under the folder each belongs to — see
Grouped tabs), **Chat** (whether a turn's tool calls are drawn) and **MCP** (what
an agent turn may reach, below). That switch was already a setting, written by a
chat view's own header under `claudeGui.showToolCalls`, and it now governs the
rows both `claude -p` surfaces share (`ChatMessage`). Its key is unchanged,
because a rename would quietly hand somebody's choice back to the default —
which is also why `claudeGui.showThinking` is left lying on disk unread: print
mode reports messages and tool calls and nothing else, so that switch went.

The dialog has no Save. A preference applies as it is picked, which makes the
studio behind the dialog its own preview — picking Vertical tabs moves the strip
while the dialog is still open. `lib/settings.ts` is the store and writes each
change to the workspace's own settings, so it survives a relaunch by the same
route as the strip's arrangement.

## MCP: the workspace as tools

An agent turn started here is already inside the workspace — so the databases
it is pointed at, the requests saved against them and the notes written about
them are things it should be able to read without being told how, and without a
second copy of the credentials in some other config file. That is the same
premise as the tab strip, one level down: `src/main/mcp.ts` serves the panels as
**three MCP servers**, one per panel, and a turn is started pointed at whichever
of them are switched on.

**Off unless somebody said otherwise**, and one switch per panel rather than one
for the lot: letting an agent read a schema is not the same as agreeing that it
may send the saved requests. The switches are in **Settings › MCP**, written to
the workspace's own settings under `mcp.database` / `mcp.api` / `mcp.notes` —
keys in `@shared/api` because both sides read them, the dialog to draw the
switch and the main process to answer with.

What each server offers — three tools apiece, except the API panel, which has
two more that write:

- **database** — `list_databases`, `list_tables`, `query`. Introspection beyond
  the table list is a query against `information_schema`, which is a thing models
  are good at and would otherwise be a per-engine adapter's worth of code
  duplicated out of the renderer. Rows are capped at 200: a tool result is read
  by a model with a context window.
- **api** — `list_requests`, `get_request`, `send_request`, plus
  `create_request`, `update_request`, `delete_request` and the same three for
  the folders they are filed under. A request goes out exactly as the panel
  would send it, which is why the resolution moved to `@shared/http-request`: the
  `{{variables}}` of the active environment, the ancestor folders' headers and
  params, one implementation for both readers. What it does _not_ carry is the
  panel's cookie jar or a request's post-response script — both live in the
  renderer, one of them in a worker sandbox.

  The writing tools save the collection an agent has just been reading:
  somebody who asked for an endpoint to be tried generally wants it kept, and
  dictating a URL, six headers and a JSON body back for the user to retype is
  the opposite of the premise. A request is written **as typed** —
  `{{baseUrl}}/users` is stored with its variables intact, since substitution
  belongs to the moment it is sent — and a method is refused unless it is one of
  `METHODS`, which moved to `@shared/http-request` for this: the panel's picker
  can only draw those, so a request saved as `PURGE` would be a row the user can
  neither read nor correct. `update_request` touches only the fields it was
  given, `headers` replaces the list rather than merging into it (a merge would
  need a rule for a header sent twice, which the panel allows), and a `folder` of
  `null` moves a request to the top level. `postResponseScript` is not writable
  at all: it runs in the renderer's sandbox, and a script is not what "save this
  request" means. Nothing is sent — `send_request` is still the only tool that
  makes a request, which is what keeps "write it down" and "run it" two separate
  agreements. It is the same switch, though: `mcp.api` on now means an agent may
  write as well as read, which is one more reason it starts off. The two
  deletions are the exception, refused to a turn that has everything else:
  the panel has no trash, `delete_folder` takes the requests inside with it,
  and a print-mode turn has nobody to ask. A request is deleted by hand in the
  panel.

  **The folders are writable too**, by `create_folder`, `update_folder` and
  `delete_folder`, because a folder is where the collection's `Authorization`
  and its `?trace=1` live — an agent that can save requests but not the folder
  they inherit from would copy that header into every one of them. A reparent is
  **refused** rather than ignored when it would make a folder its own
  descendant: the sidebar's drag guard can be a silent no-op because the folder
  visibly stays where it was, and a tool call has nothing to look at. Deleting
  cascades the way the panel's own delete does — the folder, the folders under
  it and their requests — from the same `descendantFolderIds`, which moved to
  `@shared/tree` for this: two implementations of a cascade is two answers to
  "what did I just delete". The counts come back so the agent can say. And
  `list_requests` lists the folders beside the requests, since an empty folder
  is invisible in the requests alone and naming a parent means having seen it.

  What is written is announced to the renderer (`http:changed` → `reread` on the
  API store, which also closes a tab whose request or folder has gone — the
  strip draws nothing for an id that resolves to neither, so leaving it there is
  a tab-shaped hole), and that is not only about a panel looking out of date: the
  panel saves the **whole collection** at once, so a window still holding the
  list it read at launch would put it back over the agent's request the next
  time anything in it was edited. A panel that has never read the collection
  does nothing — it has nothing stale to write back, and refreshing would
  restore its tabs into the shared strip before anybody opened it. What is left
  is a genuinely concurrent write: an edit already inside the panel's save
  debounce when the agent writes still wins. The alternative was per-record
  files, which is a change to how the panel saves rather than to this.

- **notes** — `list_notes`, `read_note`, `create_note`. A note is read as
  markdown (`noteMarkdown` in `main/note-blocks.ts`) rather than as BlockNote's
  JSON, and a written one is stored _as_ markdown: converting markdown into
  blocks needs the parser only the renderer has, and the store already hands a
  markdown body over as it found it — the editor converts on first open, the same
  path a note written by an older build takes. It only ever creates, never
  overwrites, because a note may hold drawings and pictures that markdown cannot
  carry. A new note is announced to the renderer (`notes:changed`), which is
  otherwise holding the listing it read at launch.

**Streamable HTTP on loopback**, bound the way the note preview binds its own:
127.0.0.1, a port the OS picks, a secret this run generated in the first path
segment, and a request carrying an `Origin` refused outright — that last one is
the DNS-rebinding guard the spec asks a local server for. The alternative was a
stdio server, which would be a script spawned once per turn, each needing its
own way back to this app's state; one HTTP server in the process that already
holds the state is less of everything. The responses are plain JSON rather than
an event stream, which the spec allows for a server that never pushes.

A starting turn is handed `--mcp-config ~/.tabomni/mcp.json`, written at that
moment with the servers that are on and mode `0600` — a file rather than the JSON
inline, because the URL carries this run's secret and a command line is readable
by every process on the machine.

**Every call is checked against the setting**, not only the ones that were on
when the turn started. Turning a server off has to mean the agent cannot use
it, and a turn in flight is not something to have to wait out to be listened to —
so a switched-off server answers `tools/list` with an empty list and a
`tools/call` with an error naming the dialog. The other direction is not
symmetric: switching one _on_ only reaches turns started afterwards, since the
config was written when the turn began. That is what the line under the switches
says.

`test/mcp.ts` speaks the protocol over a real socket — the handshake, the tool
lists, a request resolved through its folders, a request written, changed and
deleted, a folder made, refused a move into its own subtree and then deleted
with what it held, a note read as markdown, and every way in that should be
refused: a wrong secret, a longer path, a `GET`, an
`Origin`, half a JSON body. Calling into the class would have proved none of
those, and each one is a place where a server that "works" is one the CLI
silently declines to use.

## The assistant, removed

**There was a chat panel about the whole workspace**, opened from the button at
the right of the title bar and drawn as the dock's first tab. It was one
conversation held by the main process — `claude -p` per turn, `--session-id` then
`--resume`, its chats listed in `chats.json` with each one's lines in
`chats/<id>.json` — running in an empty directory of the app's own with every
workspace folder reached through `--add-dir`, so that no folder was the one it
was "in". It was read-only, and enforced by a **denylist**: `--allowed-tools`
only pre-approves, so `--disallowed-tools` was what actually refused `Bash`, the
edit tools and everything reaching outside the turn.

It is gone the way the Mail, git, code search and specs panels went — deleted
rather than hidden behind a flag, so that what is here is what runs. Nothing of
it is left in the code: `src/main/assistant.ts`, `lib/assistant/store.ts` and
`assistant-panel.tsx` are deleted, the seven `assistant:*` channels and the six
methods over them are out of the contract, `AssistantChat` with them, and
`Store` no longer has a `readChat`. `AssistantMessage` and `AssistantEvent`
stayed: they name the assistant _role_ in a turn, which a worktree's chat still
produces.

What replaces it is the chat in a worktree, which is where the argument landed.
The panel existed because the MCP servers are about the _workspace_ and a chat
with a checkout under it is a conversation about one repository — but a worktree
chat is handed the same three servers on the same terms, so the tools were never
the thing only this panel could reach. What it had that no other surface has is a
turn that cannot change anything, and that is a smaller thing than a second chat
UI, a second store, a second `claude -p` policy and a second denylist to re-read
every time the CLI grows a tool.

Two things moved rather than went. Its rows and its composer are the worktree
chat's now (`ChatMessage` and `ChatComposer` in
`components/studio/worktree/`, with `lib/worktree-chat/mention-text.ts` and
`mentions.ts` under them) — they were always shared, and there is one caller
left. And the title bar's button is the **dock's** toggle: the dock's chevron
hides it, and with the tab that used to reopen it gone that corner was a one-way
door.

What is left on disk is left there, as the Mail panel's `mail.json` was: a
workspace that ran the old build still has `workspace/chats.json`, its
`workspace/chats/` directory and an `~/.tabomni/assistant` scratch directory, and
this app no longer reads or deletes any of them. Somebody's conversations are
theirs to keep. The `claude` transcripts those turns wrote are, as ever, the
CLI's own and reachable with `claude --resume`.

## `@` in a chat's composer

`@` in a chat's composer inserts a **name**, and pastes nothing.

There was a composer that put a chip in the message and swapped it for a line of
context on the way out, because a CLI in a pty could see nothing but the prompt —
a table it had never been told about was a table it could not ask about. A chat
here is the other case: it is started with whichever of the Database, API and
Notes servers are switched on, and every one of those tools takes a thing by
_name_ (`list_tables`, `get_request`, `read_note` all say "id or name"). So
picking a row inserts the name and stops there. Pasting the schema in beside it
would be handing the agent a second, staler copy of something it can read for
itself, and the reply would have to be read wondering which of the two it went
by.

**The databases themselves are listed, which a chip could not be.** A chip has to
expand into something, and what a database would expand into is its schema —
which means connecting, and a menu opening is not consent to connect. A name
needs no connection: the list is the manifest's, read at launch, and
`list_databases` and `list_tables` both take one. So every database is offered
whether or not the Database panel has opened it, and the open one's tables are
offered on top of that — which is the difference between `@` answering "what is
in this workspace?" and only answering "what is in the database I happen to be
browsing?".

A row is the name and nothing else — `mydatabase.mytable` rather than that name
with its connection spliced on. On the engines where a schema _is_ a database the
name already says it, and a connection called `Shop (staging)` does not belong in
the middle of an identifier. Which connection a table is in is the row's second
line instead, and the agent's own `list_databases` — which answers with each
record's name _and_ its database — is what pins a bare `public.users` down when
there is more than one Postgres connection.

That is also the reason the tint refuses a dot with a name hanging off it: with
the database `shop` known and its tables unread, `shop.public.orders` is tinted
nowhere rather than tinted at the front, which would have claimed the workspace
had read a table it has not.

The tint is drawn behind the text rather than in it. The composer is a plain
textarea over a mirror of its own value — one class list, `FIELD` in
`chat-composer.tsx`, shared by the two so a character lands in the same place in
both — and the mirror renders the tint with transparent glyphs, so the text on
screen is the textarea's own and selection, IME and undo are the platform's. A
rich-text editor would have been a document model to keep in step for a
decoration, over a message that is plain text on the wire and in the transcript.

What is tinted is read from the catalogue rather than remembered from the menu,
which is `markMentions` in `lib/worktree-chat/mention-text.ts`: a name typed by
hand lights up like one that was picked, half a name deleted stops being tinted,
and a note that has since been deleted is plain text — the tint means "the
workspace still holds this", which is the thing worth knowing before sending.
Names are matched whole and case-sensitively, longest first, and a
one-character name is not matched at all, because it would tint every letter it
appeared in. The same marks are drawn on the message once it is sent, so a line
still reads as pointing at a table rather than mentioning one in passing.

## Explorer

The first of the four sections, and the only panel that shows the folders
themselves rather than something the studio keeps about them: the workspace's
directories, opened one level at a time, and a file opened into an editor.

**One tree: the files of the checkout being worked in.** Not one per project
and not one per checkout — the list is the contents of a single directory, with
no root row above it and nothing else beside it (`shownRootOf` in
`lib/files/roots.ts`, over `activeFolderId` and `checkout` on
`lib/projects.ts`).

Two wider versions came first and both are the wrong shape. Every checkout as a
root of its own is three copies of one repository stacked in one column, each
with its own `src/`, its own `package.json` and its own everything; every
project as a heading is the same problem one level up, a list to scroll past
before reaching the files somebody actually has open. The question a file tree
answers is "the files of the thing I am working on", and the thing being worked
on is one place. It is the choice the dock's Terminal already makes: one shell
for the place you are in, not one per place there is.

Clicking a project row or a worktree row in the column moves the tree, the chat
and the shell together, so the files beside a chat that is editing a branch are
that branch's files. Which checkout is remembered **per project**, so coming
back to one lands on the branch it was left on rather than on its main working
tree. A `⌘P` hit anywhere else switches the selection on the way to revealing
it, since the index walks every root.

**There is no bar above the list.** There was one — the project's name, the
branch on screen and a picker for the other checkouts — and it went for the
reason the panel's title went: the left column already lists every project and
every checkout and marks the one selected, so a strip repeating it was a row of
chrome answering a question that was already on screen. Which branch a file tab
belongs to is on the tab's hover line, and the title bar's crumb says the same
thing across the top.

What the bar carried is the **root's menu**, and that is now the right-click on
the empty space under the tree — the only part of this panel that is about the
checkout as a whole rather than about a file in it. It splits the way the bar
did: `New file`, `Refresh`, `Collapse all`, `Copy path` and `Reveal` act on the
checkout on screen, `Add folder` is the workspace's own, and `Rename` and
`Remove folder` act on the workspace's record of the project. The cost is known
and accepted: a tree long enough to fill the column leaves only the list's
bottom padding to right-click, and the way back is `Collapse all` or the File
menu. The root is read and watched without being a row — `FileTree` keeps its
path in `expanded`, which is also what makes `Collapse all` leave the tree
standing.

**The panel's header is two tabs: `All files` and `Changes`.** It was the word
`Explorer` and a row of buttons, which named the panel to somebody already
looking at it; the space is worth more as the way in to the other list this
panel has. After an agent's turn, "what has changed in this checkout" is
often the only question being asked, and it is now a click rather than a button
that opened a pane. `explorerTab` on `useStudio` is which one is showing,
remembered with the strip — it is a way of working rather than a fact about a
branch, so it does not reset when the left column moves. The bar underneath —
the project, the branch, the checkout picker — is shared by both, since both are
about the same checkout.

**One button beside them, and it is `Refresh`.** There were four — `New file`,
`Refresh`, `Collapse all`, `Add folder` — and a row of icons beside two tabs is
a row of icons nobody reads. Each of the other three is on a menu over the thing
it acts on, which is a better place for it: `New file` and `Collapse all` on the
root bar's menu, and `New file` again on any directory row's, where it creates
in **that** directory rather than guessing from whatever was selected;
`Add folder` on the empty space under the tree and in the File menu. Refresh is
the one that is about the panel rather than about anything in it, and the one
with no target to right-click — the filesystems `fs.watch` is quiet on are why
it exists. It re-reads both halves, the disk and git, because "this is out of
date" is one thought.

A workspace pointed at nothing draws the `Add folder` button where the files
would be. It drew an empty list and said nothing before, on the argument that
the header had the button directly above it; it does not any more, and a blank
column whose only way forward is a right-click is a dead end.

The count rides on the tab: `Changes 12`, read for the checkout on screen
whichever tab is showing, which is the whole use of a number on a tab. Nothing
at all at zero, or before the first read.

**The list is here; the diff is the tab it opens.** `changes` is a `Pane` of its
own (`changes-pane.tsx`, `lib/files/changes.ts`), one per checkout, whose **id is
the root's** — so `rootOf` is the identity function and the tab is in the strip
exactly while that checkout is the one being worked in. A row picks a file and
that tab shows its diff, so a turn's twelve changed files are twelve clicks and
one tab.

That last sentence is the whole of why the list is allowed back into a sidebar.
It stood as a `Files | Changes` toggle on this panel once and the click is what
moved it out: a sidebar row opened a **file tab**, so reading twelve changed
files left twelve tabs to close afterwards. Then it was the pane's own left
column, which worked but put the list somewhere that had to be opened before it
could be read. What is not allowed either way is the list in both places at
once — one question answered twice, which is the thing this app keeps deleting
(the Terminal sidebar's second folder list, the assistant panel beside a worktree
chat) — so the pane holds the diff and nothing else.

A row is one line: the directory, dimmed, then the file's name in its git
colour, then the state's letter and `+112 −8` at the end. The **directory** is
what gives way when the column is narrow — `min-w-0` on it and `shrink-0` on the
name — because the name is the part anybody scans a list for, and truncating the
other way round gives a column of rows that all begin `src/renderer/comp…` and
end nowhere. The counts come from `git diff --numstat` against
`HEAD`, except for an untracked file, which is in no diff at all and so is
counted by being read — under a cap, since an untracked directory of generated
output is not worth reading and a minified bundle is one line and twelve
megabytes (`MAX_COUNTED_NEW_FILES` in `main/git.ts`). Where there is no honest
number the row shows none: a binary file, a file past the cap, a repository with
no commit yet. Nothing ignored is listed — those are what the tree greys, and
they are not anybody's changes.

Its list is read for the **one checkout on screen**, unlike the colours, which
are read for every root so that any path can be coloured — `useWatchChanges` is
the hook the panel calls, and it is the panel rather than the list that calls it
because the count on the tab has to be right while the tree is what is showing.
It keeps no timers of its own either: `useGitStatus` already debounces the watchers and already reads
`.git`, so its answer for a root changing identity is the signal to re-read —
including after a commit made in the dock's shell. Two sets of timers over one
set of events would be two lists that disagree.

**A row selects; the pane is the diff.** What that pane draws is
`FilePane` — the very component a file tab draws, so the header, the diff
controls, `Diff | Edit` and ⌘S are the ones already learnt rather than a second
set to drift from them. It reads the file through the files store without putting
it in `openIds`, which is what keeps reviewing from spawning tabs. `diff` is
itself a viewer beside `text`, `markdown`, `blocks` and `image`
(`lib/files/viewers.ts`), so the same file opened from the tree is an ordinary
tab — the same strip, the same ⌘S, and the right-click menu switches to the
editor and back. It is offered for anything textual rather than only for a file git has
something to say about: "what has changed in this" is a fair question to ask of a
file that turns out to have changed in nothing, and a menu entry that appears and
disappears with the working tree is one nobody can learn. It is never the
default — a diff is asked for.

Monaco's diff editor, and **both sides are read-only**. A diff is a thing to
read: two columns, one of them a commit, with the caret stepping between
versions of the same line. The right-hand side was editable for a while, because
it genuinely is the file — and what that bought was a pane whose left half
refused every keystroke while its right half took them, in a view nobody had
opened in order to type. Editing is the `Edit` half of the toggle in the header,
which is one click away and the same buffer.

The right-hand side is still **the file** and not a copy: the same path-keyed
model the text editor uses, which is what makes the diff show unsaved edits
rather than what is on disk, and what makes switching to `Edit` keep the buffer
and its undo history. ⌘S saves from here too, since the model can be dirty from
the other view and the key is muscle memory rather than a property of the pane
it was pressed in. More than one editor can hold that model at once — a file
open as a tab while the `Changes` tab shows its diff — so `modelFor` counts
holders and `releaseModel` disposes at zero. Before it did, whichever editor
unmounted first took the buffer out from under the other. The left is a
throwaway model holding `git show HEAD:<path>`, the content of a commit.

A **deleted** file is the case worth naming: it has no row in the tree, it is a
row in this list, and its diff is the whole of it removed. So the diff is drawn
ahead of the "could not open this file" notice, with the left side committed and
the right side empty. There is nothing to special-case about it any more — the
store holds no text for such a file, and a read-only diff was never going to
hand it any.

**The path in that header is relative to the checkout**, with the absolute one
on the hover line. A `git worktree` checkout lives under
`~/.tabomni/workspace/worktrees/<uuid>/<branch>/`, so the absolute path spends
forty characters on where this app keeps its checkouts before it reaches
anything about the file — and a header that truncates from the left then shows
`…/hhh/bbb.txt` where `bbb.txt` would have fitted. `Copy path` and `Reveal`
still deal in the absolute path, which is what the OS and a terminal want.

**The diff has its own toolbar**, in the row that already carries the file's
path — how the two sides are laid out and whether whitespace is drawn are
questions about the thing on screen, and a second strip under the first would be
two toolbars for one pane. Three controls: `Diff | Edit`, which is the same
`views` field the tree's "open with" writes; inline against side-by-side; and
whitespace. The last two are `useSettings` (`diffSideBySide`, `diffWhitespace`
under `workbench.settings`), because how somebody reads a diff is not a property
of the file they happen to have open, and they are applied with `updateOptions`
so a click does not cost the scroll position.

`Diff | Edit` is drawn only while one of those two is the viewer showing. A `.md`
can also be a preview or a block editor, and a segmented pair cannot say which of
three is on without lying about the other two; that menu is the tree's
right-click, which offers all of them. The layout control is a segmented pair
with the current mode lit rather than one button that swaps its icon: a single
icon stands either for the mode you are in or for the mode you would get, and
whichever it means, half the people reading it take it for the other. `pressed`
on `IconButton` is only `aria-pressed` — it says so to a screen reader and
nothing to the eye — so the on state is drawn here.

Choosing side by side also turns **off** `useInlineViewWhenSpaceIsLimited`.
Monaco second-guesses `renderSideBySide` by falling back to the inline view below
`renderSideBySideInlineBreakpoint`, which is the right default for a setting
nobody set and the wrong behaviour for a button somebody just pressed — and it is
what made the first diffs in this panel come out unified in a pane a shade under
the 900px threshold.

**The diff is the one editor that is unmounted rather than hidden.** Every panel
in the workbench, and every file tab inside this one, is kept mounted and hidden
with `invisible` — the point is editing state, an undo history and a caret and a
set of folds that a rebuild would take. A diff has none of that worth keeping:
the right-hand side is the file's own model, which the text editor holds anyway,
so a rebuild costs a scroll position. Set against that, a diff editor left live
in a hidden panel went on painting its line numbers and its red and green bands
straight through the pane drawn over it.

The same bug had a second half worth naming: `visible` in `file-workspace.tsx`
meant "the active file tab" when what it has to mean is "the active tab **of the
panel being looked at**". A file tab stays active while a chat is the pane on
screen, so a note editor in the hidden panel was answering the drawing event only
the visible one may answer, and ⌘S typed into a chat's composer saved a file
tab nobody could see. `pane === "files"` is now the other half of it.

**What the tree draws and what the app may read are two different things.**
`fileRootsOf` is every root there is — each folder and each of its checkouts —
and it is what answers "may this be read", "does this tab survive", "which
checkout is this path in". `shownRootOf` is the single one the tree draws.
Keeping them apart is what stops switching project or branch from closing the
tabs of the one being left, unsaved edits and all: the tree is a view, not the
workspace.

Everything keyed by "where" uses the root rather than the folder: `FileRoot.id`
is `worktreeId ?? folderId`, the same key the dock's shells use for a place. One
`git status` per root, so a checkout is coloured by its own uncommitted work;
one tsserver per root, so a hover resolves against that checkout's
`node_modules` rather than another branch's; one tab group per root, so
`src/index.ts` open on two branches is two tabs under two names; and the
palette's index walks them all, with the branch in the hint beside a hit — two
checkouts of one repository hold the same `src/index.ts`, and the folder's name
alone would draw the same row twice. `fileRoots` in `main/ipc.ts` is the
main-process half, and it is what `insideAny` is given, since a checkout is
inside no folder and every read of one would otherwise be refused.

**The tree is the directory tree.** Every other sidebar lists records this app
owns — a request, a note, a database — and files them however it likes;
this one lists what is on disk, so its shape is not the studio's to choose.
Nothing is hidden: a file explorer that skipped dotfiles would be hiding
`.env.example` and `.github`, which are what people open it to find. A folder is
read when it is expanded, one `readdir` at a time, so pointing the workspace at
a repository with a `node_modules` in it costs nothing until somebody opens
that row.

**What is expanded is watched, and nothing else is.** A folder opened in the
tree gets one non-recursive `fs.watch` for as long as it stays open, and closing
the row closes it (`main/watch.ts`, `lib/files/watch.ts`). This is the narrow
version of a watcher rather than the usual one: a watch over a whole repository
is a file handle per directory and a rebuilt tree on every `npm install`, and
the panel would spend its time reacting to churn nobody is reading, while this
costs one handle per row somebody is actually looking at and reports a
directory the tree was drawing anyway.

The renderer sends the whole set — `expanded` itself — rather than a
watch/unwatch pair, so the main process cannot end up holding a watcher for a
folder that was collapsed while a message was in flight. What comes back names
the directory and not the change: `fs.watch` reports a rename as one event or
two depending on the platform, and often names only one half of it, while the
answer is a `readdir` of that directory either way. `syncDirs` in the files
store re-reads the listing and the files in it that are on screen — except the
ones with unsaved edits, which are never overwritten by it.

**The rows are coloured by what git says about them, and lettered at the end
the way an editor does it** — `M`, `U`, `A`, `D`, `C`. One `git status` per
root (`main/git.ts`, held in `lib/files/git-status.ts`), and four things to
read off a row without opening anything: a new file is green, an edited one the
familiar tan, a deleted or conflicted one red, and everything ignored recedes
into the theme's own grey — `node_modules` and `dist` stop being the same weight
as `src`, which is most of what the colour is for. The values are the editors'
own git decoration colours rather than a set chosen here: this is the one part
of the studio somebody arrives already knowing, and a green that means "new"
everywhere else must not mean something else in this tree.

Ignored has no letter, deliberately. The letter is for a state somebody might
act on, and there are hundreds of ignored rows to one modified file — a column
of them down the whole of `node_modules` would be the loudest thing on the
screen, saying the least. A tracked file with nothing changed in it is the
ordinary row and has neither colour nor letter, so the tree is mostly plain and
the marks mean something. The hover line says the state in words as well, since
a palette nobody was taught is not information.

The index and the working tree are collapsed into one state deliberately:
nothing in the studio stages anything, so "changed and not committed" is the
whole of what a row can usefully say. A wholly untracked or ignored _directory_
arrives as one entry — git reports `node_modules/` rather than its contents,
which is the difference between one line and a hundred thousand — and the
renderer reads it as a prefix, which is also how a folder gets a colour without
anything aggregating its children.

A deleted file has no row, because the tree is what is on disk. Where it shows
is the tab: a file that has gone keeps its tab, drawn in the deleted colour with
`deleted` written on it, so the editor is plainly showing something that is no
longer there rather than looking like every other tab.

Two sources say so, and **not** either-or (`isDeleted` in `lib/files/store.ts`).
Git knows a tracked file was deleted. The tree's listing is the only thing that
knows an _untracked_ one was, since git stops mentioning it the moment it is
gone. But a listing can be stale — it is re-read from a watcher, and Refresh
exists below for exactly the filesystems where that is not enough — so a file git
is currently calling untracked, added or modified is a file that **exists**,
whatever a listing read before it was written still says. Only where git has
nothing to say at all does the listing get the last word.

Treating them as interchangeable shipped a bug worth remembering: a file an agent
had just created in a worktree was opened from the Changes list, where git had it
as `U` and its diff drew the added line correctly, and its tab said `deleted` —
because the tree had read that directory before the file existed.
`test/files-store.ts` holds the six cases now.

The status is re-read when the roots load, when Refresh is pressed, and —
debounced, so a checkout is one read and not fifty — whenever a watched
directory reports something. Each root's `.git` is watched for exactly this:
a commit made in the dock's shell changes the colour of every row and the branch
beside the folder, while touching no directory the tree has open. In a worktree
that path is a _file_ pointing into the parent repository and catches less; what
covers the case there is the ordinary one, since a commit touches files in
directories the tree already has open and each of those schedules the same read.

**Refresh is still in the header**, because a watcher is the fast path and not
the reliable one: `fs.watch` misses writes on network and virtualised
filesystems. It re-reads
every open directory and every open file, and rebuilds the palette's index,
which nothing watches at all — keeping that in step would mean watching
everything under the workspace, which is the cost this avoids.

**A path is the identity.** Tabs elsewhere are addressed by an id this app
made up; a file has only the name the filesystem gave it, so `file:` + the
absolute path is the tab id, and a rename is handled as what it is — a new
identity, carried across the open tabs, the expanded rows and the cached
listings by `movedPath` in `lib/files/paths.ts`. Those helpers accept both
separators: the main process hands over whatever `node:path` produced, which on
Windows has backslashes in it.

**Every call is checked against the workspace's roots** — its folders, and the
checkouts made of them. `insideAny` in `src/main/files.ts` is the gate in front
of the eight `files:*` handlers, fed by `fileRoots` in `ipc.ts`, and it is why
they are eight narrow calls rather than one general "run this fs operation": the main process has to be able to say what each one may touch. An
absolute path from the renderer can name anything on the machine, and the case
worth defending against is exactly the one where the renderer is wrong.

Deleting is `shell.trashItem`, not `unlink`. This is somebody's source file, the
studio has no undo of its own, and every desktop already has one.

**The workspace's folders are this panel's.** Adding one, renaming it and
removing it are here and nowhere else — a folder heading's right-click menu, and
`Add folder` in the header, which the File menu's own item and the empty space
under the tree both reach as well. This is the list that says what the workspace
is pointed at, so it is the list that changes it. The Terminal sidebar used to
carry the same three actions on its own copy of the folder list, which meant two
answers to "where do I remove a folder"; that sidebar became a Sessions list
under this tree, and then went altogether with the panel it listed. Each heading
carries the folder's branch. It
sits on a line of its own under the name rather than at the right of it: branch
names run as long as the ticket they were cut for, and a row shared with one of
those was all branch and no folder.

Removing a folder takes the studio's record of where it is, along with the tabs,
chats and shells open against it, and leaves the directory exactly as it is — the
dialog says so, because this is the one destructive action in the studio that
looks like it might delete somebody's repository.

Renaming a folder is the one rename in the studio that does not touch the thing
it names. The manifest records an absolute path and a name beside it, and only
the name changes — the directory keeps whatever it is called on disk, and
anything already running in it keeps running. The dialog says that too, rather
than leaving it to be discovered from Finder, which is what the `description` on
`RenameDialog` is for. The rename directly under it in the same menu, of a file
or directory _inside_ a folder, does touch the disk, and says which it is.

**A row is renamed in the row**, not in a dialog, and that is true of every
sidebar in the studio: a file and a directory here, a note and a note folder, a
saved request and a request folder. The field takes the row's place —
same height, same inset, the same icon or method badge beside it — the way every
editor's tree does it. `components/studio/rename-row.tsx` is the one of it;
`SIDE_ROW_SHAPE` is exported from `side-row.tsx` so the field and the row it
stands in for cannot drift apart, since a field cannot live inside the row's own
`<button>`.

Two renames are still dialogs, and both for the same reason — they are not a row's
own name. A **workspace folder**'s is the studio's label rather than the directory
on disk, and it needs somewhere to say so (above). A **table or column** is a
schema change run against a server, not a label being corrected.

The name opens **selected**, so the first keystroke replaces it. For a file that is
the name without its extension — `report.txt` opens with `report` selected and
`.txt` left alone, since an extension is a fact about the file rather than a name
someone chose, and one typed over by accident is a file the editor opens as
something else. `stemEnd` in `lib/files/paths.ts` is where the line falls, on the
same `dot > 0` rule the extension lookups beside it use: a dotfile is all name, and
`archive.tar.gz` offers `archive.tar`, because deciding which compound suffixes are
really one is a list with no end. Everything else takes the whole name — a
directory can have a dot in it and mean it, and a note or a request has no
extension for this to be about.

**Enter renames, Escape leaves it alone, clicking away renames**, and a rename that
fails keeps the field open with the caret back in it and the reason under the row —
the name is wrong and it is still the best thing to start from. Two details there
are load-bearing rather than incidental, which is why `useMenuFocusHandoff` exists
beside the row rather than being written out four times:

- **The closing menu must not take the focus back.** Base UI returns focus to the
  trigger when a menu closes, which would take it off the field the instant it
  appeared — and the blur that followed would commit an unchanged name and close it
  again, which reads as a feature that does not work. So the one item that means to
  take focus says so, and the rest keep the default.
- **The field is never disabled while the rename is in flight.** Disabling a
  focused input blurs it, which arrives as a second commit; and re-enabling it a
  render later means the refocus after a failure lands on an input that is still
  disabled and does nothing.

Which row is being renamed is the panel's own state, except in the Explorer, where
it is in the files store: the row that draws the field is at the bottom of a
recursion and the menu that starts it is at the top, so passing it down would give
`Directory` a prop it does nothing with and re-render every row in every open
directory. From the store, the two rows that change are the two that re-render.

**Nothing here starts a terminal.** A folder's menu used to hold
`New session here…`, opening the session picker with that folder chosen. A shell
is a dock tab now, pointed at whichever project the left column last had
clicked,
so there is one place that opens one and one place it appears — a menu item that
put a shell in a corner of another column would be a menu item nobody could find
the result of.

**Rows carry a file-type icon**, in front of the name the way an editor does
it: the vendored [vscode-icons](https://github.com/vscode-icons/vscode-icons)
set (MIT), a chosen forty-odd of its fifteen hundred, in
`assets/file-icons/`. `lib/files/icon-names.ts` is the table — by whole name
first (`package.json` is npm, not JSON), then by a prefix for the families that
spell themselves several ways (`tsconfig.*`, `.env.*`), then by extension — and
it is deliberately separate from `icons.ts`, which reaches for the bundler, so
the mapping can be tested without a Vite build. A type with no icon checked in
falls back to the studio's own Lucide glyph, which makes a coloured icon mean
"a kind of file the studio recognises" rather than decoration. Folders keep the
glyph either way: they are the tree's structure, and coloured folder icons
would compete with the files under them.

**A picture is shown as a picture.** PNG, JPEG, GIF, WebP, BMP and SVG open in
an image view rather than an editor — contained, never scaled up, so a 16×16
favicon is drawn at 16×16, and on a checkerboard, because transparency is what
somebody opens an icon to check and a transparent PNG on a flat panel looks
exactly like a white one. The bytes come over as a `data:` URL: the renderer is
not on a `file://` origin, and Chromium will not load a `file://` subresource
from any other one.

SVG is honestly both, so it gets both — a picture by default, and the text
editor from **Open with** in its right-click menu, which appears only where
there is a genuine choice to make. The two halves are read and kept separately,
so switching back and forth re-reads neither.

**A `.md` is the other one**, and the menu is the same menu three times over:
**Text editor**, which is what it opens as, **Markdown preview**, which draws it
as the document it was written to be, and **Markdown editor**, which is the
block editor below — the document, written without typing the syntax. The
default is the editor rather than the
preview, unlike SVG's: the Explorer is a tree of a project's source, and a
README reached from there is more often on the way to being changed than being
read. There is no second copy of the text — the preview draws the same buffer
the editor writes into, so an edit is in it the moment the view is switched,
saved or not. The renderer is the transcript's,
`components/studio/markdown-view.tsx`, which is why it sits at the studio's root
rather than in either panel; what the Explorer adds is a document's type scale
over a chat message's, in `files/file-markdown.css`, in the same theme tokens as
everything else so light and dark need no second palette. The column it is set
in is the block editor's own — `--prose-measure` in `styles/globals.css`, read
by both, with the same proportional side padding — because these are two views of
one file and switching between them must not move the text. `.mdx` is
deliberately not offered one: it is markdown with JSX in it, and a commonmark
parser drops the component tags rather than drawing them.

**A `.note` is the third file, and the only one the studio invented.** It opens
in the Notes panel's own block editor — the same `BlockEditor`, the same slash
menu, the same `/drawing` — over a file in one of the workspace's folders
instead of over a record under `~/.tabomni`. `New note…` sits beside `New file…`
in a folder's right-click menu and on the folder heading's, and creates an empty
file with that extension: there is nothing to write into it, because an empty
body is the empty document the editor starts on anyway.

What it is for is the note that belongs to a repository rather than to the
workspace — the notes on a migration, kept beside the migration, committed with
it and read by whoever pulls it. That is also why the file is written as
_indented_ JSON with a trailing newline, unlike the notes panel's own
`notes/<id>.json`: a note in a working tree gets reviewed, and a note whose
diff is one 40 KB line is a note nobody can review.

A body that is not that JSON is read as markdown rather than replaced with an
empty document (`lib/files/block-doc.ts`). A `.note` can reach the pane having
been written by hand or by something else, and an unreadable one drawn as an
empty note is an empty note about to be saved over the top of it — read as
prose it is at least all still there, and visibly so. The **Text editor** is
offered second in the same **Open with** menu for the same reason: a note that
will not open the way it should is a note whose text somebody needs to see.

It is the files store's tab, not the notes store's, and that decides how it is
written: typing marks it dirty, ⌘S and the header's Save write it, and closing
the tab flushes it — where a note in the Notes panel is written as it is typed.
The file is in somebody's repository beside their source, and a rich-text pane
that wrote on every keystroke would be changing their working tree while they
thought.

The one thing it does not carry is its pictures. A drawing's scene and a dropped
image are files of the workspace's own — `workspace/drawings/` and
`workspace/note-files/`, exactly as for a note in the panel — and the document
holds only the id or the `note-file://` URL, so a `.note` committed to a
repository arrives somewhere else with its words and without them. This is a
note editor pointed at a file, not a portable note format; making it the second
thing would mean a sidecar directory per note and a second answer to where a
drawing lives.

**The same editor over a `.md` is the one viewer that changes the file it is
shown, and it is offered anyway.** `blocks` is a single viewer — one pane, one
slash menu — and what differs is what it writes: a `.note` gets the block
document it already held, and a `.md` gets markdown printed back out of the
editor. That print is `blocksToMarkdownLossy`, which is lossy by its own name:
children of blocks that are not list items are un-nested, some styles go, and it
renders the _whole_ file from the document, so the first save reflows every line
whether or not it was touched. That is exactly the trade the Notes panel refused
when it moved its own notes off markdown — and the difference here is that the
markdown is not this app's storage, it is the user's file, so the choice is
theirs to make per file. What the studio owes them is that nothing happens until
they make it: the text editor stays the default, nothing is written until a
keystroke, and the `.md` that is only read is byte-identical afterwards.

Three things the block editor can do are switched off for a `.md`, at the source
rather than by warning about them, because the file cannot hold them:

- **Frontmatter never reaches the editor.** `---` is a thematic break to every
  markdown parser there is, so a document with frontmatter parsed into blocks and
  printed back comes out as three horizontal rules with `title:` between them —
  not a lossy conversion but a broken file, and the site or docs build reading
  that file stops finding what it needs. `splitFrontmatter` takes it off byte for
  byte and every save puts it back; the pane says so in a line above the editor,
  since content held back silently reads as content eaten. It is Jekyll's and
  `gray-matter`'s rule deliberately — a leading `---` with a later one is
  metadata, even where a rule was meant — because matching the tools that read
  these files matters more than being right about an opening rule nobody writes.
- **`/drawing` is not in the menu**, and a ```drawing fence in the file stays the
  code block it parsed to (`blocksFromMarkdown`'s `drawings: false`). A drawing
  block has no markdown of its own, so one placed here would not survive the
  save that followed it.
- **A picture cannot be dropped in.** An upload lands under
  `workspace/note-files/` and the document holds a `note-file://` URL, which is
  a broken image in every other reader of that markdown. The image panel is
  built from what the editor can do, so with no `uploadFile` it offers the one
  thing a `.md` can honestly hold: a URL to embed.

`lib/files/viewers.ts` holds all of that and nothing else does.

Two other kinds of file are reported rather than opened: anything with a NUL
byte in its first 8 KB, and anything over 2 MB. Both come back as results rather than
errors — "this is a PNG" and "this is a 40 MB log" are things the pane can say
plainly, and rejecting would file them beside "the disk went away".

### Conversations, removed

**There was a Conversations section under the tree** — every `claude` transcript
the workspace's folders had on disk, this app's runs and the user's own alike,
read-only in a tab of the Explorer pane with a `Resume` that handed one to a real
session. It is gone, deleted rather than hidden, the way the git, code search,
specs, webhook and Mail panels went: nothing of the list, the read-only view or
its store is left in the code or the tab strip.

The **Past sessions** drawer went the same way, and then the chat view itself
(see Terminal sessions, removed) — so `src/main/transcript.ts` is gone entirely,
along with the mirroring IPC and `hasTranscript`. **Nothing in the app reads
`~/.claude/projects/<encoded-cwd>/` any more.**

What this costs, plainly: no conversation the CLI wrote is reachable from inside
this app. `claude --resume` in a terminal still is. What is reachable here is
what this app itself holds, which is a worktree's chats.

### The editor

**Monaco**, which is what every editor in the studio is. It was this panel's
alone for a while, against CodeMirror everywhere else: the rest of the app edits
fields — a SQL statement, a request body, a response — where CodeMirror's size
was the point, and this one edits the user's own source, where what is wanted is
the editor they already know. Two editing stacks turned out to be the more
expensive half of that trade. One stack costs the schema-aware SQL completion
`lang-sql` gave the console for free, which is now hand-written in
`lib/db/sql-completion.ts`, and buys back a launch bundle ~250 kB smaller, one
set of keybindings across the app, and JSON and TypeScript language services the
field editors never had.

What is shared is in `lib/monaco.ts` — the workers, the font, the theme, and
`panelEditorOptions`, which is what an editor that is a _field_ gets. That is
deliberately less than this panel's: no minimap, no sticky scroll, no overview
ruler and none of Monaco's own context menu, since those are a few lines of
chrome competing with a few lines of text. What survives at any size is the half
the shared CodeMirror chrome carried too — numbered lines, folding, the find
widget and wrapping.

Every one of them is loaded on demand, each panel's editor behind its own `lazy`
so the ~4 MB of grammars is fetched the first time an editor of any kind is
opened and never in a run that stays in the sidebars. The fallback is an empty
box rather than a spinner: the chunk comes off disk on the `app://` origin, so
what it covers is a parse rather than a download. Those workers are bundled by
Vite and served from that same origin rather than fetched from the CDN the
default `MonacoEnvironment` would reach for, which in a desktop app is a network
round trip for something already on disk, and offline is a silent failure.

**Two grammars are extended rather than taken as they come** (`lib/files/grammars.ts`).
Standalone Monaco highlights with Monarch, not with the TextMate grammars VS
Code uses, and that set is smaller. `.tsx` and `.jsx` were already registered as
TypeScript and JavaScript, but neither grammar has any notion of a tag, so
markup tokenized as arithmetic; JSX rules are added in front of both. `.vue` was
not registered at all — it is HTML's own grammar plus one state for
`<script lang="ts">`, since a single-file component is an HTML document as far
as tokenizing goes.

The JSX rules rest on one heuristic, because Monarch matches a regex at a
position and `<` is three different things: **`<` directly after an identifier
is generics, `<` after anything else is a tag**. `Array<string>` and
`useState<number>()` never have a space there, while JSX always follows a `(`, a
`return`, an `=>`, a `{` or another tag. It can be wrong — `1<x` reads as a tag —
and being wrong colours a line oddly rather than breaking anything. The rules go
on the `typescript` and `javascript` languages rather than on ids of their own,
because Monaco has no `typescriptreact` and the TypeScript worker is bound to
those two ids. They are registered as a tokens provider _factory_, which is how
Monaco registers its own: registering a factory replaces the one already there,
while setting a provider directly would win only until Monaco's lazy loader
resolved and overwrote it.

Semantic TypeScript diagnostics are **off**, syntax diagnostics **on**. Monaco's
TS worker sees one file with no tsconfig, no `node_modules` and no other file in
the repository; left on, it reports every import in a real project as missing.
Syntax validation needs none of that context and is right every time — with
`jsx: Preserve` set on both defaults, or a `.tsx` file would report its own tags
as syntax errors.

What follows from the worker seeing one file is that it can say nothing about an
import — which is what the next section is for.

### Hover and go-to-definition

A real **`tsserver`**, one per Explorer root — each workspace folder, and each
`git worktree` checkout of one — in the main process (`src/main/tsserver.ts`).
A checkout gets its own because it has its own `node_modules` and its own
`tsconfig.json`, and resolving one branch's imports against another branch's
copy is how a hover ends up pointing at source nobody is looking at.
`serverFor` takes the longest matching root and a checkout is nested inside no
folder, so this falls out of the list it is given. Monaco keeps what it is good at — colouring, folding,
syntax errors in the file in front of it — and two providers hand the two
project-shaped questions to the server: what is this symbol, and where does it
come from. Hovering an import gives its signature and its doc comment;
`⌘`-clicking it opens the declaration as a tab, `node_modules` included, with the
tree expanded down to it.

**tsserver directly, not a language server.** `typescript-language-server` is a
translation layer over this same process, and turning LSP into tsserver's
protocol only to turn it back into Monaco's providers is a dependency to carry
and keep in step for no answer it could give that this cannot. The protocol is
newline-delimited JSON in, `Content-Length`-framed JSON out; the whole client is
one file, and `test/tsserver.ts` runs it against this repository rather than
against a mock — a mock would agree with whatever the client believes about the
framing, which is the belief worth testing.

**The root's own TypeScript, and no other.** A repository pinned to 5.4 should
be read by 5.4: its `tsconfig.json` may use options another version rejects, and
the types it resolves are its own compiler's. A folder with no `typescript` in
its `node_modules` gets no hovers, deliberately — shipping a copy would add forty
megabytes to the download to serve a project that, having no TypeScript
installed, has no types to resolve either. It is the same bargain the app makes
with the `claude` CLI: use what the machine has. `tsserver` is started with
`--disableAutomaticTypingAcquisition`, because the default is to reach for the
network and install `@types/*` on behalf of somebody who asked to look at a file.

The server is told what is in the **editor**, not what is on disk: `open` on a
tab, a debounced whole-file `updateOpen` as it is typed into, `close` when the
tab goes. Without that, a hover would answer for the last saved version at
positions that no longer line up with the screen. Nothing starts at launch — a
run spent in the Database panel never reads a `.ts` file, and loading a monorepo
is not a cost to pay on the chance somebody might.

Go-to-definition across files needs one more piece: standalone Monaco, handed a
target in a model it is not attached to, does nothing at all, which reads as a
broken key rather than a missing feature. `monaco.editor.registerEditorOpener` is
the hook it offers, and the studio answers it by opening the file as a tab — the
same act as clicking it in the tree.

Saving is `⌘S`, with a dot on the tab and on the tree row while a buffer is
ahead of the disk. Closing a tab writes it rather than asking — the same bargain
the Notes panel makes, since the edit was deliberate and a three-button dialog
is in the way of the common case.

## Terminal sessions, removed

There was a Terminal panel, and it was for a long time the centre of the app: as
many sessions as you opened, each a pty in one folder's real directory running a
plain shell or `claude`, one tab per project in the workbench strip with that
project's sessions in a strip inside it, an agent picker that could install a
missing CLI, and — for a `claude` session — a **chat view** that tailed the
transcript the CLI writes at
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` so that Terminal and Chat
were two ways of drawing one process.

All of it is gone, deleted rather than hidden, the way the git, code search,
specs, webhook and Mail panels went. What went with it:

- the `terminal` pane, its entry in `PANELS`, and its strip ids
- the chat view, its composer, the `@` chips and the `/` command menu
- `main/transcript.ts`, the transcript-mirroring IPC, `hasTranscript` and
  `--session-id`
- `main/agent-tools.ts` and `main/claude-commands.ts`, the agent kinds
  (`AgentKind`), the picker and the installer
- Explorer's **Sessions** list and `New session here…` on a folder's menu
- the `session` task-member kind, which was the last thing a task could hold
  that was a process rather than a document (the tasks themselves went later —
  see Tasks, removed)
- the remembered `agent.sessions` setting, which nothing reads any more (the key
  is left on disk: removing a feature is not a reason to rewrite somebody's
  settings file)

**What replaced it is two things, not one.** An agent conversation is a
worktree's chat — `claude -p` per turn in a checkout of its own, hosted by the
app rather than read off a file (see Worktrees). A shell is the dock's `Terminal`
tab, one per project, pointed at whichever the column last had clicked (see The
dock). The split is the point: the two halves of a session were a conversation
and a directory, and each of them now lives where it belongs.

What this costs, plainly. A turn cannot be interrupted with a keystroke at a real
prompt, and cannot answer a permission prompt — print mode has nobody to ask,
which is why a worktree's chat runs with edits pre-approved in a branch of its
own. `/clear`, `/compact` and the CLI's own slash commands are not reachable. And
the strip of files a turn had touched went with the transcript it was read from:
Explorer's own watchers are what notice a change now.

## The workspace's databases

The workspace can have any number of databases, each either Postgres or MySQL:
created here, in a Docker container of its own, or a connection to a server
that already exists elsewhere. They belong to the workspace rather than to any
one folder — a frontend and its API talk to the same database, and there is no
version of "whose is it" that helps. A Docker-managed database's data goes with
it, and deleting it removes its container and data too; a connection only ever
removes the record — the database itself is someone else's to manage.

Removing a folder from the workspace leaves every database exactly where it
is. That is the whole reason they are not filed under one.

The studio connects to a database from the main process, on the host, at
`127.0.0.1:<published port>`.

Such a connection can be edited — host, port, user, password, database — while
a Docker-managed one cannot: its address is Docker's to decide and its
credentials were written into the container when it was created, so there is
nothing there that could be edited into anything but a broken record. An empty
password field keeps the stored one, which the renderer is never told.

## Filtering the data browser

Filters run as a `where` clause against the database, not against the page in
front of you, so a condition finds rows on page 40 as readily as page 1 — and
the row count above the grid is counted through the same clause, or the pager
would offer pages that no longer exist.

A flat list joined by one `and`/`or` rather than nested groups: what this
builds still has to be a clause someone can read in the SQL tab. Column names
are matched against the introspected columns and quoted by the engine; values
always leave as bound parameters (`$1` for Postgres, `?` for MySQL). A
condition naming a column that has since been dropped is skipped rather than
quoted in, and an empty value box is a row still being typed rather than a
filter for the empty string.

A filter can also be described in words. That goes to `claude -p` — the CLI
already installed and signed in for the Terminal panel — rather than to an API
this app would need a key for. What comes back is a proposal and is treated as
untrusted: it lands in the panel for the user to read and Apply, and every
condition is checked against the columns that exist and the operators this app
can build, so a hallucinated column produces one fewer condition rather than a
clause nobody wrote.

## The query console

A query tab runs what is selected in its editor, or the whole tab when nothing
is — so one statement of a script can be tried without deleting the rest of it.
Editing a row in the result grid reruns exactly what produced that grid,
selection included, rather than whatever the editor holds by then.

Completion is the connected database's own schema, and is hand-written
(`lib/db/sql-completion.ts`) because Monaco ships a grammar for `sql`, `mysql`
and `pgsql` but no language service behind any of them. It offers the tables,
and after a `.` the columns of whichever table that alias resolves to; the
statement is delimited by `;` and read with a regex rather than parsed, since
the question is only which tables are named under which aliases, and being
wrong there costs one bad suggestion rather than a broken query. Providers in
Monaco are registered per language rather than per editor, so the live schema is
published under each console's model URI and looked up from there — otherwise
two open consoles would answer for each other.

A row-returning statement that doesn't limit itself gets `limit 500` appended
(`lib/db/row-limit.ts`), with "Run without limit" next to the results as the
escape hatch. Neither driver offers a server-side row cap — Postgres has no
such setting and `mysql2` has no equivalent of the CLI's `--select-limit` — so
the alternative to appending the clause is `select * from products` sending
every row across IPC into one grid, which is enough to hang the app. The cap is
a heuristic over the statement text, and every uncertain case (a script, its
own `limit`, `for update`, anything that writes) is left alone: a query that
runs uncapped is a much cheaper mistake than one rewritten into something the
user didn't ask for. The panel's own introspection queries never go through it
— capping those would silently shorten the table tree and the completion list.

Whatever does get through, the grid only mounts what is in view — both ways.
Rows and columns are each virtualized (`@tanstack/react-virtual`), because it
is the product that hurts: a 200-column table still leaves 30 rendered rows ×
200 cells, and 200 headers each carrying a whole `ColumnMenu`. What isn't
rendered stands in as a spacer — one row above and below, one cell either side
— so the table keeps its true size and the scrollbars stay honest. Every row is
exactly `ROW_HEIGHT` tall, so row size is a constant rather than something to
measure; column widths are already known, and `columnSlots`
(`lib/db/grid-columns.ts`) turns them into the cells a row renders. Header,
body and `colgroup` all come from one call, so they cannot disagree about where
a column sits. The first column is always rendered even when scrolled out of
view: it is the sticky one, and a sticky cell that isn't in the DOM stops
holding the left edge.

Indexes stay indexes into the result — a row's `rowIndex`, a column's place in
the visible list — never into whatever happens to be mounted.

The grid is memoized, and its `result`/`edit`/`control` props are built in a
`useMemo` by both panels that use it. That is not a micro-optimisation: those
panels re-render on every keystroke in the SQL editor and every move of its
cursor, and rebuilding those objects inline handed the grid new props each
time, which over a wide table meant laying the whole thing out again per
character typed.

## API requests

The API panel calls whatever endpoints the workspace's code exposes. Requests
are saved in `requests.json` under the studio's own directory rather than in
any of the folders, so trying an endpoint never writes a file into someone's
working tree. One collection for the workspace: an endpoint is called from the
frontend and served by the API, and which of the two folders it "belongs to" is
not a question worth making anyone answer.

An environment is a named set of variables, kept in `environments.json` beside
the requests and chosen one at a time. `{{name}}` is substituted anywhere in a
request — URL, headers, body — and a name nothing defines is left as written
rather than blanked, so a missing value is visible instead of silent. `baseUrl`
is not built in; an environment that defines one is what lets a bare path like
`/api/users` resolve to something, and is how the same collection is pointed
at a different host.

Requests are sent from the main process (`src/main/http.ts`), not the renderer.
From there is no page origin, so there is no CORS preflight and none of the
studio's own cookies, and headers a renderer is forbidden to set go out as
typed.

The jar in `cookies.json` is the panel's own, not Chromium's: responses' cookies
are kept for the workspace and sent back on requests they match by domain and path,
which is enough for a login route to be followed by a request that is logged in.
A request carrying its own `Cookie` header sends that instead — the more
specific instruction wins, and a header the user can read should say what is
sent.

## Mail, removed

**There was a Mail panel here**, and a Webhooks panel beside it before that.
Mail was an SMTP sink on 1025, bound to `127.0.0.1`, that accepted a message and
kept it rather than delivering it — a development mail server, written here
rather than pulled in, with `src/main/inbox.ts` for the server and
`src/main/mime.ts` for enough of MIME to read what a framework mailer sends.
Webhooks was a catch-all HTTP endpoint on 1026 with a replay button. Both are
gone the way the git, code search and specs panels went: deleted rather than
hidden behind a flag, so that what is here is what runs.

Nothing of either is left in the code. The rail is four sections, `Section` and
`Pane` no longer name `mail`, the `inbox:*` channels and the `Inbox*` types are
out of the contract, `@` in the composer offers three kinds rather than four, and
`--section-mail` went with them — the launch screen's row of dots took Explorer's
cyan in its place, since that row was never one dot per section.

What is left is on disk, deliberately: a workspace that ran the old build still
has `workspace/mail.json` and an `inbox.config` entry in its settings, and this
app no longer reads either. Removing a feature is not a reason to delete
somebody's captured mail out from under them — the file is theirs to keep or to
delete, and it costs a stopped app nothing. A build that brings mail back would
find it there.

## Notes

The panel for what the work needs written down and nothing else knows where to
put — the payload that took an hour to get right, the shape a response comes
back in, what the next step was. It is a rail section beside the other three,
not a corner of one of them, because that is what makes it reachable from
whichever panel raised the thing worth writing down.

Notes belong to the **workspace**, like the requests and the databases and for
the same reason: a note about how a frontend calls its API is about both
folders, and filing it under one would decide which one is allowed to see it.
They are filed into folders of their own — arbitrarily deep, dragged between,
right-clicked exactly the way the API panel's requests are.

Two panels wanting the same tree is what pulled that tree out into
`lib/tree.ts`: nesting by `parentId`, the cycle guard that stops a folder being
dropped into its own subtree, and the count behind "this deletes 4 notes and 2
subfolders". `lib/http/folders.ts` now delegates to it and keeps only what is
genuinely the API panel's — the headers and params that cascade down a request
folder, which a note folder has no equivalent of. `test/tree.ts` covers it: a
wrong answer there is a subtree detached from the root or a delete confirmed
against the wrong number.

**A note is a markdown file.** `notes.json` is the listing — name, folder,
timestamps — and the text lives beside it, one `notes/<id>.md` per note. Two
reasons, and the second is the better one: typing into a note rewrites that note
rather than every note at once, and what is left on disk is a directory of plain
markdown that grep, an editor, or git can read without this app's help. The id
comes from the renderer and is used as a filename, so `Store` checks it is a
UUID before it touches the path — an id is not a name the user typed, and it
should not be able to become one.

Writes are debounced 400ms, per note, so two notes open at once cannot cancel
each other's save; closing a tab flushes what is still waiting, and deleting a
note cancels it — a write landing after a delete would put the file back. The
`Store`'s own queue is what makes that ordering hold rather than a race.

The editor is a batteries-included one rather than a bare ProseMirror: it brings
the selection toolbar, the `/` block menu and the drag handles rather than having
them hand-built, and it reads as part of the studio because `note-editor.css`
points its own variables at the app's tokens — one palette, following the theme,
with nothing in the panel that has to know which theme is on. (It was Crepe,
sharing `milkdown-theme.css` with a chat composer that no longer exists; that
stylesheet went with the composer, and `@milkdown/kit` is still here for
`lib/markdown/renderer.ts`, which renders markdown to plain DOM for reading.)

Two of Crepe's features are off, each for a reason:

- **LaTeX**, which needs KaTeX's stylesheet, not a dependency this app declares.
- **AI** and the top bar, which are not what this panel is.

The image block used to be off with them — Crepe's uploader handed an inserted
file back as a `blob:` URL, bytes held in this window's memory and gone the next
time the app opened, and a dead image is worse than none. That was never a
decision about images; it was a decision about where the bytes go. **Images**
below is where they go now.

**A table's columns can be dragged.** Crepe's table block has no resizing, and
prosemirror-tables' `columnResizing` cannot be switched on to supply it: it
installs its own `TableView`, which Milkdown's node views beat because Milkdown
hands them to `EditorView` as direct props; every width it writes goes through
that view's `<colgroup>`, which Crepe's table does not have — pointed at the
`<tbody>` instead, `updateColumnsOnResize` would remove the table's own rows;
and its `mousedown` handler never runs anyway, because Crepe's `stopEvent`
claims a click on a cell for the node view. So `table-resize.ts` does the drag
itself, from a capture-phase listener that takes the event before Crepe can, and
keeps a `<colgroup>` in step with the document. Crepe's table block is otherwise
untouched — the grips, the `+` buttons and the alignment menu are still its own.

The two columns either side of the border keep their total, so the table never
changes width: it sits in a pane that is half a split workbench, with nowhere to
grow into, and a table wider than its column would need a scrollbar where the
row and column grips are. Widths reach the DOM as percentages for the same
reason, since the pane is resizable and a column pinned at 240px is only right
at one pane width. **They do not survive a reload**: the width lives in the
cells' `colwidth` attribute, and GFM has no syntax for one, so serialising the
note drops it. It holds for the session — the editors stay mounted, so tab and
panel switches keep it — and the alternative was a width written into the file
in a form no other markdown reader would understand, which is the one thing this
panel is careful not to do. `test/table-resize.ts` covers the two halves that
fail silently: the position arithmetic that finds every cell of a table, and the
clamp that stops a column being dragged shut.

The editor is keyed on the note id, and there is **one per open tab**, hidden
rather than unmounted the way the dock stacks its shells. The editor
takes its content once, at construction, and has no "load this instead", so a
pane that mounted a single editor and swapped the note under it rebuilt
ProseMirror on every tab click: back to a spinner, the caret at the top of the
document, the scroll position gone and nothing left to undo. The text was never
what that cost — `loadBody` has it cached — the editing state was. What a hidden
editor must not do is answer the drawing event: `openDrawing` is a broadcast to
every listener, so each mounted `DrawingHost` would open a dialog of its own for
one drawing clicked in the note on screen, which is what the `visible` prop is
for.

The pane waits for the file rather than mounting empty and filling in, which
would put a document nobody typed through ProseMirror's history and make one
undo empty the note. Both of those live in the editor rather than in the note
pane, because the Explorer's `.note` tabs are the same editor over a different
file.

**A table's columns can be dragged, and `table-resize.ts` is all of it.** Crepe
ships no resizing, and prosemirror-tables' `columnResizing` cannot supply it
here: it installs its `TableView` through `plugin.spec.props.nodeViews` while
Milkdown hands its own views to `EditorView` as direct props, which ProseMirror
consults first — so Crepe's table view wins and the `<colgroup>` every width is
written through is never built. Turned on anyway, its `updateColumnsOnResize`
would take the `<tbody>` for that colgroup, style the first rows as if they were
`<col>`s and remove the rest: the table's own rows, out of the content DOM. And
its handlers are `handleDOMEvents`, which never see the `mousedown` regardless,
because Crepe's `stopEvent` claims one on a cell as a click into that cell.

So the drag is its own: a capture-phase listener that takes the press before
Crepe's view can claim it, widths painted into a colgroup the plugin keeps in
step with the document, and one transaction at the end so one undo takes the
whole drag. Crepe's table block is untouched — the row and column grips, the `+`
buttons and the alignment menu are still its own. Widths are spent as
percentages rather than the pixels the attribute holds: this pane is one half of
a split workbench, and a column pinned to 240px in a pane later dragged narrower
is a table wider than the note it is in. The pair either side of a border keeps
its total, so the table itself never changes width.

**A width does not survive a reload**, and that is the honest limit rather than
an omission. It lives in the cells' `colwidth` attribute, and GFM has no syntax
for a column width, so it is dropped the moment the document is serialised. It
holds for the session — the editors stay mounted, so tab and panel switches keep
it — and it is gone the next time the note is read from disk. The alternative
was a width written into the file that no other markdown reader would
understand, which is the one thing this panel is careful not to do.

`test/table-resize.ts` covers the two halves that fail quietly: `commit`
addresses every cell by arithmetic on the table's own position, where being one
out lands on a row or the next cell along and ProseMirror simply drops an
attribute that node has no place for, and `widthsFor` is what stops a drag from
closing a column past the width a caret fits in.

### Templates, removed

**There was a template feature here**: a second listing beside the notes, in
`note-templates.json` with a body per template under `note-templates/`, made
from a `LayoutTemplate` button in the panel header, offered as **New from
template** on a right-click, filled from **Save as template** on a note, and
edited in a manage dialog that mounted the note editor over a template's file.
Four presets — meeting notes, a bug repro, an API endpoint, a decision record —
were seeded once, behind a `note.templatesSeeded` flag.

It is gone the way Mail went: deleted rather than hidden. The `note-templates:*`
channels and the `NoteTemplate` type are out of the contract, the store's own
template calls and its two paths with them, and the sidebar is a note button, a
folder button and a right-click menu with no submenu in it.

What is left is on disk, deliberately: a workspace that ran the old build still
has `workspace/note-templates.json`, the bodies under `workspace/note-templates/`
and the seeded flag in its settings, and this app no longer reads any of them.
Removing a feature is not a reason to delete somebody's writing out from under
them. A template worth keeping is a note now — the text is markdown either way.

### Images

A picture goes into a note the three ways one goes into any editor: dropped on
it, pasted into it, or picked through the image block's **Upload** tab. That tab
is the whole of the wiring — BlockNote builds the panel out of what the editor
can do, so an editor with no `uploadFile` offers only "Embed" a URL, and a
dropped file is ignored. `lib/note/uploads.ts` is that function.

**The panel is the studio's own**, replaced rather than restyled the way the `/`
menu is (`note/file-panel.tsx`, mounted through `FilePanelController` with
`filePanel={false}` on the view). BlockNote's shadcn build renders that tab as a
bare `<input type="file">` — the platform's own grey "Choose File / No file
chosen", which follows the OS rather than the theme, cannot be dropped onto, and
has nowhere to put a reason. Restyling it was not the cheaper half: that build
ships a vendored copy of the shadcn components with tokens of its own, so the
input to correct was someone else's. What is there instead is a drop zone and a
URL field built from `components/ui/`, which is what makes the panel follow the
theme like everything else — and what lets a refused upload say why, since
`uploadNoteFile` throws a sentence written to be read rather than a flag. The tab
names and the button still come from BlockNote's dictionary, and the file
dialog's filter from the block's own `fileBlockAccept`, so a video block's panel
is right without this file knowing what a video is. A drop on the zone stops
there: let through, it reaches ProseMirror's own handler as well and lands a
second block under the one being filled.

**The bytes become a file of the workspace's own**, one per upload under
`workspace/note-files/`, and the document holds a URL naming it. Neither
alternative survives contact with the panel:

- **Not a data URL in the block.** A note's body is rewritten on every pause in
  the typing and crosses the bridge each time, so a photograph pasted into one
  would be re-encoded, re-sent and re-written for the rest of that note's life.
- **Not a path into the user's own folders.** The file the picture came from is
  theirs to move, rename or delete, and a note is expected to still have its
  picture afterwards.

Which is the trade the drawings already make, and the rest follows the drawings
too: the name is a fresh UUID plus an extension taken from the browser's idea of
the file's type — so nothing the user's filesystem named reaches a path of ours,
and two pictures dropped from two folders cannot be the same file — and `Store`
checks the shape of that name before it becomes one, the way it checks a note id.
Duplicating a note **copies** the files and points the copy at the copies
(`cloneNoteFiles`, beside `cloneDrawings` in the same `copyOf`), because two
notes sharing one file means deleting either blanks the other. Deleting a note
takes its pictures with it, read out of the document while it is still there.

**The URL is `note-file://workspace/<name>`, a scheme this app serves**
(`shared/note-files.ts` is its shape, `main/protocol.ts` the handler). Both sides
have to be able to say what one means: the renderer puts it in an `img` and
Chromium fetches it through the handler, streamed off disk with the content type
its extension gives it, while the preview server renders the same document for a
browser that has never heard of the scheme and swaps it for the bytes. A privileged
scheme rather than `file://`, which Chromium will not load as a subresource of
another origin, and `secure` so it is not mixed content on a page served over
`app://`. The handler builds no path of its own: it hands the name to the store's
own `noteFilePath`, which is the same check every other note file goes through.

**A picture, a clip and a sound all work; an attachment is where it stops.** A
video or an audio file dropped in plays where it sits, in the editor and on the
preview page both — the Preview section below is how, since a player needs a URL
it can seek within rather than the inlined bytes an image gets. Anything with no
player, a PDF or an archive, is still stored and still named in the note, and in
the preview it is a link the browser opens if it can show the type and downloads
if it cannot. What it is _not_ is openable from the
editor: BlockNote's Download button hands the URL to `window.open`, and the
studio denies a `window.open` in any scheme but `http`, `https` and `mailto`
(`openExternal` in `main.ts`), which is a rule worth more than that button.
Opening one from the studio is a save dialog in the main process, not a URL — so
it is left undone rather than half-done.

What every one of them shares is one table of types, in `shared/note-files.ts`,
read in both directions: the renderer turns the browser's `file.type` into the
extension it stores under, and the main process turns that extension back into
what it serves. Two tables would eventually disagree, and a file stored as `.mp4`
and served as `video/quicktime` is a player that shows nothing.

An `![alt](https://…)` or an image copied out of a browser — which arrives as a
`data:` URL on the clipboard's HTML — is left exactly as it is. Those are not the
workspace's files, and the walks that copy and delete know the difference by
asking `noteFileNameOf`. `test/note-files.ts` is that seam: the URL both sides
agree on, and the two walks over it, one per process because neither may import
the other's.

### Drawings

`/drawing` in a note puts a canvas in it: freehand, shapes, arrows, text and
images, on **Excalidraw** rather than anything hand-built. It is MIT, it is the
tool people already reach for, and a drawing editor is not something to write in
an afternoon — tldraw would have been the other candidate and its licence does
not suit an MIT app.

A drawing is edited in a **dialog**, not in the note. Excalidraw claims the wheel
for zoom, so a live canvas in the middle of a scrolling document is something
the page cannot be scrolled past; and a diagram wants more room than a column of
prose has. What sits in the note is the finished drawing, exported to SVG —
click it, or Edit, and the canvas opens over the note.

**Shapes come out straight, not sketched.** Excalidraw is a whiteboard and its
defaults say so: an outline that wobbles off true and a hand-drawn font, which
reads as charm on a whiteboard and as a badly drawn rectangle on a diagram of an
API — which is what a drawing in an engineering note mostly is. So the canvas
opens on roughness 0 and Nunito (`PLAIN_DEFAULTS`), forced over whatever the
scene was saved with in the same way `theme` is. The cost is that changing the
sloppiness or the font lasts as long as that drawing is open and no longer; a
default that applied only to a canvas nobody had saved yet would leave every
drawing made before the change sketched, which is the thing being fixed.
Elements already on a canvas keep the look they were drawn with — select all and
change it in Excalidraw's own panel.

**The font has to be one Excalidraw's own picker offers**, and that is not a
matter of taste. Liberation Sans was the first choice here, being the plainest
thing in the package, and it is the one font in it that is not meant for a
browser: `serverSide: true`, filtered out of the picker, shipped to render an
export on a server. Nothing preloads it — `loadSceneFonts` loads only the
families a scene already contains — so text typed in it was measured against
whatever the browser substituted, and when the real file arrived `Fonts.onLoaded`
dropped the caches and re-fitted every bound label, moving boxes that had already
been put down. The canvas felt unlike excalidraw.com because it was doing
something excalidraw.com never does.

**A drawing is a file, and the note keeps only its id**, in a fenced block:

````markdown
```drawing
7c3f1a2e-5b6d-4a8f-9e21-1f0b3c4d5e6f
```
````

The scene itself is `workspace/drawings/<id>.excalidraw`, Excalidraw's own
format, openable at excalidraw.com or in its desktop app. Inline was the
alternative and it loses on the thing this panel is built around: an uploaded
image is base64, and a megabyte of it in the middle of a note ends the claim
that what is on disk is markdown anybody can read. A fence, meanwhile,
round-trips through any markdown parser untouched.

Getting that fence to _stay_ a drawing took one narrowing. Milkdown's parser
asks every node in the schema which mdast node it matches and takes the first
that says yes, in schema order — and the commonmark code block says yes to every
fence, this one included, whichever order the two are registered in. So
`keepDrawingFencesOutOfCodeBlocks` narrows the general one rather than racing the
specific one, as a config on `codeBlockSchema`'s ctx: Crepe registers the
commonmark preset itself and there is no swapping its copy out from outside.

The block is a ProseMirror node view, which is a plain DOM object rather than a
React component — so it reaches the editor dialog through an event
(`onDrawingOpened`) rather than a callback nobody was in a position to hand it,
and it redraws on a theme change through one `MutationObserver` on `<html>`
shared by every block in the document. A drawing is exported light or dark
rather than tinted; Excalidraw inverts the strokes, and a preview that stayed
dark on a white page would be the only thing in the studio that did.

Excalidraw is around a megabyte and most sessions never open a drawing, so it is
loaded on demand: `React.lazy` for the editor, a dynamic `import()` in the node
view for the SVG export, and neither runs for a note with no drawing in it. Its
**fonts are served by this app**, not from esm.sh where it looks by default — a
desktop app should not go to the network for a file it can ship, and the glyph
widths should not depend on whether it got there. The `excalidraw-fonts` plugin
in `vite.config.ts` reads them out of `node_modules` in dev and emits them into
the bundle for a build; `public/` was the other option and 13MB of vendored
woff2 does not belong in git.

Deleting a note deletes the drawings its markdown refers to, read out of the
text while it is still there. Duplicating a note copies them and re-points the
copy, so editing the duplicate cannot change the original. Deleting just the
block leaves its scene behind on purpose: that has to be undoable, and a delete
that had already removed the file would come back as an empty drawing.
`test/drawings.ts` covers the reading, since both directions are destructive
when it is wrong.

**Numbered badges** — the ①②③ of an annotated screenshot — are the one thing
added to Excalidraw's own set of tools, and the button for them is **in its
toolbar**, after a divider, where a tool belongs. Excalidraw has no slot there:
`renderTopRightUI` is beside the island and `Footer` is under the canvas, so the
button is a **portal into Excalidraw's own DOM**, a `MutationObserver` waiting
for `.App-toolbar > .Stack_horizontal` to appear and React rendering into it.
That is a query against class names that are Excalidraw's rather than this
app's, and the first thing to look at if the button goes missing after an
upgrade; it is safe in the other direction, since the portal appends after
everything Excalidraw's React put there and React removes only its own children.
The observer keeps watching rather than stopping at the first hit, because view
mode unmounts that toolbar and brings it back. The button wears Excalidraw's
`ToolIcon` classes and a 20-box icon stroked at 1.25 like the shapes beside it —
anything else would read as another application's button dropped into the row.

A badge is stamped rather than drawn: the click drops the next number into the
middle of the view, already selected and with the pointer back on the selection
tool, so the gesture is stamp-and-drag rather than stamp, then go and find it. It
takes the background colour chosen in Excalidraw's own panel with the digit inked
black or white by the luma of that colour — white on pale yellow is a badge with
nothing legible in it — and its roughness is 0 rather than Excalidraw's sketchy
default, which on a circle that small reads as a badly drawn one.

**A circle and a digit in a group, not an ellipse with a bound label**, and that
one decision is most of how a badge behaves. A bound label does not scale with
what holds it: Excalidraw resizes the container and then re-fits the label to it,
growing the container's height and its width in two separate branches when the
text no longer fits — one axis at a time, which on a circle means an oval, and a
digit that stays its original size however small the circle gets. A group goes
through `resizeMultipleElements` instead, where `keepAspectRatio` is forced the
moment a selection holds a text element or anything grouped, and `fontSize` is
scaled along with the geometry. So a badge resizes as one object, round, without
holding Shift. It gives up nothing for it: a standalone text that is centred and
middle-aligned re-centres itself on edit — `getAdjustedDimensions` offsets it by
half of what it grew — so 9 becoming 10 stays over the circle.

The stamp still positions the digit by hand rather than trusting where a fresh
text element lands, and the button selects the **group** as well as its two
halves: selecting only the elements leaves the badge without the group's handles,
which are the ones that resize it as a unit rather than sliding the circle out
from under its number.

The number itself lives in the element's `customData`, Excalidraw's own field
for a third party's data, and the next one is read back out of the scene rather
than counted in React: that is what lets a drawing reopened tomorrow carry on at
4, and deleting the last badge hand its number back. `lib/note/badges.ts` holds
all of it, and takes `convertToExcalidrawElements` as an argument rather than
importing it — an import at the top of that file would pull the megabyte back
out of its lazy chunk and into the studio's own bundle.

### Preview

**Copy preview link** on a note's right-click menu puts a loopback URL on the
clipboard; **Open preview** hands the same URL to the browser. What is on the
other end is the note as a finished page — the thing to paste into a browser
beside whatever the note documents, to send to someone on the same machine, or
to hand to something that reads pages rather than looks at them.

**It is server-rendered, and that is the decision the rest follows from.** The
page arrives complete: no script runs before the words are there, so anything
that fetches it — `curl`, a model reading a URL — gets the whole note. The
obvious way to build it was BlockNote's own `blocksToHTMLLossy`, and it is not
available here: that is a method on an editor, an editor is ProseMirror, and
ProseMirror is a DOM. Taking it would have meant the renderer rendering every
preview and pushing it to the main process, so a note could only be previewed
while the studio was open on that note. `main/note-html.ts` is the walk written
instead — the same block model, emitting plain semantic HTML rather than
BlockNote's own class-laden markup, which is the better output for a page that
is read rather than edited.

Everything it renders came off disk, so nothing is trusted: text is escaped, a
URL is parsed and checked against a scheme list before it becomes an `href` —
`javascript:` keeps its words and loses its link — and a colspan is an integer
or it is not there. A note is the user's own writing, but this is a page served
over a socket, and the document does not get to write the markup.

`main/preview.ts` is the server: loopback, a port the OS picks, and a secret
generated per run as the first path segment. A wrong secret and an id that is
not a note in this workspace answer with the same 404, so neither can be found
by trying. That secret is also what looks the id up — the note's own listing is
consulted rather than the path being turned into a filename, which is what
keeps `../` from ever reaching one. One segment shorter is the index: every
note in the workspace with the folder it is filed under, which is what a reader
after the notebook rather than the note wants.

**A link lives as long as the app run.** Both the port and the secret change on
the next launch and nothing is written to disk to outlive them, so a preview
left open overnight is a dead tab rather than a page still serving a note to
whoever kept the URL. The server binds on the first link asked for, so a
workspace whose notes are never read outside the studio never opens a port, and
it is closed on quit along with the shells and the databases.

The page carries the version it was rendered at and answers `HEAD` with it as an
ETag; the one script on it polls that and reloads when it changes. This is the
only thing on the page that needs JavaScript, and it is the only thing lost
without it — which is what makes a preview open beside the editor keep up with
the typing while still being a document rather than an app.

**A colour reaches the page as a name, never as the value behind it.** The
stylesheet declares both renderings of each of BlockNote's nine highlights and a
coloured run gets `var(--hl-yellow-text)`, so a yellow heading is the studio's
yellow in a light browser and the studio's other yellow in a dark one — kept in
step by the browser rather than by the walk. It is also the whole of the
validation: nothing out of the file is ever spent as a CSS value, and a name
that is not one of the nine is dropped. What that costs is a colour picked
outside the menu — the studio writes its own `oklch(…)` onto table cells this
way — which is bound to the theme it was picked in and has no honest rendering
on a page that follows the reader's. The one value that is not BlockNote's own
is the light-mode yellow, darkened because a yellow chosen for the editor's dark
surface all but disappears on white.

**A table keeps the column widths it was built with.** They ride along as the
`<colgroup>` the editor holds them in, and with `table-layout: fixed`, which is
what makes a width a width — under the automatic layout a browser treats one as
a suggestion and stretches it to the content, which is the table the widths were
set to prevent. A table with every column sized is exactly as wide as they add
up to and sits at the left, the way the editor lays it out; one with any column
unsized fills the measure, the sized columns keeping their pixels while the rest
share what is left. A table the note gave no widths at all is left to its
content, because fixed layout there would divide it into equal columns and call
that a decision.

Long words are broken with `overflow-wrap: anywhere`, and that is not
cosmetic: a note holds URLs, ids and paths longer than the measure, and
`anywhere` counts towards a table cell's min-content width — which is what stops
one long link inside a table from making the page scroll sideways. `pre` is left
out, because a line break invented inside code is a lie about the code.

A **drawing** is the one thing the main process cannot render: it has no
Excalidraw, and a scene needs a canvas and a font stack. What it inlines is an
SVG the renderer exported beside the scene, always in light mode, written
whenever a drawing is saved and backfilled the first time a scene is read in a
session — so opening the note once is what gives its diagrams to the preview. A
drawing that has not been through that says so rather than leaving a gap.

**The note's own files are resolved before the walk runs, not inside it.** They
arrive under `note-file://`, a scheme of this app's that the browser reading this
page has never heard of, and `withNoteFileUrls` in `main/note-blocks.ts` swaps
every one of them in the document — so `note-html.ts` keeps a single scheme list
and sees a URL a browser can follow like any other. `filesIn` in `preview.ts` is
what each becomes, and the split is the one interesting decision on this page:

- **A picture is inlined**, as a `data:` URL. It is small, and it is what keeps a
  note of writing and screenshots a single file — saveable out of the browser,
  readable by something that follows no links.
- **Everything else is a link back to this server**, on a route of its own:
  `/{token}/file/{name}`. A `data:` URL is the wrong shape for it — a video would
  put tens of megabytes of base64 in the markup, `<video>` cannot seek inside
  one, and a browser refuses to navigate to a `data:` document at all, which is
  what once left a PDF in a note unopenable.

`file` is safe as a reserved first segment because the branch it shadows is a
note id, and a note id is a UUID. The token is checked before either branch, so a
file is exactly as reachable as the note holding it and no more.

**That route answers ranges**, and that is what makes a player a player rather
than a play button: a `<video>` asks for the head of the file to find its
duration and then for the bytes around wherever the reader drags to, and a server
answering each of those with the whole file gives a clip that cannot be seeked.
Single ranges only — `bytes=a-b` and the `bytes=-n` suffix form — because no media
element sends a multipart range, and the whole file is a truthful answer to a
header this does not parse. The bytes are sliced out of a buffer rather than
streamed off disk, which is honest only because an upload is capped at 64 MB; a
note that could hold an hour of video would want a read stream there.

A video or audio block gets `controls preload="metadata"` and never `autoplay`:
three clips in a note should cost three headers rather than three downloads, and
nothing on a page someone opened to read should start making noise. A block the
editor was told not to preview, and one whose file has gone, both fall back to
the link — or, with nothing to link to, to the "missing" line.

What is deliberately not in the ETag is the files: a note file is written once,
under a name nothing else uses, so a picture that changed is a document that
changed.

## The system bar

A row along the bottom of the workbench: how busy the machine's cores are, how
much memory it has left, and — at the right-hand end — what this app is taking
of both. `src/main/system-usage.ts` measures it, one poll every two seconds.

Everything there is a delta since the previous poll, which is why there is one
poller for the whole window (`src/renderer/lib/system/usage.ts`) rather than one per
component: the interval between two calls _is_ the window each percentage is
averaged over, so a second timer would shorten both and both would report a
fraction of the truth.

Two figures are easy to get wrong and are worth stating:

- **Available memory** is free pages _plus_ the cache the kernel would reclaim
  on demand. `os.freemem()` counts only the former, and on macOS that is tens
  of megabytes on a perfectly healthy machine — a bar pinned at 100% for the
  life of the app. Chromium already computes the honest figure, and
  `process.getSystemMemoryInfo()` exposes the pieces.
- **CPU** is a share of the whole machine, all cores counted, so one pinned
  core on a ten-core machine reads 10%. Electron's `percentCPUUsage` is on
  that same scale already — measured, not assumed — so the tooltip derives the
  per-core figure that Activity Monitor shows instead, because a bar
  disagreeing with Activity Monitor by a factor of ten with no way to see why
  would just look broken.

The app's share is every process Electron runs, added up. The dock's shells are
not in it: a pty is a child of the daemon, and counting it would make the studio
look responsible for work the user started deliberately.

## The launch screen

`src/renderer/components/studio/splash.tsx` is what the app opens on, and the
only screen before the workbench. There used to be two — the suspense fallback
while the studio's chunk loaded and a second one while `manifest.json` was read,
each a line of grey text — and the handover between them was a flicker. It is
one component now, timed from one module-level timestamp, so crossing from the
first mount to the second continues the animation instead of restarting it.

It draws the studio in miniature — the left column, a strip of tabs, the pane,
and the sections as dots in the studio's own hues across the panel on the right,
a strip of tabs, a sidebar, a panel — assembling in the order the eye
reads them, then sweeping for as long as the app is still opening. The workbench
is held back until the sequence has run (`SPLASH_ASSEMBLE_MS`), which is usually
longer than opening the manifest takes: a splash cut off a third of the way
through does not read as a fast app, it reads as a glitch. It then crossfades
rather than cuts — the workbench mounts when the fade starts and is on screen
behind the last of it.

The easings and keyframes are in `src/renderer/styles/motion.css` and used
through Tailwind's `animate-*` utilities. No animation library: what is wanted
is a few hundred milliseconds of easing, and a runtime re-rendering every frame
to produce it would be competing with a pty and a data grid for the same main
thread. The file is written to three rules, and is the place for an animation
added anywhere else:

- **A movement says where the thing came from**, so nothing travels in a
  direction the layout does not already imply.
- **Anything a click waits on is over in 250ms.** The launch screen is the one
  exception, because nothing else is waiting on it.
- **Opacity and transform only** — the two the compositor animates without
  laying the page out again.

Under `prefers-reduced-motion` the entrances become `none` and the screen
assembles in one frame. The two loops are left running deliberately: they are
the only thing saying the launch has not stalled, and a spinner that does not
spin is not a calmer app, it is one that looks hung.

## Development

```sh
bun run dev
```

Starts Vite, waits for it, then launches Electron against it. The renderer hot
reloads; changes under `electron/` or `shared/` need the command restarted.

```sh
bun run test
```

Plain `bun` scripts under `test/`, with no test framework behind them — see
`test/harness.ts`. `bun run test` discovers every file in the directory, so
adding one is dropping a file in.

They cover the places where being wrong is expensive and noticing would
otherwise be slow: the chat view's tail, the Explorer's own file handling, the
tab strip's ordering. Those run against the real thing rather than a fixture —
`test/transcript.ts` appends to a file while the mirror watches it, and
`test/files.ts` creates and renames real ones — because a hand-written sample
would only check the parser against my memory of the format.

## Building

```sh
bun run build     # bundle the main process and the renderer
bun run package   # ...then produce an installer with electron-builder
```
