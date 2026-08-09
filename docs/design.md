# desktop

The studio as an Electron app: projects are real directories on disk rather
than rows in a browser database, and every tool over them — database, API,
specs, terminal, agent — is a tab in one window rather than an application of
its own.

## Layout

| Path            | What it is                                                    |
| --------------- | ------------------------------------------------------------- |
| `src/main/`     | Main process: storage, databases, terminals, IPC.             |
| `src/preload/`  | The one bridge script, sandboxed.                             |
| `src/shared/`   | The typed IPC contract, imported by both sides (`@shared/*`). |
| `src/renderer/` | Renderer: the Vite + React studio.                            |
| `test/`         | Plain `bun` scripts, no test framework.                       |

## Projects

Project data lives in `~/.tabula`: `manifest.json` for the project list,
its databases, and settings, and one directory per project under `projects/`.

```
~/.tabula/
  manifest.json
  projects/<id>/
    source/       the project's own files, for a project scaffolded here
    db/<db-id>/   one Docker-managed database's own data, if it has any
```

A project is either imported — an existing folder on disk, edited where it
is — or scaffolded into `source/` here. Either way, opening a project only
reads its file tree; there is no install step and nothing else is spawned.

## Terminal sessions

The Terminal panel holds as many sessions as you open, each in the project's
real directory: a plain shell, or `claude`. `+` asks which — and for a CLI that
is not on this machine it offers to install it instead of to start it,
running the install in a session of its own so the output and any password
prompt are yours to read. What each kind runs, how it installs, and whether it
is there is decided in `src/main/agent-tools.ts`, so the picker cannot offer
something that would not start.

Sessions run on the host, outside any container, and belong to the project they
were opened in — a pty's directory is fixed when it starts, so switching
projects hides them rather than moving them.

### The chat view

A `claude` session is one process — the interactive CLI in a pty, like any
other session — and **Terminal** and **Chat** are two ways of drawing it.
Switching between them starts and stops nothing, so it is safe mid-turn.

A session opens on the terminal. That is the view a session can be _worked_
in — it carries the composer, and it is where a permission prompt or an
`AskUserQuestion` is answered — so the chat is the one you switch to, to read
what happened, rather than the one you have to switch away from to reply.

The chat reads the transcript the CLI writes for itself, at
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, and tails it as it
grows (`src/main/transcript.ts`). Every session is started with
`--session-id`, so the file belonging to a tab is known rather than guessed
at — two tabs open on one project follow their own conversations.

Reading a file rather than driving the CLI is what makes the chat a view of
the running session instead of a second one, and it is also the whole of what
the chat cannot do:

- **Replies arrive a message at a time**, not a token at a time. The CLI
  appends a line once a message is complete.

Whether a turn is running is not inferred from any of that: the CLI records a
`stop_reason` on every assistant message, and only `tool_use` means another is
coming. That is what the composer's busy state follows, and the word
"working" in the chat's header — a finished tool call says nothing about
whether the agent is done, since it still owes a reply to the result.

The chat says it in words and never spins. A turn can run for minutes, and
this is the view you switch to in order to _read_: an indicator turning at
the edge of the eye for all of it adds motion, not information. The two
spinners left in the chat are the ones that resolve — a tool call's status
icon, which becomes a tick or a cross, and the sessions drawer's list while
it loads.

- **Permission prompts are answered in the terminal view**, at the CLI's own
  prompt, and so is **`AskUserQuestion`** — the agent asking you to choose
  between options. The chat draws the question, its options and their
  descriptions in full, and marks which one was picked. It is shown whatever
  "Show tool calls" says: a collapsed row labelled `AskUserQuestion` is exactly
  the point in a transcript where what was asked is worth reading.
- **`/clear` at the prompt** starts a conversation under a new id, which the
  pinned file cannot follow. The sessions drawer is the way back: it lists
  every conversation on disk for the project, and the new one is the top of
  that list.

