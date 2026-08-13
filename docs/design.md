# desktop

The studio as an Electron app: a workspace points at real directories on disk
rather than rows in a browser database, and every tool over them — database,
API, mail, terminal, agent — is a tab in one window rather than an
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
    mail.json       what the SMTP sink caught
    notes.json      the Notes panel's listing
    note-folders.json
    notes/<note-id>.md   one note's own markdown
    note-templates.json  the text a new note can start from
    note-templates/<template-id>.md
    db/<db-id>/     one Docker-managed database's own data
```

**There is no switching.** That is the point of the design rather than a
missing feature: someone working on a frontend and the API behind it has two
folders open, not two applications to alternate between, and a switch would
take one of them — along with every tab, session and connection opened against
it — off the screen. Adding a folder brings its files into view; removing one
takes its sessions with it and leaves the directory untouched.

Everything else belongs to the workspace rather than to a folder: the
databases, the saved requests, the cookie jar, the capture server. A
project's database is generally the same database its frontend and its API both
talk to, and filing it under one of the two would only decide which panel is
allowed to see it. What _is_ per folder is what is genuinely per repository — a
session's working directory and a branch name.

Sign-in is what will bring a second workspace. Until then the studio always
holds this one, which is why its id is a constant rather than something the
manifest has to be read to learn.

## The tab strip

One strip for the whole workbench, above whichever panel is showing, rather
than one per panel: a table, a request, a captured email and a session sit side
by side, and clicking any of them goes to the panel that shows it. Leaving
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
"pick a table" notice with two sessions still in the strip, because the only
store asked was the one that had just emptied. Now the tab beside the closed one
takes over, whichever panel it belongs to (`neighbour` in `lib/tabs.ts`, tested
there). The panels' own lists close tabs without going through the strip, so
`fillPane` is the same fallback offered to them: the rows in Explorer's Sessions
list use it.

**The sidebar follows what the pane is showing.** Because a tab can be picked
from the strip, from `⌘P`, or by jumping to a definition, the thing on screen is
regularly one the sidebar has scrolled past, folded away, or is not even the
sidebar _for_ — and a list marking a row nobody can see has marked nothing. So
selecting anything brings its own sidebar to the rail, opens whatever holds it,
and scrolls the row into view.

Except where the thing has no sidebar of its own. **There are five rail sections
and six panes:** a session draws in a pane with no rail button, because it is
started and listed in the Explorer sidebar — so `showPane("terminal")` leaves the
sidebar exactly where it is, which is already the list the row was clicked in.
`Section` in `lib/rail.ts` is that subset, and `Pane` in `lib/store.ts` is it
plus `terminal`; they were one union while every pane had a button.

Only that direction. The rail still moves the sidebar on its own without
touching the pane, which is what lets a tree be read while another panel's tab
stays on screen; it is picking something that moves both. A section taken off
the rail is not brought back by a pick either — hiding one says "not a way into
the studio for me", and a selection is not an argument against that.

The scrolling half is one place: `SideRow` is every sidebar's row, and it
scrolls itself into view when it becomes the active one — `block: "nearest"`, so
a row already on screen is left exactly where it is rather than the list
centring itself on every click. The opening half cannot be shared, because what
"holds" a thing differs per panel: a directory chain in the Explorer, a folder
chain in API and Notes (`ancestorFolderIds` in `lib/tree.ts`), the workspace
folder a session runs in, the branch a table belongs to.

Each panel does it in its own `select`, not in an effect beside the list. That
is what keeps the fold state honest in both directions: it only ever _opens_, so
a folder somebody shut stays shut unless what they picked is inside it, and the
folder holding the current selection can still be collapsed by hand — which a
version derived during render could not allow. It is also why API's and Notes'
folds moved out of their components and into their stores: a list cannot open a
folder for a selection made in another panel.

**The strip comes back on a reload.** It used not to: Terminal remembered its
sessions and no other panel remembered anything, so a reload left one strip
intact and emptied four. Each panel writes its own record under a settings key
of its own — `http.tabs`, `inbox.tabs`, `db.tabs`, plus `workbench.strip` for the
cross-panel order and the pane on screen — because what identifies a tab is the
panel's business: a schema-qualified table name here, a capture id there.
`lib/tab-memory.ts` is only the reading and writing, which was the same four
times over.

Every record is reconciled against what actually exists, never trusted: a
request deleted since, a capture that has aged out of the capped list, a table
that has been dropped. For the API and capture panels that happens as they are
restored, in the first `refresh()` — the moment those panels know what their ids
mean. Each panel restores once, so a later refresh cannot reopen what has been
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
panel's "No table selected" spoke for all five, since `database` is the pane a
fresh launch starts on — somebody who opened the studio to read captured mail was
told to pick a table. The terminal steps aside for it too, which is what stops
closing the last session from leaving its own "start a session" line saying the
same thing in one panel's words.

The notice has two things to say, and which one depends on the strip. With tabs
in it, they are what to pick and it points up at them. With none, there is
nothing above to point at, so it points at the sidebar — and so follows the
**rail**, not the pane: the pane is where the last tab was, and with no tabs
there is no last one, so the sidebar on screen is the only thing that could be
acted on from there.

**A panel switched away from is hidden, not unmounted.** The terminal always had
to be — its session is a pty with no way to reattach, so taking it off the screen
would end the conversation — and the other five turned out to want the same for a
smaller reason: a strip that keeps every panel's tabs on screen is an invitation
to switch, and everything a panel held that its store did not was thrown away
each time. Leaving Database for Mail and coming back gave a result grid scrolled
to the top, a SQL editor with no undo history and the query split back at its
default height; a note came back as a fresh ProseMirror over the same text. None
of that is state a store has any business holding — a scroll offset and an undo
stack belong to the view — so the view is what stays.

A panel is still built the first time it is shown, since a panel nobody has
opened is a connection nobody is reading and the terminal's is a process, and
`mounted` in `studio.tsx` is that list. The hiding is `invisible` rather than
`hidden`: `display: none` destroys the scrolling boxes inside, which would put
that grid back at the top by another route, and it is what the Terminal panel
already stacks its own sessions with.

**And the same one level down: a tab switched away from is hidden, not
unmounted.** The rule was only ever half applied — Explorer, Notes and Terminal
stacked their tabs, and the other four rebuilt one pane per click, so keeping
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

## Search

`⌘P` opens a search over everything the workspace can open — a file, a table, a
request, a captured email or callback, a running session, a note — and picking
one opens its tab and goes to the panel that shows it.
`components/studio/command-palette.tsx` is the whole of it.

It exists because the strip and the seven sidebars only answer a question the
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

## The two window shortcuts

`⌘P` opens the search above and `⌘W` closes the tab the pane is showing, both
answered by a `keydown` listener in the renderer rather than by an accelerator
in the application menu. `lib/shortcuts.ts` is the predicate the two share.

They are the page's rather than the menu's because a registered accelerator is
handled in the main process, before the page sees the key at all, and both of
these need what only the renderer knows: the palette owns its own dialog, and
which tab is the current one is worked out in `workspace-tabs.tsx` from
whichever panel is on screen — no store holds it. The File menu still lists
**Close tab ⌘W**, with `registerAccelerator: false`, so the key is displayed and
the item works without the menu taking the keystroke. Closing the _window_ moved
to `⇧⌘W`, the move an editor makes and for the same reason: a window holds every
panel's tabs, and losing it to a keystroke aimed at one of them takes the
sessions running in it too.

Both are claimed on the capture phase, ahead of whatever has focus. `Mod-P` is
otherwise Chromium's print, and a palette that also sent the window to a printer
is one nobody presses twice; `⌘W` is taken early so that an editor with a focus
trap of its own cannot swallow it. **Off macOS a session's terminal keeps both**:
there the shortcuts are `Ctrl+P` and `Ctrl+W`, which are readline's before they
are ours — one walks a shell's history and the other deletes the word behind the
cursor — and a shell's editing keys have no second way to be pressed, while the
menu item and the palette do. Nothing is given up on macOS, where xterm never
sends `⌘` to the process.

With an empty strip `⌘W` is left alone rather than swallowed: there is no tab to
close, and doing nothing is quieter than a window vanishing under a keystroke
meant for a tab.

## Explorer

The first section on the rail, and the only panel that shows the folders
themselves rather than something the studio keeps about them: the workspace's
directories, opened one level at a time, and a file opened into an editor.

**The tree is the directory tree.** Every other sidebar lists records this app
owns — a request, a note, a captured mail — and files them however it likes;
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
folder (`main/git.ts`, held in `lib/files/git-status.ts`), and four things to
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
longer there rather than looking like every other tab. Either source answers —
git knows a tracked file was deleted, and the listing the tree already holds
knows an untracked one was, which git stops mentioning the moment it is gone.

The status is re-read when the folders load, when Refresh is pressed, and —
debounced, so a checkout is one read and not fifty — whenever a watched
directory reports something. Each folder's `.git` is watched for exactly this:
a commit made in a Terminal session changes the colour of every row and the
branch beside the folder, while touching no directory the tree has open.

**Refresh is still in the header**, because a watcher is the fast path and not
the reliable one: `fs.watch` misses writes on network and virtualised
filesystems, the same caveat the transcript mirror polls around. It re-reads
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

**Every call is checked against the workspace's folders.** `insideAny` in
`src/main/files.ts` is the gate in front of the eight `files:*` handlers, and it
is why they are eight narrow calls rather than one general "run this fs
operation": the main process has to be able to say what each one may touch. An
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
answers to "where do I remove a folder" and a sidebar that was this one plus a
session row; it now lists sessions and leaves the folders alone. Each heading
carries the folder's branch, and this is the one list that always shows it — the
Terminal sidebar has no heading to put it on in a single-folder workspace. It
sits on a line of its own under the name rather than at the right of it: branch
names run as long as the ticket they were cut for, and a row shared with one of
those was all branch and no folder.

Removing a folder takes the studio's record of where it is, along with the
sessions open against it, and leaves the directory exactly as it is — the
dialog says so, because this is the one destructive action in the studio that
looks like it might delete somebody's repository.

Renaming a folder is the one rename in the studio that does not touch the thing
it names. The manifest records an absolute path and a name beside it, and only
the name changes — the directory keeps whatever it is called on disk, and every
session already running in it keeps running. The dialog says that too, rather
than leaving it to be discovered from Finder, which is what the `description` on
`RenameDialog` is for. The rename directly under it in the same menu, of a file
or directory _inside_ a folder, does touch the disk, and says which it is.

**`New session here…`** is on a folder as well, opening the Terminal panel's own
picker with that folder chosen. It is the flow anyway — what somebody wants a
terminal in is usually the repository they are reading — and since the Terminal
sidebar no longer draws folders with nothing running in them, it is where the
first session in one is started. It sits on the folder heading rather than on the
directory rows under it because `terminalCreate` takes a folder id: a pty's cwd
is a workspace folder's own directory, and an item promising a shell in
`src/main/` would be promising something the contract cannot express.

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

**A `.md` is the other one**, and the menu is the same menu: **Text editor**,
which is what it opens as, and **Markdown preview**, which draws it as the
document it was written to be. The default is the editor rather than the
preview, unlike SVG's: the Explorer is a tree of a project's source, and a
README reached from there is more often on the way to being changed than being
read. There is no second copy of the text — the preview draws the same buffer
the editor writes into, so an edit is in it the moment the view is switched,
saved or not. The renderer is the transcript's,
`components/studio/markdown-view.tsx`, which is why it sits at the studio's root
rather than in either panel; what the Explorer adds is a document's type scale
over a chat message's, in `files/file-markdown.css`, in the same theme tokens as
everything else so light and dark need no second palette. `.mdx` is deliberately
not offered one: it is markdown with JSX in it, and a commonmark parser drops
the component tags rather than drawing them.

`lib/files/viewers.ts` holds all of that and nothing else does.

Two other kinds of file are reported rather than opened: anything with a NUL
byte in its first 8 KB, and anything over 2 MB. Both come back as results rather than
errors — "this is a PNG" and "this is a 40 MB log" are things the pane can say
plainly, and rejecting would file them beside "the disk went away".

### Conversations

**Under the tree, the agent history of each folder — including the parts this
app had nothing to do with.**

A `claude` conversation is a file the CLI wrote. Every run of it appends to
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, whether it was started
from a session in this app or typed into Terminal.app, and `listSessions` in
`src/main/transcript.ts` reads that directory — the one `--resume` itself reads.
So the studio can list, and draw, conversations it never started and has no
process for. That is the whole reason this list is worth having: it is the agent
history of a repository, not the history of this app's use of it, which is
something an editor's own chat panel cannot offer for a CLI run in a terminal it
does not own.

It was already possible to reach one and only in the worst place: the **Past
sessions** drawer, inside a running session's chat view. The way back to
yesterday's conversation therefore began with starting a new one. Here it is a
list beside the files, and a click reads it without starting anything at all.

**A conversation opens read-only, and `Resume` is the way to talk to it.** The
pane is the chat view's own transcript feed with a different strip above it and
no composer under it — there is no process to type at. `Resume` hands the
conversation to a real session (`terminalCreate` with its id, which the CLI
resumes) and closes the read-only tab, because what that tab was for is then on
screen with a composer. A conversation that is _already_ running in a session
says `Go to session` instead and selects that tab: two `claude` processes
appending to one transcript is not a state worth being able to reach, and the
CLI refuses a session id that is in use anyway.

**These tabs belong to the Explorer pane**, not the Terminal one, because
`showPane` moves the sidebar with the pane — and the row a conversation was
picked from is in _this_ sidebar. Opening one into the Terminal pane would take
the rail to a sidebar with no row for it to mark, which is the failure that rule
exists to prevent. They are a store of their own
(`lib/terminal/conversations.ts`) rather than more `openIds` in the files store:
a file tab is an absolute path, and `prune`, `restore`, `flush` and `movedPath`
all read one as a path. `lib/panels.ts` adds the two lists up into the one
pane's tabs, and `onScreen` there is what settles which of the two the pane
draws — set when a conversation is picked, cleared by `useFiles.select`.

**Read when the section is opened**, not on launch: this is a `readdir` plus the
head of every transcript in it, per folder, and a repository worked in for months
has hundreds. Refresh is the section's own button. The list is grouped by folder
only when the workspace has more than one, the same rule the Terminal sidebar
groups sessions by, and it scrolls in a box of its own so the tree above stays
what the panel is mostly for.

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

A real **`tsserver`**, one per workspace folder, in the main process
(`src/main/tsserver.ts`). Monaco keeps what it is good at — colouring, folding,
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

**The folder's own TypeScript, and no other.** A repository pinned to 5.4 should
be read by 5.4: its `tsconfig.json` may use options another version rejects, and
the types it resolves are its own compiler's. A folder with no `typescript` in
its `node_modules` gets no hovers, deliberately — shipping a copy would add forty
megabytes to the download to serve a project that, having no TypeScript
installed, has no types to resolve either. It is the bargain the Terminal panel
makes with the `claude` CLI: use what the machine has. `tsserver` is started with
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

## Terminal sessions

The studio holds as many sessions as you open, each in one folder's real
directory: a plain shell, or `claude`. **There is no Terminal section on the
rail.** They are started and listed in the Explorer sidebar's own Sessions list,
under the folder each one runs in, and a session draws in a pane of its own with
no sidebar — see the Layout section on the five sections and six panes.

The rail button was there first, and what it opened was a sidebar whose top half
was Explorer's folder list again. Taking the folder management out of it (see the
Explorer section) left a handful of session rows behind a way in of their own,
which is a button on the rail for a list that fits under another one. What the
sessions genuinely need is the folders, and those are Explorer's.

`+` on that list asks which folder and which kind — and for a CLI that is not on this machine it offers to install it
instead of to start it, running the install in a session of its own so the
output and any password prompt are yours to read. What each kind runs, how it
installs, and whether it is there is decided in `src/main/agent-tools.ts`, so
the picker cannot offer something that would not start.

Sessions run on the host, outside any container. The folder is asked for rather
than assumed because a pty's directory is fixed the moment it starts and cannot
be moved afterwards — the picker is the only place that choice can be made.

**The list answers "what is running", and only that.** A folder appears in it
only once something is running in that folder; which folders the workspace is
pointed at is the tree above it, and adding, renaming and removing one is
answered there. A folder heading appears only when the workspace has more than
one folder — every session in a single-folder workspace is in the only folder
there is — and it carries no branch, because the tree's own heading says that
once, a few rows higher.

The section is expanded by default, unlike Conversations below it: these are live
processes, and a session on screen with nothing in the sidebar selecting it is
how a session gets forgotten about. With nothing running it is a header and no
more, and folded it says how many sessions are running under it. Nothing folds
per folder any more — the section itself folds, and a fold inside a box that
already scrolls was a third level of hiding for a list of a few rows.

Starting the first session in a folder is therefore not done from the list, which
is not drawing that folder yet: `+` asks which folder, and `New session here…` on
a folder in the tree is the shorter way — what somebody wants a terminal in is
usually the repository they are reading. Both open the same picker, which the
workbench mounts off `picking` in the terminal store rather than the sidebar
holding it: a dialog a sidebar holds is unmounted when the rail moves.

### Closing a session

**Closing a tab ends the pty; it does not end the session.** The row stays in the
Sessions list under its folder, dimmed and marked `closed`, below whatever is
still running. Clicking it runs it again — `restart` and "reopen" are the same
act, because a pty cannot be resumed, only started over.

This is about `claude` in particular. The conversation was never the studio's to
delete: the CLI wrote it to `~/.claude/projects/…/<session-id>.jsonl` and it is
still there after the tab goes. What closing used to do was drop the only handle
onto it, leaving the Past sessions drawer inside a _running_ session as the way
back — start a session, switch to Chat, open the drawer, find it. A closed row
is that handle, and reopening one passes its `claudeSessionId` back to
`terminalCreate`, which resumes it if `hasTranscript` finds the file.

A closed row is no longer the _only_ handle. Explorer's Conversations section
lists every transcript a folder has on disk, this app's sessions and the user's
own `claude` runs alike, and reading one there starts nothing — see the
Conversations part of the Explorer section. What a closed row still is, and that
list is not, is a record of the session as this app had it: its name, its kind,
and its place under a folder.

A closed shell is honest about offering less: there is no transcript and no
saved scrollback, so running it again is a fresh pty in the same directory.
`Forget` is how a row goes for good — named for what it does, since the
transcript on disk is the CLI's file and is left alone.

Two things are dropped rather than closed: an install run, because a closed one
would offer to replay an installer, and a session whose pty never started,
because there is nothing behind the row. `closed` is a separate flag from
`exited`, which is the process ending on its own while the tab carries on.

Closed rows are remembered across a launch along with the open ones, and come
back closed. Everywhere outside the sidebar wants `liveSessions` rather than
`sessions`: a closed session is not a tab in the strip, is not mounted in the
pane — unmounting the pane is what kills the pty — and is not a conversation
another tab is holding open.

Which session was on screen is remembered too, and reopening happens in the
background: `open` normally puts the pane on the terminal and makes the new
session active, which is right when a person started it and wrong when five are
being put back at launch. It left the last one restored active and the pane on
the terminal, and since taking the pane also writes it down, the remembered pane
was overwritten every launch — the whole strip appeared to forget which tab was
selected, whichever panel it belonged to.

An empty workspace has no screen of its own. The studio used to be held shut
behind a full-window "No folders yet" until one was added, which was right when
a folder was what the whole app was about; it is not, and holding four panels
that never needed one behind a fifth that does is a gate charging everybody for
one panel's requirement. Both sidebars simply draw an empty list — no notice
saying it is empty, because a panel that announces its own emptiness announces
it again every time the section is opened, and Explorer's `Add folder` is in the
header directly above where the folders would be. `New session` here is disabled
until there is a folder to start one in, since a pty's cwd has to be some
directory.

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
at — two tabs open on one folder follow their own conversations.

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
  every conversation on disk for the folder, and the new one is the top of
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
back to it. A conversation another tab of the folder already has open is
listed but not offered, since two `claude` processes resumed onto one
transcript would both be appending to it.

The composer sits under the terminal, and only there: it writes into the CLI's
own prompt, which is the terminal's, and the chat is the view for reading the
conversation rather than adding to it. The mode is the one setting
that still waits for a restart, and deliberately: the CLI would take
`/config permissionMode=…` live, but that writes `permissions.defaultMode` into
your own `~/.claude/settings.json`, where the workspace's choice would become
the default for every other repository and every `claude` you run yourself.
Restarting
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

#### `@` — the other panels, in the prompt

**The one thing only a studio can offer an agent.** An agent in an editor sees
the files and the terminal output; it cannot see the schema of the database this
project talks to, the request that reproduces a bug, or the mail the app just
sent, because those live in other applications. Here they live in the same
window, so `@` in the composer is a menu of them: a table with its columns, a
saved request resolved against the active environment, a captured mail, a note.
`lib/terminal/mentions.ts` is the catalogue.

**Everything is read from what the renderer already holds** — a table's columns
are the ones the schema read brought back, a request's URL goes through the same
`resolveUrl` the send path uses. No query is run and no IPC is invented to answer
a keystroke, which is also why tables appear only once a database is open: a menu
opening is not consent to connect. What _is_ asked for is the three panels that
load lazily (`primeMentions`), because a menu that was empty until you had
visited the API panel reads as a broken feature rather than an empty workspace.

**Picking one inserts a chip — the thing's own name, in the panel's colour — and
the context it stands for replaces it on the way out.** Pasting the context
inline was the first version and it read badly: a note's body or a table's two
dozen columns pushed the sentence being written off the screen, and the prompt
stopped being something anybody could re-read before sending it. `expandMentions`
in `lib/terminal/mention-text.ts` does the replacing, called by the composer's
`send`; long values are collapsed to one line and cut there, saying how much was
dropped.

The chip is **a link to a private scheme**, `tabomni://mention/<kind>:<id>`,
rather than a ProseMirror node of this app's own. The composer is a Crepe
document serialized to markdown at send time, so a custom node would need its own
serializer and node view, while a link is already in the commonmark schema,
already serializes, and carries the id in its href — which is what makes the
expansion possible at all. Nothing can open a `tabomni://` link, deliberately:
the href is an identifier, not an address.

