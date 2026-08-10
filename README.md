<div align="center">

<img src="resources/icon.png" alt="Tabula" width="120">

# Tabula

**One window for the applications a project already needs.**

[![CI](https://github.com/tabulapp/tabula/actions/workflows/ci.yml/badge.svg)](https://github.com/tabulapp/tabula/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-43-47848F.svg)](https://electronjs.org)

<img src="docs/screenshots/database.png" alt="The Database panel: a table's rows in the data browser, and the tab strip every panel shares" width="900">

</div>

---

A database client, an HTTP client, a mail catcher, a request bin, a terminal,
and wherever the agent runs: half a dozen applications, half a dozen window
layouts. Switching between them costs more than any one of them saves. Tabula
makes each of them a tab in one window, the way an editor makes files tabs.

There is one **workspace**, holding any number of **folders**: directories
already on this machine, worked on where they are. It deliberately does not
switch, because someone working across a frontend and its API has both open at
once.

## The panels

**Database.** A SQL client. Postgres and MySQL, the schema tree on the left, a
table's rows browsed and edited in place, and the query console as a tab like
any other. Databases the workspace runs in Docker, or ones you connect to.

<img src="docs/screenshots/query-console.png" alt="The query console: a SQL editor above its result grid" width="900">

**API.** An HTTP client. Requests are filed in folders that cascade headers and
params onto what they hold, and `{{variables}}` resolve against the chosen
environment. They are sent from the main process, so there is no page origin,
no CORS preflight, and forbidden headers go out as typed.

<img src="docs/screenshots/api.png" alt="The API panel: a request with its query parameters, and the URL its {{variables}} resolve to" width="900">

**Mail** and **Webhooks.** Mailhog and a request-bin service. An SMTP sink and
a catch-all HTTP endpoint on loopback, catching the mail the project sends and
the callbacks fired at it. Mail is shown as the recipient would see it, and any
capture can be replayed verbatim at any URL.

<img src="docs/screenshots/mail.png" alt="The Mail panel: a captured message with its envelope, and its text alternative" width="900">

<img src="docs/screenshots/webhooks.png" alt="The Webhooks panel: a captured POST with its body, headers and a Replay control" width="900">

**Terminal.** A terminal, plus the agent. A session is a pty in a folder's own
directory, and the folders are listed here, each with the branch it is on. Pick
`claude` instead of a shell and the same session gains a chat view, reading the
transcript the CLI writes.

<img src="docs/screenshots/terminal.png" alt="The Terminal panel: a shell session in a folder, with each folder's branch beside it" width="900">

**Notes.** A scratchpad. Markdown filed in folders and left on disk as plain
`.md` that grep and git can read without this app. `/drawing` opens an
Excalidraw canvas and leaves the result in the note.

<img src="docs/screenshots/notes.png" alt="The Notes panel: a markdown note in the Crepe editor" width="900">

There is no git panel, no code search and no specs panel. All three were
removed rather than left hidden, and your editor and your shell already do the
first two. The MIME parser is Tabula's own rather than a dependency, so the
studio cannot behave differently depending on what you happened to have
installed, and the AI features shell out to `claude -p` rather than an API
needing a key.

## Install

**macOS 12 (Monterey) or newer**, Apple Silicon or Intel. The builds are
**unsigned and not notarized**, so install with `curl` rather than a browser.
macOS quarantines anything a browser hands over, and Gatekeeper then reports
the app as _"damaged"_, which is misleading: nothing is damaged, it is unsigned.

```bash
curl -fsSL https://raw.githubusercontent.com/tabulapp/tabula/main/install.sh | bash
```

That is [`install.sh`](install.sh) in this repository, short enough to read
first. It picks the build for your architecture and copies the app into
`/Applications`, and running it again is how you update. Pass a version to pin
one (`| bash -s 0.0.3`). A `.dmg` from the
[Releases](https://github.com/tabulapp/tabula/releases) page works too, after
`xattr -dr com.apple.quarantine "/Applications/Tabula.app"`. Be clear about
what that means: the check is being **skipped, not passed**.

**Linux x64.** The AppImage from Releases is the whole install. It needs FUSE
(`sudo apt install libfuse2` on Debian and Ubuntu), or
`--appimage-extract-and-run` without it.

**Windows x64.** The `.exe` from Releases is an NSIS installer, also unsigned,
so SmartScreen wants _More info_ then _Run anyway_.

Tabula is developed and used day to day on macOS. The Linux and Windows builds
come out of the same workflow and the tests run on Linux, but they are far less
travelled than that sentence makes them sound; assume rough edges. Docker is
needed only for the workspace's own databases, and `claude` only for agent
sessions and the AI features. Neither is needed to start the app.

## From source

Needs [Bun](https://bun.sh) 1.3+ and Node 20+.

```bash
git clone https://github.com/tabulapp/tabula.git
cd tabula
bun install
bun run dev      # bundles the main process, starts Vite, launches Electron at it
```

`bun run test`, `lint`, `typecheck` and `build` are the rest. A `Makefile`
wraps packaging: `make dmg` for this machine's architecture, `make help` for
the others. Builds are unsigned unless `SIGN=1`.

## Documentation

- **[`docs/design.md`](docs/design.md)**: what each panel is for and why it
  behaves as it does. Read this before changing one.
- **[`CONTRIBUTING.md`](CONTRIBUTING.md)**: the layout, the IPC contract the
  main process and the renderer talk over, and where the seams are.
- **[`SECURITY.md`](SECURITY.md)**: the security model, and how to report a
  vulnerability.

Contributions are welcome. A new database engine, a new agent CLI and a new
panel are all designed to be added to. Small fixes need no ceremony; anything
structural is worth an issue first.

## License

[MIT](LICENSE).