The drawer switches which conversation the tab is _having_, not just which one
it is showing. Picking one replaces the tab's session id and starts its pty
again, resuming it — so what you are reading is what the composer talks to.
An earlier version pointed the pane at the transcript and left the pty on its
own conversation, which meant the only way to reply to what was on screen was
"Back to live", and the only way to know that was to try. A pty runs exactly
one conversation; a chat that reads one and writes to another has no honest
way to say so.

What it costs is the process: a turn in flight ends, the same as any other
restart. The conversation does not — it is on disk, and the drawer is the way
back to it. A conversation another tab of the project already has open is
listed but not offered, since two `claude` processes resumed onto one
transcript would both be appending to it.

The composer sits under the terminal, and only there: it writes into the CLI's
own prompt, which is the terminal's, and the chat is the view for reading the
conversation rather than adding to it. The mode is the one setting
that still waits for a restart, and deliberately: the CLI would take
`/config permissionMode=…` live, but that writes `permissions.defaultMode` into
your own `~/.claude/settings.json`, where a per-project choice would become the
default for every other project and every `claude` you run yourself. Restarting
resumes the same conversation — `--resume` writes on into the same transcript —
so it costs the process and nothing else. A mode cycled with Shift+Tab at the
CLI's own prompt moves the control too, from two sources with different
weaknesses: the transcript records the mode as each prompt is _submitted_, so
it is authoritative but a turn behind, while the terminal's own status line
(`⏵⏵ accept edits on`) changes immediately and is read straight out of the pty.
The status line wins when it has spoken. Reading a TUI's chrome is brittle by
nature — a reworded indicator simply stops moving the control, leaving the
transcript's slower answer, which is what it did before.

A question does not reach the chat until it has been answered, and that is a
consequence of reading a file rather than a gap worth closing. Measured, not
assumed: an ordinary tool's call is written to the transcript the moment it
starts — a 25-second command left a 22-second gap before its result — while a
question the user took 21 seconds to answer put the call and the answer on
disk in the same read. So for the whole time the terminal is showing one, the
file says nothing at all, and the chat says only "working". The terminal view
is where it is answered, and where it is visible meanwhile.

Closing that window would mean a `PreToolUse` hook reporting the question to
the app out of band — which was tried and taken back out. It is the one thing
that would make this app a writer of `claude`'s configuration rather than a
reader of what it already writes, and it buys a card a few seconds earlier in
the view that is not the one you answer in.

What the composer sends goes into the pty as bracketed paste — so a `/…` line
is run as a command, and Stop sends the Escape the CLI reads as "end this
turn".

A bar along the bottom of both views shows what the conversation has spent,
read off the `usage` the CLI copies onto every assistant line. The figure that
matters is the context the last request carried: it says whether the next
message will fit, and it drops when the CLI compacts. Beside it are the
conversation's totals, which only climb.

The bar is under the terminal only. That is the view a message is written in,
so it is the only one where any of this is a question about to be answered;
the chat, which you switch to in order to read back through what happened,
carries no bar and no composer, and gives its whole height to the
conversation.

Beside the conversation's own figures it shows the account's allowance as
`5h ▁▃ 55%   7d ▁▁ 37%` — the rolling five-hour window and the weekly one,
the two bars `/usage` draws in the TUI, each with a meter of the same
make as the context one beside it. Three meters read as one control only if
they are the same drawing, so there is a single `Meter` and a single set of
thresholds: amber at 70%, red at 90%, whichever ceiling is being measured.
The number sits next to its meter and stays the row's ordinary colour —
the meter already carries the warning, and shouting it twice reads as two
things going wrong.

The windows are labelled `5h` and `7d` rather than abbreviated to the word
"session", because a percentage of an unnamed allowance says nothing. They
are **account-wide**, not this conversation's: spent by every `claude` the
user runs, which is the reason they are worth having in front of a session
that is only one of them. Percentages because that is all the usage endpoint
returns for a subscription.