Milkdown renders a link's `href` through an allowlist of schemes, so ours reaches
the DOM empty — the _mark_ still holds it, which is why the send path still works,
but CSS has nothing to select on. The kind therefore travels as a `data-mention`
attribute added through `linkAttr`, the preset's own hook for attributes on a
rendered link, composed with whatever Crepe's link tooltip has already set there.
`chat-composer.css` colours the chip from that, in the same token the rail uses
for that panel: a table is the Database hue wherever it appears.

Nothing is read when a row is picked — resolution happens at send — so picking
cannot fail, and a mention whose thing has gone by then falls back to the label
the chip was showing rather than sending an href the agent can do nothing with.
The trigger is `@` at the start of a word, so `someone@example.com` typed into a
prompt opens nothing, and an open menu ignores ⌘/Ctrl+Enter so that Send still
sends rather than inserting whichever row was highlighted.

The same `@milkdown/plugin-slash` machinery as the `/` menu beside it — that
plugin is "a menu on a trigger character", and neither of its two uses here is
Crepe's own block menu, which this composer turns off. What differs is the
trigger, the rows, and that picking one inserts context rather than a command.

#### What the turn changed

**The transcript says which files changed, and says it first.** The CLI
records every tool call it makes with the arguments it made it with, so an `Edit`
is a line naming the file it edited: `writtenPaths` in `lib/terminal/touched.ts`
reads them out of the transcript the chat view is already tailing. A strip under
the conversation lists them, newest last, and clicking one opens it in Explorer.

