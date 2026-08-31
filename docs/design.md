# desktop

The studio as an Electron app: a workspace points at real directories on disk
rather than rows in a browser database, and every tool over them — database,
API, terminal, agent — is a tab in one window rather than an
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
~/.yasuo/
  manifest.json     the workspace, its folders, its databases, settings
  workspace/
    requests.json   the API panel's collection
    environments.json
    folders.json    the groups those requests are filed under
    cookies.json
    note-files/     pictures dropped into a block document
    drawings/       one `<id>.excalidraw` per drawing
    db/<db-id>/     one Docker-managed database's own data
```

**There is no switching.** That is the point of the design rather than a
missing feature: someone working on a frontend and the API behind it has two
folders open, not two applications to alternate between, and a switch would
take one of them — along with every tab, shell and connection opened against
it — off the screen. Adding a folder brings its files into view; removing one
takes its shells and its chats with it and leaves the directory untouched.

Everything else belongs to the workspace rather than to a folder: the
databases, the saved requests, the cookie jar. A
project's database is generally the same database its frontend and its API both
talk to, and filing it under one of the two would only decide which panel is
allowed to see it. What _is_ per folder is what is genuinely per repository — a
shell's working directory, a run command and a branch name.

Sign-in is what will bring a second workspace. Until then the studio always
holds this one, which is why its id is a constant rather than something the
manifest has to be read to learn.

## The left column

What the workspace **holds**, stacked: `Search`, then `Projects`, `Database`
and `API` as folding sections, as many open at once as there is room for
(`workspace-sidebar.tsx`). It is the whole of the left edge and it does not go
away while you work, which is the point: reaching any of them is a click in a
list already on screen rather than a trip through one.

**Today it draws `Projects` and nothing else** — `SIDEBAR_SECTIONS` is that one
line — and the other two open in a window each from the footer; see Panel
windows below. There was a fourth, `Notes`, and it is gone rather than hidden:
see Notes, removed.

**It took two moves to arrive at this, and the first went too far.** The
activity rail went first — Conductor's left column is navigation and the
_contents_ of the thing being worked on are on the **right** — which put
Explorer, Database, API and Notes (then still a panel) behind a row of tabs on
the right-hand panel.
That fixed the real problem (the left of the window was three columns deep
before anything being worked on) and introduced a smaller one: a tab strip shows
exactly one list, and "what does this workspace hold" is a question about seeing
several at once. Four ways of filling one box is not four lists.

So the others came left as sections, and **the Explorer kept the right-hand
panel**, alone and without tabs — a strip of four tabs with one tab on it is a
row of chrome that answers nothing. The asymmetry is the point rather than an
oversight: a file tree is the contents of the thing being worked on rather than
a list of what the workspace holds, it is far the deepest of the four, and it
follows whichever project this column has clicked. The other three are lists of
records the workspace owns, and they are short.

A folded section is a bare `PanelHeader` this column draws; an open one is the
panel's own component, unchanged, with the fold handed to its own header
(`open`/`onToggle` on `PanelHeader`, so there is one header rather than a second
bar drawn above each panel's). The panel is unmounted while folded, which it can
afford to be: neither holds a pty, a turn in flight or an editor — what they
hold is a store each, which outlives the component. Open sections share what is
left of the column evenly and scroll inside themselves; sized to their contents
instead, a long list of requests would push the projects off the bottom.

`section-tabs.tsx` went with the tabs, and so did the rail's remembered order and
hidden set — folding is what hiding was for, and a handful of labelled sections
need no arranging. What survives both bars is the _kind_: `lib/sections.ts` holds the
ids and `section-marks.tsx` the label, icon and hue, because a hue that means
"table" has to mean it wherever a table is listed.

**The right column is the Explorer**, its whole height. `⌘B` closes it, and the
left column closes on its own button. Two keys for two columns, deliberately:
one that took both would leave the workbench with no edges at all.

**Both columns close to a 36px rail rather than to nothing** — the same
`RAIL_WIDTH`, each holding the button that brings its column back. Explorer's is
the one the argument is written out under (see Closing it leaves the rail); this
column's is the mirror of it, with one difference: it is on the column's **inner**
edge rather than the window's. Each rail sits at the end its column is
collapsible from, which for this one is the right, beside the handle that shut
it — and it leaves the window's left edge to the traffic lights alone.

That mirror cost the left column its top row. The toggle used to sit up there
beside the lights, and that row had to be **drawn twice** — once in the column,
once in the crumb bar — so the button could survive the column it collapsed.
With the button at the edge in both states, `WindowLeftEdge` is what it was
always for and nothing else: clearance for the lights. The column is 36px of the
84 they need, so the crumb bar's half of that clearance is `3rem` rather than
`5.25rem`.

The dock — `Run` and `Terminal` — is under the **pane**, spanning its width; it
used to be the lower half of this column, and see The dock for why it moved.

**A project's rows are its chats**, and clicking one opens it — see Chats
below. A project row carries a `+` that starts another, shown on hover, because
a column of projects each wearing a permanent one is a column of plus signs.
Projects fold, and which are shut is remembered (`lib/projects.ts`, under
`projects.column` with whether the column itself is showing).

The rows were a project's `git worktree` checkouts once, with the chats a level
below them — one row per branch, and no way to see from this column what
conversations a project actually held. That layer is gone (see Worktrees,
removed), and what a project opens onto is the thing the column was always
navigating to.

Clicking a project row or one of its chats also points the dock's `Terminal` tab
at that project, so a shell opened beside a chat is in the directory the chat is
editing.

Adding, renaming and removing a folder is **Explorer's**, not this column's: the
list that says what the workspace is pointed at is the one that changes it.
This column is a way to get somewhere, and with no folders it says so and points
at Explorer.

### Tasks, removed

There was a layer above the workbench here — a **task**: a name, a line about
what it was for, and members taken from any panel, so `debug orders` was the
`create-order` request, the `orders` table, a file in `api/` and a note. The
column listed them under the project each was filed in, `Home` opened a grid of
cards (`⌘E`, **View › All tasks**), `Home › debug orders` ran across the title
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

The **Board** below is not that layer coming back, and the difference is the
reason it was worth building where the other was worth deleting — see the
section for which of the two claims each makes.

## Panel windows

`Database` and `API` are not sections of the left column any more —
`SIDEBAR_SECTIONS` is `projects` and nothing else — so the two buttons at the
left end of that column's footer open each of them in a **window of its own**
(`openPanelWindow`, `main.ts`). One window per panel, focused rather than
duplicated if it is already open.

**They are the same renderer**, loaded with `?view=database` or `?view=api`,
which `App.tsx` reads before it decides what to draw (a query rather than a
route: there is no router here, and one flag is not a reason to add one). So the
tree, the request list, the tabs and the grid are the components the studio
draws, against the same stores — nothing in a panel window is a second
implementation of anything. What `PanelWindow` leaves out is the workbench: no
rail, no dock, no projects, and a strip holding one panel's tabs rather than
five panels' — `lib/tabs.ts` arranges a mixture, and a window with one panel in
it has nothing to interleave, which is also why its tab ids carry no `PREFIX`.

**The reason it can be a window at all is that neither panel is pushed
anything.** Every call they make — `databases:list`, `db:query`,
`docker:status`, `http:*` — is a call and an answer, and an answer goes back to
whoever asked. The push events (`processOutput`, `terminalData`,
`files:changed`, a chat's frames) still go to the studio window alone, which is
what `getWindow` in `ipc.ts` answers with; a panel that needed one of those
would need its own manager in main, and would not be worth a window on these
terms. The channel is checked rather than trusted (`isPanelWindowView`): a
string from the renderer names a window this process is about to open.

The two windows share what the stores **remember** — `db.tabs`, `db.selected`,
`http.tabs` are the workspace's settings, not a window's — and that used to
follow all the way through: open a table in the Database window, close it, quit,
and the table came back next launch in the **studio's** strip, beside the chats.
It was defended as "they are one workspace", and it was wrong. What a window
opens is what that window is for; a tab surfacing in a strip whose column has
not listed the panel since `SIDEBAR_SECTIONS` was cut to `Projects` reads as the
app having lost track of where things live, and there was no way to put it back
short of closing it.

So **the studio does not draw either pane at all**. `PANES` in `lib/store.ts` is
the list of panes the workbench walks, and `database` and `api` are out of it;
both stay in `Pane`, in `PANELS` and in their stores, so putting either back is
that one id — the same bargain `SIDEBAR_SECTIONS` makes. The memory is still per
workspace and still shared, which is the right shape: it is now read by the only
window that draws it.

Two things went with that pane. `⌘P` no longer lists **tables or requests** — a
palette row that selects a tab into a strip which never shows it is found,
opened and invisible, which is the failure `useHasOpenTabs` is commented
against; each window has its own list down its left side, which is the way in
that is still there. And the studio's boot no longer reads the databases: that
read was what pulled the remembered tabs back in, and nothing in this window
lists them. `DatabaseWindow` does its own read on mount — which is why a window
refreshes what its own list needs rather than waiting for a studio boot that may
never happen in it, and why there is only ever one window per panel.

They keep their **native title bar**, on macOS too. `hiddenInset` buys the
studio a header that stands in for the title bar; these have no such header, and
traffic lights over a tree are lights with nothing behind them.

## Board

A project's kanban board: columns it names itself — starting at `Todo`, `Doing`,
`Done` — and cards that can each name the chat their work is happening in. Opened
from the project's own row in the left column, a board mark beside the `+`, from
that row's menu, or by name in `⌘P`, which lists one board per project.

**It is a project's, not the workspace's.** The thing a card is about is work in
one repository, and the chat a card links to runs in one directory; a board
holding both projects' cards would be a board whose every card had to say which
repository it meant, and a link that could cross between them. So `folderId` is
on the card, and the board is **one tab per project whose id is the project's** —
the shape the `Changes` tab already has, which is what puts it in the strip
exactly while that project is the one being worked in and takes it out again on
a switch. `rootOf` in `lib/panels.ts` is the identity function for both.

### What it is not

The **task** above (see Tasks, removed) was a container of members drawn from
every panel — a request, a table, a file, a note — with a crumb across the title
bar, a `Home` dashboard of cards, and `Add what is open`. What was wrong with it
was not the kanban idea, which it did not have: it was that a task was a second
place every other panel's contents were filed, so every panel had to know about
it, and what it bought over simply having those things open was a name.

A card here holds a **title, a line, a column, its own marks, and at most one
chat**. Nothing else in the app is filed under it, and nothing outside the board
and that chat's own header knows a card exists. That is the whole difference, and
it is why this one is not on the path to being that one.

### What a card carries, and what it does not

Three marks were added on top of the title and the line: **tags**, a
**priority**, and a **due date**. Each is drawn only when it is set, so a plain
card is exactly as tall as it was.

They earn their place for the same reason and it is worth saying once: each is a
thing about the work that a **person types once and reads at a glance
afterwards**, and each has a place to be drawn that costs nothing when it is
empty. The test for anything else proposed for a card is that one.

- **Tags are text, not records.** There is nothing about a tag to keep beyond the
  word — no rename, no palette, no listing — so a tag store would be a second
  file to keep in agreement with the cards for no answer either could give alone.
  The hue is derived from the text (`tagTone`), which is what makes the same word
  the same colour on every card of every project without anything remembering
  that it is. Two unrelated tags can collide on a hue; the chip carries the word
  too, so what is lost is nothing.
- **Priority is three levels and absent is the default.** Not five, because the
  only thing a priority on a personal board is read for is which card to pick up
  next, and a scale nobody can rank consistently stops being maintained. Not
  defaulted to `medium`, because a board where every card claims a priority is a
  board where the field says nothing.
- **A due date is a day, not an instant** — `YYYY-MM-DD`, and the one date in
  this app that is not an ISO timestamp. A due date rendered from an instant is a
  day early or late depending on the reader's offset, and a board that calls a
  card overdue because the machine woke up in another timezone is a board that
  cannot be trusted. Its colour is `overdue` / `soon` / `later`, where `soon` is
  today or tomorrow and nothing further: a week-wide window paints most of a
  healthy board amber.

What was **refused** in the same pass, from a mock-up of a team board:
**assignee and avatars**, **comments**, **attachments**, an **activity log**, and
a `Status` field in the card's drawer.

The first four are the same refusal: this app has one user, no accounts, and no
server. There is nobody to assign a card to, nobody to comment to, and no event
stream for an activity log to draw — the agent cannot write to the board either,
because this app serves no MCP server of its own (below). The nearest honest
thing to all of them already exists and is already on the card: the **linked
chat**, which says who is on it, is where the discussion about it happens, and
whose age says whether it is still moving.

`Status` is refused for the reason the drawer has no column picker: the column
_is_ the status, and a second control saying it is a second answer that can
disagree with the board behind the drawer.

### Opening a card

A **click** on a card opens a **drawer down the right-hand edge** — Base UI's
drawer with `swipeDirection="right"`, and the first use of that component in the
app.

It was a centred dialog behind a **double click**, and both halves were wrong for
the same reason. A card is read against the board around it — which column it is
in, what is beside it, what else is due that week — and a modal over the middle
covers exactly the thing the card is being read against; a panel down one edge
leaves the board legible behind it. Once opening a card is that cheap it can be
what a plain click does, and a double click is a gesture nothing announces and
that no card on this board looked like it wanted.

Two consequences, both of which had to be handled rather than discovered: the
`⋯` menu button and the chat footer live **inside** a card that now opens on a
click, so both stop the click from reaching it — otherwise pressing `⋯` opens the
drawer under its own menu, and following a card to its chat opens both. A drag
does not fire a click at all, so letting a card go in another column cannot open
it.

An editor **in the column** was never the alternative: the point of the card on
the board is that it is a few lines high, and one that grew a text area where it
sat would push the rest of the column out of view every time somebody fixed a
typo.

Fields on `BoardCard` are **optional and read through functions** — `tagsOf`,
`priorityOf`, `dueOf` — never off the record. Board files were on people's disks
before these existed and nothing in main normalises one on the way through
(`listBoardCards` is a read of the JSON), so each reader has to answer for a card
written by an older build and by a newer one. That is `toneOf`'s rule, applied to
three more fields, and `test/board-cards.ts` is where it is checked.

### The columns are the project's own

`Todo` / `Doing` / `Done` are what a board **starts** as — `DEFAULT_BOARD_COLUMNS`,
seeded the first time one is opened — and from there they are added, renamed,
recoloured and dragged.

They were **fixed**, and the argument for that was that a board answers one
question and every added column asks a second one. That was wrong about how a
board is actually kept: `Blocked` and `Review` are the two every real one grows,
and a board that cannot say "waiting on someone else" gets that said in card
titles instead. So the reversal, and what it cost is what was predicted — a
record type (`BoardColumn`), a file (`board-columns.json`), a rename, a reorder,
and a rule for the cards in a column being deleted.

**That rule is: nothing rewrites the cards.** Deleting a column leaves its cards
naming a column that has gone, and `columnOf` draws such a card in the **first**
column — visible, and one drag from wherever it belongs. A delete that silently
moved eight cards somewhere else would be a delete that lost track of work, so
the menu item says how many will turn up in the first column before it is
picked. The last column standing cannot be deleted at all: a board with no
columns has nowhere to draw a card and nowhere to put the button that would add
one back.

The seeded ids **are the words** — `todo`, `doing`, `done` — and that is
load-bearing rather than tidy: cards written while the columns were a fixed union
hold exactly those strings, so seeding them means a board written by the previous
build needs no migration pass.

One consequence worth naming: the tab's badge counts the cards **not in the last
column**, since there is no longer a column called `Done` to ask about. Every
board is read left to right and work ends at the right-hand end of it, whatever
that column has been called.

### Colour

A column carries one of six hues (`BoardTone`), picked from its own menu, and the
neutral is first because a column with nothing to say about itself should be able
to say nothing. The record holds the **id** and `lib/board/tones.ts` holds what
that is worth in pixels — the split `GitFileState` has from `GIT_TONES`, so a
change of palette touches nothing that was saved.

Five strengths per hue, and deliberately not one colour at five opacities: the
dot in the header is the hue at full strength because it is the thing being read;
the header tint behind it is faint, because a column is furniture and a card is
content; the card's **left border** is what carries the hue down the column, so a
card dragged into the wrong one reads as wrong without the header being in view;
the insertion line while dragging takes the hue of the column it is in, so the
gap being aimed at says which column it is in; and `chip` is a filled label on a
card — a tag or a priority — which is the only one carrying a text colour as well
as a tint, because it is read over the card's own background rather than tinting
something that already had its own.

The same six hues serve the tags, which is why there are not two palettes: a tag
picks its hue from its own text (`tagTone`) out of the five that are not the
neutral. A column may say nothing about itself; a tag somebody chose to type
always has something to say.

A card's marks are **shapes as well as colours** — the priority has an arrow and
a word, the due date a calendar. Three chips in a row separated only by hue fails
for anyone who cannot tell them apart, and fails for everyone at a glance, which
is the only way a board is ever read.

### Dragging

Both a card and a column, with the platform's own `draggable` / `dragover` /
`drop` rather than a library: a board moves one thing at a time to one insertion
point. A column is dragged **by its header**, which is why cards are draggable
separately — a column that could be picked up anywhere in its own body would
swallow every attempt to pick up a card.

The arithmetic is `moveCard` and `moveColumn`, and it is the one part of this
panel worth a test (`test/board-cards.ts`). Two things there are easy to get
wrong and invisible when wrong: the gaps on screen are counted against the column
**as drawn**, which still holds the thing being carried, while the move counts
against it taken out — one off, one direction only — and the file holds every
project's records, so a drag on one board must not reorder another's.

`membership` in `cards.ts` exists because of a third: the drawing filed an
orphaned card into the first column and the drop did not, so a card let go beside
an orphan landed a row off. One rule, read by both.

The board scrolls **sideways**, with a fixed column width, rather than dividing
the pane by however many columns there are: a tenth column that made the other
nine unreadable would be a board that punished being used.

### The link to a chat, in both directions

Four things, and none of them is a fifth panel knowing about the board:

- A card's **footer line** is its chat — the title, whether it is answering
  right now (the `busy` event, the same one the projects column's spinner reads)
  and how long ago it last did. The line is the click: it opens the chat. That is
  a line of text per card rather than a control per card, because what somebody
  wants off a glance at a board is which cards have an agent on them.
- **Start chat from this card** creates a chat in the card's project and links
  it, with the card's title and body as the composer's **draft** — `create` takes
  one, and this is the only caller left that uses it. Not sent: the first turn is
  still the user's to phrase and to
  read before it runs, and a card that sent itself would be a board that starts
  agents.
- The chat's own pane carries a **chip** above the transcript naming its card,
  with the column changeable from there — somebody finishes reading a turn and
  knows the card is done, and the alternative is switching to the board to drag
  a card whose chat they were just in. It draws nothing at all for a chat no
  card names, which is most chats.
- A card whose chat has been **deleted** says so and offers to start another.
  `linkedChat` resolves the link at read time and is null for exactly that, the
  way `chatRootId` is null for a chat whose project has gone. Deleting a chat
  therefore needs no write to the board, and there is no state in which the two
  disagree about what exists.

### The agent cannot move a card

This app serves no MCP server of its own (see MCP), so there is no tool to hand
a turn that would let it write to the board — and adding one would be reversing
that decision for a panel that does not need it. The consequence to be clear
about: a board is **the user's** account of what is being worked on, not a place
the model keeps state, and it does not update itself when a turn finishes. What
the model does know is whatever the chat was seeded with, which is the card's own
text.

### On disk, and what is not remembered

Two files, both the whole workspace's and both read once at launch:
`workspace/board.json` for the cards and `workspace/board-columns.json` for the
columns — `board:list` / `board:save` and `board:list-columns` /
`board:save-columns`, each replacing the whole collection the way the requests'
listing is replaced. Two files rather than one, and the columns not a field on a
card, for the reason a request folder is not a field on a request: a column is
renamed, recoloured and reordered without any card changing.

**Order in each list is order on the board** — within a column for a card, left
to right for a column — so a drag of either is one write and there is no second
ordering to keep in agreement. `moveCard` and `moveColumn` in
`lib/board/cards.ts` are the only code that knows it, and `test/board-cards.ts`
is why.

The cards of a project that has **left the workspace** stay in that file. The
board simply does not draw them, the way a chat whose folder has gone is dropped
from the listing rather than deleted — see the `tasks.json` argument above.

Which boards were open is **not** remembered across launches, unlike the API
panel's tabs and like the `Changes` tab this copies: a board is one click from the
project it belongs to, and restoring one would mean restoring a tab for every
project somebody had glanced at.

## Chats

A project's rows are its chats, and clicking one opens it.

### Worktrees, removed

There was a layer between the two: a project's rows were its `git worktree`
checkouts — a second working tree on a branch of its own, sharing the single
object store, so two agents could work on one project without standing on each
other's files, index and branch — and a chat lived in one of those rather than
in the project. It is **gone**, deleted rather than hidden, the way the Mail and
Terminal panels went: `main/git.ts`'s `worktrees` / `addWorktree` /
`removeWorktree` and `parseWorktrees` / `worktreeSlug`, the `worktrees:*`
channels, `WorktreeRecord`, `lib/worktree/store.ts`, the New worktree dialog,
`test/worktrees.ts` and `test/worktree-git.ts` are all out, and so is the
nullable `worktreeId` that ran through `ChatPlace`, `FileRoot`, the dock's
shells, `gitStatus`, `gitChanges`, `terminalCreate` and `startProcess`.

What it cost was paid on every use and the isolation was wanted on few of them:
a branch to name and a directory to remove afterwards, before a question about
the project somebody already had open. What is left is the shape everything
else in the app was already keyed by — a **project**, `FileRoot.id` and the
dock's shell key and a chat's root all being the same folder id, with no `??`
chain anywhere deciding which of two directories was meant.

A workspace that used the feature still has its checkouts on disk under
`~/.yasuo/workspace/worktrees/`. Nothing reads them and nothing deletes them,
for the reason `mail.json` survives its own panel; `git worktree list` in the
project is what still knows about them, and `git worktree remove` is how they
go. A chat written in one has a `worktreeId` naming nothing, which `chatRootId`
reads as null. It was **not listed** at first, on the ground that there is
nowhere left to run its next turn — and that was the wrong answer to a true
observation. The conversation is on disk and readable, and a chat which silently
stopped existing is worse than one that is listed and explains itself when you
send to it, which `WorktreeChats.run` already does: a turn whose folder has left
the workspace finishes with a line saying so. So they are listed, last, under a
folder called **`Ungrouped`** (`ungroupedChats` in `lib/worktree-chat/store.ts`,
`UNGROUPED_ID` in `projects-section.tsx`, which is a sentinel among folder ids
because those are uuids). It is drawn only when it holds something — an empty
`Ungrouped` would be a row explaining a situation nobody is in — and it is the
one row here with no `+` and no menu, since a chat needs a directory to run in
and this row names the absence of one. Clicking a chat under it moves nothing
else: there is no project to point the dock's shell and the Explorer tree at,
and pointing them at whichever project was last active would be this app
guessing.

**How the rows are drawn.** A folder mark, open or shut, where a disclosure
chevron used to be: what this column lists is projects on disk, and the chevron
carried only "there is more below", which is the one thing the indent already
says. The open one takes the primary hue, which is what separates the project
being worked in from the ones merely listed. The chats under it carry **no mark
at all** — a column of identical speech bubbles is a column of noise, since the
only thing they distinguish is a chat from a chat — and what that space is spent
on instead is the **age** of each conversation, right-aligned and `tabular-nums`
so a `9h` and a `23h` end on the same pixel. That is the question actually asked
of this list: not what a row is, but which of four similarly-named chats is the
one from this afternoon. `since` in `lib/worktree-chat/since.ts` is the label
(`test/chat-since.ts`), deliberately coarse — one unit, no decimal, `now` under
a minute rather than a `0m` that reads as missing data. The long form in
`lib/db/display.ts` stays where it is: a cell in the data browser has the width
for "9 hours ago" and a row here does not.

Rows in this section are **rounded blocks inset from the column**, which is not
what `SideRow` is: the shared row is full-bleed with a bar down its left edge,
right for the Explorer's dense tree and wrong for a column of a dozen items with
the whole height to themselves. It is overridden at the call site rather than
made a variant, since one section wanting a different shape is not yet a second
kind of row. The inset is `px-1` on the scrolling list and **not** a margin on
each row — a row given `w-auto` to make room for a margin stops being `w-full`,
so it sizes to its content, so `truncate` on the title has no width to truncate
against, and what that looks like is a column of clipped titles and a horizontal
scrollbar under the list.

### The chat is hosted, not tailed

Clicking a project's row opens a chat in it, and the app **hosts** that
conversation rather than reading one.

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

#### A chat is a place

A chat is a **place**, and a place is a project's own working tree: `New chat
here` on a project row's context menu, on the `+` at the end of its row, and on
the title bar crumb's menu, all start one with the project directory as the cwd.
On the record that is `folderId` (`ChatPlace` in `@shared/api`), read through
`chatRootId` the way options are read through `chatOptions` — which is where a
record written while chats lived in checkouts comes back as null. That id is a
`FileRoot.id` and the dock's shell key already, so a chat's scope, its tab group
and the row it moves the workbench to all fall out of it unchanged.

The permissions are **not** quietly narrowed for it. Narrowing them would make
`Edits` mean two different things depending on where it was picked, and `Plan`
and `Ask` are already in the picker for exactly this. What is not claimed is
isolation: `SYSTEM_PROMPT` in `main/worktree-chat.ts` tells the turn it is in
the user's own working tree on whatever branch they have checked out, since a
model told it is isolated when it is not reaches for `Bash` more freely than it
should. The caption under the composer says "in this project's own working tree"
(`captionFor` in `chat-pane.tsx`), and the empty state says it a second time,
with the toolbar named as the way to be asked first.

The cwd resolve is deliberately **not** a fallback chain: a chat whose folder has
left the workspace finishes with a line saying so, rather than running its next
turn in whichever directory happens to be readable.

#### A chat holds its CLI open, and can be typed into mid-answer

**A chat is a session, not a sequence of turns.** It used to be the second: one
`query()` per message, with a **string** prompt, which is the SDK's single-turn
mode — it closes stdin on the first result, the process exits, and the next
message opens a new one with `resume`. That has one consequence that is not a
detail: while a turn is running there is no process to say anything to, so the
composer was disabled for the length of it. Everybody who uses the terminal
`claude` types the next thing while the current answer is still scrolling, and
this app was the one place that could not.

`query()` also takes an **async iterable** prompt, which is its streaming input
mode: one CLI for the life of the chat, reading user messages off a queue
(`Inbox` in `main/claude-agent.ts`) as they are pushed. A message sent mid-turn
is handed to the CLI, which queues it and folds it into the next turn — the
CLI's own behaviour, not something reimplemented here. So the composer is live
at all times, Enter always sends, and `Stop` sits beside `Send` rather than
replacing it: stopping what is running and adding to it are two different things
somebody might want, and they are not alternatives.

Four things fall out of that, and each cost something to get right:

- **`result` stopped being the end of anything.** It is the end of a _turn_; the
  session ends when the stream does. An error result no longer ends it either —
  the SDK only closes its input on a single-turn query — so a failed turn leaves
  the chat usable instead of taking its CLI with it. `onTurn` and `onExit` are
  the two halves that used to be one `onDone`.
- **Token counts became cumulative.** The SDK documents `modelUsage` and
  `total_cost_usd` as the session's running total on every result of a
  streaming-input session; read raw, the fifth turn of a chat is drawn as having
  cost what the first four cost as well. `usageOf` takes the previous result and
  subtracts, per model rather than on the sum — a chat switched from Sonnet to
  Opus would otherwise credit one against the other — and reads a total that went
  _backwards_ as a reset (`/clear`, or a session reopened) rather than a refund.
  `test/chat-usage.ts` covers all of it.
- **A renderer can no longer work out whether a chat is busy.** "Sent, and no
  `done` yet" was the whole truth while a chat refused a second message; now a
  turn can end with another already queued behind it. So busy is main's to say,
  as its own `busy` event, taken from the CLI's `session_state_changed` — which
  it only sends when `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS` asks it to — and
  from the pushes and results otherwise. See The subagents, below, for why the
  fallback is not good enough on its own.
- **The toolbar moves under a running session.** Model and effort go over as
  control requests (`setModel`, `applyFlagSettings`) instead of being an argument
  list a new process is spawned with, and the permission never was the CLI's —
  `permits` is consulted per tool call, so putting the picker on `Plan` takes
  effect on the next call. What still cannot move is the cwd and the
  `CLAUDE_CONFIG_DIR` profile: those _are_ the argument list, so a change to one
  closes the session and the next message opens another (`signatureOf`).

`Stop` became an **interrupt** rather than a kill. Killing the process was only
ever how a turn was stopped when a turn _was_ the process, and it cost the chat
its warm CLI as well; an interrupt ends the turn and leaves what was queued
behind it to run, which is the CLI's own rule and the terminal's.

The cost of all this is a `claude` per chat that has been sent to, resident until
the app quits — which is a real cost and not one the user asked to pay. So a
session with nothing to do for five minutes is **closed** (`IDLE_MS`), quietly
and with no line written: the conversation is on disk and the next message opens
it again as a resume, which is precisely what every message used to do. The
window only has to cover reading an answer and typing a reply.

#### What a turn looks like

**A turn's working is folded, and its answer is not.** A finished turn is read
for what it concluded; the seven tool calls under it are read when something
looks wrong, which is a different visit five minutes later. A `showToolCalls`
setting used to answer that by hiding the rows outright, which serves neither:
the switch has to be found and flipped between the two readings, and nothing on
screen says there is anything behind it — it is why that setting is gone. So the
pane draws one line — `7 tool calls, 13
messages, 1 subagent`, with a mark per _kind_ of tool that ran — and the whole of
it opens on a click.

What is folded is everything a turn produced except its **last word**: the tool
calls, the thinking, and the narration between them ("let me read the composer
first"), which reads as working precisely because the answer came after it.
Three things are never folded — an **error**, a **refusal**, and what the turn
**cost** — the first two for the reason the old switch already made an exception
of refusals: both are the turn saying it did _less_ than was asked, and that
cannot be behind something somebody has to know to open. The third is below. A turn still being answered has no last word yet, so all of it is
working; a turn that only talked has no fold at all. `lib/worktree-chat/
activity.ts` is the whole of that and it is pure, because every case it has is a
shape of transcript rather than anything on screen — `test/chat-activity.ts`.

**A tool row is four things rather than a string**: a mark saying which kind of
tool it was, what the model said it was doing, the file it was about as a chip
with its own file-type icon, and what came back. They are apart because they are
read at different speeds — the marks are scanned, the chips are looked for, and
the argument is read only when one of the first two caught the eye — and a single
line of `Read /Users/…/projects/api/src/http/client.ts` defeats all three. The lead is
the model's own `description` where a tool carries one, so a `Bash` row says
"Check IPC wiring for attachments" rather than "Bash". `chat-marks.tsx` holds
the glyphs, in its own file for the reason `section-marks.tsx` is: the same mark
is drawn on the row and on the closed fold above it.

Three of those four are things `main/claude-agent.ts` had been throwing away.
`describeCall` pulls the file, the description and the argument apart instead of
collapsing the input to one string — one string could not have been split back
up, since "is this a path" is not a question to ask of text somebody's command
wrote — and it is also what stopped every subagent row being 120 characters of
the prompt's JSON: `Task` carries a description, a whole prompt and a subagent
type, and what a row wants is which agent ran.

**A tool's result is the one line in a chat that is not append-only.** The row is
written when the call goes out, because that is when there is something to watch;
the result arrives afterwards and is filled into the row already on screen, found
by the CLI's own `toolId`. Holding the row back until the result came would be a
pane showing nothing while the interesting part happens. `resultLine` reduces
what came back to a count once it is more than a line — a `Read` returns the
file, and a row that showed it would be the file in the transcript — and shows a
single line as it stands, since "the command printed nothing" and "the command
printed `3`" are the two answers somebody scanning for is actually after.
`recordResult` in `main/worktree-chat.ts` patches the held lines synchronously
and only those, which is the note worth reading before touching it: every other
write there is a read-modify-write with an `await` in the middle, and that is
safe for an append and not for a change to a line the same turn is appending
after.

**An edit's row says how much it moved, not what the CLI said about it.** The
result of an `Edit` is a sentence — "The file /Users/…/review-panel.tsx has been
updated. Here's the result of running `cat -n`…" — and it was the widest thing in
the row: forty characters of a path the chip beside it was already showing, then a
clause about `cat -n` that is about the CLI rather than about the change. So
`changeOf` reads the change off the call's **input**, which is where both sides
of it are: `stat` is `+3 −1` and goes where the result went, and `change` is the
`-`/`+` lines themselves, shown when the chip is hovered. It is deliberately not
a computed diff — those two strings _are_ the sides, and running a diff over them
would be inventing detail about which of their lines correspond — and it is
capped, because a tooltip is not a pane and the file's real diff against `HEAD`
is a click away in `Changes`. `Write` and `NotebookEdit` have one side only,
which is honest: a write replaces the file, and what it replaced is not in the
call. The sentence comes back when the call **failed**, which is the one time it
is the thing worth reading — an edit that could not find its `old_string` says so
there and nowhere else.

**A todo list is read the same way, for the same reason.** `TodoWrite` is the
one call whose argument _is_ the thing worth reading, and it matched none of the
keys `argumentOf` looks for — so every one of them drew
`{"todos":[{"content":"…","status":"pending","activeForm":"…"}` cut at 120
characters. `todosOf` reads the list off the input the way `changeOf` reads a
change off one, and returns `null` for a payload of any other shape, so a CLI
that renames the field lands back on that JSON rather than on an empty
checklist. The row then says the two things a list has: `1/3` where a result
would go, and the item being worked on as its argument. The list itself is under
the row — the one block in that panel that is not a `pre`, because a todo is a
sentence and wraps, where a command is text whose indentation is its own.

The CLI's third field, `activeForm`, is dropped: it is the same task in the
present participle, and a chat is rewritten whole to disk on every appended
line. Which item is running is drawn rather than said.

**And the closed fold carries it**, which nothing else about the working gets to
do. A list is the one call that is about the _turn_ rather than about a file —
what it is going to do and how far through it is — and a long turn's working is
folded precisely while that is the question being asked, so the fold's own line
ends `· Wire the IPC (1/3)`. The alternative was drawing the latest list outside
the fold like a refusal: a checklist per turn in the transcript for ever, most of
them stale and none of them the answer anybody came back for. It is the **last**
list in the run, since `TodoWrite` is called again for every item that starts and
finishes and only its final state is true (`countsOf`, `test/chat-activity.ts`).

**The lines open on a click, in a popover, and the whole row is the button.**
Both halves of that were got wrong first and are worth the record. It was a
`title`, which cannot hold a line break. Then it was a _tooltip_, which is the
wrong container twice over: the tooltip in this app is the inverted `bg-primary`
chip meant for a few words, so a `-`/`+` block came out as a pale box with code
in it, and a panel that goes away when the pointer leaves the row cannot be
scrolled, selected or copied out of — all three of which is what somebody wants
from code. And the target was the _chip_, which is 90px of a 600px row: a target
found by accident once and never again. A click on the row keeps the panel up
while the reader looks down the rows under it, which is what reading a turn's work
actually looks like. A row with nothing to show is left a plain `div` rather than
a button, and a chip with no change keeps its `title`, so a `Read` is exactly as
it was.

The popover's footer says **what this call changed, and that the file's own diff
is in `Changes`** — because those two answers drift apart the moment anything
else touches the file, and a popover captioned "diff" showing the first while
somebody read it as the second would be worse than no popover at all.

**Thinking is back**, as one folded line each, always drawn. It was dropped when
a turn was read for its messages and its tool calls and nothing else; `read`
takes the `thinking` blocks now. Only a
turn that was actually thinking has any, which is the effort picked on the
composer's toolbar — so a chat on Haiku at `low` draws none rather than drawing
empty ones.

**A turn being worked on is a spinner, `Working…`, and how long it has been
going** (`chat-skeleton.tsx`). It was a set of placeholder bars shaped like a
turn — a thinking line, tool rows, an answer — and they read as content arriving
that never did, when the rows a turn actually draws land a second later anyway.
What was missing instead was the elapsed time: the question somebody asks of a
spinner after a minute is whether it is stuck, and `1m5s` moving answers it
where a still bar does not. It is `elapsed` in `lib/worktree-chat/since.ts`,
every unit down to the second because the second is the part that moves — the
coarse single unit `since` draws in a sidebar row would sit on `1m` for the next
fifty-nine of them. The start is `startedAt` on the store, beside `sending`,
rather than state in the pane: the pane is one instance reused across the strip,
so a clock local to it would restart every time somebody looked at another chat.
It survives a queued message and an `ask` for the same reason — it is how long
this stretch of work has been going, not the current turn.

#### The subagents, while they are the only thing happening

**A turn that hands its work to subagents used to lose the spinner altogether**,
and the two halves of that were separate faults.

The first is which signal says a chat is busy. The CLI has an authoritative one
— `session_state_changed`, whose `idle` is documented as firing only once the
background-agent loop has exited — but it emits none of them unless
`CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS` is set, which this app did not set. So
`reportsState` in `claude-agent.ts` never turned true and busy fell back to "a
`result` arrived", which is exactly wrong here: a turn that starts agents in the
background _is_ finished as far as its result is concerned, and the agents go on
working for minutes afterwards. Read back off a real transcript, the result line
landed immediately after `7 agent đang chạy song song` and forty-odd rows of the
agents' own work arrived under a chat the app was drawing as idle. The env var is
one line and the fallback stays for a `claude` too old to answer it.

The second is that there was nothing to draw in the gap. A subagent's tool calls
do arrive on the same stream, but a long one goes quiet for minutes at a time,
and the pane's only account of it was a tool row that had not come back yet. What
the CLI sends in the meantime is a heartbeat — `task_started`, `task_progress`,
`task_updated`, `task_notification` — which `read` was dropping with every other
system frame. It is now kept as a **set** of running agents, announced whole
(`ChatAgent`, the `agents` event) rather than as starts and finishes to be paired
up, for the reason the SDK gives its own `background_tasks_changed` the same
shape: a bookend that goes missing leaves a spinner nobody can stop. The spinner
says `Working · 3 agents…` and names up to four of them with the last tool each
one called, which is what turns a minute of silence into something moving.

**The tool has two names.** It was `Task`, it is now `Agent`, and both are real:
which one arrives depends on the user's own CLI, and a transcript on disk holds
whichever was current when it was written. Testing for one of them was a bug in
three places at once — subagents counted as ordinary tool calls in the fold, the
row drawn with the fallback wrench and the whole prompt as its argument, and, the
one that mattered, `Task` alone on `READ_TOOLS` and `ALLOWED_TOOLS`, so a mode
below `Full access` refused every handoff to a subagent. `AGENT_TOOLS` is the
pair, kept once per process because the two never import each other.

#### What a turn cost

**Every turn ends with a line saying what it spent**, and it is not folded:

```
Opus 5 · 39.1k prompt, 96% cached · 1.9k out · 1m5s · 41.3k context · $0.31
```

The numbers were being read and dropped — the SDK reports them once, on the
result line, and `read` passed over them — which left the app unable to answer
the one question a hosted chat is asked about itself: why an afternoon of turns
came to what it came to. The CLI's own transcript is not this app's to read (see
Conversations, removed), so if the app does not keep them nothing does.

**Why the cached share is on the line rather than behind it.** A turn's prompt
barely changes size: this app's system prompt, the tool list, and the
conversation so far. What changes by an order of magnitude is which side of the
cache it lands on — a prompt read back is billed at a tenth, one written at a
quarter more than full price. The same trivial turn in this repository, measured
on Haiku: **$0.0049** where the prefix was already cached, **$0.0788** where it
was not. So `96% cached` is the number worth reading, and `0% cached` on a turn
that is not the first of a chat is the app having asked for a prefix nothing else
shares — its own `--append-system-prompt`, its own `--allowedTools`, or an hour
since the last turn that shared one, the cache being 1h TTL.

The model is on the line for the other half of the same question. The toolbar's
model and effort are `null` by default, which leaves the user's own `claude`
deciding — and what it decides is whatever their global settings say, so a chat
can run on Opus for a week with nothing on screen having said so.

`usageOf` in `main/claude-agent.ts` reads it off `modelUsage` rather than
`usage`, which the SDK documents as the main agent loop alone: `Task` is
pre-approved, and a turn that ran a subagent spent what the subagent spent. The
per-model figures are summed and the label is whichever model read the most, so
a turn that compacted on Haiku is still an Opus turn. `thinking` is the one
figure that comes off `usage`, the only place the SDK breaks the output down; it
is main-loop only, so it is a floor, and a floor answers what it is read for —
whether reasoning is where the output went.

**How long the turn took is on the line too**, in the spinner's own words
(`1m5s`, via the same `duration` in `lib/worktree-chat/since.ts` that the clock
under `Working…` counts up with) — the figure that was on screen while the turn
ran is worth keeping once it has stopped moving, and the chat's total is the
afternoon added up beside what it cost. It is **measured in main, around the
turn**, not read off the SDK's `duration_ms`: everything on a result line is the
streaming session's running total, so a wall time taken from it would grow with
the chat the way `modelUsage` does. A message sent into a chat that is already
working does not restart it — the queued turn's clock starts where the running
one's result landed — which is the per-turn reading of the same stretch the
spinner draws as one. A line written before the field existed has no time rather
than `0s`.

**The context figure is the one number on the line that is not a spend**, and it
is read differently from all of them. Everything else is a sum — over the turn's
model calls, its subagents, and then over the chat's turns — and a context
summed the same way is meaningless: ten 40k turns are not 400k of a window. It
is a level. So it is taken off the turn's **last assistant message** rather than
its result line (the result's `usage` aggregates every call the turn made, so a
turn of eight round trips reports eight prompts), the main loop's own only
(`parent_tool_use_id` marks a subagent's, whose conversation dies with the
`Task`), and the chat's total carries the last turn that reported one rather
than adding them up — which is why it can also go **down**, when the CLI
compacts.

**And it is live.** Main sends it as its own event on every reply
(`type: "context"`), not only on the usage line, because the number is watched
rather than looked up: a turn that reads twenty files moves the window a long
way before it ends, and a figure that only lands once the turn is over answers
the question after the moment it was asked. The event is not written down — the
usage lines are the record, and this is the same quantity arriving sooner — so a
reloaded window falls back to the last line until the next reply. `chatLine`
joins the two, and it draws the context **alone** for a chat whose first turn is
still running: there are no usage lines until a turn ends, and a footer that
stays empty through the first answer is empty for exactly the turn somebody
opened the chat to watch.

There is no denominator beside it. The SDK reports the window size only in the
`context_usage` twin of the `/context` report, which arrives on a slash-command
result — so a `41.3k / 200k` would cost a turn to keep current, and a table of
windows per model id in this app would be a guess that goes stale on the next
model and is wrong for the `[1m]` variants (`lib/worktree-chat/models.ts` makes
the same argument about capability ordering). The used figure alone answers what
it is read for: whether the conversation is near the point where it compacts.

It is a **line of the conversation** (`role: "usage"`), written and read back
with the rest, rather than a field on the record. A chat holds several turns and
each cost its own amount on its own model; a total on the record could not say
which. The chat's own total is summed from those lines
(`lib/worktree-chat/usage.ts`, pure and tested in `test/chat-usage.ts`) and drawn
beside the caption under the composer — the one number to compare against
`/cost` in a terminal. A chat with no usage lines has no total rather than a
total of zero, which is what every chat written before this reads back as. A
crashed turn reports zeroes, and `$0.00` for it would be the app calling a
failure free, so it says `nothing counted` instead.

It is also the **only** `claude` the app runs. What this document's old
"only one" rule was actually against is still refused: features calling the CLI
as a helper — an AI filter, an import button — because a helper turn is a turn
nobody asked for. A project's chat is a conversation somebody is having.
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
- **No MCP config goes over at all.** There used to be one — this app served its
  own panels as three servers and pointed a turn at the file naming them, through
  `extraArgs` rather than the SDK's `mcpServers` option, because that option
  serialises the config onto a command line every process on the machine can
  read. Both the servers and the flag are gone; a turn now gets exactly the
  servers the CLI finds for itself in that directory.
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
(the `edits` entry in `PERMISSIONS` permits them) and `Bash` with them — that is
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
thinks in: the project being refactored wants Opus at `max`, and the chat asking
where a function is called wants Haiku at `low`. A turn is built from whatever
they said when the message was sent, and a turn already in flight keeps what it
started with — they are its argument list, and there is nothing to change it to.

**The model rows are the user's own `claude`'s.** They were four aliases written
into `@shared/api`, and the trouble with a written list is not that it goes stale
— it is that it was never right for anybody in particular. Which models an
install offers is a property of the account and the CLI version behind it: this
machine answers with six, including `Opus (1M context)` and a Fable that says
_Requires usage credits_, and one of the four aliases that used to be in the list
(`fable`) is a name no row on it actually carries. A picker offering a model the
account cannot use fails a turn after somebody has typed a message; one hiding a
model they are paying for is worse.

So `agentModels` asks (`main/agent-models.ts`, `agent:models` in the contract).
It costs a `claude` process and **no tokens**: `supportedModels()` is a control
request over the SDK's own stdin channel — the same channel `canUseTool` answers
on — so the CLI answers it out of what it knows about the account without an API
call. The prompt handed to `query()` is an iterable that never yields, which is
what keeps it that way; the answer is held for the app run, since it changes when
somebody installs a different CLI and not between two openings of a menu.
Measured: ~500ms for the control request, ~2.7s for the whole call cold, almost
all of that the login shell being asked where `claude` is. A row is the CLI's
`displayName` over its own `description`, because "which model" is a question
about the trade-off and the trade-off is the sentence — `Haiku 4.5 · Fastest for
quick answers` — and the digits down the right are this app's, the same nine keys
the CLI's own picker offers. Where the ask failed, `CHAT_MODEL_FALLBACK` draws
three aliases and nothing invented.

**Effort is per model.** The CLI says which levels each one takes, and Haiku 4.5
takes none — so the effort picker beside it is not drawn at all rather than drawn
disabled: a control that cannot be used is a question about why, and the answer
is a property of the model chosen one button to the left. Picking a model also
clears an effort it does not accept, or a chat moved onto Haiku would keep `high`
for ever with no picker left to change it back. `AgentModel.efforts` is
three-valued for the case in between: a list is what the CLI said, `[]` is a
model that takes none, and **null is nobody having asked** — a fallback row, or a
model this build has never heard of — which gets every level, because refusing
one the CLI would have taken is worse than offering one it ignores
(`chatEfforts`, `test/chat-models.ts`).

**And the effort menu has no `Default` row.** It had one, above the five, and it
was `effort: null` — pass no `--effort` and let the CLI decide. What that did was
put the tick on a word: a chat sitting on it ran at a level nothing on screen
named, and nothing _could_ name it, because `supportedModels()` lists the levels
a model accepts and does not say which one it falls back to. The honest choices
were a menu admitting it does not know, or a level this app names out loud, and
this is the second: `DEFAULT_CHAT_EFFORT` is `medium`, every pick goes through
`effortFor` and lands on a level the chosen model accepts, and `chatOptions`
reads a null off disk as that level — so a chat written before this has a tick
too, and the toolbar and the argument list say the same thing. The one exception
is `Inherit`, which keeps `null`: it is the row that means "whatever your own
`claude` is set to", and naming a level under it would override the setting it
exists to defer to.

The same complaint applies to the **model** row called `Default (recommended)`,
and the answer there is different, because that row is the CLI's own and it
follows the account — replacing it with the alias behind it would pin a chat to
a model the account might stop recommending. So the row stays and says what it
is: `ModelInfo.resolvedModel` is the wire id behind each row, and the alias row
sharing the default's is the default under a name (`defaultModelAlias`), drawn
beside the label. A CLI too old to send the field draws the row as it was — a
missing suffix is the failure this is allowed to have, not a wrong one.

**A new chat opens on `default` rather than on nothing.** `null` means no
`--model` at all, which leaves the turn on whatever `~/.claude/settings.json`
says — and that is not a neutral default: on the machine this was written on it
meant **596 of 596** chat messages ran on Opus, against 81% in the same user's own
terminal, with nothing on screen having said so. `default` is the CLI's own first
row, the model it recommends for that account. `null` is still there as the last
row, `Inherit`, described as "whatever your own `claude` is set to", because it is
a thing somebody can genuinely want; a record that says `model: null` keeps it,
and a record with no options at all — written before there was a toolbar, so
nobody ever chose — gets what a new chat gets.

**Permission is one picker, not a picker and a toggle.** There was a plan toggle
beside the other two and it is gone into this: plan mode _is_ a permission — the
read-only one, asked a particular way — and two controls over one question can be
put into a state neither of them means ("plan, with full access"). So the third
control is `Plan` / `Read only` / `Ask` / `Edits` / `Full access`, held as `permission`
on `WorktreeChatOptions`, and `PERMISSIONS` in `main/worktree-chat.ts` is the one
table saying what each runs as — what it permits, what the turn is told and
whether it may stop to ask, out of one entry, so a turn cannot
be assembled half in one mode and half in another. It was the first control here
to have no **Default**, because there is no such thing for it: a turn runs at
whatever this says, and `Edits` is what it says until somebody changes it. The
effort picker has since gone the same way, for the same reason — see above.

Four of the five decide up front, which is what print mode forced and what a
chat that never interrupts still wants. **Read only** is what `default` used to
have to become, back when a turn that may not write without a prompt may as well
have been told so up front; it is still the right mode for a question, and now
it is a choice rather than a workaround.
**Nothing a mode decides reaches the CLI's argument list**, and that is worth
saying before the modes themselves, because it is why they are cheap to switch
between. `allowedTools`, `disallowedTools` and a per-mode `appendSystemPrompt`
are all part of the request's **cached prefix** — tool definitions sit ahead of
the system prompt — so for as long as a mode was expressed in them, changing
mode mid-chat threw that prefix away and paid to rebuild it. Measured in this
repository against a 43k prompt: a switch cost **42,345 tokens written and none
read**, where the turn before it wrote 103 and read the lot — eighteen times the
price for the same question, and the user had done nothing but move a picker.

So what the CLI is handed is byte-identical on every turn of every mode: no
`allowedTools` and no `disallowedTools` at all, one `permissionMode` (`manual`),
one system prompt. (There was a fixed `disallowedTools` — the workspace's two
`delete_*` — and it went with the servers those tools were on.) The mode is applied in this process instead, by
`permits` on the turn, which `deciding` in `main/claude-agent.ts` consults for
every call. `permissionMode` was measured too and is free to vary — switching it
between `acceptEdits`, `manual` and `bypassPermissions` cost ~85 tokens — but it
no longer needs to, one value covering all five. What a mode is _told_ moved with
it, from the system prompt to the head of the **message**, which is outside the
prefix and therefore free. Switching mode now costs 100–170 tokens.

Two things fell out of doing it this way, and both are improvements the cache
work did not set out to make. A bare tool name on `allowedTools` **auto-approves
the call before `canUseTool` is consulted** — the SDK warns about it on stderr —
so for as long as each mode sent a list, the callback was never reached for
anything that mode had listed, and the `matchedAskRule` handling below had never
run. And **Full access** stopped being `bypassPermissions`, which auto-approves
everything before the callback in the same way; the two `delete_*` refusals it
names are now enforced here rather than left to the CLI, which turns them from a
request into a guarantee.

**Full access** permits every tool, and it exists
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
the half this app can enforce: `READ_TOOLS` is everything that reads, and a
writer is refused by being absent from it — the workspace's own included, since
saving a request is the one kind of change no `git checkout` takes back. `Bash`
is not on it — a command can write, and no reading of an argument list decides
which ones do — and what that costs is `git log` and `rg`, which `Glob` and
`Grep` are the same reconnaissance without a shell. That list is what
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
which is the set worth being asked about. `manual` is the `--permission-mode`
every mode now runs at, and it was `Ask`'s first: this CLI's mode list no longer
has a `default` (it is `manual` for "prompt about everything" and `auto` for the
classifier), and the SDK passes whichever string it is handed straight through,
so naming the one that is gone would fail the turn on its argument list. Nothing
is refused except the
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
which writes a rule into the project's `.claude/settings.local.json` — checked
in or not, as that project already decides — and it is offered only where the SDK
had a rule to suggest, since a button that did nothing would be worse than no
button.

**`AskUserQuestion` comes down the same callback, in every mode.** The model's
own multiple-choice question, the thing anyone who has used the interactive CLI
will recognise. It reaches the app by being on no mode's permit list, which is
the whole mechanism — `permitting` in `main/worktree-chat.ts` carves it out of
`Full access`'s "everything" for the same reason, since that mode's `allowed` is
`undefined` and would otherwise answer the question with its own unanswered
input before `onAsk` ever ran. Unlike the rest of what `canUseTool` sees, this
one is the model asking the _user_ something rather than asking for permission,
so `onAsk` is wired for it regardless of what else a mode permits or asks about
— `Plan` and `Read only` included. Everything else `permits` refuses still goes
through `permission.asks`: only `Ask` stops for those, and the other four refuse
them with a sentence the model reads, since there a question is a turn waiting
on nobody. `AskUserQuestion` itself is answered by **allowing the call**
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
leaves in the draft is an `@` and a path relative to the project — plain text,
the same thing `@` inserts, through the same `mentionOf`, so a dropped file is
tinted like a picked one: the turn runs in this directory with `Read`, so a path is
already something the agent can open, and print mode takes a prompt rather than
an upload. It is still the picker rather than a second `@`, since the OS dialog
reaches files the index does not — anywhere on the machine, and past what the
walk skipped. A file from somewhere else keeps its absolute path, since a `../..`
chain reads like a path in this project and is not one (`relativeTo` in
`lib/files/paths.ts`, `test/attach-paths.ts`). **Mention a file…** types the `@`,
which is all it has to do — the menu that follows is the one a typed `@` opens.

**The MCP servers a turn gets are the user's own**, and this app hands over none
of its own. It used to: the databases, the saved requests and the notes went over
as three `yasuo-*` servers pre-approved by name, with two `delete_*` tools
refused, and that whole feature has been removed — see MCP below for the argument
and for what replaced the section in Settings. What is left needs no flag at all.
The CLI reads `~/.claude.json`, the repository's own `.mcp.json`, the enabled
plugins and the account's claude.ai connectors exactly as it would running plain
`claude` in that directory, and a chat here is handed all of it.

`ToolSearch` is on `ALLOWED_TOOLS` because of them: a CLI configured to defer
tools reaches an MCP tool through it, and being asked to approve a search for a
tool is a prompt nobody can answer. The tools themselves are on no mode's list —
this app configures no server and so has no name to name — so a call to one is
decided by the mode, which for four of the five means refused with a message
rather than left to stall.

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

**A chat is written down by its first message.** It used to be written down by
the `+`, on the reasoning that the row has to exist for somebody to type into —
a tab that only appears once you have said something is a `+` that does nothing.
That reasoning was right about the tab and wrong about the record: the tab does
open on the click, but it is the **renderer's** until the first message
(`unsaved` in `lib/worktree-chat/store.ts`), so a `+` somebody thought better of
no longer leaves an `Untitled` row in the project's list and a file on disk for
ever. There was nothing in those chats to keep.

What that costs is that the renderer mints the id, which is the CLI's session
id — main can no longer invent one at the first message, because it would be a
different chat to the one on screen. So `createWorktreeChat` takes a `ChatSeed`:
the id, and whatever else the tab picked up before anybody spoke into it. The
toolbar is the one that matters — picking Opus and `Plan` before typing is
ordinary — and `/rename` is there for the same reason. An id already in the
listing is returned as it stands rather than added twice, which is what two
messages sent before the first write landed would otherwise do.

The exception is a caller that records the chat's id somewhere else. The board's
`startChat` links a card to the chat it starts, so it asks `create` to `save`
straight away; without that, closing the app would bring the card back with its
chat `lost` — which is what a card whose chat was _deleted_ says, and it would
be saying it about a chat that was never written down at all.

**A chat is named twice, and the second name is the CLI's.** The first is the
sentence that opened it, clipped to forty characters, which is what the tab says
the moment somebody presses Enter and is a poor name for a chat found again in
the column a week later — "Kiểm tra giúp tôi tại sao api /api/sear…" against
"Line-landing API empty responses". The second is a summary of that same first
message, and the argument that mattered is that **this app does not produce it**:
`CLAUDE.md` refuses features that call the CLI as a helper, and a summarising
turn would be exactly that — a turn nobody asked for, on the user's tokens, for a
tab label. The CLI writes one for itself anyway. It goes into the session's own
transcript as `{"type":"ai-title","aiTitle":…}`, off a model of its own, ahead of
the turn's first reply, and it costs the chat's session nothing.

So `retitle` in `main/worktree-chat.ts` reads it rather than asks for it. Nothing
on the SDK's message stream carries it; `getSessionInfo()` would answer, but it
reads the config directory of _this_ process and a chat on a profile is under a
`CLAUDE_CONFIG_DIR` of its own. The transcript's folder is **found rather than
computed** — the folder name is the project path with every non-alphanumeric
character replaced, applied to the path the CLI _resolved_, so a folder reached
through a symlink is somewhere this app would have to guess at (`/tmp` is filed
under `-private-tmp` on macOS) — and a session id is a UUID, so the file name
alone identifies it.

`autoTitled` is what keeps it honest: only a chat this run named after its own
first message may be renamed, and the user's own rename takes it off that list
mid-turn. The read happens as the turn ends and **`done` waits on it**, because
`done` is what the renderer re-reads the listing on and a re-read that raced the
write would put the sentence back on top of the name. The `title` event beside
it is not that path — it is for the turn that _failed_, where there is no re-read
and a chat can still have been named.

An `--append-system-prompt` says where the turn is, and nothing else. Short,
because the CLI can see the working directory for itself. It was two sentences
while there were `yasuo-*` tools to explain — a tool list says what a tool does,
not that the databases behind it belong to the workspace rather than to this
directory — and it is one now that there are none.

**Several at once.** `WorktreeChats` keys everything by chat id — a turn per
chat, lines per chat — because a question about one project while another is
being refactored is the point rather than an edge case.

**Where they live.** The listing is `workspace/worktree-chats.json` and each
chat's lines are `workspace/worktree-chats/<id>.json` beside it — a listing and
a file each, for the reason the notes had the same split: a turn rewrites one
chat rather than all of them. Both keep the old names, because renaming the files would lose every chat
already written.

The chats are the `worktree` pane, registered in `PANELS` like any other, listed
in the left column under the project each is in, and grouped under it in the tab
strip when grouping is switched on in Settings › Tabs. The list in the column is
what makes a chat from last week findable at all: the strip holds what is open
in _this_ run, and a chat is written down as it happens.

### Running in one

A turn runs in the project's directory, and so does anything else pointed at it:
`terminalCreate` and `startProcess` both take a `folderId` and main resolves
`resolveFolderDir(folderId)`.

An **id**, never a path. The renderer does not get to name a directory main has
not already written down — the same rule `insideAny` in `main/files.ts` is for.

A chat's empty state is `WorktreeWelcome` — which project, and its path —
because somebody with two projects open needs to know which one they are about
to change. It says the opposite of a reassurance, on purpose: this is the
working tree you have checked out, and an edit here is an edit to your work.

## The dock

The strip under the pane, spanning its whole width: `Run` and `Terminal` — the
tail of Conductor's own `Setup / Run / Terminal`.
`components/studio/dock.tsx` is the strip, `lib/dock.ts` is whether it is open
and which tab it holds, and the chevron in its corner collapses it — a close
button would be wrong, because this is one of two halves a column is split into
and collapsing gives the other the whole of it.

**It was the lower half of the Explorer column**, stacked under the tree exactly
as Conductor stacks its own strip under its file list. That was the wrong thing
to inherit, because the geometry is not Conductor's: its file list is on the left
and as wide as somebody drags it, while the Explorer here is on the right and
capped at 520px. So the shell got roughly 60 columns — under the 80 that
virtually every CLI's output is written for, which is the width `git diff`, a
stack trace and a build log all assume — and `Run` was no better off, since what
it prints is compiler and test output, wide for the same reason. The second cost
was the stacking itself: opening the dock took the tree's height, so the two
things somebody wants _together_ after running a command — the output, and
`Changes` — were competing for one column.

Under the pane rather than across the whole window, which was the other
candidate. Full width would give the shell more room still, but it puts the
Explorer back in the same trade the move was made to end: the tree is what gets
consulted while the dock is open, and a dock that shortened it to gain a few
columns would be the same coupling pointed the other way. Within the pane's
column the two are independent — the tree keeps its height, the dock gets
whatever the editor area is wide, which is most of the window.

The move also fixed something the old position hid. The dock was a panel inside
the Explorer column, and that column is `collapsible` with a `collapsedSize` of
0 — so `⌘B` took the dock with it, and the title bar's own dock button then
expanded a panel inside a column that was zero pixels wide, showing nothing.
Nothing was lost while it was gone, since collapsing does not unmount and the
pty went on running; there was simply no way to see it without bringing the
Explorer back. `⌘B` and the dock's toggle now govern one thing each.

The two tabs are what this app actually has to put there: the things that are
_about_ what is on screen rather than things that were opened. There was an
`Assistant` tab in front of them, and the button at the right of the title bar
opened the dock on it (see The assistant, removed).

The dock is **collapsed rather than unmounted**, and the shell is the reason. A
pty taken out of the React tree ends; it does not hide. While the dock held only
a conversation the main process owned and a log, unmounting it cost nothing — the
moment it held a terminal, closing the dock would have killed whatever was
running in it.

### Closing it leaves the strip

**It collapses to its own tab row**, not to nothing: `collapsedSize` is
`DOCK_STRIP_HEIGHT` from `lib/dock.ts`, the 36px that row is tall. So what is on
screen with the dock shut is the chevron — pointing up now — and `Run` and
`Terminal`, each of which opens the dock on itself. Neither tab is drawn as
selected while it is shut, because a lit tab would be pointing at a panel that
is not there.

**This is what replaced the button in the title bar.** The dock used to collapse
to nothing, which made its chevron a one-way door and meant the way back had to
live somewhere else; that somewhere was a `PanelBottom` button in the top-right
corner, inherited from the `Assistant` tab that used to open the same dock. The
objection is that it is three regions away from the thing it acts on — a
window's title bar is for what the window is, and the button was there for a
reason to do with the dock's history rather than with where anyone would look for
it. A row that stays where the chevron left it answers the question at the place
it is asked, so the button is deleted, `toggle` is the chevron's, and that corner
of the title bar is empty.

One number for the strip's height rather than an `h-9` in the component and a
`36` in `studio.tsx`: the two have to agree or the dock closes to a sliver of its
own tabs, and nothing in the build would catch the drift.

**Dragging the dock shut is the same as clicking the chevron.** The panel has an
`onResize` that compares against `DOCK_STRIP_HEIGHT` and flips the store, which
is the two-way binding the Explorer column already had — without it the store
would still say open after a drag, leaving a chevron pointing down at a dock that
is already down and one press of `⌃\`` doing nothing.

### Terminal

A shell in the project the column last had clicked (`lib/shell/store.ts`,
`dock-terminal.tsx`).

**This is where the Terminal panel went.** There was a panel — a pane of its own,
a tab per project in the strip, an agent picker, and a chat view tailing the
CLI's transcript — built on the premise that a session _was_ the work and could
not be demoted into a corner. A project's chat is that work now, hosted rather
than tailed, and what was left of the panel is what Conductor's tab always
was: a shell beside the work. So the panel is gone, and this is the whole of it.

**One shell per place**, keyed by the project's folder id. Clicking a project
row, or one of its chats, points the dock at that project's shell, so the
terminal beside a chat is in the directory the chat is editing. A pty's cwd is
fixed when it starts and cannot be moved, so
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
removed from the workspace takes its shell with it.

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
than one per panel: a file, a diff, a chat and a project's board sit side by
side, and clicking any of them goes to the pane that shows it. Leaving one panel
for another used to take the first panel's tabs off the screen — still open, but
nothing said so. `components/studio/workspace-tabs.tsx` assembles it from the
panel stores `PANES` names; the order across panels is `tabOrder` on the studio
store, since a chat between two files is a position none of those stores has
anywhere to record. A table and a request are no longer among them — those two
panels have windows of their own, each with a strip of its own (see Panel
windows).

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
`showPane` sets the pane and nothing else. A project's chat is the one pane with
no list of its own, which is why `Pane` in `lib/store.ts` is `Section` plus
`worktree`: `Section` in `lib/sections.ts` is the four kinds the workspace holds,
and a chat is a conversation in a project rather than one of them.

The scrolling half is one place: `SideRow` is every sidebar's row, and it
scrolls itself into view when it becomes the active one — `block: "nearest"`, so
a row already on screen is left exactly where it is rather than the list
centring itself on every click. The opening half cannot be shared, because what
"holds" a thing differs per panel: a directory chain in the Explorer, a folder
chain in API (`ancestorFolderIds` in `lib/tree.ts`), the project a chat is in,
the branch a table belongs to.

Each panel does it in its own `select`, not in an effect beside the list. That
is what keeps the fold state honest in both directions: it only ever _opens_, so
a folder somebody shut stays shut unless what they picked is inside it, and the
folder holding the current selection can still be collapsed by hand — which a
version derived during render could not allow. It is also why API's folds moved
out of its component and into its store: a list cannot open a folder for a
selection made in another panel.

**The strip comes back on a reload.** It used not to: one panel remembered its
tabs and the others remembered nothing, so a reload left one strip intact and
emptied the rest. Each panel writes its own record under a settings
key of its own — `http.tabs`, `db.tabs`, `note.tabs`, plus `workbench.strip` for
the cross-panel order and the pane on screen — because what identifies a tab is
the panel's business: a schema-qualified table name here, a note id there.
`lib/tab-memory.ts` is only the reading and writing, which was the same several
times over.

Every record is reconciled against what actually exists, never trusted: a
request deleted since, a file that has gone, a table that has been dropped. For
the API panel that happens as it is restored, in the first
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
each time. Leaving Database for API and coming back gave a result grid scrolled
to the top, a SQL editor with no undo history and the query split back at its
default height. None
of that is state a store has any business holding — a scroll offset and an undo
stack belong to the view — so the view is what stays.

A panel is still built the first time it is shown, since a panel nobody has
opened is a connection nobody is reading, and `mounted` in `studio.tsx` is that
list. The hiding is `invisible` rather than `hidden`: `display: none` destroys the
scrolling boxes inside, which would put that grid back at the top by another
route, and it is what the dock stacks its own shells with.

**And the same one level down: a tab switched away from is hidden, not
unmounted.** The rule was only ever half applied — Explorer and the Notes panel
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

### The preview tab

**A single click in the Explorer is a look, not an open.** The tab it opens is
the _preview_ one — drawn in italics, one at a time — and the next single click
takes its place rather than adding a tab beside it. Double-clicking the row, or
typing in the file, keeps it: the italics go and the tab stays like any other.
It is the editors' own rule, and it is here for the reason it is there: reading
through a repository to find something is one click per file, and each of those
clicks used to leave a tab behind, so ten minutes of looking cost fifteen tabs
to close and a strip too wide to read.

`previewId` on the files store is the whole of the state — one path, or null —
and `opening` beside it is the arithmetic, tested in `test/files-store.ts`. Four
things about it are deliberate:

- **A file that already has a tab is left exactly as it is.** A kept tab stays
  kept and a preview stays a preview, so clicking around the tree cannot quietly
  demote the file being edited into something the next click evicts.
- **The replacement happens in the slot the old tab held**, so the tab does not
  move out from under the pointer while somebody is clicking down a directory.
- **Only the tree previews.** `⌘P`, a definition jumped to, `New file`, and
  `Open with` are all somebody asking for a particular file, and they open a tab
  of its own. So the flag is on `open`/`select` rather than being the default,
  and the one caller passing it is the row in the tree.
- **An edit keeps it**, from `setText` rather than from the editor: a keystroke,
  a paste and a format all go through that one function, and a preview tab that
  has been typed into and then evicted would be lost work. The eviction still
  flushes, for the same reason closing a tab does.

It is not remembered across a launch — `files.tabs` stores what was open and
which was selected, and everything restored comes back kept. A tab that survived
a restart is one the workspace kept, and having the first click in the tree
evict it would make the memory worse than none. `keep` is by path rather than
"whatever is previewing", so a double click on some other row cannot promote it.

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
exception.** The chats were one for a while — grouped whatever the setting
said, on the argument that a chat tab stands for a conversation in a place
rather than for something the user opened, so grouping was how that panel
stopped spending the strip. What it bought in practice was two tab strips
stacked on screen the moment a chat was open, in a window whose setting said
tabs were not grouped: the outer strip the place, the inner one its chats, for
a panel nobody had asked to fold. So the exception is gone, `grouper` reads the
setting and nothing else, and a chat is one tab among the rest — with its
project on its hover line, because the label is the chat's title and cannot
carry both.

What a folder _is_ differs per panel, and `groupOf` is each one's answer: the
Explorer root a file sits in — a workspace folder, the longest match, since a
folder added inside another is still a project of its own — the project a chat
is in, the folder in the panel's own tree a request is filed under, the schema a
table belongs to. A request at the top level of its tree is filed under a real
place rather than nowhere, so its group is named for the panel — "Requests" —
rather than "Ungrouped".

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

### Vertical tabs, removed

The strip could be a column beside the pane instead of a row above it —
**Settings › Tab strip › Vertical tabs**, a `tabsPlacement` of `top` or `right`,
in a resizable panel of its own so how much of a file name fit was the user's
drag. What paid for it was the label: a row gives every tab the same narrow box
and truncates the name in it, while a column gave each one a whole line and read
as a list of what is open.

It is deleted: the `orientation` prop on `TabStrip` and `WorkspaceTabs`, every
axis branch inside the strip, the nested `ResizablePanelGroup` in `studio.tsx`,
the `tabsPlacement` field and its setter in `lib/settings.ts`, the `TabsPlacement`
type, and the `PlacementOption` cards with their miniatures in the Settings
dialog.

What it cost was paid on every read of the strip's code. Nine `vertical`
branches ran through one component — the drop line's edge, the stacking, the
active tab's accent border, the thumb, the wheel listener, the drag's axis, the
empty state — so every question about how a tab behaves had to be answered twice,
and the column's own arrangement had a further wrinkle behind it: the strip fell
back to the row when nothing was open, because a row with no tabs takes no
height while a column would have been a blank band down the side of an empty
workbench. That is a preference whose layout the workbench, the strip and the
settings store all had to agree about. Against that, the pane is what the window
is mostly for, and a column of tabs takes its width from the thing being worked
on — which is the same argument that moved the dock out of the Explorer column.

A workspace that had picked `right` still has `tabsPlacement` in its
`workbench.settings` bag on disk. Nothing reads it and nothing rewrites the bag
to remove it — `isStored` ignores the key and the next `save()` simply stops
writing it, for the reason `workspace/mail.json` survives its own panel. Its
strip comes back as the row.

## Search

`⌘P` opens a search over everything **this window** can open — a file, a chat, a
project's board — and picking one opens its tab and goes to the pane that shows
it. `components/studio/command-palette.tsx` is the whole of it.

It exists because the strip and the two columns only answer a question they are
already pointed at. A file nobody has expanded a folder of, a chat from last
week and another project's board are each a trip through a list the user is not
in and is not going back to, and the list they moved to is still there when they
arrive. The palette is the way in that leaves the columns where they were — for
the same reason nothing else here switches them, `select` on each panel's own
store is what it calls, so a chat opened from the palette behaves exactly like
one opened from a project's row.

**Tables and requests are not in it.** They were, and the row worked; what
stopped working is where it landed. Neither `database` nor `api` is a pane this
window draws any more (see Panel windows), so selecting one put a tab into a
strip that never shows it — found, opened and invisible, which is precisely the
failure `useHasOpenTabs` carries a comment against. Each panel's window has its
own list down its left side. A palette row that reached _into_ that window would
be a push to a window main deliberately sends nothing to.

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
the chats and boards beside them. Picking one opens the file **and** expands
the
tree down to it: somebody who found a file this way generally wants to see what
sits next to it.

What the palette lists otherwise is what the panels list, read from their stores
rather than from an index — the chats and one board per project, both of which
the studio already holds.

**Nothing it lists can fail any more.** Opening a row is a read or a `select`,
so `open` resolves to nothing and the palette's only line under the input is the
`Opening …` one, shown after 150ms so the usual case never flashes it. The
failure channel was there for the one row that dialled a server: a table in a
database the workspace was not on had to move there first. That row is gone with
the pane, and so is the channel.

## The window shortcuts

`⌘P` opens the search above, `⌘W` closes the tab the pane is showing, `⌘S` writes
the Explorer's open file, `⌘B` shows or hides the sidebar and `⌃\`` shows or hides
the dock's Terminal — each answered by a `keydown`listener in the renderer
rather than by an accelerator in the application menu.`lib/shortcuts.ts` holds
the predicates.

They are the page's rather than the menu's because a registered accelerator is
handled in the main process, before the page sees the key at all, and each of
these needs what only the renderer knows: the palette owns its own dialog, which
tab is the current one is worked out in `workspace-tabs.tsx` from whichever panel
is on screen — no store holds it — and whether `⌘B` is the sidebar or a bold
word depends on where the caret is. The File menu still lists **Close tab ⌘W**
and the View menu **Sidebar ⌘B** and **Terminal ⌃\``**, all with
`registerAccelerator: false`, so the key is displayed and the item works without
the menu taking the keystroke.
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
keeps it everywhere else: in the code editor, which has no binding for it, and in a plain
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

**`⌃\`` is the one bound with `Ctrl`on every platform**, macOS included, because
the key belongs to the editors rather than to the platform — and`⌘\``on macOS is
already the system's "next window". It is read off`event.code === "Backquote"`rather than`event.key`: the binding is the physical key beside `1`, and what
`key`reports for it with`Ctrl`held varies by layout.`Shift`is refused, so
the chord sometimes written`⌃~`is not this one and`⌃⇧\`` stays free for a "new
terminal" if one is ever wanted.

It is also **the one shortcut that is deliberately not refused inside the
terminal**, which is the opposite of the rule `⌘P` and `⌘W` follow off macOS.
Nothing in a pty is bound to `⌃\``, so there is no editing key being taken — and
hiding the panel from inside the shell, having just run something in it, is most
of what the key is for. That is also why it is claimed on the capture phase:
xterm would otherwise hand the key to the process before the page saw it.

What it toggles is the **Terminal tab**, not the dock: `toggleTab` shows that tab
when it is not the one on screen and hides the dock when it is, so the key
reaches a terminal from the `Run` tab in one press rather than two. **View ›
Terminal** lists it with `registerAccelerator: false`, the same arrangement
**Close tab** and **Sidebar** have and for the sharper version of the same
reason: whether the key shows or hides depends on which tab the dock is on, which
is the renderer's answer alone.

## Settings

**Settings…** in the application menu — ⌘, — opens a dialog, and there is
nothing else to it: no settings tab in the strip, no section, no page.
What is in it is about the workbench rather than about anything in the
workspace, so it has nothing to be a tab _of_ — and one of the settings there is
about the tab strip itself, which a tab would be a poor place to hold the switch
for.

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
the far end of the line. There was a `stacked` row for a control too big for the
end of a line — the tab strip's two placement pictures, the only one there ever
was — and it is deleted along with them, rather than left as a shape with no
caller.

There are four sections: **Appearance** (the theme, which the `d` key still
toggles — the header's moon button was removed when this row took its place, and
with it the last clickable thing in the title bar), **Tabs** (whether tabs are
gathered under the folder each belongs to — see Grouped tabs), **Claude** (the
named `CLAUDE_CONFIG_DIR` profiles a chat's turns can run under) and **MCP**
(which MCP servers the user's own `claude` has, below).

**Every row in Claude says whether that directory is actually signed in, and as
whom.** A profile is a name beside a path, and a path is a weak thing to name an
identity with: it can be a typo, it can be a directory somebody logged out of
months ago, and on macOS the token is not in it at all — it is in the login
keychain — so a directory can name an account it can no longer authenticate as.
Without the check, all three look exactly like a profile that works, right up
until a turn fails under an identity the user thought they had. The account is
**asked of `claude`** — `claude auth status --json`, run with that directory as
`CLAUDE_CONFIG_DIR` — for the reason the MCP listing is asked rather than read:
`<dir>/.claude.json` does hold an `oauthAccount`, but that file is the CLI's,
its shape moves between releases, and it would still not answer the question. It
costs a process and no tokens.

Three things about it are decisions rather than details. **The directory is
`stat`ed first and a missing one is never spawned into**: `claude` creates
whatever `CLAUDE_CONFIG_DIR` points at before it answers, so probing a typo
would silently make the typo real and then report it as merely signed out — the
whole point of `No such directory` being its own badge and not `Not signed in`
is that the two have different fixes. **Only the default account is checked when
the section opens**, and each profile is checked by its own button: checking
every row on open is a `claude` per profile, and a row per keystroke while a
path is being typed is worse. **Nothing is drawn as good until the CLI has said
so** — the unchecked state is its own quiet badge rather than an optimistic one.
The default account — no `CLAUDE_CONFIG_DIR` at all, which is what a chat with no
profile picked runs under — gets a row of its own above the list, because it is
the one the others are being told apart from.

**The composer's own picker says it too**, and that is where it matters most:
Settings is where profiles are set up, but the account menu in a chat's toolbar
is where one is _chosen_, and "Claude Hùng" over "Claude Personal" over "Claude
Hai" is four names somebody typed and no way to tell which login any of them is.
So each row carries the address under the name (`accountLine`) — the email
rather than a `Signed in` badge, since a badge beside an email is the same fact
twice, and the words are kept for the rows that will _not_ run, which are the
ones drawn in the destructive colour. The menu asks when it is **first opened**
and the answers are held for the run: a workspace has a composer per chat and
none of them is a reason to run `claude`, a menu of four profiles must not be
four processes every time it is dropped down, and a login does not change while
somebody is deciding who to send a message as. Re-asking is the Check button in
Settings, which is the one place somebody has just done something that would
change the answer.

**There was a Chat section, and it is gone**: two switches, `showToolCalls` and
`showThinking`, inherited from a chat view's own header under
`claudeGui.showToolCalls` and `claudeGui.showThinking`. **A chat now always
draws both.** The switches were written against a pane that laid a turn's
working out in full, where hiding it was the only way to read the answer; the
fold answered that better (see The chat view below), and once everything the two
governed was already one line deep behind a click, what they turned off was not
noise but the record of what the agent actually did — the thing the pane is for
when something looks wrong. A preference nobody has a reason to set is a
preference to delete. The store's fields, its setters and the two settings keys
are deleted with the rows; the keys already on somebody's disk are left where
they are, unread, the way `workspace/mail.json` is.

The dialog has no Save. A preference applies as it is picked, which makes the
studio behind the dialog its own preview — switching Group tabs on regathers the
strip while the dialog is still open. `lib/settings.ts` is the store and writes
each change to the workspace's own settings, so it survives a relaunch by the
same route as the strip's arrangement.

## MCP: what the user's own `claude` has

**There were three MCP servers here, and they are gone.** `src/main/mcp.ts`
served the workspace's panels to a turn as `yasuo-database`, `yasuo-api` and
`yasuo-notes` — streamable HTTP on loopback, an OS-picked port, a per-run
secret in the path, one switch per server in Settings › MCP under
`mcp.database` / `mcp.api` / `mcp.notes`, a `0600` config file written at the
moment a turn started and pointed at with `--mcp-config`, and every tool call
rechecked against the setting so switching a server off stopped a turn already
in flight from using it. Between them they offered eleven tools: the databases
and their tables and a capped `query`; the saved requests, the folders they
inherit from, and `send_request` resolving `{{variables}}` through
`@shared/http-request` exactly as the panel would; the notes as markdown, and a
`create_note` that never overwrote. `test/mcp.ts` spoke the protocol over a real
socket, including every way in that should be refused — a wrong secret, a longer
path, a `GET`, an `Origin`, half a JSON body.

All of it is deleted: the module, the tests, the three setting keys, the config
file, the `--mcp-config` flag, the `yasuo-*` entries on every tool list, the
two `delete_*` refusals, the sentence in the system prompt naming the tools, and
the `notes:changed` / `http:changed` channels that existed only so a panel could
notice what an agent had written underneath it (with `reread` on the API store,
which had no other caller). `signatureOf` is down to two fields, because the MCP
config was the third thing a session could not be changed out from under.

**The argument for removing it.** The premise was good — a turn started inside
the workspace should be able to read the workspace — and it is not what the
feature turned into. Configuring MCP is something the user's own `claude` already
owns, thoroughly: `claude mcp add`, a repository's `.mcp.json`, plugins, claude.ai
connectors, and a real Postgres or HTTP server for any of it that is worth
having. This app was a second place to configure MCP, with its own switches, its
own config file, its own security surface (a loopback port and a secret to keep
out of a command line) and its own answer to "why can the agent not see my
database" — and the switches were off by default, which they had to be, so the
common case was a feature that did nothing until somebody found it. Against that,
the part it was uniquely good at is narrow: an agent reading a table the Database
panel is already pointed at. What it cost was a whole subsystem in the middle of
this app's only `claude`.

**What it costs, said plainly.** A turn can no longer read the workspace's
databases, saved requests or notes at all. Somebody who wants that installs an
MCP server for it the way they would for any other tool — and it then works in
the dock's Terminal and in a chat here alike, which the app's own servers never
did.

**What the section is now: a listing.** Settings › MCP shows the servers the
user's own `claude` has, the way `/mcp` in the CLI does — name, scope, transport,
the URL or command behind it, whether it connected, the error if it did not, and
its tools behind a disclosure. Read-only on purpose: the whole point of removing
the servers was to stop being a second place to configure this, and a listing
that could also edit would be exactly that again. Installing is `claude mcp add`;
signing a connector in is claude.ai.

`main/mcp-servers.ts` asks for it, and it is `agent-models.ts` with a different
control request: `mcpServerStatus()` over the SDK's own stdin channel, a `claude`
process and no tokens, a prompt that never yields so the process comes up,
answers and is closed without a turn. Three things about it are decisions rather
than plumbing:

- **Asked, not parsed.** This app could read `~/.claude.json` and a
  repository's `.mcp.json` itself and would still not know the interesting half —
  whether a server connected, what it failed with, which tools it turned out to
  have. Only the process that connected knows that.
- **Asked in a project's directory**, because an MCP config is per directory: the
  listing is true of the active project and says which one it is. With no project
  open it is the user's home directory, which is the user-scope half of the answer
  and nothing repository-specific.
- **Not cached**, unlike the model list, which main holds for the whole run. The
  model list changes when somebody installs a different CLI; this one changes the
  moment they run `claude mcp add`, which is generally why they are looking at it.
  What is shared is only an ask already in flight for the same directory — Strict
  Mode mounts an effect twice, and Refresh is a button.

Two shapes of the CLI's answer are handled rather than trusted, and
`test/mcp-servers.ts` is about exactly them. A `status` word this app has no row
style for becomes `unknown` rather than a row that draws nothing. And a listing
asked the instant the process came up can legitimately be all `pending`, since
MCP startup is not blocking for the CLI — so it is asked again until nothing is
pending or a budget runs out.

**That budget was measured, and the first guess was wrong.** Two seconds looked
generous and was not: against this install a local stdio server settles by
~1.4s, a plugin's HTTP server by ~2.4s, and an account's **claude.ai connectors**
take **~4.4s**, each being a proxy that has to reach out. So a ClickUp and a
Figma sat drawn as _Connecting_ for ever, while `/mcp` in a terminal — a session
up for minutes — showed both connected with their tools. The budget is eight
seconds now, which puts a full listing at ~6.6s here and gets the same answer the
CLI gives. It is still a ceiling rather than "until they all settle": a server
that never connects must not hold the listing, so what is past it stays
_Connecting_ and **Refresh** asks again.

Trouble sorts to the top (`orderedServers`): a failed server eight rows down a
list of twelve is a failure somebody has to go looking for. A remote server's
headers are deliberately not drawn — that is where its token is.

**Two things here are not a listing**, and the line between them is the point.

**The switches** — one per server, one per tool behind the fold — are _this
app's_ refusal and not a change to anything of the user's. The list of what is
off lives in this app's own settings (`MCP_DISABLED_TOOLS_KEY`, a JSON array
under one key because a connector has fifty tools and the list is read whole
anyway), and it reaches a turn as the CLI's `disallowedTools`. So a server
switched off here is still installed, and their terminal still has every tool of
it.

Three decisions inside that:

- **`disallowedTools`, not `permits`.** A mode's policy is applied in this
  process, per call, precisely so it stays out of the cached prefix. This one
  goes the other way on purpose: refusing per call would leave the tool in the
  model's prompt — offered, paid for, and failing only when used — and the reason
  to switch a tool off is usually that you do not want it in the prompt.
  Verified against the CLI's own `init` frame: two tools named on
  `--disallowed-tools` are two tools **absent** from the list the model is given,
  not two tools refused on use.
- **So it is a _workspace_ setting, not per chat or per mode.** It is inside the
  cached prefix, which is the one thing the five modes were carefully arranged
  not to touch. A list that varied per message would rebuild a 43k prefix per
  message; one that changes when somebody opens Settings costs that once. It is
  in `signatureOf` for the same reason the cwd is — a running session was started
  with it, so changing it closes that session and the next message opens another.
- **The entries are _wire_ names.** The CLI normalises a server's configured name
  into the one a tool call carries — everything outside `[a-zA-Z0-9_-]` becomes
  `_` — so `claude.ai ClickUp` is `mcp__claude_ai_ClickUp__…` and
  `plugin:context7:context7` is `mcp__plugin_context7_context7__…`, both real
  examples off this machine. An entry built from the pretty name matches nothing
  at all and fails **silently**, which is why `wireServer` exists and is tested.
  A server-wide entry is the bare prefix, which the CLI reads as all of it — so
  one entry covers a tool added to that server later, and switching a server back
  on clears every entry beneath it rather than leaving three tools quietly
  refused. That last case is `withServerOff`, and it is what the tests are for.

**Remove** is the opposite of a switch and says so before it runs: it is
`claude mcp remove` against the user's own config, so the server goes from their
terminal too, and there is no undo. It runs the CLI's own command rather than
editing `~/.claude.json` or a repository's `.mcp.json` from here — that file is
the CLI's, its shape moves between releases, and two writers of one JSON file is
how it gets corrupted. `execFile` with an argument array, because a server's name
comes out of a config file and a config file is not a thing to hand to a shell.
The button is only drawn where the CLI's `--scope` could take the scope
(`local` / `user` / `project`, `isRemovable`): a claude.ai connector lives on the
account and a plugin's server inside the plugin, and neither is a config entry to
remove. The confirmation stays open on failure so the CLI's own sentence — "no
such server", "that scope is read-only" — lands somewhere the user is still
looking, and the listing is **re-asked** afterwards rather than spliced, since a
server can be configured in two scopes and what is left is the CLI's answer
rather than this app's arithmetic.

**A `needs-auth` row carries the way to fix it**, which is the one place this
listing does more than list. No authorize URL comes back in the status, so the
destination is derived rather than reported (`signIn`), and only where there is
an honest one: a **claude.ai connector** — `claudeai` scope, `claudeai-proxy`
transport — is signed in on the account rather than on this machine, so the row
links straight to `claude.ai/settings/connectors`, a plain anchor that
`main.ts`'s `will-navigate` hands to the user's browser. Any _other_ remote
server needing auth is the CLI's own OAuth dance, with a callback listener and a
browser round trip this app has no part in, so that row says `/mcp` in a `claude`
session instead. The alternative was linking the server's own URL, which in a
browser is a protocol error rather than a sign-in page.

### The fence that used to be here

Before the servers went, there was an argument about the user's own: a turn ran
with `--strict-mcp-config`, so it saw the file this app wrote and nothing else,
and a server of the user's had to be copied into it by name — one switch each
under **Your own servers** in Settings › MCP — before a chat could reach it.
`main/user-mcp.ts` did the reading and `withUserServers` in `main/worktree-chat.ts`
decided what a switched-on server meant to each permission mode. That went first,
and for the reason that eventually took the servers with it: an issue tracker
already set up in the terminal was invisible from the chat editing the branch the
issue is about, for no reason on screen.

The cost of dropping the fence is still the cost today: the read-only modes
(`Plan`, `Read only`) cannot refuse an inherited server _by name_, because this
app does not configure one and so has no name for it. They still refuse every
tool they know about — the writers, the shell — and a tool from a server the CLI
found on its own is on no mode's list, so `deciding` refuses it with a message
rather than leaving it to stall. That is a deliberate trade for parity with the
plain CLI over a narrower guarantee.

**One exception cuts across all five modes: `matchedAskRule`.** A connector an
account has set to require approval — a claude.ai ClickUp, say — forces
`canUseTool` for its tools no matter what: ahead of `bypassPermissions`, and
even past an `allowedTools` entry that matched. Before this, a turn under
`plan`, `read`, `edits` or `full` had no `canUseTool` the SDK would actually
reach, so such a call was simply denied with nobody there to ask — `Full
access` bypassing every permission check this app knows about was never the
same promise as bypassing one an account holder set on a connector, and there
was no way to keep it.

`deciding` in `main/claude-agent.ts` is the one callback every mode now goes
through, and `matchedAskRule` is the first thing it checks — before what the
mode permits, so it is allowed even under `plan` and `read`. Approving without
a person reading the request
is exactly what the account's own `ask` rule was against — this substitutes
the app's own judgment for the human prompt the rule asked for, in every mode
including `plan` and `read`, because a connector's tool carries no read/write
shape this app can see: a `plan` turn that reaches one is trusting the
account's own policy rather than this app's read-only guarantee.

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
stayed: they name the assistant _role_ in a turn, which a project's chat still
produces.

What replaces it is the chat in a project, which is where the argument landed.
The panel existed because the MCP servers were about the _workspace_ and a chat
with one repository under it is a conversation about that repository — but a
project's chat was handed the same three servers on the same terms, so the tools
were never the thing only this panel could reach. (Those servers are gone
altogether now; see MCP above.) What it had that no other surface has is a
turn that cannot change anything, and that is a smaller thing than a second chat
UI, a second store, a second `claude -p` policy and a second denylist to re-read
every time the CLI grows a tool.

Two things moved rather than went. Its rows and its composer are the project
chat's now (`ChatMessage` and `ChatComposer` in
`components/studio/worktree/`, with `lib/worktree-chat/mention-text.ts` and
`mentions.ts` under them) — they were always shared, and there is one caller
left. And the title bar's button became the **dock's** toggle for a while: the
dock's chevron hid it, and with the tab that used to reopen it gone that corner
was the only way back. It is deleted now — the dock keeps its tab row on screen
when it is shut, so the way back is the row itself; see Closing it leaves the
strip.

What is left on disk is left there, as the Mail panel's `mail.json` was: a
workspace that ran the old build still has `workspace/chats.json`, its
`workspace/chats/` directory and an `~/.yasuo/assistant` scratch directory, and
this app no longer reads or deletes any of them. Somebody's conversations are
theirs to keep. The `claude` transcripts those turns wrote are, as ever, the
CLI's own and reachable with `claude --resume`.

## `@` in a chat's composer

`@` in a chat's composer offers the checkout's **folders and files**, with what
each would cost a turn, and inserts the **path**. It pastes nothing.

It listed the workspace's other panels before this — every database, the open
one's tables, every saved request, every note — on the grounds that it is the
thing only a studio can offer: an agent in an editor cannot see the schema of the
database this project talks to or the note saying what the payload has to look
like, and here they are in stores the composer can read. That is still true and it
was still the wrong menu. What somebody reaches for mid-sentence is a file, tens
of times for every time they mean a table, and a menu of two dozen table names is
a menu without the thing they meant in it. The three panels were not lost by
losing the rows: a chat was started with whichever of the Database, API and Notes
MCP servers were switched on, and each of those tools took a thing by _name_, so
`list_tables` and `read_note` answered from a name the agent could also simply be
told in words. Those servers have since gone too (see MCP above), which does not
bring the rows back — a menu of two dozen table names was the wrong menu on its
own terms. Deleted rather than kept beside the paths, and deleted the way
this repository deletes things: `lib/mentions.ts`, `lib/mention-text.ts` and
`test/mentions.ts` are gone, along with the `Mention` type's `resolve` and the
`database` kind.

**A mention is a path, relative to the chat's checkout.** The turn runs there
with `Read`, so `src/main/ipc.ts` is already something the agent can open, and it
is what the agent would have typed itself — the same reasoning as **Attach file**,
which writes a path for the same reason. Nothing is expanded on the way out:
pasting the file in would hand the agent a copy of something that may have
changed by the time it looks, and the reply would have to be read wondering which
of the two it went by.

**Each row says what mentioning it would cost.** `src/main` and
`src/main/git.ts` look alike in a menu and are three orders of magnitude apart in
a context window, and that difference is the whole of what a path does not say
about itself. A file's estimate is its size over four bytes a token — the figure
for English, close enough for code; a folder's is every indexed file below it,
which is what the row is actually being asked. Deliberately estimated from sizes
rather than counted from text: the index walks twenty thousand paths and reads
none of them, and the number does not need to be right to the token, it needs to
say whether this is a hundred tokens or a hundred thousand. The formatting rounds
hard for the same reason — `~48k tokens`, never `~48,213`.

**The Explorer's index is what is listed**, not a walk of its own
(`listWorkspaceFiles`, held by `lib/files/store.ts` and shared with `⌘P`). One
answer to "what is in this workspace" rather than two that would drift, and it is
also why the rows are what they are: the walk skips `node_modules`, `dist` and
the rest and stops at twenty thousand paths, so a folder's estimate is a floor
rather than an audit — which is the right direction to be wrong in for a warning.
Folders are indexed alongside the files for this menu, and the palette asks for
`kind === "file"` because a palette row opens a tab, which a folder is not. The
walk `stat`s a directory's files at once as it goes; that size is the only thing
cheap enough to have for every path in a workspace.

**And what git ignores is dropped on top of that.** The fixed list in
`main/files.ts` is deliberately not `.gitignore` — the reasons are recorded with
it, and they are about the _tree_, which shows everything there is — but a
repository's own statement of what is not its source is exactly the right filter
for a menu offering things to point a turn at. Build output, a `.env`, a
generated lockfile: none of it is what a sentence means by "look at this file",
and no list written here could know it, since it is per repository.

Read from what Explorer already holds (`lib/files/git-status.ts`) rather than
asked for a second time: that store keeps one `git status --ignored` per root for
the tree's colours, and a wholly ignored directory arrives as one entry, so a
path inside `dist/` is answered from the entry git gave for the folder. Two
readers of the same question would drift the first time one of them refreshed.
It also means git does the ignore parsing — nesting, negation,
`.git/info/exclude`, somebody's global excludes — which is the whole reason
`main/files.ts` never tried to.

The palette is deliberately **not** filtered this way. `⌘P` is somebody looking
for a file they know is there, and a file this app can plainly see and refuses to
find is the failure the fixed-list decision was written against; `@` is a menu
proposing what is worth a turn's attention, and the two want different lists off
one index. Both are cached against the index's and the status's identities, so a
commit or an Explorer refresh rebuilds the rows and nothing else does.

With nothing typed yet the menu is the top of the tree — shallowest first,
folders before files — because the useful answer the moment after `@` is "what is
in this repository", not twenty thousand paths in the order the walk found them.
With something typed it is the palette's kind of match, in the order somebody
thinks about it: the file's own name starting with what was typed, then containing
it, then the directories above it, then the characters merely appearing in order,
so `slfs` finds `src/lib/files/store.ts`. Shorter breaks a tie.

**A row wears the file type's own icon**, from the same vendored set the tree and
a tool row's chip draw from (`iconFor` in `lib/files/icons.ts`), with a Lucide
glyph where there is no icon for the type and a plain folder glyph for a folder —
the tree's reason, that coloured folders would compete with the files they hold.
It was a dot in the panel's hue first, and a dot says only "this is a row": what
the eye is doing down a list of forty paths is looking for a kind of file, and the
icon is the fastest thing to answer that. It is deliberately the _same_ picture
as in Explorer, or the two lists would be two vocabularies for one workspace. The
word `file` / `folder` stays on the right of the row, since the icon is
`aria-hidden` and a menu has to say what a row is out loud as well.

The tint is drawn behind the text rather than in it. The composer is a plain
textarea over a mirror of its own value — one class list, `FIELD` in
`chat-composer.tsx`, shared by the two so a character lands in the same place in
both — and the mirror renders the tint with transparent glyphs, so the text on
screen is the textarea's own and selection, IME and undo are the platform's. A
rich-text editor would have been a document model to keep in step for a
decoration, over a message that is plain text on the wire and in the transcript.

**The `@` stays in the text**, and only a word carrying one is a candidate for
the tint. It used to be replaced by the path on insertion, which left a mention
indistinguishable from any other word and the tint with nothing to go on but the
lookup — so in a repository holding `src/api`, or a folder called `test`, an
ordinary sentence using either of those words lit up as though a file had been
pointed at. The tint was claiming an intent the text never had, and there is no
way to recover that intent from the letters alone: `test` is a folder here _and_
an English word, and which one was meant is exactly what the sigil records. So
the sigil is the mention, kept rather than consumed, and `mentionOf` is what
every caller inserting a path goes through — the menu's rows and **Attach
file**'s paths alike, or a dropped file would be the one path that arrived
untinted. It costs one character in the message and buys back the whole class of
false positives; it is also what plain `claude` reads as a file reference, so the
text still says the same thing to the CLI as it does on screen.

What is tinted is read from the index rather than remembered from the menu, which
is `markMentions` in `lib/worktree-chat/mention-text.ts`: an `@path` typed by hand
lights up like one that was picked, half a path deleted stops being tinted, and a
file that has since been deleted goes plain the next time the index is walked —
the tint means "the workspace still holds this", which is the thing worth knowing
before sending. Matched word by word against a lookup rather than by one regexp
built from every known name, which is what the catalogue's few dozen table names
allowed and twenty thousand paths do not: a pattern rebuilt on every keystroke is
the one thing here that would be felt while typing. The cost of the word split is
that a path with a space in it is not tinted, which is a decoration missing
rather than a mention lost — and which is why **Attach file** gives such a path
its quotes and no `@`, rather than an `@` the tint could never honour.
Punctuation around a word is shed before the lookup, so an `@path` in brackets or
at the end of a sentence still lights up while
`@src/main/ipc.ts.map` — a file the index does not hold — lights up nowhere. The
same marks are drawn on the message once it is sent, so a line still reads as
pointing at a file rather than mentioning one in passing.

## `/` in a chat's composer

`/` at the head of a message opens the second of the composer's two menus: the
**slash commands the user's own `claude` would run in this project**. What is
picked goes to the CLI as the message and is run by the CLI, exactly as it would
be typed in a terminal. Two commands are the exception, and they are the reason
this is not simply a list — see below.

**The list is asked for, not written down.** `main/agent-commands.ts` calls
`supportedCommands()` over the SDK's control channel, which is the same
never-yielding-prompt construction `agent-models.ts` and `mcp-servers.ts` use: a
`claude` process, no tokens, no turn. The argument for asking is stronger here
than it was for the models. Measured in this repository the answer is seventy-odd
commands, of which fewer than thirty are the CLI's own — the rest are the user's
`~/.claude/commands`, this repository's `.claude/commands`, and every skill of
every enabled plugin. A written list would hold none of the last three, and would
go stale against the first with every release. Asked **per directory**, like the
MCP listing and unlike the model list, because a repository's own commands and
skills belong to that checkout.

**Held per project for the run**, which is between the other two: the model list
is held because it only changes when a different CLI is installed, and the MCP
listing is deliberately not held because somebody looking at it has usually just
run `claude mcp add`. This one is held because the CLI's own list does not move
under a live session either — `/reload-skills` exists precisely because it does
not. It is asked on the **first `/` typed**, not on mount: nothing is on screen
until then, and a `claude` per composer that mounts would be a process for every
tab switch. The cost is one visible beat on the first `/` of a project, which is
why the menu draws while it is still empty and says what it is waiting for. A
menu that appeared only once the answer landed would read as a keystroke that did
nothing for a second and a half.

**`/` is narrower than `@` on purpose.** `@` opens anywhere a word can start,
because a mention belongs mid-sentence. A slash is punctuation in ordinary prose
— `src/main`, `and/or`, a URL — so a menu that opened mid-sentence would open on
almost every message about a file. It would also be _wrong_ to: the CLI only
reads a slash command at the head of a message, so a row offered in the middle
would insert text that runs as literal prose.

**Two commands are this app's, and everything else is the CLI's.** `/clear` and
`/rename` are about the conversation rather than about the code, and both are
things this app already owns. `/clear` in a terminal swaps the session the
terminal is attached to, and there is no terminal here to swap — sent as a
message it would be read as prose, and the transcript on screen, which is this
app's file rather than the CLI's, would still be full. `/rename` names a session
transcript the CLI keeps, while the name on screen is in the tab and in the
project's list. Everything else — `/compact`, `/context`, `/init`,
`/code-review`, every skill, every plugin's command — goes over verbatim, which
is both less code here and the only way those stay correct as the CLI changes
them.

The interception is in the **store's `send`**, not in the composer: the `Changes`
pane, a board card and the composer all send through that one door, and a
`/clear` typed into any of them has to mean the same thing. It is parsed from the
draft rather than from the menu's pick, so `/clear` typed in full and never
chosen from a row means what the row would have meant. The parse is deliberately
exact — `/clearly` and `clear the cache` are messages, and reading either as
`/clear` throws away a conversation nobody asked to throw away.

**`/clear` closes the session as well as emptying the lines**, and that is the
half that is easy to miss. A chat's id _is_ the CLI's session id, and `started`
on the record is what decides whether the next message opens a session or
`resume`s one. Wiping the transcript alone would leave a chat that looks empty
and answers out of the context it was asked to forget. So `WorktreeChats.clear`
closes the live session, drops `started`, settles any outstanding permission ask
for that chat — the card on screen is a promise the turn is awaiting — and writes
an empty file. What it does **not** do is make a new chat: the id, the tab, the
title and the options all stay, because what `/clear` means in the terminal is a
new context in the conversation you are in, not a different conversation.

**Some of what the CLI lists is not offered.** Three kinds, in `HIDDEN` in
`lib/worktree-chat/command-text.ts`: a terminal's own settings (`/color` sets a
prompt bar this app has none of, `/heapdump` writes to the Desktop of a process
that is not this one), controls this composer already has and would then have
twice (`/model`, `/effort` and `/fast` are the toolbar's model menu, and a
session's model moves through `setModel` rather than through a message; `/mcp` is
Settings › MCP), and the CLI's `__`-prefixed internals. Anything not named is
offered, so a plugin installed tomorrow is in the menu without a release — which
is the whole point of asking.

That list is **written down because it cannot be asked for**, and this is the one
place the design gives something up. The SDK marks terminal-bound commands in its
`init` frame, as `terminal_slash_commands`, and that frame is only emitted when a
turn starts. The control-channel ask deliberately never runs one, so no init
frame arrives — verified against the CLI: the message stream stays empty for the
whole call. The alternative was starting a turn per launch to learn something
that changes once a release, which costs tokens for a list of a dozen names.

A row is the command, its argument hint where it declares one, and its
description clamped to two lines — a skill's description is written for a model
and runs to a paragraph. A command is chosen by what it _does_, which is why the
description is the row here rather than a footnote under it as the `@` menu's
token estimate is. The two local commands are labelled `this app` on the row,
said rather than left to be discovered: somebody who knows what `/clear` does in
a terminal is owed the difference.

## The context window, and compaction

The composer's toolbar carries a **meter**: a short bar and a percentage saying
how much room is left in this chat's context window before it is compacted.
Beside it, in the transcript, a compaction shows as a **rule across the
conversation** — everything above it is something the model now knows only as a
summary.

**There is no percentage for compaction itself, and the meter is what replaced
wanting one.** This was asked twice and settled empirically rather than from the
type declarations: a real `/compact` driven through the SDK emits exactly two
frames — `{status: 'compacting'}` and then `{status: null, compact_result: …}` —
with nothing in between. No progress event, no token countdown, nothing. That is
because compaction is _one summarisation call_: there is no work for a fraction
to be a fraction of. A bar running 0→100 there would be a clock in a costume,
reaching 100% while the CLI is still working or stalling at 80% and jumping. So
the spinner stays a spinner, and the number went where a number can be honest.

**The meter counts down, not up**, which is the same reading the CLI's own
`Context left until auto-compact` gives. "13% used" is a fact about the past; the
question somebody has while typing is how much room is left before the
conversation gets summarised, and a meter should answer the question being asked
rather than the one that is easier to compute. The bar **drains** rather than
fills for the same reason — a bar growing beside a number shrinking would be two
readings of one window pointing opposite ways. `remainingOf` is clamped where
`fractionOf` is not, and the asymmetry is deliberate: "over the limit" is a real
state worth reporting honestly, while "minus eleven percent left" is not a state
at all.

Where auto-compaction is switched off the line stops counting down and says what
is used instead. A countdown to an event that will never happen is a promise.

**The window is measured, not counted, and the difference is a denominator.**
This app already tracked a context figure — `contextOf` in `claude-agent.ts`,
summed from a reply's own usage — and it could say `19.3k` and nothing else,
because a reply carries what it was billed and not the size of the window it was
billed against. `getContextUsage()` is the missing half: a control request over
the SDK's own channel, costing a round trip and no tokens, carrying `maxTokens`,
the auto-compact threshold and the split by category. It is the structured twin
of what `/context` prints.

Both are kept, because they are not the same measurement arriving twice.
`context` moves on every reply and is what ticks while a long turn reads twenty
files. The `window` lands **once a turn**, after the result: a control request
per content block would be a round trip for a figure nobody can act on
mid-answer. Neither is written down — the window describes the process the chat
is talking to, and a chat whose session has been closed for idleness has none
until its next turn. The meter is simply absent rather than drawn at zero, since
zero would be a claim about an empty window when the truth is that nobody has
asked yet.

**The bar is read against the auto-compact threshold, not the window**, and this
is the decision the whole feature turns on. On a 1M-context model the CLI
compacts at 967k, so a bar drawn against 1M sits calm right up to the moment the
conversation is summarised out from under it — the warning arrives after the
event it was warning about. `fractionOf` divides by whichever limit will actually
act, and falls back to the window where auto-compaction is off, which is also why
the detail line says `of 967k before auto-compacting` rather than `of 1M`: that
is the number somebody is counting down to. The CLI's own `percentage` is on the
record and deliberately not drawn, since it is rounded against the raw window and
would be a figure disagreeing with the bar beside it.

The breakdown behind the meter is the CLI's own categories. `Free space` is
dropped from it — it is the remainder and would be the largest row in almost
every chat, opening a list meant to answer "what is filling this up" with the one
thing that is not. Deferred rows are **kept but sorted last**: they are the
out-of-window tool schemas, listed and not charged, and "13.7k you are not paying
for" belongs beside the ones you are.

**The colours are the app's own.** The CLI sends one per category, but those are
its _terminal theme's_ names — `promptBorder`, `inactive`, `claude`, `warning`,
`purple_FOR_SUBAGENTS_ONLY` — which no stylesheet here can use and which carry no
meaning to map: two unrelated categories share `promptBorder`. So `readWindow`
matches on the category's **name** and anything unrecognised becomes `other`,
which draws in a neutral tone. That is the field most likely to move in a CLI
release, and an unfamiliar category then draws as a neutral band rather than
disappearing.

The compaction boundary is a **line**, unlike the two above, and it is on
`alwaysShown` in `lib/worktree-chat/activity.ts` — the strongest case of that
rule. Its whole meaning is _where in the transcript it sits_; folded into a run
of tool calls it would be a divider inside a fold, dividing nothing a reader can
see. `trigger` is kept because `auto` and `manual` explain different things: an
automatic compaction is why an answer above the line reads as though it forgot
something.

Every failure around the meter is swallowed on purpose. A CLI too old to answer
the control request, a session closed for idleness between the result and the ask
landing, a request that times out — all of them mean "no new number", and the
caller keeps the last one it had. A turn that worked must not report an error
because a decoration could not be refreshed.

## Explorer

The first of the four sections, and the only panel that shows the folders
themselves rather than something the studio keeps about them: the workspace's
directories, opened one level at a time, and a file opened into an editor.

**One tree: the files of the project being worked in.** Not one per project —
the list is the contents of a single directory, with no root row above it and
nothing else beside it (`shownRootOf` in `lib/files/roots.ts`, over
`activeFolderId` on `lib/projects.ts`).

The wider version came first and it is the wrong shape: every project as a
heading is a list to scroll past before reaching the files somebody actually has
open. The question a file tree answers is "the files of the thing I am working
on", and the thing being worked on is one place. It is the choice the dock's
Terminal already makes: one shell for the place you are in, not one per place
there is.

Clicking a project row in the column, or one of its chats, moves the tree, the
chat and the shell together, so the files beside a chat are the files it is
editing. A `⌘P` hit anywhere else switches the selection on the way to revealing
it, since the index walks every root.

### Closing it leaves the rail

**The column collapses to a 36px rail**, not to nothing: `collapsedSize` is
`RAIL_WIDTH` from `lib/store.ts`, and what stays against the window's
right edge is one button — `PanelRightOpen` — that brings the column back.

This is the dock's `DOCK_STRIP_HEIGHT` argument turned on its side, and it was
written against the same failure. The column is `collapsible`, so dragging its
handle past the minimum shuts it, and while it collapsed to `0` the only ways
back were `⌘B` and the View menu — neither of which is where somebody who has
just dragged a column off the screen is looking. A handle is a one-way door if
what it closes leaves nowhere to hold the way back.

**The rail is on screen whether the column is open or shut**, which is the part
worth arguing. A rail that only appeared once the column had gone would put the
button in a different place depending on the state it exists to change.

**It is positioned, not laid out** (`absolute`), and that was got wrong first.
The rail was a 36px flex column beside the tree — the honest way to build it,
and the one that made every panel around it pay: the tree lost that width on
every row of a list hundreds of rows long, for a button used at the top, and the
panel's `defaultSize` / `minSize` / `maxSize` all had to be written as "the
tree's own width plus the rail's". Out of flow those numbers go back to being
the tree's, and what is left to arrange is the single row the button lands on —
the tree's header, which carries a `pr-11` for it. The left column does the same
for its `Search` row.

The tree is **hidden rather than unmounted** when the column closes: it is what
watches the checkout's changes for the count on its `Changes` tab, and one taken
out of the React tree would stop watching and come back scrolled to the top. It
is hidden rather than squeezed to zero width, which is the other half of the
rail being out of flow: a rail in flow clipped what was beside it, and a
positioned one does not, so a column shut to 36px showed a sliver of the tree
behind the button.

### The flicker, and the two fixes that were not it

Closing a column left its rows lit in the rail for a beat before they went, and
the first two explanations were both about **render ordering** — plausible,
cheap to believe, and wrong.

The first was that the store hides the contents a frame before the panel
narrows, so hiding moved to the panel's own `onResize`; that only turned the
flash around, into contents clipped to 36px for a frame. The second was that
`collapse()` ran in a `useEffect`, which is after the paint, so it became a
`useLayoutEffect`. That one is a real improvement and is kept — the width and
the hiding now land in one frame, and the dock's identical call got the same
change — but it was not the bug either.

**What it actually was: `visibility` is a transitionable property, and
`Button` carries `transition-all`.** Every row in these columns is a `Button`,
Tailwind's default duration is 150ms, and a `visibility` transition is discrete
in one direction only — `visible → hidden` holds at _visible_ for the whole
duration and flips at the end. So the rows outlived the collapse by exactly
150ms, while `PROJECTS` — a header, not a button — went immediately.

**It was found by measuring rather than reasoning.** A screen recording taken
off the app, split into frames with `ffmpeg`, put the collapse on the frame it
was clicked and the rows on nine frames after it, vanishing in one step with no
fade. Nine frames at 60fps is 150ms, which named the cause outright; a render
one frame late cannot look like that, and neither of the two theories above
survived the first frame that was actually looked at. Two rounds of plausible
reasoning cost more than one recording would have.

So the contents are hidden with **`opacity-0` and not `invisible`**: opacity
does not inherit, so the children's own transitions never see it, and the box
it is set on has no transition of its own. `pointer-events-none` goes with it,
since an invisible box still takes clicks.

The hiding has **two sources**, and the pair is not belt-and-braces: the store
is what a _click_ changes, and a container query
(`@max-[100px]:opacity-0` under a `@container` wrapper) is what a _drag_
crosses, since dragging a column shut only reaches the store afterwards through
`onResize`. `100px` is anywhere between the rail and the panel's `minSize`.

The rail carries **only the toggle**, and not a vertical copy of `All files` and
`Changes` the way the dock's strip carries its two tabs. The dock's tabs are
there because a shut dock has no other way to be opened _on_ the tab you want;
the Explorer's two tabs are a hair apart in a header that comes back with the
column, so a second set of them in the rail would be chrome answering a question
nobody had.

The button is `h-9`, the height of the header it is over, and carries no border
of its own — the header's own bottom line runs the full width under it, and the
resize handle beside it is a 1px line in the same colour, so a border here would
draw one of them twice.

**The resize handle stays on screen** while the column is shut, unlike the
dock's, which is hidden when it collapses. There is an edge for it to be now, so
dragging is the second way back beside the rail's button.

**The left column's rail is the mirror of this one** (`project-rail.tsx`), down
to the `h-9` it sits in, so the two toggles are on the same line across the
window. It is on that column's **inner** edge — see The left column — and it is
_under_ the column's top strip, so the traffic lights sit in one uninterrupted
drag region whichever state the column is in.

**There is no bar above the list.** There was one — the project's name, the
branch on screen and a picker — and it went for the reason the panel's title
went: the left column already lists every project and marks the one selected, so
a strip repeating it was a row of chrome answering a question that was already
on screen. Which project a file tab belongs to is on the tab's hover line, and
the title bar's crumb says the same thing across the top.

What the bar carried is the **root's menu**, and that is now the right-click on
the empty space under the tree — the only part of this panel that is about the
project as a whole rather than about a file in it. It splits the way the bar
did: `New file`, `Refresh`, `Collapse all`, `Copy path` and `Reveal` act on the
project on screen, `Add folder` is the workspace's own, and `Rename` and
`Remove folder` act on the workspace's record of the project. The cost is known
and accepted: a tree long enough to fill the column leaves only the list's
bottom padding to right-click, and the way back is `Collapse all` or the File
menu. The root is read and watched without being a row — `FileTree` keeps its
path in `expanded`, which is also what makes `Collapse all` leave the tree
standing.

**The panel's header is two tabs: `All files` and `Changes`.** It was the word
`Explorer` and a row of buttons, which named the panel to somebody already
looking at it; the space is worth more as the way in to the other list this
panel has. After an agent's turn, "what has changed in this project" is often
the only question being asked, and it is now a click rather than a button that
opened a pane. `explorerTab` on `useStudio` is which one is showing, remembered
with the strip — it is a way of working rather than a fact about a project, so
it does not reset when the left column moves. The bar underneath — the project
and its branch — is shared by both, since both are about the same project.

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

The count rides on the tab: `Changes 12`, read for the project on screen
whichever tab is showing, which is the whole use of a number on a tab. Nothing
at all at zero, or before the first read.

**The list is here; the diff is the tab it opens.** `changes` is a `Pane` of its
own (`changes-pane.tsx`, `lib/files/changes.ts`), one per project, whose **id is
the root's** — so `rootOf` is the identity function and the tab is in the strip
exactly while that project is the one being worked in. A row picks a file and
that tab shows its diff, so a turn's twelve changed files are twelve clicks and
one tab.

That last sentence is the whole of why the list is allowed back into a sidebar.
It stood as a `Files | Changes` toggle on this panel once and the click is what
moved it out: a sidebar row opened a **file tab**, so reading twelve changed
files left twelve tabs to close afterwards. Then it was the pane's own left
column, which worked but put the list somewhere that had to be opened before it
could be read. What is not allowed either way is the list in both places at
once — one question answered twice, which is the thing this app keeps deleting
(the Terminal sidebar's second folder list, the assistant panel beside a
project's chat) — so the pane holds the diff and nothing else.

**The rows are a folder tree, the shape a pull request is read in everywhere
else, and that is a reversal.** Each row was one line — the directory dimmed,
then the file's name in its git colour — on the argument that a turn's changes
are a dozen files scattered through the checkout and a tree of them would be
mostly folders. Two things settled it the other way. A dozen is the small case:
after a long turn the column is twenty rows that all begin
`src/renderer/components/studio/`, and the question actually being asked —
_which area did this touch_ — has to be reassembled by eye from prefixes,
which is exactly the work a tree does once at the top. And the directory was
the part that gave way when the column was narrow, so the answer was truncated
first. The rest of the panel is unchanged: a file row is still the name, the
state's letter and `+112 −8`, and it still opens the checkout's one diff tab.

`lib/files/change-tree.ts` builds the rows and is pure, with
`test/change-tree.ts` on it. **A chain of single-child directories is one row** —
`src/renderer/lib/files` rather than four levels of indentation buying nothing,
which is what GitHub does — and the fold stops at any directory holding a file
of its own, or that file would lose the level it sits at. Node ids are relative
and `/`-joined and are keys, never paths: the folders in this tree exist only
because some file's path passed through them, git named the files, and this
renderer builds no paths at all (`lib/files/paths.ts`). Only the file rows carry
git's absolute path, which is the only thing that goes back over IPC. A path
from outside the checkout stays whole as one top-level row rather than being
split into folders it is not in. Directories sort before files, which is not
git's own order — that is by path, so `src/a.ts` would come between two folders,
and a folder between files is a folder that gets missed.

A directory row folds, carries its descendants' counts added up, and stages,
unstages or discards **everything under it** — one click on a folder rather than
nine on its files, which is the thing the tree buys beyond legibility. It is
drawn in the panel's own muted text rather than in a git colour: a folder
holding an added file and a deleted one has no single state, and picking one
would be the row asserting something git did not say. What is folded is stored
as the **shut** ids, not the open ones, so a pile just opened shows every change
in it — the files are the point here, unlike in `All files`, where a checkout
has thousands. A wholly untracked directory (`change.directory`) is a **leaf**,
not a folder to open: git named one path and never listed what is under it, and
the row still goes to `All files`.

The counts come from `git diff --numstat` against
`HEAD`, except for an untracked file, which is in no diff at all and so is
counted by being read — under a cap, since an untracked directory of generated
output is not worth reading and a minified bundle is one line and twelve
megabytes (`MAX_COUNTED_NEW_FILES` in `main/git.ts`). Where there is no honest
number the row shows none: a binary file, a file past the cap, a repository with
no commit yet. Nothing ignored is listed — those are what the tree greys, and
they are not anybody's changes.

**A wholly new directory is drawn as one.** Git reports it as a single entry —
`?? public/images/building/`, the same shape that keeps `node_modules` from
being a hundred thousand rows — and drawn like every other row it read as a file
with no counts, which is a row that says nothing about the twenty new files
under it. It carries a folder glyph and a trailing separator now, and it is the
one row in this list that does **not** open the diff tab: there is no diff of a
directory, and the row used to open the pane on a path that is not a file and
leave it blank. It goes to `All files` instead, revealed and opened, which is
where a directory's contents are.

### Staging, discarding, and where this stops

**The list stages and discards; it does not commit.** Both writes went out with
the working-tree panel and both came back here, which is a reversal worth
recording. The argument for keeping them out was that the studio is not a git
client — and it is not — but the Changes list is what somebody reads straight
after an agent's turn, and the sentence being said at that moment is "keep this
one, throw that one away". Every other panel lets somebody act on the thing it
is showing. This one made them go to a shell to act on rows they were already
pointing at.

Committing stays out, and the line is not arbitrary: staging and discarding are
answered by pointing at rows, and a commit is a sentence somebody writes. The
dock has a shell in the same folder one click away, so stopping here is
stopping exactly where the shell is better — rather than growing a message box,
then an amend, then a log, then a second and worse git client.

**The index is no longer collapsed in this list, and still is in the tree.**
Porcelain's two columns are the index against `HEAD` and the working tree
against the index; the tree keeps reading them as one state, because a row there
has nothing useful to say beyond "changed and not committed" and forty rows of
staged-versus-not is a tree nobody reads. The list cannot, because staging is
done from it — so it has a `Staged` pile and a `Changes` pile, and **one path
can be two rows**: a file staged and then edited again is both, with each row
carrying its own side's counts (`--cached` for the first, a plain `git diff` for
the second). Summing them would be the number for neither. Each pile has a
heading whenever it has anything in it, carrying its count and its own actions.
The tab's number counts **files**, not rows.

**The actions are on the row, under the pointer** — `+` to stage, `↩` to throw
away, `−` to unstage, and the same three on a pile's heading for the whole pile.
This is the Source Control gesture, and it is here because it is the one
somebody arrives already knowing. It cost an argument twice over. A row is a
`<button>`, and a button inside a button is dropped by the browser — the same
wall the rename field ran into — so the buttons are a **sibling** of the row,
positioned over its right-hand end, where the state letter and `+112 −8` turn
`invisible` to make room. `invisible` rather than `hidden`, or the row's width
would change under the pointer and the name would reflow as the cursor arrived;
and `pointer-events-none` while they are transparent, or an invisible button
would swallow the click meant for the row. They answer to `focus-within` as well
as to `hover`, so Tab reaches them.

The right-click menu is the fuller way and stays: it carries `Copy path`, it is
what a row reached by keyboard has, and `Stage all` / `Unstage all` /
`Discard all changes…` are on it as well as on the headings. Those are repeated
on a row's menu deliberately — a list long enough to want `Discard all` is one
with no empty space left to right-click.

The heading was the one thing conditional on state, and that is what settled its
own argument. `Changes` inside the `Changes` tab is the panel's name said twice,
so the headings were drawn only once something was staged — until they became
where `Stage all` lives, at which point a heading that appears in some states is
an action that appears in some states. Both are drawn whenever their pile has
rows.

**Both piles fold, and both arrive folded.** A checkout opens as two counts —
`STAGED 3`, `CHANGES 12` — and a pile's rows are drawn once its heading is
clicked. The whole heading is the toggle rather than the chevron alone, since a
12px target is not one; that makes it a `<button>`, which keeps the pile's own
actions a positioned sibling for the same reason a row's are. Those actions stay
reachable while folded — `Stage all` is the one thing wanted without reading the
rows first. The state is the list's own and per pile, not remembered across a tab
switch: there are two piles, so re-opening one is one click.

**Discard means back to `HEAD`, both sides.** Not "the working tree back to the
index", which is a second, similar thing to explain and would leave a staged
copy of what was just discarded. Whichever of a file's two rows the menu was
opened on, the file ends up as `HEAD` has it. A file `HEAD` does not have — a
new file, or where a rename landed — cannot be restored from it, so discarding
that one is taking it out of the index and moving it to the **trash**, never
`unlink`: the studio has no undo of its own, which is the same promise the
Explorer's Delete makes. `discardAll` is built on the same path-by-path work
rather than on `git reset --hard`, which would be one command and wrong twice —
it leaves untracked files exactly where they are, which are the ones an agent's
turn most often adds, and it deletes tracked ones past any trash. A rename is
restored whole: porcelain reports the source as a second record, and discarding
the destination without putting the old name back leaves a working tree in a
state nobody asked for. It is the one action in this panel with a dialog in
front of it, and the dialog says which files go back to the last commit and
which go to the trash.

The writes are gated **twice**. `ipc.ts` checks every path against the
workspace's folders, the same gate the eight `files:*` calls pass through, and
`main/git.ts` then refuses anything not under the folder it was handed — so a
path inside another of the workspace's folders cannot be staged into this one's
repository. Nothing is optimistic: what a `git add` did to a `MM` file is git's
answer to give, so all three writes end by re-reading the list, the tree's
colours and the listings the paths were in.

Its list is read for the **one project on screen**, unlike the colours, which
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

CodeMirror's merge view, and **both sides are read-only**. A diff is a thing to
read: two columns, one of them a commit, with the caret stepping between
versions of the same line. The right-hand side was editable for a while, because
it genuinely is the file — and what that bought was a pane whose left half
refused every keystroke while its right half took them, in a view nobody had
opened in order to type. Editing is the `Edit` half of the toggle in the header,
which is one click away and the same buffer.

The right-hand side is still **the file** and not a copy: the same path-keyed
buffer the text editor uses, which is what makes the diff show unsaved edits
rather than what is on disk, and what makes switching to `Edit` keep the buffer
and its undo history. ⌘S saves from here too, since the buffer can be dirty from
the other view and the key is muscle memory rather than a property of the pane
it was pressed in — claimed by `changes-pane.tsx` on the window rather than by
the editor, because a genuinely non-editable CodeMirror view holds no focus to
bind a key on. (Monaco's read-only diff was still focusable and took the key
itself; this is the one place the change of stack moved a behaviour rather than
kept it.) More than one editor can hold that buffer at once — a file open as a
tab while the `Changes` tab shows its diff — which is what
`lib/files/documents.ts` exists for: it counts holders, drops the buffer at
zero, and forwards a change made in one view to every other view on the same
path. Before any of that, whichever editor unmounted first took the buffer out
from under the other. The left side holds `git show HEAD:<path>`, the content of
a commit, and belongs to nothing.

**Where the changed lines come from is git, not CodeMirror.** For a long time
the pane handed the merge view two texts and let it work out the difference, and
that was fine to look at and quietly wrong to reason about: the `+`/`-` counts
beside the row in this same list have always been `git diff --numstat`, so the
list and the pane were two algorithms answering one question. They agree on
almost everything and disagree exactly where it is hardest to notice — a moved
block, a file whose every line changed, whitespace. A studio that says `+12 −9`
on a row and then draws eleven bands is a studio nobody can use to check
anything.

So `main/git.ts` also answers `git diff HEAD --unified=0` for the path, and the
renderer reads the changed ranges off the `@@` headers
(`lib/files/git-diff.ts`). `--unified=0` because nothing here reads context: with
no context lines a hunk header **is** the changed range. `HEAD` is named
deliberately, unlike in `numstat`, because the left-hand side on screen is the
commit — a patch that stopped at the index would describe a pair nobody is
looking at.

The seam that makes this cost nothing is `DiffConfig.override` in
`@codemirror/merge`: the package funnels every diff it computes through one
function, and everything built on the result — the chunking, the folded
unchanged bands, the gutters, the review column, both layouts — is the same code
either way. **Not one line of the view changed.** The ranges still go through the
package's own `makePresentable`, so changes a line or two apart still merge into
one band rather than becoming one band per `@@`; the pane looks exactly as it
did.

**Git's patch is a hint and not a promise, and that is the whole of the design.**
The override has to answer synchronously and git does not, so the patch is
fetched alongside the committed text — one IPC call answering both, since the
pane draws nothing until it has both and two calls would be two waits for one
paint — and it describes exactly one pair of texts. Two things routinely make it
describe some other pair: git reads the file **on disk** while the pane's right
side is the shared buffer, which may hold edits nobody has saved; and the
extension calls the override again on **substrings** of the two documents when a
chunk is recomputed. Rather than enumerate the ways a patch can be stale — a
line-ending filter, a `diff=` driver, a file written between the read and the
diff — the ranges are checked against the two texts, and the check is total: a
list of changed ranges describes a pair of texts **if and only if everything it
leaves unchanged is equal in both**, which is a walk of the gaps between the
hunks. If any gap disagrees the whole patch is dropped and the merge view's own
algorithm runs, unchanged. A partly-trusted patch would draw a diff that is
quietly wrong, which is worse than the thing this replaced.

What that costs, honestly: a file with unsaved edits is diffed by CodeMirror
again, because there is no patch for a text git has never seen. Binary files, a
repository with no commits and an untracked file all fall down the same path,
which is the one they were already on.

A **deleted** file is the case worth naming: it has no row in the tree, it is a
row in this list, and its diff is the whole of it removed. So the diff is drawn
ahead of the "could not open this file" notice, with the left side committed and
the right side empty. There is nothing to special-case about it any more — the
store holds no text for such a file, and a read-only diff was never going to
hand it any.

**The path in that header is relative to the project**, with the absolute one
on the hover line. A repository somewhere deep under `~` spends the first
forty characters of its absolute path saying nothing about the file before it
reaches
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

Choosing between them **rebuilds the view**, because side by side and inline are
two different constructions rather than one widget with a flag: `MergeView`
against the `unifiedMergeView` extension. Under Monaco it was an `updateOptions`
that also had to turn `useInlineViewWhenSpaceIsLimited` **off** — Monaco
second-guessed `renderSideBySide` by falling back to the inline view below a
width threshold, which is the right default for a setting nobody set and the
wrong behaviour for a button somebody just pressed, and is what made the first
diffs in this panel come out unified in a pane a shade under 900px. That clause
has nothing left to guard against and is gone. Whitespace is now all or nothing
(`highlightWhitespace`) where Monaco drew the marks inside a selection: there is
no selection-scoped equivalent, and somebody who turned the toggle on to find a
stray tab wanted all of them anyway.

**A review is left on the diff, and stays there.** Reading a turn's work is where
the remarks happen — "this leaks", "wrong error path", "rename this" — and before
this they had to be retyped into a chat with the file and the line named by hand,
which is both the tedious part and the part that goes wrong. So the `Changes`
pane takes them where they occur: a `+` in a column against the code picks a
line — **held down and dragged** for a range, the way a forge does it, with
shift-click as the second way — a box **floating against those lines** takes the
remark, and the thread it opens is drawn **under the lines it is about**. What is
left in flow is one bar: how many comments the checkout has, and `Discard`, which
is the only thing that can say a review exists in a file that is not open.

**`Ask AI to fix…` is gone**, and with it `reviewPrompt` and its tests. It opened
a chat in the project with the whole review written into its composer, unsent —
the ellipsis meant exactly that, since a prompt assembled out of eight remarks is
the kind that wants a sentence added to it before it goes. What it was really
saying is that a review's _destination_ is a chat, and that a comment is a
half-written message on its way somewhere else. It is not: a comment is a thing
said about a line, and `Ask Claude` on the thread answers one where it was
asked, which is what somebody actually wanted the eight-remark prompt to do.
Handing the whole review over in one go is still a thing somebody may want, and
it is now three words in any chat — the diff is right there. What is not is a
button whose only purpose was to move a review out of the pane it belongs in.

The chat composer's `drafts`, which that button seeded, are **not** removed: they
were fixing something that was already wrong on their own account. The field held
one local `useState` and the pane was never keyed, so a half-written message
followed you into the next chat you clicked and sat under its own field. It is
keyed by the chat now, the field hands back what was in it on the way out
(`onLeave`), and `create` takes a draft and writes it in the same `set` as the
chat — the composer reads it as its _initial_ value, and one arriving a render
later would arrive after the field had been built empty. Initial rather than
controlled, because a value round-tripped through a store on every keystroke
would put the mention menu's caret bookkeeping behind a render it does not
control.

**A comment is a thread, not a line of text**, and that is the shape rather than
a feature: a remark on a range is answered, argued with and added to, the way one
on a pull request is. So a range holds _notes_, each with an author, and `Reply`
adds one. Which is also what makes the next thing expressible without a
migration: an **agent** asked to review the diff leaves threads of its own
(`author: "agent"`, opened through `comment` rather than through the composer),
and answering one is the same reply. Nothing in `lib/files/review.ts` would
change for it, which is the reason it is built this way before there is anything
to build on it — retrofitting an author onto a flat string is a migration, and
there is nothing yet to migrate. In the prompt, a thread with one note is that
note unattributed and a thread with several is the exchange with each line
labelled `Reviewer` or `Assistant`: naming an author in a conversation with one
voice is noise, and who said what is the whole content of a disagreement. `lib/files/review.ts` is the
store and the prompt; `lib/files/review-marks.ts` is the column;
`review-panel.tsx` is the strip.

Seven things about its shape were decided rather than fallen into — one of which
has since been decided the other way, and is left here with its reasoning because
the reversal is only legible beside it:

- **The picker is a gutter, not the code.** Both sides of this diff are genuinely
  read-only, so nothing in the content area holds focus or reports a selection,
  and the browser's own selection there is what somebody uses to _copy_ a line. A
  mousedown handler over the code would have to guess which of the two every drag
  was. A click in a gutter is never anything else.
- **The range is painted while it is dragged; the box opens when the pointer is
  let go** (`settled` on the pending range). Drawing the box on the way down took
  height off the diff mid-gesture, which moved the rows out from under the
  pointer that was still choosing them. The drag itself is followed with an
  anchor rather than by growing what is there — `stretch` against `pick`'s
  `extend` — because a drag that turns back has to shrink, and a range grown from
  itself can only ever get bigger. **The drag is followed on `window` rather than
  on the column**, and that is not a detail: the column is 22px wide, and the
  hand pulling a range down goes _through the code_ — which is the thing being
  chosen. So the row comes off the pointer's Y through `lineBlockAtHeight`, the
  same way a gutter's own handlers resolve a line, and the X is ignored; a drag
  that leaves the editor entirely keeps working, and one clamped past either end
  stops at the last row on screen rather than scrolling the diff under a held
  pointer. Only a row crossed changes the range, since each change is a store
  write, a render and a transaction. It is finished on a `window` `mouseup`, since
  the button is regularly let go outside the column it was pressed in.
- **The remarks are in the pane's own bar, not in the diff** — which is what this
  shipped as, is no longer true, and is the decision worth reading in full because
  it went round twice. The threads _were_ CodeMirror block widgets under the lines
  they were about, which is where a forge draws them, built from plain DOM because
  a React root per thread would be mounted by a view that rebuilds on every file,
  layout and theme change and measured before React had committed anything into
  it. They came out to a list at the foot of the pane on a plainer argument: a
  diff with three comments in it is a diff pushed apart in three places, and the
  code around a remark is the thing somebody is reading. Both halves of that were
  true and it was still the wrong trade — see the bullet below.
- **Only the new side** — which is what this shipped as, and is no longer true
  twice over. The reasoning was that a comment's line numbers are the working
  file's, because those are what an agent can open the file at, and a removed line
  is a block widget with no line in the file to point at. Deleted code turned out
  to be half of what a review is about ("this was load bearing", "why did this
  go"), so a comment on one is numbered in the commit and says so; and a range can
  now cover both at once. See the two bullets on `ReviewAnchor` below.
- **The quoted lines are captured when the thread is opened**, not resolved when
  it is sent. Lines move — a fix to the file above this one is enough — and a
  snippet read later would quote something the remark was never about. Capped at
  `SNIPPET_LIMIT`, with a line saying how much was left out, since a prompt that
  stops mid-function reads as the reviewer having meant only that much.
- **The column is in this pane's diff and nowhere else.** `reviewRootId` is a
  root id rather than a flag, and only `changes-pane.tsx` passes one — the `Diff`
  half of a file tab's toggle is the same component without it. A `+` in every
  diff in the app would be offering a review with nowhere to submit it.
- **A review is a sitting, not a record** — which it no longer is, and the
  reversal is worth reading beside the reasoning it overturns. Nothing was written
  to disk, on three legs: a review was _for_ the chat at the end of it, anything
  worth keeping was in that chat, and a comment read back a week later would point
  at line numbers that had since moved.
  The first two went with `Ask AI to fix…`. There is no chat at the end any more —
  a comment is answered in its own thread — so nothing was keeping a review, and
  closing the window lost an afternoon of reading. The third leg was the real one
  and is now **answered rather than ignored**: a thread is addressed by the
  **lines it quoted**, not by its numbers. The snippet was already stored, for the
  prompt, and turns out to be the durable address. `settle` re-anchors a thread
  the first time its file is shown — which is the one moment both the commit and
  the working buffer are to hand — in three steps whose order is the point: the
  lines are still where they were (leave it, and hand back the _same object_, so
  the common case re-renders nothing); they are somewhere else in the file (move
  the anchor); they are gone, or they now appear twice (mark it `stale`). Never
  delete: a remark whose code has gone is still something somebody said, and often
  the most interesting thing in the review. It is drawn as **outdated** and tints
  no rows, because the numbers it holds are the ones it was written with and
  marking whatever sits at them now would be pointing at the wrong code.
  A run that appears twice is refused for the same reason it is worth having the
  rule at all — moving to the first of two identical `}` lines is a comment
  quietly reattached to the wrong code, which is worse than saying nothing.
  The threads live in `workspace/review.json`, one file for the workspace the way
  the board's cards are, which is why `ReviewThread` and everything under it moved
  into `shared/api.ts`: main is the one writing them now. Writes are **debounced**,
  unlike the board's, because this store is written to by a _drag_ — every row a
  range crosses is a `set`.
- **A conversation can be resolved**, the way a forge's can, and the word is
  chosen for what it does not mean: not deleted, not hidden, not moved. A
  resolved thread folds to **one line on its own lines** — `Resolved`, how many
  comments, the file and range — and opening it gives back the whole exchange
  and a `Reopen conversation` beside the reply field it was settled from.
  Deleting it is still `X`, which is the destructive one and still on hover.
  Why keep it at all, when `Delete` was already there: a remark that was dealt
  with is the record of _how_ it was dealt with, and the argument in the thread
  is usually worth more than the remark that started it — `Delete` is for a
  comment that should never have been written, and resolving is for one that
  worked. What resolving buys is the two things a long review runs out of: the
  **height** (a diff worked through can be read as a diff again) and the
  **count**. Every count in the app is of the open threads (`openThreads`) —
  the bar under the diff, the badge on a row of the Changes list — because a
  count is read as _how much is left_, and a review whose every remark has been
  answered should say so rather than still claiming twelve. The settled ones are
  said beside it (`3 comments · 5 resolved`) rather than folded in, since a
  number that disagrees with the diff under it is worse than two numbers.
  `resolved` is **absent on an open thread** rather than `false`, so every
  review already on disk reads as open and nothing migrates; the field is a set
  rather than a toggle (`resolve(id, boolean)`), because the two ends are two
  different buttons and a toggle lets a stale render settle what somebody had
  just reopened. Whether a folded thread is showing is **not** on the store and
  not written down: it says nothing about the review, and a thread unfolded to
  be read should fold itself again the next time the pane is built.
  Hiding resolved threads outright — a `Show resolved` switch on the bar, which
  is what a forge does with a long conversation — was considered and left out:
  the threads are drawn _in the diff_ here rather than in a list, so a folded
  one costs a single row where a hidden one costs a control, a piece of state
  and a way to lose a comment somebody is looking for.

#### What the first version of it got wrong

Three complaints, all of them about the distance between where a remark is
_thought_ and where it can be _written_, and all three answered without giving
back the thing the block widgets were taken out for — a diff pushed apart in as
many places as it has comments.

- **The offer to comment appears on the row, not in the column.** The `+` was
  revealed by a CSS `:hover` on a 14px gutter cell laid over the sign column,
  which meant a reader who had not been told the column existed found it by
  sweeping the pointer through it, and one who had still had to aim. It is now
  put up by `hoverRow` in `review-marks.ts` — editor state, set from a
  `mousemove` on the editor's own DOM — so it appears while the pointer is on the
  **code**, which is where it already is. That costs a transaction per row
  crossed, which is what the CSS was avoiding; it is the rate a drag already
  dispatches at, every other row's marker is `eq` to what it was so one cell
  redraws, and the dispatch is skipped when the row has not changed. It also has
  to be state rather than `:hover` for a reason CSS cannot reach: a removed chunk
  is **one** gutter element holding twenty rows, so a selector can light the slot
  or nothing, and which of the twenty the pointer is on is arithmetic.
- **The composer is against the lines, and is still not in the flow.** Picking a
  range at the top of a diff and then typing about it in a strip at the foot of
  the pane is the single thing that made this tiring: the eye and the focus both
  travel, and the code the remark is about scrolls out of the sentence being
  written. The box is now `position: fixed` over the diff, hung below the range
  where there is room and above it where there is not. **Positioned, not laid
  out** is the whole of why this is affordable where the widgets were not —
  nothing in the diff moves for it, and there is only ever one of these, only
  while somebody is typing into it. Where it goes is `spot` on the review store,
  pushed by `codemirror-diff.tsx` and re-pushed while the diff scrolls, since a
  range scrolled out from under its box is a box pointing at nothing. The
  rectangle is **measured off the DOM** rather than computed from line numbers,
  and that is deliberate: a range on the new side is a run of document positions
  `coordsAtPos` would answer, but one on the old side lives inside a
  `@codemirror/merge` block widget where there is no position to ask about. Both
  sides already carry a class saying they are pending, so one query is right for
  both by construction. In a split diff exactly one editor reports, or the one
  with nothing pending in it would answer null over the top of the one that
  measured it. The strip's own copy of the box is **kept** rather than deleted,
  for the range that is on screen nowhere — picked and then scrolled past.
- **A range may cover both sides of a hunk**, which reverses "only the new side"
  above and the "one side or the other and never both" that replaced it. The
  argument for the old rule was sound as far as it went — the two sides are
  numbered in different files, and a pair of numbers cannot be in two — and it was
  the wrong thing to build the _shape_ around. What somebody selects in a unified
  diff is a hunk: the `-` lines and the `+` lines that replaced them, which is one
  thought, and the most common thing in a diff to have an opinion about. Refusing
  it meant two comments each saying half a remark. So a comment's address is a
  `ReviewAnchor` — a run of the commit's lines, a run of the working file's, or one
  of each — and `side`, `fromLine` and `toLine` are gone from both the thread and
  the pending range. There was no migration to do: **a review is a sitting, not a
  record**, so nothing on anyone's disk had the old shape. In the prompt a hunk is
  quoted **twice, labelled** `Removed` and `Now`, never in one fence: half of what
  is quoted is in the file and half is not, and running them together is the exact
  mistake the deleted-side heading has always existed to stop.
- **Which rows a gesture covered is worked out by the editor, not the store**, and
  that is what fixed the selection feeling unreliable. The old drag took the row it
  started on and the row it was over and did min/max — so a drag that crossed into
  the other side was _ignored outright_ (the range froze while the pointer kept
  going, which reads as broken rather than as a rule), and one that crossed a
  folded bar froze the same way. `spanBetween` in `review-marks.ts` now walks the
  heights between the two ends and folds every row it finds through `withRow`. It
  **samples at half a row** rather than enumerating `viewportLineBlocks`, and that
  is the point rather than a shortcut: the samples go through `rowOf`, which is the
  same function the press itself used, so the range is guaranteed to contain the
  row that was clicked. A walk that re-derived what a block means is where the old
  version's two answers came from. Every row is at least `DIFF_ROW_HEIGHT` tall —
  that is what pins the removed chunks' arithmetic — so nothing can be stepped over,
  and both ends are sampled exactly so a one-row gesture is one row. A folded bar
  contributes nothing and the walk passes over it, which is what dragging across a
  fold looks like everywhere else.
- **The band over the picked rows is a box-shadow, not a background**, and the
  reason is a rule this pane cannot outrank. `diff-chrome.ts` paints
  `.cm-changedLine` with `!important`, and it has to —
  `@codemirror/merge`'s own base theme competes with it at the same specificity,
  so without it a removed row came out with a red `-` column and brown code. But
  `!important` beats any specificity the review's own theme can reach, so a
  `background-color` band lost on exactly the rows a review is most often about:
  a range dragged across a hunk was tinted on its context lines and bare on its
  added ones, which reads as the selection being cut in half rather than as one
  band. An inset shadow with a spread big enough to fill the row paints **over**
  the row's own background instead of competing with it — which is what this
  wanted anyway, since a line being picked is still an added or a removed line.
  The edges are listed before the wash in every rule, because earlier shadows
  paint on top.
- **A removed chunk's columns state their geometry**, and the bug that made this a
  rule is worth keeping. A removed chunk is **one** gutter element however many
  rows it draws, so every column beside it has to line up with rows that a
  different piece of code laid out. `.cm-diffRemovedCol` was `display: block` and
  nothing else, which left two things to chance — where the column sits inside a
  slot taller than its content, and how tall each row is — and the visible result
  was the `−` signs drawn a whole row below the lines they belonged to while the
  numbers beside them were right, because a number cell and a sign cell resolve
  their line boxes differently. The review's own column never had it, and that is
  the tell: `.cm-reviewRemovedCol` has always carried `alignSelf: stretch` and an
  explicit `height` per row, so in the same slot its marks lined up beside signs
  that did not. `.cm-diffRemovedCol` carries both now. Anything drawn against a
  removed chunk should: `line-height` alone is a guess about the glyph.
- **The shift-click anchor is tracked now**, where it deliberately was not. Growing
  whatever was pending is what a reader means by shift-click when a range is a pair
  of numbers in one file; a range that can cross sides has no such thing as
  growing, because which rows are in it depends on where the run _started_. So the
  press records its height in **document** coordinates — client coordinates would
  name a different row after any scrolling in between — and a later shift-click
  spans from there.
- **The threads went back into the diff**, under the lines they are about, and the
  argument that took them out is answered rather than forgotten. A diff _is_
  pushed apart at a comment — but at a comment, which is where somebody is already
  looking, and nowhere else. What the strip cost was worse and less visible: a
  remark four hundred pixels below its code is read with a finger on the screen,
  and a list with its own scroll made coming back to what you had already said a
  hunt through a second scrollable thing. The thing the list was supposed to buy —
  "a thread in a file that is not on screen is still readable" — turned out to be
  worth almost nothing, because a thread is read _while looking at its lines_; what
  is genuinely wanted from off-screen is only the knowledge that comments exist
  elsewhere, and that is a count in a one-line bar.
  That bar counts **threads**, and `noteCount` was deleted for it. Summing every
  note was right while the bar was the header of a list of notes — "a thread with
  three replies is three things said" — and stopped being right the moment the
  list went: what the bar answers now is _how many places have a remark on them_,
  and a thread argued with three times is one place to go and look. Counting notes
  also had a result nobody would defend out loud, which is that asking Claude a
  question made the review look bigger, since its answer is a note like any other.
  What makes it affordable this time is `lib/files/review-hosts.ts`. The node a
  thread is drawn in belongs to neither side: the widget's `toDOM` hands the same
  node back every time, so a view rebuild _moves_ it rather than replacing it, and
  React reaches it with `createPortal` — so a thread is still a component with a
  reply box, a spinner and an error line, which is what the plain-DOM version could
  not afford. It also settles which threads are drawn without anybody deciding: a
  thread in a file the pane is not showing portals into a node nothing attached, so
  nothing renders and nothing errors. Gone with the strip: the thread list, its
  scroll, and the heading that was a button opening the file a thread is about —
  a control that navigates to where you already are.
- **A thread is drawn the way a forge draws one**, and the reason to copy that
  layout is not fashion: it is what anybody who reviews code already reads without
  being taught. A bordered box between two runs of code; one block per thing said,
  each headed by **who said it**; hairlines between the blocks; and a `Reply…`
  field at the foot. Three things the earlier card got wrong come out of it. A
  glyph beside the text left _who_ to be inferred from an icon, and a review with
  a reviewer and an agent in it is a conversation, which needs names. Spacing
  between notes made three remarks read as one paragraph with gaps, where a
  hairline makes them three. And `Reply` was a button revealed on hover — a
  control nobody can see, guarding the single most common thing to do with a
  thread; it is a one-line field now, collapsed until clicked, which is the trade
  a forge makes: present, without spending the height of a form. What is kept that
  a forge has no need of is the **file and line**, because a hunk's
  `12–14 (was 8–9)` and the `deleted` mark carry what the box's position on screen
  cannot say; it goes where a timestamp goes.
- **A commented range is drawn as the same band as a picked one**, at the same
  strength, and the speech bubbles are gone. Every row of a commented range used to
  carry a filled bubble, which put a column of solid glyphs down a pane whose
  whole job is showing code — and covered the `+`, so the one row that could not
  offer to be commented on was a row somebody had already commented on. The band
  says the same thing with no glyphs, in the vocabulary the reader has just used
  to pick the range: one word rather than two. The `+` now appears on hover over
  any row, commented or not, because this column has one job and it is offering to
  add a remark; that a line carries one is the band's business.
  It was drawn a shade quieter at first, on the reasoning that a range already
  commented on is a state of the file while a range being picked is something
  happening now. That is backwards: a picked range lives for as long as a drag and
  arrives with a handle on its end and a composer floating against it, where a
  commented one has to be _found_ by somebody scrolling a diff looking for what
  they have already said — and it was the fainter of the two. One band, one
  strength; what tells "now" apart from "marked" is the handle and the box. The
  two keep separate class **names** for one appearance, grouped in the theme,
  because `spotOf` finds the picked range by querying those classes and a
  commented row sharing them would anchor the composer to the union of everything
  marked in the file.
  The ends of a commented run come from the **set** of commented lines — a row
  whose neighbour on this side is not commented is an end — rather than from
  anything stored on the thread. That is exact within a side, and costs one thing
  against `pending`, which carries its ends: a comment covering a whole hunk draws
  as two touching bands with a hairline where the deleted rows meet the ones that
  replaced them. A field on the record would close it and is not worth having for
  a rule nobody would notice was there.
- **A block widget has to declare itself**, which is a bug worth keeping: `isHunkBar` in `diff-chrome.ts` identifies a
  collapsed region **by elimination** — "this configuration has exactly two kinds
  of block widget, so not being a removed chunk is being a collapsed bar" — which
  was exact until the review added a third. Every gutter then drew the expander
  beside each thread, a control that would have tried to uncollapse a region that
  is not there. A widget now carries `FOREIGN_WIDGET`, a symbol exported from
  `diff-chrome.ts` and read off `BlockInfo.widget`, and anything else adding a
  block widget to a diff has to carry it too. The symbol goes that way round
  because the import cannot: `review-marks.ts` already reads that file, and that
  file has no business knowing what a review is.
- **`Review` is a turn per changed file**, and what comes back are **comments**,
  not a report. That is the whole of the idea: a review returned as
  prose is a review somebody reads and then re-enters as remarks, which is the
  tedium this pane exists to remove. So a turn answers with a fenced JSON array
  of findings — a path, a line range, a sentence — and each one becomes a thread
  with `author: "agent"`, on the lines it names, answerable and deletable exactly
  like one somebody typed. The author was in the store from the day it was
  written, for this, which is why nothing about its shape changed to allow it.
  Three things are decided rather than fallen into. The patches are gathered by
  **main**, not fetched by the turn: it has no shell, `git` is not something a
  read-only tool list can reach, and this app already knows how to ask. What the
  turn does for itself is _read the files_, which is the part a `--unified=0`
  patch cannot give it. The findings name the **working file's** lines only —
  nothing turning a patch into a position has the commit's text to hand, and a
  remark about a deletion belongs on the lines that replaced it. And
  `findingsIn` is **defensive without being repairing**: the fence is looked for
  first and the outermost brackets second, but a finding missing a field or naming
  a line that is not a number is _dropped_, because the cost of guessing is a
  comment pinned to the wrong line and the cost of dropping is one remark. `null`
  means nothing there was JSON at all and is said out loud; an empty array is a
  real answer — the change is sound — and reads as one.
  **The split into a turn per file is a reversal**, and the reason is arithmetic
  rather than taste. It was one turn over the concatenated patches under a single
  `PATCH_LIMIT`, which is a budget spent in path order: on a change of any real
  size — a few hundred files, a regenerated lockfile, a formatting sweep —
  everything after the first few dozen was dropped to a list of names the turn
  was free to ignore, and the review silently reported on the front of the
  alphabet. A per-file turn is the only shape where the hundredth file is looked
  at as hard as the first, and the cap becomes per file, so nothing is dropped
  for being late in a change. Two things are given up for that and neither is
  free. **N turns is N cached prefixes** — the cost of a review now scales with
  the change, where before a 400-file diff and a 4-file diff cost nearly the
  same. And **no turn sees the change whole**, so a remark that only exists in
  the relationship between two files is one this will not make; that is softened
  rather than solved, by handing every turn the list of changed files and the
  tools to read them. Grouping related files into a turn each was considered and
  rejected as the thing to do first: every rule for "related" is either an import
  graph that only works for this repo's own languages, or a proximity heuristic
  that puts `main/git.ts` and `lib/files/git-diff.ts` in different turns anyway.
  A turn may comment **only on its own file** — findings naming another are
  dropped — because every changed file has a turn, and a remark each turn that
  can see a file is allowed to make is that remark left once per importer.
  Turns run `REVIEW_CONCURRENCY` at a time, which is a count of resident `claude`
  processes and so is small; one file failing is collected rather than raised,
  and only a run where _every_ file failed comes back as an error, because a run
  that reviewed 399 files and lost one to a timeout should hand over the 399.
  Threads are **added**, never replaced: a review run on top of remarks somebody
  had already written is two reviews of the same diff, and throwing one away is
  `Discard`'s business rather than this button's.
- **A finding says how bad it is**, on the scale a forge already taught
  everybody: `critical` / `high` / `medium` / `low`, the words CodeQL, Copilot
  Autofix and every GitHub security alert use, in that order. Four rather than
  the board's three, and deliberately **not** `BoardPriority` even though they
  read alike: a priority is what somebody decided to do next and a severity is
  what a model thinks a defect costs, and sharing the type would make the two
  the same word by accident. What it buys is the thing a twelve-comment review
  is missing — an order to read them in — and it costs one word in the prompt
  and one chip in the thread. The prompt spends its words on the **boundaries**
  rather than on the names, because that is where a model drifts: `critical` is
  data loss, a security hole or a crash on an ordinary path (and most reviews
  should have none), and it is told to judge the _defect_ rather than its own
  confidence, or every uncertain finding arrives as `low`. Only two of the four
  are **coloured** — red and amber — and `medium` / `low` are drawn in the same
  muted grey as the rest of a thread's furniture: a four-colour scale makes
  every comment shout, and a reviewer scanning a file needs the two that matter
  to be the two that are visible. It is on the **thread**, not the note, because
  it belongs to the finding and a thread is one finding — a label that moved as
  the argument went on would be a badge nobody could trust. **Absent is a real
  state**: a remark somebody typed has none, and `severityOf` drops a word it
  does not recognise (`moderate`, `P2`, a number) rather than rounding to the
  middle, since a `medium` nobody chose cannot be told apart from one the model
  did. Case and stray spaces are forgiven, and nothing else is.
  The progress dialog says the **breakdown** when a run finishes — `12 comments
left — 1 critical, 3 high, 2 low` — because a count on its own does not answer
  the question somebody asks a review: is this read now, or after lunch. It is
  tallied where the comments are **left** rather than off the findings, so it
  cannot disagree with the count beside it: a finding on a file that could not
  be read leaves no comment and is in neither. Worst first, a level with nothing
  in it left out entirely (`0 low` is a phrase nobody wants), and a run whose
  findings all came back unrated says nothing at all rather than an empty
  bracket — `severitySummary`, checked in `test/review.ts`.
- **`⌥↓` / `⌥↑` walk the review**, across files, and this is the thing a
  twelve-file review was missing rather than a convenience. The comments are in
  the diff under the lines they are about, which is right and is also why
  reading all of them was twelve trips through the Changes tree and a hunt down
  each file. `step` takes the **open** threads of the checkout in
  `orderedThreads` order — by file, then down the page, which is the diff's own
  order and not the order they were opened (an agent's review is four concurrent
  turns answering in any order) — opens the next one's file through `openPath`,
  the way clicking its row would, and focuses it. It **wraps**, deliberately: a
  review is walked until it is empty rather than until the bottom, and what
  makes that safe is that resolving is what takes a thread off the walk, so the
  list shrinks as it is worked through and the last one settled ends it. A
  focused thread that has since been resolved or deleted starts the walk over
  rather than ending it.
  Two things had to be got right. The pane **scrolls** to the thread, which
  means waiting: `step` may have opened another file, and the widget does not
  exist until that diff has been read and laid out — so the effect asks for the
  host node every frame until it is in the document, bounded at two seconds so a
  file that never draws is not a rAF loop for the session. And the thread is
  drawn with a **ring** that stays until the walk moves on rather than fading:
  `⌥↓` is a place, and a highlight that vanished would leave somebody who looked
  away with no way back but pressing the key again and overshooting. The key is
  refused inside anything being typed into — `⌥↓` in the reply box is macOS's
  "end of paragraph", and a reviewer mid-sentence must not be thrown into
  another file.
  The walk is also **two buttons** in the Explorer's `Changes` header, beside
  `Review` and `Discard`, and they exist for one reason: a shortcut with nothing
  on screen is a shortcut nobody finds. It shipped as keys alone and was
  invisible — the first thing asked about it was where it was. The tooltips name
  the keys (`Next review comment (⌥↓)`), so the buttons teach their own
  replacement; they are in the header rather than in the diff because the walk
  _starts_ before a file has been picked, which is most of what it is for; and
  they are never disabled, because the walk wraps and one comment left is a
  comment both arrows land on. They are drawn only while something is unresolved,
  which is what keeps that header's own rule — the ordinary state of it is still
  two tabs and Refresh.
  Considered and **not** built: a panel listing every finding, the way a forge's
  `Conversations` tab does. It is the report this feature exists not to produce
  — see the note above about where the threads are drawn — and the walk gets
  most of what it would have been for without moving a single comment away from
  its code.
- **A row's comment badge is coloured by the worst severity on it.** `3` says
  how much and not how bad, so a reviewer opened three files to find the one
  with the `critical` in it; the badge is the only thing on a Changes row a
  review owns, so it is where that answer goes. A directory row takes the
  **maximum** under it, the way it already takes the sum — `worstUnder` beside
  `commentCountsUnder`, and both take a `Map<path, number>` so
  `lib/files/change-tree.ts` stays free of the review's shape: a rank is
  comparable without knowing what `critical` means, and `0` — no severity, or no
  comment — is the identity a maximum needs. Only the top two are coloured,
  exactly as the chip in a thread is and for the same reason: a tree where every
  badge is a different colour is a tree with no signal in it.
- **The bar under the diff is gone**, and it is worth saying what it was, since
  it survived two rounds of being made better before being deleted. It was a
  32px strip at the foot of the `Changes` pane holding the comment count,
  `Discard`, `Review`, and a slot that said what the last run had found or what
  the running one was doing. Every one of those found a better home, and once
  they had, the strip was a row of things said elsewhere taking height off the
  diff on every screen, in every state, whether or not there was a review at
  all. `Review` is in the Explorer's `Changes` header — where the changed files
  are listed, and where a review is wanted _before_ a file is picked — and it
  was already there, so the bar's copy was the same button asked for twice.
  `Discard` moved beside it, for the reason it could not stay: the comments it
  clears are across every file, most of which are not the one open. How a run
  went is the **progress dialog's**, which is on screen while it runs and says
  the count when it stops — the bar was saying it a second time, in a strip a
  reviewer who had picked no file could not see. And the count is the **badge on
  each row** of the Changes list, which answers the better question: not how
  many remarks there are, but which files have any. The bar's one irreplaceable
  job — saying a review exists in a file nobody has opened — was that badge's
  all along. What is left of the strip is the case that had nowhere else to go:
  a comment being written on a range that has been scrolled off screen draws it,
  and nothing else does.
- **Claude is called by name, not by a button.** Writing `@claude-review` in a
  comment runs one turn in that checkout and puts the answer in as a note by
  `agent` — the author `lib/files/review.ts` has had since the day it was written,
  for exactly this, which is why nothing about the store's shape changed to allow
  it. It is the question a reviewer already has while writing the remark ("is this
  actually load bearing?"), and the only way to ask it before was to send the
  whole review to a chat and read the answer somewhere else.
  It was an `Ask Claude` button beside the reply field, and a mention is better
  for a reason the button could not fix: pressing it sent the **whole thread**, so
  "what about the null case?" or "…but only the second half" could not be asked at
  all without writing a second comment first and then pressing. A mention makes
  the question and the summons one sentence. It is also the shape a forge's review
  already has, so it needs no teaching beyond seeing one — which is why the
  mention is left in the text rather than stripped once it has done its job.
  Typing `@` opens a **menu**, which is what makes the name findable without
  being memorised — so the placeholders teach the key (`@ to ask Claude`) and the
  menu supplies the rest. It reuses `mentionQuery` and `insertMention` from
  `lib/worktree-chat/mention-text.ts`: pure text work with no chat in it, already
  checked in `test/chat-mentions.ts`, and two answers to "is the caret inside a
  mention?" would be two behaviours to keep agreeing. What it does **not** reuse
  is the rest of that menu — there is exactly one name to offer, so this has no
  selection, no arrow keys and no ranking, and the day there is a second one the
  composer's menu is the thing to copy. The keys it takes are `Enter` and `Tab` to
  accept and `Escape` to dismiss; `⌘⏎` is deliberately not one of them, because a
  comment finished while the menu happens to be up should send rather than
  complete a word nobody was choosing, and `Escape` closes the menu rather than
  the box so a dismissed list cannot throw away a half-written remark.
  Two rules make it safe. `mentionsAgent` matches the **token**, so
  `@claude-reviewer` is somebody else, `@claude-review-later` is a note to self,
  and an address or a path ending in it is not a summons — a false positive here
  is a turn nobody asked for. And **only a note by `you` summons anything**: Claude's
  own answer comes back through the same `reply`, and one that quoted the mention
  while explaining it would otherwise ask itself for ever. Both are checked in
  `test/review.ts`, the second by watching `asking` rather than by mocking the
  channel. Asking again after arguing with an answer sends the exchange so far,
  attributed, so the second ask is a follow-up rather than the first question
  again.

That runs a **second `claude`**, which is the rule in `CLAUDE.md` and
`ipc.ts` worth stating against rather than quietly stepping over: features
calling the CLI as a helper — an AI filter, an import button — are refused,
because a helper turn is a turn nobody asked for. This is not one. It is a button
on a comment, pressed by the person who wrote the comment, and its answer goes
where they are looking. What makes it safe to allow without the rule losing its
edge is that it is deliberately **not a conversation**: `src/main/review-agent.ts`
opens a session for the question and closes it on the answer, so there is no
transcript, no resume, no idle reaper and no id anybody could send a second
message to. It is read-only by the same means `Plan` and `Read only` are — a tool
list applied in this process, no `Bash` — because a reply that edited the file
under the diff being read would be the diff moving mid-sentence. Nothing can stop
it to ask, since there is no card and nobody watching, so an unpermitted call is
refused with a sentence rather than held. It is bounded at three minutes, which a
chat's ask deliberately is not: there somebody is reading the question and will
answer, here nobody is and there is no Stop to press. While it runs the thread
draws the turn as the note it is about to become — Claude's own mark, its name,
and "Reading the code…" — because the button that used to carry the spinner is
gone and a thread that has summoned somebody has to say so where the answer will
appear. A reviewer who wants a real conversation opens a chat and says so — the
diff is on screen beside it.

A note is drawn as **markdown**, through the same `MarkdownView` the chat pane
and the Explorer's `.md` preview use. Claude answers in it — backticked
identifiers, a `**bold**` qualifier, the odd short list — and a thread showing the
source characters is a thread quoting the punctuation instead of reading it; a
reviewer who types `fd` gets the same. That renderer builds its own DOM, so there
is no React tree to slip a chip into, which is why `markMention` wraps
`@claude-review` in backticks on the way in: inline code is the one marking that
survives the round trip, and it says the right thing anyway — a handle rather than
prose. The stored note is untouched, so what `threadBlock` quotes back to Claude
is still what was typed.

A failure is **drawn** under the thread and not written into it as a note: a
reply that did not happen is not something anybody said.

`threadPrompt` is the one part with a test (`test/review.ts`): a heading naming
the file and its lines **relative to the project** — the cwd the turn runs in, and
forty characters shorter than the absolute path — the quoted lines in a fence so a
`#` in them is not a heading, then what was said, replies included and attributed,
so asking a second time after arguing with the first answer is a follow-up rather
than the same question again. It asks for the comment to be **answered** rather
than carried out. `threadBlock` is split out of it because that is the part worth
being sure of; it had a second caller, `reviewPrompt`, which went with
`Ask AI to fix…`.

**The diff is the one editor that is unmounted rather than hidden.** Every panel
in the workbench, and every file tab inside this one, is kept mounted and hidden
with `invisible` — the point is editing state, an undo history and a caret and a
set of folds that a rebuild would take. A diff has none of that worth keeping:
the right-hand side is the file's own buffer, which the text editor holds anyway,
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
`fileRootsOf` is every root there is — each of the workspace's folders — and it
is what answers "may this be read", "does this tab survive", "which project is
this path in". `shownRootOf` is the single one the tree draws.
Keeping them apart is what stops switching project or branch from closing the
tabs of the one being left, unsaved edits and all: the tree is a view, not the
workspace.

Everything keyed by "where" uses the root rather than the folder: `FileRoot.id`
is the folder's id, the same key the dock's shells use for a place. One
`git status` per root, so a project is coloured by its own uncommitted work;
one tsserver per root, so a hover resolves against that project's
`node_modules` rather than another project's; one tab group per root, so a file
is filed under the project it is in; and the palette's index walks them all,
with the project in the hint beside a hit — two repositories in one workspace
both hold a `src/index.ts`, and the path alone would draw the same row twice.
`fileRoots` in `main/ipc.ts` is the main-process half, and it is what
`insideAny` is given: it is the one list the gate, the watchers, the palette's
walk and the tsservers are all answered from.

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

The index and the working tree are collapsed into one state deliberately — in
**the tree**, which is what this is about: a row here has nothing useful to say
beyond "changed and not committed", and a `node_modules` of files marked staged
or not is a tree nobody reads. The Changes list keeps them apart, because
staging is done from it; see _Staging, discarding, and where this stops_ above.
A wholly untracked or ignored _directory_
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
had just created was opened from the Changes list, where git had it
as `U` and its diff drew the added line correctly, and its tab said `deleted` —
because the tree had read that directory before the file existed.
`test/files-store.ts` holds the six cases now.

The status is re-read when the roots load, when Refresh is pressed, and —
debounced, so a project is one read and not fifty — whenever a watched
directory reports something. Each root's `.git` is watched for exactly this:
a commit made in the dock's shell changes the colour of every row and the branch
beside the folder, while touching no directory the tree has open. What covers
the cases it misses is the ordinary one, since a commit touches files in
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

**Every call is checked against the workspace's roots** — its folders.
`insideAny` in `src/main/files.ts` is the gate in front
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
**Markdown preview**, which is what it opens as, **Text editor**, which draws
the source, and **Markdown editor**, which is the block editor below — the
document, written without typing the syntax. The default is the preview rather
than the editor, the way SVG's is the picture: the Explorer is a tree of a
project's source, and a README reached from there is more often being read than
changed. There is no second copy of the text — the preview draws the same buffer
the editor writes into, so an edit is in it the moment the view is switched,
saved or not. A picture the document names relatively — `./docs/img.png` — is
read in against the file's own directory as a `data:` URL (see `MarkdownView`'s
`baseDir`), which is the one way a browser on this app's origin can see a local
file at all. The renderer is the transcript's,
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
in the block editor — the one the Notes panel brought and left behind (see
Notes, removed) — over a file in one of the workspace's folders instead of over
a record under `~/.yasuo`. `New note…` sits beside `New file…`
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

It is the files store's tab, and that decides how it is written: typing marks it
dirty, ⌘S and the header's Save write it, and closing the tab flushes it — where
the Notes panel wrote its own records as they were typed.
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
when it moved its own records off markdown — and the difference here is that the
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
what this app itself holds, which is a project's chats.

### The editor

**CodeMirror**, which is what every editor in the studio is. It has been all
three arrangements now, and the order matters more than any one of them:
CodeMirror everywhere; then Monaco in this panel against CodeMirror in the
field editors — the rest of the app edits _fields_, a SQL statement, a request
body, a response, where CodeMirror's size was the point, and this one edits the
user's own source, where what is wanted is the editor they already know; then
Monaco everywhere, because two editing stacks turned out to be the more
expensive half of that trade; and now back, on one stack.

**What the round trip actually decided.** Monaco's case was one stack, one set
of keybindings, and language services the field editors never had. It kept the
first two. The third is where the accounting went the other way: nearly every
piece of machinery the Monaco version needed was machinery _for_ Monaco.

- The SQL console's schema completion had to be written by hand — 290 lines of
  regex, alias-tracking and a map keyed by model URI — because Monaco ships
  grammars for SQL and no service behind them. It is ten lines now
  (`lib/db/sql-completion.ts`). This was the one cost the move to Monaco
  admitted to at the time, and it was the largest.
- The request body needed a hand-written Monarch grammar, `http-body`, because
  Monaco's JSON _service_ marked every `{{variable}}` as a syntax error and had
  no per-model switch. The body is highlighted by the real JSON parser now, with
  the variables as a decoration over it (`lib/http/body-language.ts`).
- `.tsx`, `.jsx` and `.vue` needed grammars extended by hand, and the JSX one
  rested on a heuristic — `<` after an identifier is generics, `<` after
  anything else is a tag — that got `1<x` wrong. Lezer has real TSX and Vue
  parsers, so `lib/files/grammars.ts` is deleted rather than ported.
- The diff pane held a `visibility: hidden` host, two chained animation frames,
  a 32ms settle, a two-second guard and a rule about when `HEAD` could arrive,
  all to hide the gap between Monaco painting a file and folding it. The merge
  view comes up folded on its first paint; all of it is gone.
- Five worker entry points and a `MonacoEnvironment` existed so a desktop app
  did not fetch its tokenizer from a CDN. Lezer parses on the main thread.

**And what it cost, which is one thing.** Monaco bundled a TypeScript worker
that reported _syntax_ errors. Lezer parses and does not diagnose, so a genuine
typo in a `.ts` file no longer gets a squiggle. See the next section: the server
that could answer it better is already running.

What is shared is in `lib/editor.ts` — the font, the theme, `baseChrome`, and
`panelChrome`, which is what an editor that is a _field_ gets. That is
deliberately less than this panel's `fileChrome`: no active-line band, no
indenting Tab (Tab is how you leave a field) and no completion popover, since
those are chrome competing with a few lines of text. What survives at any size
is numbered lines, folding, the find panel and wrapping. The theme is this app's
own tokens for everything structural — gutter, selection, find bar, completion
popover — and two literal palettes for the syntax colours, which are VS Code's
Light+ and Dark+ so that changing the stack did not silently restyle every file
in the app. It is a **per-view** compartment, where Monaco had one theme for
every editor on the page and each component called `setTheme` globally.

**A language is a dynamic import, not a grammar in the bundle.**
`@codemirror/language-data` carries 143 of them and loads each on demand;
`lib/editor-languages.ts` is the whole of the resolution, matching a filename or
a name against that registry rather than against a table kept here — the same
argument the Monaco version made about `monaco.languages.getLanguages()`. What
follows is that resolving a language is synchronous and _using_ one is a promise:
every editor opens in plain text and colours a frame or two later. That is the
trade that stopped a session which opens one JSON file paying for four megabytes
of grammars.

Every editor is behind its own `lazy`, so nothing of the stack is in the bundle
the studio launches with and a run that stays in the sidebars fetches none of it.
The fallback is an empty box rather than a spinner: the chunk comes off disk on
the `app://` origin, so what it covers is a parse rather than a download.

**One copy of `@codemirror/view` in the bundle, enforced twice.** A CodeMirror
extension is identified by the object it was built from, so two copies of that
package are two `EditorView.theme` facets and two `keymap`s, and an extension
built against one is silently inert in a view built from the other — no error,
the theme just does not apply. Milkdown depends on the same packages, and this
project's install resolves thirteen nested copies at the _same version_, which is
exactly why neither the package manager nor `tsc` reports a conflict.
`package.json` pins the version exactly; `resolve.dedupe` in `vite.config.ts`
pins the module. Both comments say so, and both are load-bearing.

### Hover and go-to-definition

A real **`tsserver`**, one per Explorer root — each workspace folder — in the
main process (`src/main/tsserver.ts`). Each gets its own because it has its own
`node_modules` and its own `tsconfig.json`, and resolving one project's imports
against another's copy is how a hover ends up pointing at source nobody is
looking at.
`serverFor` takes the longest matching root, so a folder added inside another
one gets the inner server for the files under it. The editor keeps what it is
good at — colouring, folding, bracket matching in the file in front of it — and
a hover source and a key binding hand the two project-shaped questions to the
server: what is this symbol, and where does it come from. Hovering an import gives its signature and its doc comment;
`⌘`-clicking it opens the declaration as a tab, `node_modules` included, with the
tree expanded down to it.

**tsserver directly, not a language server.** `typescript-language-server` is a
translation layer over this same process, and turning LSP into tsserver's
protocol only to turn it back into the editor's own hover and definition
sources is a dependency to carry
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

Go-to-definition across files is a call into the files store: open the file as a
tab and reveal it, the same act as clicking it in the tree, with the position
left in `pendingReveal` for the editor that mounts a frame later. Monaco needed
a hook for this — handed a target in a model it was not attached to its
standalone editor did nothing at all, which read as a broken key rather than a
missing feature, and `registerEditorOpener` was what it offered instead. There
is no editor-level indirection to satisfy here: the extension already knows the
path it was built for.

**The one thing lost in moving off Monaco is on this page rather than hidden.**
Monaco bundled a TypeScript worker that reported _syntax_ errors in the file in
front of it — held to syntax alone, because it could see no `tsconfig.json` and
no `node_modules` and marked every import in a real project as missing. Lezer
parses for structure and does not diagnose, and there is no CodeMirror
TypeScript service that is not a second copy of the compiler in the renderer,
which is the thing the server above was written to avoid. So a genuine typo in a
`.ts` file no longer gets a squiggle. The server that could give it back
properly — with the _type_ errors Monaco's worker never had — is already running
and already told what is in the editor; wiring diagnostics through it is a
feature, and was deliberately not smuggled into a migration.

Saving is `⌘S`, with a dot on the tab and on the tree row while a buffer is
ahead of the disk. Closing a tab writes it rather than asking, since the edit
was deliberate and a three-button dialog is in the way of the common case.

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
project's chat — one agent turn at a time in that project's directory, hosted by
the app rather than read off a file (see Chats). A shell is the dock's `Terminal`
tab, one per project, pointed at whichever the column last had clicked (see The
dock). The split is the point: the two halves of a session were a conversation
and a directory, and each of them now lives where it belongs.

What this costs, plainly. A turn cannot be interrupted with a keystroke at a real
prompt, and cannot answer a permission prompt — print mode has nobody to ask,
which is why a project's chat runs with edits pre-approved and says so under the
composer. `/clear`, `/compact` and the CLI's own slash commands are not reachable. And
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

Completion is the connected database's own schema, handed to
`@codemirror/lang-sql` (`lib/db/sql-completion.ts`). It offers the tables, and
after a `.` the columns of whichever table that alias resolves to, off a real
parse of the statement.

That file was 290 lines and is now about ten, which is the clearest single
measure of what the two moves between editing stacks cost and refunded. Monaco
ships grammars for `sql`, `mysql` and `pgsql` and no language service behind any
of them, so all of this had to be written by hand: a regex for the tables a
statement names and the aliases they are named under, a keyword list, a
statement-at-the-cursor split on `;` that a semicolon inside a string literal
would fool, and a `Map` keyed by model URI — because a Monaco provider is
registered per _language_ rather than per editor, and two open consoles would
otherwise answer for each other. Every one of those is a property of Monaco
rather than of SQL. Here the schema is configuration of the one editor it
belongs to, so two consoles cannot collide by construction.

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

## Notes, removed

**There was a Notes panel here**: a section of the left column with its own
folder tree, a record per note in `notes.json`, a body per note under
`notes/<id>.json`, a block editor over it, and a loopback preview server that
served any of them as a finished page. It is gone the way Mail and the Tasks
layer went — deleted rather than hidden behind a flag, so that what is here is
what runs.

The argument for going was the one the panel was built on, read back the other
way round. A note was justified by being _reachable from whichever panel raised
the thing worth writing down_ — and by the time the left column was projects
alone, it was reachable from nothing: `SIDEBAR_SECTIONS` had not listed it for
some time, and `⌘P` was the whole of the way in. What it held is a file in a
repository in every case that mattered, and the Explorer edits those in the same
editor. A second place to write things down, filed under the workspace rather
than under the work, is a place notes go to be lost.

What went with it: `lib/note/store.ts`, `note-list.tsx` and `note-workspace.tsx`;
`main/preview.ts`, `main/note-html.ts` and `main/note-blocks.ts`; the `notes:*`
channels, `notes:preview-url`, `note-files:copy`, `note-files:delete` and
`drawings:delete`; `NoteRecord`, `NoteFolder` and `NoteBody` out of the contract;
`Section`, `Pane`, `SidebarSection` and `PREFIX` no longer naming `note`, and
`--section-note` out of the tokens. `test/note-preview.ts` and `test/note-files.ts`
went with the code they covered.

**What stayed is the editor**, because the Explorer's `.note` and `.md` tabs are
that editor over a file — see § The block editor below, which is where the
pictures and the drawings are documented now. The walks that were only the
panel's went even so: which drawings and which pictures a document owned were
questions asked to delete or duplicate a _note_, and nothing deletes or
duplicates a document any more. A scene whose block is deleted stays under
`workspace/drawings/`, which is what the panel did for an undone delete anyway.

**What is on disk is left alone**, deliberately, the way the mail and the note
templates before it were: a workspace that ran the old build still has
`workspace/notes.json`, `workspace/note-folders.json`, the bodies under
`workspace/notes/`, and `workspace/note-templates*` from the removal before this
one. This app reads none of them. Removing a feature is not a reason to delete
somebody's writing out from under them, and a note worth keeping is a `.note`
file in a repository now — copy it in and the Explorer opens it in the same
editor.

## The block editor

The pane behind a `.note` or a `.md` in the Explorer (`files/file-blocks.tsx`
over `note/block-editor.tsx`) — BlockNote, brought in with the Notes panel and
kept when that went. What it is bound to and what a `.md` costs is § Explorer
§ The editor; what follows is the two block types that are this app's own.

### Images

A picture goes into a document the three ways one goes into any editor: dropped
on it, pasted into it, or picked through the image block's **Upload** tab. That tab
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
alternative survives contact with the editor:

- **Not a data URL in the block.** A document is re-serialised on every pause in
  the typing, so a photograph pasted into one would be re-encoded and
  re-written for the rest of that file's life.
- **Not a path into the user's own folders.** The file the picture came from is
  theirs to move, rename or delete, and a document is expected to still have its
  picture afterwards.

Which is the trade the drawings already make, and the rest follows the drawings
too: the name is a fresh UUID plus an extension taken from the browser's idea of
the file's type — so nothing the user's filesystem named reaches a path of ours,
and two pictures dropped from two folders cannot be the same file — and `Store`
checks the shape of that name before it becomes one.

**Nothing deletes one.** The copy-and-delete walks over a document were the
Notes panel's — a note being duplicated or deleted was the only thing that ever
owned a picture — and they went with it. A file dropped into a `.note` in
somebody's repository is kept until they say otherwise, which for a file under
`~/.yasuo` is the safer of the two ways to be wrong; the alternative is a
delete that has to be right about a document the user may still be undoing.

**The URL is `note-file://workspace/<name>`, a scheme this app serves**
(`shared/note-files.ts` is its shape, `main/protocol.ts` the handler). Both sides
have to be able to say what one means: the renderer puts it in an `img` and
Chromium fetches it through the handler, streamed off disk with the content type
its extension gives it. A privileged scheme rather than `file://`, which Chromium will not load as a subresource of
another origin, and `secure` so it is not mixed content on a page served over
`app://`. The handler builds no path of its own: it hands the name to the store's
own `noteFilePath`, which is the same check every other one goes through.

**A picture, a clip and a sound all work; an attachment is where it stops.** A
video or an audio file dropped in plays where it sits, seeking through the
`Range` header `main/protocol.ts` passes along. Anything with no player, a PDF
or an archive, is still stored and still named in the document. What it is _not_
is openable from the
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
workspace's files, and `noteFileNameOf` in `shared/note-files.ts` is what knows
the difference.

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
rather than tinted; Excalidraw inverts the strokes, and an export that stayed
dark on a light page would be the only thing in the studio that did.

Excalidraw is around a megabyte and most sessions never open a drawing, so it is
loaded on demand: `React.lazy` for the editor, a dynamic `import()` in the node
view for the SVG export, and neither runs for a note with no drawing in it. Its
**fonts are served by this app**, not from esm.sh where it looks by default — a
desktop app should not go to the network for a file it can ship, and the glyph
widths should not depend on whether it got there. The `excalidraw-fonts` plugin
in `vite.config.ts` reads them out of `node_modules` in dev and emits them into
the bundle for a build; `public/` was the other option and 13MB of vendored
woff2 does not belong in git.

**Nothing deletes a scene.** Deleting the block leaves the file behind on
purpose — that has to be undoable, and a delete that had already removed the
file would come back as an empty drawing — and the walk that took a _note's_
drawings with it went with the Notes panel. What is left under
`workspace/drawings/` is the user's to clear out, which is the same bargain the
pictures make.

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

## Updating

The right-hand end of that same bar is where a new release turns up: a pill
saying `Update to 1.0.20`, and nothing at all when there is none.

**It is not `electron-updater`, and that is not an oversight.** Squirrel.Mac
refuses to swap a bundle that carries no Developer ID, and these builds carry
none — signing costs an Apple Developer membership, which is the same fact that
`install.sh` exists to work around. An auto-updater bolted on anyway would be a
progress bar that ends in a failure the user cannot act on. So the whole
mechanism is three small pieces:

- `src/main/updater.ts` asks the GitHub releases API for `releases/latest` and
  compares its tag against `app.getVersion()`. It imports no `electron` — the
  current version and the script's path are arguments — so `test/updates.ts` can
  import it under plain `bun`, the same bargain `main/git.ts` makes.
- `src/renderer/lib/updates.ts` decides _when_ to ask: once at launch, then
  every six hours. Releases are cut a handful of times a month and the anonymous
  API allows sixty requests an hour per address, which this app is not the only
  thing on the machine spending.
- The button runs **`install.sh`** — the same script the README hands people,
  shipped inside the bundle as an `extraResources` entry rather than fetched
  when the button is pressed. A button that downloads and executes a script at
  the moment of the click is a different thing to agree to than one that runs
  the app's own copy, even where both URLs are the same.

Three details are load-bearing:

- **The installer is spawned detached.** `install.sh` quits the running app
  itself, by design, so that a bundle is not replaced out from under a live
  process — a child of that process would die mid-`ditto`. Detached, it survives
  to finish and to `open` the app again.
- **There is no success path to report.** The app is gone before the script
  ends, so the renderer's `installing` state is never cleared, and the honest
  end of it is the window closing. A failure to _start_ the installer is
  reported in the dialog; a failure inside it lands in `~/.yasuo/update.log`,
  which is the only place left to put it.
- **`isNewer` is strictly newer, and numeric.** A string comparison makes
  `1.0.9` newer than `1.0.19` and offers everybody a downgrade forever, and a
  check for "different" does the same to anyone running a build from a checkout.
  Prereleases sort below the release they precede. `test/updates.ts` is that
  table, and it is the only part of this with an opinion worth testing.

Nothing ever pops up. The check comes back while the user is in the middle of
something, and whatever that was, it was more important — so the answer becomes
a pill and a section in Settings › Updates, and never a modal over the composer.
Skipping a version is per version: the pill returns for the next release rather
than never again, and the Settings section ignores the dismissal entirely, since
a page headed Updates is not a place to hide one.

Off macOS the check still runs — "there is a newer version" is true on Windows
too — but `installable` is false and the only button is the one that opens the
release page.

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