This app never asks the API for them. `/usage` does, and caches what it got
in `cachedUsageUtilization` in `~/.claude.json`; `electron/claude-usage.ts`
reads that cache and nothing else, which is the transcript arrangement again
— a reader of what the CLI already writes rather than a second client of the
API, which would want the OAuth token the CLI holds. The consequence is that
the figures are as fresh as the CLI last made them and no fresher, so the
tooltip says how old they are rather than presenting an hour-old number as
current.

Two things it still deliberately does not show. **Cost**: the CLI writes
none, and a figure worked out here from a price list the app carried would be
wrong the day prices move and meaningless on a subscription. **A token count
against the allowance**, because the endpoint gives percentages and a count
reconstructed from them would be invented. The context window is a guess for
a related reason: the transcript records the tokens sent but never the
ceiling, and the 1M window is a beta header rather than a model of its own,
so 200k is assumed until a request is seen to exceed it.

## A project's own databases

A project can have any number of databases, each either Postgres or MySQL:
created here, in a Docker container of its own, or a connection to a server
that already exists elsewhere. A Docker-managed database's data goes with
it, and deleting it (or the project it belongs to) removes its container
and data too; a connection only ever removes the record — the database itself
is someone else's to manage.

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

The API panel calls whatever endpoints the project exposes. Requests are
saved per project in `requests.json`, beside its database rather than inside
its repository, so trying an endpoint never writes a file into someone's
working tree.

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
are kept per project and sent back on requests they match by domain and path,
which is enough for a login route to be followed by a request that is logged in.
A request carrying its own `Cookie` header sends that instead — the more
specific instruction wins, and a header the user can read should say what is
sent.

## Mail and Webhooks

The API panel sends requests out. These two panels catch what comes the other
way — the mail the project's own code sends, and the callbacks a provider fires
at it — with two servers bound to `127.0.0.1` and nothing else:

- an **SMTP sink** on 1025, which accepts a message and keeps it. Nothing is
  ever delivered. That is the point: an app configured against this cannot mail
  a customer by accident, which is the failure a development mail server exists
  to prevent. Any username and password are accepted, because a framework
  configured with credentials will not send without being asked for them, and
  there is nothing here for credentials to protect. TLS is not offered.
- a **catch-all HTTP endpoint** on 1026, which accepts every method on every
  path, answers `200` with a JSON body, and allows cross-origin requests so a
  callback fired from a browser is not refused by a preflight.

Both are written here rather than pulled in: a mail catcher that has to be
installed first is a panel that works on the machine it was written on. `src/main/inbox.ts` is the two servers,
`src/main/mime.ts` is the parsing that follows — enough of MIME to read what a
framework mailer sends (`multipart/alternative` inside `multipart/mixed`,
base64 and quoted-printable bodies, RFC 2047 subjects, RFC 2231 filenames) and
no more. A part it cannot make sense of is shown as an attachment rather than
dropped.

Everything structural in the parser runs on the message decoded as latin1, which
maps one byte to one character: that is what lets a boundary be found by string
index and the part behind it recovered as the exact bytes it arrived as. The
charset a part declares is applied to those bytes afterwards, per part — the
only order that works when one message carries a UTF-8 body and a Shift_JIS
attachment name.

Captures are kept in `inbox.json` beside the project, newest first and capped at
200, so an inbox survives a restart without becoming the slowest thing the panel
does. A mail's HTML is rendered in an iframe with `sandbox=""` and a CSP that
allows only `data:` URIs — a template with a script in it must not run inside
the studio, and a remote image must not load, because in a mail that image is a
tracking pixel and fetching it would tell a server the message was read.

A captured request can be **replayed** at any URL, verbatim: same method, same
body, same headers minus the hop-by-hop ones the new connection writes for
itself. That is the reason to catch one rather than log it — a provider fires an
event once, and the handler that mishandled it can be run against that exact
request, signature header included, as many times as it takes.