Two things follow. The first is that the files are named at all — the `Edit`
cards are in the transcript in order, and are the first thing "Show tool calls"
switches off, so "what did it change" used to be a scroll back through the turn
or a `git status` in the terminal view. The second is that Explorer follows
along: `syncPaths` in the files store re-reads exactly those paths — the open
directories they are in, and the open files themselves, skipping any with unsaved
edits, which are what somebody typed and not the session's to discard. The effect
lives in `terminal-session-view.tsx` rather than in the chat view, because a turn
is usually watched in the terminal view and the tree should not be stale
depending on which of the two is on screen.

This is kept alongside the tree's own watchers rather than replaced by them. It
names the file as the tool call is recorded rather than after a debounce, it
reaches a folder mounted into a container or held over a network — where
`fs.watch` says nothing — and the strip is a list of what the turn did, which is
a thing to read rather than a mechanism for keeping a listing fresh.

Only writes count. `Read`, `Grep` and `Glob` name files and change nothing, so
counting them would turn "what changed" into "what was looked at" and re-read
half a repository per turn. `Bash` is the honest gap — `sed -i`, a build, a
`git checkout` all write and none of them says so in a way this can read — so a
turn that only ran commands is picked up by the tree's watchers, and by Refresh
where those cannot see it. A read-only conversation shows the same strip and syncs nothing: those
writes happened whenever it ran, and a tree refreshed from a transcript days old
would be answering a question nobody asked.

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

