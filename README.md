<div align="center">

<img src="docs/banner.svg" alt="TabOmni: databases, HTTP endpoints, mail, webhooks, shells and notes all flowing into one window, and out as one tab strip" width="900">

# TabOmni

**One window for the applications a project already needs.**

[![CI](https://github.com/TabOmniApp/TabOmni/actions/workflows/ci.yml/badge.svg)](https://github.com/TabOmniApp/TabOmni/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-43-47848F.svg)](https://electronjs.org)

</div>

---

A database client, an HTTP client, a mail catcher, a request bin, a terminal,
and wherever the agent runs: half a dozen applications, half a dozen window
layouts. Switching between them costs more than any one of them saves. TabOmni
makes each of them a tab in one window, the way an editor makes files tabs.

There is one **workspace**, holding any number of **folders**: directories
already on this machine, worked on where they are. It deliberately does not
switch, because someone working across a frontend and its API has both open at
once.

The panels are Database, API, Mail, Webhooks, Terminal and Notes, and
[`docs/design.md`](docs/design.md) is what each one is for and why it behaves as
it does. There is no git panel, no code search and no specs panel. All three
were removed rather than left hidden, and your editor and your shell already do
the first two. The MIME parser is TabOmni's own rather than a dependency, so the
studio cannot behave differently depending on what you happened to have
installed, and the AI features shell out to `claude -p` rather than an API
needing a key.

## Install

Every build is **unsigned**, so each OS objects in its own way. That is what the
last line of each section is about.

### macOS

macOS 12 (Monterey) or newer, Apple Silicon or Intel.

```bash
curl -fsSL https://raw.githubusercontent.com/TabOmniApp/TabOmni/main/install.sh | bash
```

[`install.sh`](install.sh) picks the build for your architecture and copies it
into `/Applications`. Run it again to update, or `| bash -s 1.0.0` to pin a
version.

Use `curl` rather than a browser: macOS quarantines a download and Gatekeeper
then calls the app _"damaged"_, which only ever means unsigned. A `.dmg` from
[Releases][releases] works too, after
`xattr -dr com.apple.quarantine "/Applications/TabOmni.app"` — which skips the
check rather than passing it.

### Linux

x64. The AppImage from [Releases][releases] is the whole install.

```bash
chmod +x TabOmni-*-x64.AppImage
./TabOmni-*-x64.AppImage
```

It needs FUSE (`sudo apt install libfuse2` on Debian and Ubuntu), or
`--appimage-extract-and-run` without it.

### Windows

x64. The `.exe` from [Releases][releases] is an NSIS installer. SmartScreen
stops it: _More info_ → _Run anyway_.

[releases]: https://github.com/TabOmniApp/TabOmni/releases

TabOmni is developed and used day to day on macOS; the Linux and Windows builds
come out of the same workflow and the tests run on Linux, but assume rough
edges. Docker is needed only for the workspace's own databases and `claude`
only for agent sessions and the AI features — neither to start the app.

## From source

Needs [Bun](https://bun.sh) 1.3+ and Node 20+.

```bash
git clone https://github.com/TabOmniApp/TabOmni.git
cd tabomni
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