Two panels, not one. They started as a single "Inbox" with a filter across the
top, which saved a slot on the rail and cost more than it saved: the filter was
an admission that the two are read apart, and one Start button meant the webhook
catcher — worth leaving up all day — could not stay up while the SMTP sink was
stopped. So each has its own rail section, its own pane, its own settings tab
and its own switch.

What stayed shared is everything below the panels: one `InboxServers` managing
both, one capped list of captures, one file. `src/renderer/components/studio/inbox/` holds
`CaptureList` and `ServerSettings`, each taking a `server` prop — the two
sidebars are the same list of arrivals, and writing them twice is how two
sidebars drift a pixel apart. Each panel starts, stops and clears only its own
half; `inboxClear` takes a kind, because a Clear that deleted something the user
could not see would be a poor button.

The ports are per project, in `manifest.json` settings under
`inbox.config:<projectId>`, along with whether to bind each one when the project
is opened. Nothing sent while a server is down can be caught afterwards, which
is what that switch is for.

## Screen specs

The Spec panel writes screen specifications — the document that says what a
screen shows, what each control on it is, and what happens when it is used. A
spec is a `*.spec.json` file **in the project's own repository**, which is the
one decision the rest of the panel follows from: it is committed beside the code
it describes, and reviewed in the same pull request, like any other file. This is the opposite of where API requests live, and
deliberately so — trying an endpoint is a private experiment, agreeing on what a
screen does is not.

A spec **opens as a page, not a form**: it is read far more often than it is
changed — by whoever is building the screen, by whoever is testing it — and a
wall of input boxes is a worse thing to read than a document. `Edit` in the
toolbar swaps in the form, which edits the same page in place rather than
sitting beside a live preview, so the two views are recognisably one document
with the boxes turned on. The mode is per visit rather than remembered: leaving
a tab and coming back is a fresh look at the spec.

There is no JSON view in either. The file underneath stays JSON because it has
to diff in a pull request, but nobody has to look at it. Edits are written back
on a timer, and ⌘S skips the wait.

Status is a `Select` and the date is shadcn's date-picker — a `Popover` around a
`Calendar` — rather than free text and a native `<input type="date">`, so both
are drawn by the app rather than half of one by the OS. Neither closes its
field: `status` stays a string and a document that already says something
outside `SPEC_STATUSES` keeps its word, offered at the bottom of the menu; the
date stays a string in `yyyy-mm-dd`, and `asDateInput` is what lets a document
written as "07/08/2026" open in the picker without being silently rewritten.

The overview holds a **canvas** — one figure, however many pictures are on it.
Screenshots are dropped onto it and moved and resized freely; markers are
dragged in from a palette beside it. The numbers run 1, 2, 3 across the whole
canvas rather than per picture, because what a reader sees is one drawing and
what the item table joins to is one sequence. Four kinds of marker: a plain
numbered circle, a square that reads better over dense UI, an arrow for
something too small to sit a label on (drag its tip separately), and a box that
frames a region rather than a point.

Every measurement on the canvas — positions, sizes, and the canvas's own height
— is a percentage of the canvas _width_, the way a CSS percentage padding is.
That is what makes it behave as one picture: the panel can be any width and
everything scales together, and dragging the handle under the canvas to make it
taller adds room at the bottom without moving or stretching anything already on
it. A percentage of the height would do neither. An image stores only its
width; the height follows the picture's own proportions, because a squashed
screenshot is never what anyone meant.

Pictures are **copied into the repository**, into `<spec-name>.assets/` beside
the spec, and the canvas records the relative path. Not embedded as data URLs:
a 300 KB screenshot inlined into the JSON is a file no diff can show. The copy
never overwrites — a second `screen.png` becomes `screen-1.png` — so two specs
in one folder cannot quietly replace each other's illustrations. Displaying one
needs `readProjectImage`, because the renderer's origin is not `file://` and
Chromium will not load a `file://` subresource from any other origin.