## Mail

The API panel sends requests out. This one catches what comes the other way —
the mail the project's own code sends — with an **SMTP sink** on 1025, bound to
`127.0.0.1` and nothing else. It accepts a message and keeps it. Nothing is ever
delivered. That is the point: an app configured against this cannot mail a
customer by accident, which is the failure a development mail server exists to
prevent. Any username and password are accepted, because a framework configured
with credentials will not send without being asked for them, and there is
nothing here for credentials to protect. TLS is not offered.

It is written here rather than pulled in: a mail catcher that has to be
installed first is a panel that works on the machine it was written on.
`src/main/inbox.ts` is the server, `src/main/mime.ts` is the parsing that
follows — enough of MIME to read what a framework mailer sends
(`multipart/alternative` inside `multipart/mixed`, base64 and quoted-printable
bodies, RFC 2047 subjects, RFC 2231 filenames) and no more. A part it cannot
make sense of is shown as an attachment rather than dropped.

Everything structural in the parser runs on the message decoded as latin1, which
maps one byte to one character: that is what lets a boundary be found by string
index and the part behind it recovered as the exact bytes it arrived as. The
charset a part declares is applied to those bytes afterwards, per part — the
only order that works when one message carries a UTF-8 body and a Shift_JIS
attachment name.

Captures are kept in `mail.json` under the studio's own directory, newest first
and capped at 200, so an inbox survives a restart without becoming the slowest
thing the panel does. A mail's HTML is rendered in an iframe with `sandbox=""`
and a CSP that allows only `data:` URIs — a template with a script in it must
not run inside the studio, and a remote image must not load, because in a mail
that image is a tracking pixel and fetching it would tell a server the message
was read.

