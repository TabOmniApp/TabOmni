import { mcpUserServerNames } from "../src/shared/api"
import { chosen, describe, serversFrom } from "../src/main/user-mcp"
import { withUserServers } from "../src/main/worktree-chat"
import { check, finish, section } from "./harness"

/**
 * Offering the user's own `claude` servers to a chat here.
 *
 * The pure halves, and they are worth a test each for the same reason: every
 * one of them sits against something this app does not own. `serversFrom` reads
 * a file another program writes and has reshaped before; `mcpUserServerNames`
 * reads a setting this app wrote in some earlier version of itself; and
 * `withUserServers` decides what a turn may call, where being wrong in one
 * direction is a read-only mode that writes and in the other a turn that stalls
 * on a prompt nobody can answer.
 */

section("reading ~/.claude.json")

const config = {
  mcpServers: {
    linear: { type: "http", url: "https://mcp.linear.app/mcp" },
  },
  projects: {
    "/Users/someone/ferry-admin": {
      mcpServers: {
        clickup: { command: "npx", args: ["-y", "@clickup/mcp", "--stdio"] },
      },
      // The rest of what a project entry holds, none of which is a server.
      history: [{ display: "hello" }],
      allowedTools: [],
    },
    "/Users/someone/ferry-api": {
      mcpServers: {
        clickup: { command: "npx", args: ["-y", "@clickup/mcp"] },
      },
    },
  },
}

const servers = serversFrom(config)

check("lists the user's own and the projects'", servers.length === 2, servers)

check(
  "the user scope comes first",
  servers[0]?.name === "linear" && servers[0]?.scope === "user",
  servers[0]
)

check("a user server has no project", servers[0]?.project === null)

check(
  "a project server says which directory it came from",
  servers[1]?.name === "clickup" &&
    servers[1]?.scope === "project" &&
    servers[1]?.project === "/Users/someone/ferry-admin",
  servers[1]
)

// Two projects configuring the same server is the ordinary case — it is one
// server added twice — and listing it twice would be two switches for one
// thing, either of which silently wins.
check(
  "the same name in two projects is listed once",
  servers.filter((server) => server.name === "clickup").length === 1
)

check(
  "the config is carried, for the file main writes",
  servers[0]?.config.url === "https://mcp.linear.app/mcp",
  servers[0]?.config
)

section("a config this app did not write")

// Every one of these is a real shape: a machine that has never run the CLI, a
// config from a version that had no servers, and the sort of half-written file
// a crash leaves. None of them may throw — the list is drawn in a dialog.
check("null is no servers", serversFrom(null).length === 0)
check("a string is no servers", serversFrom("nope").length === 0)
check("an array is no servers", serversFrom([1, 2]).length === 0)
check("an empty object is no servers", serversFrom({}).length === 0)

check(
  "a project that is not an object is skipped",
  serversFrom({
    projects: {
      "/a": "broken",
      "/b": { mcpServers: { x: { url: "http://h/" } } },
    },
  }).length === 1
)

check(
  "a server with nothing in it is skipped",
  serversFrom({ mcpServers: { empty: {}, real: { command: "x" } } }).length ===
    1
)

section("what a row says")

check(
  "an http server says its host",
  describe({ type: "http", url: "https://mcp.clickup.com/mcp" }) ===
    "http · mcp.clickup.com"
)

// The type is optional in the CLI's own config, and a URL is what decides it.
check(
  "a url with no type is http",
  describe({ url: "https://mcp.linear.app/mcp" }) === "http · mcp.linear.app"
)

check(
  "sse keeps its own name",
  describe({ type: "sse", url: "https://example.com/sse" }) ===
    "sse · example.com"
)

check(
  "a command says the command and its first argument",
  describe({ command: "npx", args: ["-y", "@clickup/mcp", "--stdio"] }) ===
    "stdio · npx -y"
)

check(
  "a command with no args is the command",
  describe({ command: "server" }) === "stdio · server"
)

// A URL the platform cannot parse is still worth showing: it is what the user
// typed, and it is what they will recognise.
check(
  "an unparseable url is shown as it stands",
  describe({ url: "not a url" }) === "http · not a url"
)

check(
  "a server carrying a token never shows it",
  !describe({
    url: "https://mcp.clickup.com/mcp",
    env: { CLICKUP_TOKEN: "pk_secret" },
  }).includes("pk_secret")
)

section("the stored setting")

check("nothing stored is none of them", mcpUserServerNames(null).length === 0)
check("empty is none of them", mcpUserServerNames("").length === 0)
check(
  "a list is read back",
  mcpUserServerNames('["clickup","linear"]').join() === "clickup,linear"
)
// The failure this is written against: a setting that cannot be read must not
// come out as "everything".
check(
  "broken json is none of them",
  mcpUserServerNames("[clickup").length === 0
)
check("an object is none of them", mcpUserServerNames('{"a":1}').length === 0)
check(
  "non-strings are dropped rather than kept",
  mcpUserServerNames('["clickup",7,null]').join() === "clickup"
)

section("a name with nothing behind it")

// A server removed with `claude mcp remove` has to stop being handed over, and
// the setting goes on holding the name so putting the server back does not mean
// approving it again.
check(
  "a stored name the config no longer has is dropped",
  chosen(servers, ["clickup", "gone"])
    .map((one) => one.name)
    .join() === "clickup"
)

check("nothing chosen is nothing", chosen(servers, []).length === 0)

section("what a mode does with them")

const readOnly = {
  allowed: ["Read", "Grep"],
  refused: ["Write", "Bash"],
  userServers: "refuse",
}
const editing = {
  allowed: ["Read", "Write"],
  refused: ["mcp__tabomni-api__delete_request"],
  userServers: "allow",
}
const asking = { allowed: ["Read"], refused: [], userServers: "ask" }
const bypassing = { refused: [], userServers: "ask" }

const editingTools = withUserServers(editing, ["clickup"])
check(
  "an editing turn may call them without asking",
  editingTools.allowed?.includes("mcp__clickup") === true,
  editingTools.allowed
)
check(
  "and the mode's own list is kept",
  editingTools.allowed?.includes("Write") === true
)

// The whole server, not some of it: nothing in a config file says which of a
// server's tools read and which file a ticket.
const readOnlyTools = withUserServers(readOnly, ["clickup", "linear"])
check(
  "a read-only turn refuses them outright",
  readOnlyTools.refused.includes("mcp__clickup") &&
    readOnlyTools.refused.includes("mcp__linear"),
  readOnlyTools.refused
)
check(
  "refused rather than merely left off the allow list",
  readOnlyTools.allowed?.includes("mcp__clickup") !== true
)

// Neither list is how the question reaches the screen.
const askingTools = withUserServers(asking, ["clickup"])
check(
  "an asking turn leaves them unlisted",
  askingTools.allowed?.includes("mcp__clickup") !== true &&
    askingTools.refused.length === 0
)

check(
  "full access grows no allow list",
  withUserServers(bypassing, ["clickup"]).allowed === undefined
)

// An empty array is a list that allows nothing rather than the absence of one,
// which in `full` is the difference between bypassing and refusing everything.
check(
  "no servers switched on changes nothing",
  withUserServers(bypassing, []).allowed === undefined &&
    withUserServers(editing, []).allowed?.join() === "Read,Write"
)

finish()