`CanvasMarker` draws the markers for both the editor and the preview, so a spec
looks the same either side of the Edit button — the editor puts grips over what
it draws rather than drawing its own version.

The panel is the one place in this app that uses colour. Everything else is
monochrome on purpose — `--primary` is a neutral grey — but a spec is _scanned_
rather than operated, and three of its vocabularies answer a question before
their words are read: the status says whether the document is settled, the
control column says which rows the user types into, and a screen state says
which one is the failing case. `lib/spec/tones.ts` holds those three lookups and
nothing else is tinted; the numbered badges keep the red they share with the
markers on the canvas, which is what ties a row to the mark pointing at it. Each
vocabulary is open, so an unrecognised word falls back to neutral rather than to
a guess, the same as `METHOD_TONES` in the API panel.

The sidebar is a **folder tree**, and its folders are real directories rather
than records of their own. The API panel keeps its folders in `folders.json`
with a `parentId` on each; a spec cannot, because a spec is a file in the
repository — a second opinion about where one lives would be a second thing to
keep in step with `git mv`. So `lib/spec/tree.ts` _derives_ the tree from the
paths — one row per directory, nested, the same shape the API panel's folders
take.

An earlier version compacted a chain of folders holding nothing but one more
folder into a single row, so `docs` containing only `specs` read as
`docs/specs`. It saved a line and cost far more: the folder that was swallowed
had no row of its own, so it could not be renamed, deleted or dropped onto, and
the row that remained carried both names while acting on only the inner one —
which reads, correctly, as a delete that will take both. A row is a
directory.

The menu has three targets rather than two. A folder offers **New spec here**,
**New folder inside**, **Rename** and **Delete**; a spec offers **Rename or
move**, **Duplicate**, **Copy path** and **Delete**; and the empty part of the
list — which is the list itself, not nothing — offers **New spec** and **New
folder** at the top level, the same two the header's buttons do. Showing the
spec menu greyed out there said only that nothing could be done. Specs and folders both **drag between folders**, with a drop zone at
the bottom for moving something back to the top level. A folder cannot be
dropped into itself or into anything under it — on disk that is a rename of a
directory into its own child, a move whose destination travels with the source
— and `canMoveInto` in `lib/spec/tree.ts` is what refuses it. Renaming a folder
moves it on disk and carries what is under it — the open tabs, the selection and
the drafts all name paths that just changed, and a draft that kept the old one
would write itself back into a directory that no longer exists.

One thing to know: **git does not track an empty directory.** A folder made here
is real on this machine and invisible to everyone else until a spec is put in
it, which is why the panel remembers it in `emptyFolders` — deliberately in
memory only, so that on the next launch the truth is whatever is committed.

Right-clicking a spec offers **Rename or move**, **Duplicate**, **Copy path**
and **Delete**. The first two take a folder as well as a name, which is what
makes renaming a spec and moving it between folders one operation. Each of the first three has to move `<name>.assets/` as
well: a spec and its screenshots are one document to anyone reading the
repository, and every image `src` on the canvas is a path into that folder, so
`withAssetsAt` rewrites them to match. A path that was never in the old folder
is left alone, because it was pointing somewhere else on purpose. Rename moves
the pictures first, writes the rewritten document under the new name, and only
then removes the old file, so a failure part-way leaves a spec that still opens.
Delete takes the folder with it — the pictures are of no use to anything else,
and both are in the repository, so git is the way back.

The item table is six columns — No, Item name, Control, API, Constraints,
Description — and was eleven. The two that went are worth recording, because the
reasoning applies to anything else the table grows. `logicName` sat beside
`itemName` and held the same words in every document written so far; the
distinction it comes from, internal name versus displayed name, is real, but a
column filled by copying the one next to it is not recording it. `defaultValue`,
`length`, `required`, `attribute` and `inOutField` are all properties of an
_input_, and most of what a screen shows is not one — on a scanner with a camera
and a dialog, all five read "-". Five always-present columns for a minority of
rows is what makes a table nobody can read without scrolling, so they are now
one free-text `constraints` ("required, max 32"). That costs the ability to diff
"required" on its own and buys a table that fits.