**There was a Webhooks panel beside this one**, a catch-all HTTP endpoint on
1026 that answered every method on every path, with a replay button that sent a
captured request back out verbatim. It was removed rather than hidden, the way
the git, code search and specs panels were. What it left behind is deliberate
and small: a capture still carries `kind: "mail"`, which is the field that tells
one of its records apart from a mail in a file written by that build, and
`Store.listInbox` reads `inbox.json` once to carry the mail across to
`mail.json` before removing it. The settings blob under `inbox.config` still
nests the port under a `mail` key for the same reason.

The port is the workspace's, in `manifest.json` settings under `inbox.config`,
along with whether to bind it at launch. One server rather than one per folder:
a port can only be bound once, and the code that sends the mail is usually one
folder of a project whose other folders would want the same sink anyway. Nothing
sent while it is down can be caught afterwards, which is what that switch is
for.

## Notes

The panel for what the work needs written down and nothing else knows where to
put — the payload that took an hour to get right, the shape a response comes
back in, what the next step was. It is a rail section beside the other five, not
a corner of one of them, because that is what makes it reachable from whichever
panel raised the thing worth writing down.

Notes belong to the **workspace**, like the requests and the captures and for
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

The editor is **Crepe**, Milkdown's batteries-included editor, already here for
the Terminal panel's chat composer. It brings the selection toolbar, the `/`
block menu and the drag handles rather than having them hand-built, and it reads
as part of the studio because `milkdown-theme.css` points its `--crepe-*`
variables at the app's own tokens — one palette, following the theme toggle, with
nothing in the panel that has to know which theme is on. `note-editor.css` is
the sizing, kept apart from the colour for the same reason `chat-composer.css`
is: Crepe's own padding is sized for a full document page, and this pane is one
half of a split workbench.

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
rather than unmounted the way the Terminal panel stacks its sessions. Crepe
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
undo empty the note. Both of those live in `markdown-editor.tsx` rather than in
the note pane, because the templates below are the same editor over a different
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