Documents written against the old columns lose nothing: a filled-in property
becomes a labelled part of `constraints` (`required: ○, length: 1-128`), a
property holding "-" is dropped rather than carried across as noise, and a row
that named itself only in `logicName` keeps that as its item name.

Two things a screen spec is otherwise missing have sections of their own.
**Navigates to**, in the overview beside Pre-data condition, is the symmetric
half of it: that says how you arrive, this says where you leave for and on what
condition. It used to be reachable only by reading four levels into the event
prose — "then move to FR_002" — which meant nobody could draw the project's
screen map, or check that FR_002 exists, without reading every spec end to end.
**Screen states** (section 5) lists loading, empty, error and not-allowed. A
spec that omits these does not lack them; the screen still has them, they are
just decided later and separately by whoever builds it, which is how a project
ends up with a different empty state on every screen. The list starts empty
rather than pre-filled, because four named states with nothing written against
them would look answered while saying nothing — the buttons offer them instead.

Status and an item's Control are both `OpenSelect`: a suggested list, but the
value stays a string and a document already saying something else keeps its
word, offered at the bottom of the menu. Typed by hand these fields collect
"Approved"/"approved"/"APPROVED" and "Input"/"input"/"TextBox", which nothing
can group; a closed list would instead have this panel quietly correcting a
team's own vocabulary.

Detail processing is **two fixed sections** — 3.1 Check authority and 3.2 Event
behavior handling — rather than a list the author adds to. Every screen has both
answers, who is allowed in and what each thing on it does when used, and a spec
that simply omits one has not decided it, it has forgotten it. A free list lets
that happen quietly; two named fields show the gap as an empty section.

`parseSpec` is total by design: the panel writes the file back as you type, so a
file half-written by hand has to load as a document with gaps rather than take
the panel down. It also carries a one-way migration. This panel first shipped
with `processing` as nested `{no, title, type, content}` sections, `api` as
`{required, description}`, the mockup as a flat `hotspots` list, and then as a
list of screenshots each with pins positioned as a percentage of _itself_.
Documents in every one of those shapes still open. The old sections become
markdown (trees become nested lists, `<code>` becomes backticks) and are routed
into the two fixed ones by their own titles. Hotspots become markers down the
middle of an empty canvas, with each one's label becoming the item name of the
row its number points at, since a marker no longer carries text. Separate
screenshots are stacked down the canvas and their pins mapped into the slot each
picture now occupies — approximate in the vertical, unavoidably, because a
picture's height is not knowable without reading the file, which `parseSpec`
cannot do. Every number and kind survives exactly; what may need nudging is
where a mark sits.

A section whose title matches neither fixed one — the old "Screen
initialization" is the case — is kept, with its heading, under Check authority.
That placement is arbitrary and deliberately so: a paragraph in the wrong
section is one someone can see and move, while a dropped one is one nobody knows
to look for.

The file is written back in the new shape the first time it is saved, and
nothing converts back. No tag survives the trip either — what comes out goes
straight into a markdown editor, so the one thing that must not happen is a tag
becoming a tag again. `test/spec.ts` is mostly about that migration and about
files that are not specs at all.

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

The app's share is every process Electron runs, added up. Terminal panel sessions are not in it: a `claude` is a child of the pty daemon, and counting
it would make the studio look responsible for work the user started
deliberately.

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
otherwise be slow: the chat view's tail, the two capture servers, the spec
schema and its migration. Those run against the real thing rather than a
fixture — `test/transcript.ts` appends to a file while the mirror watches it,
`test/inbox.ts` holds an SMTP conversation over a socket — because a
hand-written sample would only check the parser against my memory of the
format.

## Building

```sh
bun run build     # bundle the main process and the renderer
bun run package   # ...then produce an installer with electron-builder
```