### Templates

A template is the text a new note starts from — the headings a meeting always
needs, the fields a bug report is useless without. They are made from the
`LayoutTemplate` button in the panel header, from **New from template** on a
right-click, and from **Save as template** on a note that turned out to be worth
starting from again.

**A template is not a note with a flag on it.** It has no folder, no tab and no
place in the strip, and nothing accumulates them the way work accumulates notes.
Filing both in `notes.json` would mean every read of the notes remembering to
filter, and one forgotten filter is a template showing up as a note. So it is
its own listing and its own directory, `note-templates.json` and
`note-templates/<id>.md`, split for the same two reasons a note's body is split
from its listing.

What it _is_ is the same markdown, which is why the manage dialog's right-hand
pane is the note pane's own editor — same block menu, same tables, same
drawings — and why a name typed there is saved on the same 400ms delay as the
text, flushed when the dialog closes rather than confirmed with a button.

A drawing in a template is **copied** into every note made from it
(`cloneDrawingsIn`, the same call `duplicate` leans on), and copied again on the
way in when a note is saved as a template. Sharing the scene would mean every
note made from one template drew on a single canvas, and deleting any of them
took that canvas from all the others.

**Four presets are seeded once** — meeting notes, a bug repro, an API endpoint,
a decision record — on the first read of a workspace that has no templates. From
that moment they are ordinary templates: renameable, editable, and gone for good
when deleted. The guard is a settings flag rather than "is the list empty",
because deleting every template is a thing someone may mean, and an empty list is
the one state that would bring the presets back on the next launch.

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
theme toggle like everything else — and what lets a refused upload say why, since
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

**A picture is what this is for**, and the honest limit is what happens to
anything else. A file dropped into a note that is not one — a PDF, an archive —
is still stored and still named in the note, but nothing will open it again from
there: BlockNote's Download button hands the URL to `window.open`, and the
studio denies a `window.open` in any scheme but `http`, `https` and `mailto`
(`openExternal` in `main.ts`), which is a rule worth more than that button. The
preview says the same thing in its own way, rendering the "missing" line rather
than a `data:` link a browser would refuse to navigate to. Making those files
openable is a save dialog in the main process, not a URL — so it is left undone
rather than half-done.

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
it is closed on quit with the inbox's two.

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

**A picture is inlined too**, as a `data:` URL, because the note holds it under
`note-file://` — a scheme of this app's, which the browser reading this page has
never heard of. That happens to the document rather than to the markup:
`withNoteFileUrls` in `main/note-blocks.ts` swaps the URLs before the walk runs,
so `note-html.ts` keeps one scheme list and sees a URL a browser can follow like
any other. Only the pictures — a `data:` link to a PDF is a navigation Chromium
refuses, so any other kind of file, and any picture whose file has gone, gets the
same "missing" line as a file the page cannot reach. What is deliberately not in
the ETag is the pictures: a note file is written once under a name nothing else
uses, so a picture that changed is a document that changed.

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

## The launch screen

`src/renderer/components/studio/splash.tsx` is what the app opens on, and the
only screen before the workbench. There used to be two — the suspense fallback
while the studio's chunk loaded and a second one while `manifest.json` was read,
each a line of grey text — and the handover between them was a flicker. It is
one component now, timed from one module-level timestamp, so crossing from the
first mount to the second continues the animation instead of restarting it.

It draws the studio in miniature — the rail with dots in the studio's own hues,
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
otherwise be slow: the chat view's tail, the SMTP sink, the tab
strip's ordering. Those run against the real thing rather than a fixture — `test/transcript.ts` appends to a file while the mirror watches it,
`test/inbox.ts` holds an SMTP conversation over a socket — because a
hand-written sample would only check the parser against my memory of the
format.

## Building

```sh
bun run build     # bundle the main process and the renderer
bun run package   # ...then produce an installer with electron-builder
```
