import { useEffect, useState, type ReactNode } from "react"
import { useTheme } from "next-themes"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  Columns2,
  MessagesSquare,
  Palette,
  Plug,
  type LucideIcon,
} from "lucide-react"

import type { McpServerName } from "@shared/api"
import { useSettings, type TabsPlacement } from "@/lib/settings"

/**
 * The studio's preferences — **Settings…** in the application menu, ⌘,.
 *
 * A dialog rather than a panel with a tab of its own: what is here is about
 * the workbench itself rather than about anything in the workspace, and a
 * preference read once and closed does not want a place in the strip beside
 * the files it is being read about. It is also the only honest home for a
 * setting whose effect *is* the strip — a tab is a poor place to be holding
 * the switch that moves the tabs.
 *
 * Laid out the way every settings window of this shape is: sections down the
 * left, one section's rows on the right, each row a name and a sentence with
 * its control at the far end. That is not decoration — it is what keeps the
 * dialog the same size as it grows. A single scrolling column is fine for the
 * three settings there are today and stops being fine at ten, and a list of
 * sections is also the only thing that says what *kinds* of preference exist
 * without reading all of them.
 *
 * There is no Save: a preference applies as it is picked, which is what makes
 * the studio behind the dialog its own preview. Everything written here goes
 * through `lib/settings.ts` and lands in the workspace's own settings, so it
 * survives a relaunch the way the strip's arrangement does.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<SectionId>("appearance")

  const current = SECTIONS.find((candidate) => candidate.id === section)!

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="grid h-[34rem] max-h-[85vh] w-full grid-cols-[12rem_1fr] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <nav
          aria-label="Settings sections"
          className="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r bg-muted/30 p-2"
        >
          <p className="px-2 pt-1 pb-2 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
            Options
          </p>
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              // `aria-current` rather than `role="tab"`: these are pages of a
              // dialog, not tabs of a panel, and the panel beside them is not
              // a tabpanel anyone should be able to arrow through.
              aria-current={id === section ? "page" : undefined}
              onClick={() => setSection(id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                id === section
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-col">
          {/* `pr-12` clears the close button, which the dialog draws in the
              corner over whatever is there. */}
          <header className="shrink-0 border-b px-5 py-4 pr-12">
            <DialogTitle>{current.label}</DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              {current.blurb}
            </DialogDescription>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {section === "appearance" ? (
              <AppearanceSection />
            ) : section === "tabs" ? (
              <TabsSection />
            ) : section === "chat" ? (
              <ChatSection />
            ) : (
              <McpSection />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type SectionId = "appearance" | "tabs" | "chat" | "mcp"

/** The sections, in the order they are listed. Each one is a heading, a line
 * saying what it covers, and the rows below — kept together so adding a
 * section is one entry rather than three edits. */
const SECTIONS: {
  id: SectionId
  label: string
  blurb: string
  icon: LucideIcon
}[] = [
  {
    id: "appearance",
    label: "Appearance",
    blurb: "How the studio looks.",
    icon: Palette,
  },
  {
    id: "tabs",
    label: "Tabs",
    blurb: "Where the workbench's tab strip sits, and how much it gathers.",
    icon: Columns2,
  },
  {
    id: "chat",
    label: "Chat",
    blurb: "How much of an agent's turn a conversation shows.",
    icon: MessagesSquare,
  },
  {
    id: "mcp",
    label: "MCP",
    blurb: "What an agent session may reach in this workspace.",
    icon: Plug,
  },
]

function AppearanceSection() {
  // `theme` is the choice, `resolvedTheme` what it came out as — the choice is
  // what a settings row is asking about, so `system` stays visible as `system`
  // rather than as whichever of the two it happens to be right now.
  const { theme, setTheme } = useTheme()

  return (
    <Card>
      <Row
        title="Theme"
        description="Follow the system, or pin the studio to one of the two."
      >
        <Segmented
          value={theme ?? "system"}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onPick={setTheme}
        />
      </Row>
    </Card>
  )
}

function TabsSection() {
  const tabsPlacement = useSettings((state) => state.tabsPlacement)
  const setTabsPlacement = useSettings((state) => state.setTabsPlacement)
  const groupTabs = useSettings((state) => state.groupTabs)
  const setGroupTabs = useSettings((state) => state.setGroupTabs)

  return (
    <Card>
      {/*
        Off by default: the strip somebody already has is the one they chose,
        and a preference that rearranges every open tab the first time the app
        launches is not a default, it is a surprise.

        The sessions are not mentioned because they are not affected — they have
        always been gathered this way, for a reason that is theirs alone: a tab
        there stands for a process rather than for something the user opened.
      */}
      <Row
        title="Group tabs by folder"
        description="One tab per folder in the strip, with that folder's own files, requests or notes in a second strip inside it. Off, every file and request is a tab of its own."
      >
        <Switch checked={groupTabs} onCheckedChange={setGroupTabs} />
      </Row>
      <Row
        stacked
        title="Tab strip"
        description="Vertical tabs put the strip down the right-hand side of the pane, where a long name has a row to itself instead of being truncated. Drag the edge between the two to set how wide it is."
      >
        <div role="radiogroup" className="grid grid-cols-2 gap-3">
          <PlacementOption
            value="top"
            current={tabsPlacement}
            label="Horizontal tabs"
            hint="A row above the pane"
            onPick={setTabsPlacement}
          />
          <PlacementOption
            value="right"
            current={tabsPlacement}
            label="Vertical tabs"
            hint="A column on the right"
            onPick={setTabsPlacement}
          />
        </div>
      </Row>
    </Card>
  )
}

function ChatSection() {
  const showToolCalls = useSettings((state) => state.showToolCalls)
  const setShowToolCalls = useSettings((state) => state.setShowToolCalls)
  const showThinking = useSettings((state) => state.showThinking)
  const setShowThinking = useSettings((state) => state.setShowThinking)

  return (
    <div className="space-y-4">
      <Card>
        <Row
          title="Tool calls"
          description="Every file read, command run and edit made, in the order the agent made them."
        >
          <Switch checked={showToolCalls} onCheckedChange={setShowToolCalls} />
        </Row>
        <Row
          title="Thinking"
          description="What the model worked through on the way to an answer, one folded line each. Only a turn that was actually thinking has any — that is the effort picked on the chat toolbar."
        >
          <Switch checked={showThinking} onCheckedChange={setShowThinking} />
        </Row>
      </Card>

      {/* Both are on by default now that a turn's working is folded into one
          line rather than laid out in full — these decide what is inside the
          fold, not how much of the pane it takes. */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        A turn shows its answer with everything it did on the way gathered into
        a single line above it. Click that line to open it.
      </p>
    </div>
  )
}

/**
 * The three MCP servers, off until somebody says otherwise.
 *
 * Off is the default and the only defensible one: these hand a `claude`
 * session the workspace's databases, the requests saved against them and the
 * notes written about them, and that is a decision rather than a convenience.
 * Each one is its own switch for the same reason — letting an agent read a
 * schema is not the same as letting it send a saved request.
 */
function McpSection() {
  const mcp = useSettings((state) => state.mcp)
  const setMcpEnabled = useSettings((state) => state.setMcpEnabled)

  // Re-read every time the section is shown rather than at launch: `claude mcp
  // add` is run in the dock's Terminal, and the moment somebody comes here is
  // the moment they expect to find what they just added.
  const loadUserServers = useSettings((state) => state.loadUserServers)
  useEffect(() => {
    void loadUserServers()
  }, [loadUserServers])

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Card>
          {MCP_ROWS.map(({ server, title, description }) => (
            <Row key={server} title={title} description={description}>
              <Switch
                checked={mcp[server]}
                onCheckedChange={(next) => setMcpEnabled(server, next)}
              />
            </Row>
          ))}
        </Card>

        <p className="text-xs leading-relaxed text-muted-foreground">
          A session picks these up when it starts, so a session already running
          keeps whatever it was started with — restart it to change what it can
          reach. Turning one off stops the tools working straight away, running
          session or not.
        </p>
      </div>

      <UserServers />
    </div>
  )
}

/**
 * The servers the user's own `claude` has, offered one at a time.
 *
 * A chat here runs with a config this app wrote and `--strict-mcp-config`, so
 * nothing in the CLI's own config reaches it — which is right, and is also why
 * this list exists: the alternative to a switch per server is either inheriting
 * a config this app never saw or telling somebody their issue tracker is
 * unreachable from the chat editing the branch the issue is about. Switching
 * one on copies it into the config a turn is handed. Nothing here is read
 * except to list it: the `env` a server carries stays in main.
 *
 * A word about what a read-only chat does with them, because it is the one
 * thing that is not obvious from a switch: `Plan` and `Read only` refuse these
 * outright. Nothing in a config file says which of a server's tools read and
 * which file a ticket, and a read-only turn that finds out by calling one was
 * never read-only.
 */
function UserServers() {
  const servers = useSettings((state) => state.userServers)
  const loaded = useSettings((state) => state.userServersLoaded)
  const enabled = useSettings((state) => state.mcpUserServers)
  const setMcpUserServer = useSettings((state) => state.setMcpUserServer)

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm leading-none font-medium">Your own servers</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          The MCP servers your <code>claude</code> is configured with. Off until
          you say otherwise, and switched on one at a time: a chat here is
          handed what this app was told to hand it, never whatever config a
          directory happens to be under.
        </p>
      </div>

      {servers.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-xs leading-relaxed text-muted-foreground">
          {loaded
            ? "None configured. `claude mcp add` in the dock's Terminal adds one, and it will be listed here."
            : "Reading your Claude Code config…"}
        </p>
      ) : (
        <Card>
          {servers.map((server) => (
            <Row
              key={server.name}
              title={server.name}
              description={
                server.scope === "project"
                  ? `${server.detail} · added under ${server.project}`
                  : server.detail
              }
            >
              <Switch
                checked={enabled.includes(server.name)}
                onCheckedChange={(next) => setMcpUserServer(server.name, next)}
              />
            </Row>
          ))}
        </Card>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        A server added under a project is offered here too. A checkout lives
        outside the project it is a branch of, so matching by directory would
        hide exactly the servers a chat wants — and a switch here belongs to the
        whole workspace rather than to one checkout.
      </p>
    </div>
  )
}

/** What each server puts in front of an agent, in the words somebody deciding
 * whether to turn it on needs. */
const MCP_ROWS: {
  server: McpServerName
  title: string
  description: string
}[] = [
  {
    server: "database",
    title: "Databases",
    description:
      "Lists the workspace's databases and their tables, and runs SQL against them — the same connections the Database panel uses, writes included.",
  },
  {
    server: "api",
    title: "API requests",
    description:
      "Reads the saved requests and sends them against the active environment. A sent request is a real one: it reaches whatever the environment points at.",
  },
  {
    server: "notes",
    title: "Notes",
    description:
      "Reads the workspace's notes as markdown and can write new ones. It never overwrites a note that already exists.",
  },
]

/** The box a section's rows sit in — one border around the group rather than
 * one per row, so a section of three reads as three rows of one thing. */
function Card({ children }: { children: ReactNode }) {
  return <div className="divide-y rounded-lg border">{children}</div>
}

/**
 * One setting: what it is, what it does, and the control for it.
 *
 * `stacked` for a control too big to sit at the end of the line — the tab
 * strip's two pictures — which is the same row with the control on its own
 * line rather than a second kind of row.
 */
function Row({
  title,
  description,
  stacked,
  children,
}: {
  title: string
  description: string
  stacked?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn("p-4", stacked ? "space-y-3" : "flex gap-6")}>
      <div className={cn("min-w-0 space-y-1", !stacked && "flex-1")}>
        <p className="text-sm leading-none font-medium">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div className={cn(!stacked && "flex shrink-0 items-center")}>
        {children}
      </div>
    </div>
  )
}

/** A handful of exclusive choices, short enough to show all at once. */
function Segmented({
  value,
  options,
  onPick,
}: {
  value: string
  options: { value: string; label: string }[]
  onPick: (value: string) => void
}) {
  return (
    <div role="radiogroup" className="flex rounded-md border bg-muted/40 p-0.5">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(option.value)}
            className={cn(
              "rounded-[5px] px-2.5 py-1 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "bg-background font-medium text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * One of the two tab layouts, with a miniature of it.
 *
 * The whole card is the control rather than a radio with a card next to it:
 * what is being chosen is a picture, and a target the size of the picture is
 * the one people aim at. It keeps the radio's semantics — `role="radio"` and
 * `aria-checked` — so it is still a group of two to anything reading the
 * dialog rather than two unrelated buttons.
 *
 * The drawing is three boxes rather than an icon: what moves is a whole region
 * of the window, and the shortest way to say which one is to show the window.
 */
function PlacementOption({
  value,
  current,
  label,
  hint,
  onPick,
}: {
  value: TabsPlacement
  current: TabsPlacement
  label: string
  hint: string
  onPick: (value: TabsPlacement) => void
}) {
  const active = current === value
  const vertical = value === "right"

  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => onPick(value)}
      className={cn(
        "flex cursor-pointer flex-col items-stretch gap-2 rounded-lg border p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "border-primary bg-accent/40"
          : "hover:bg-accent/20 hover:text-foreground"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-16 gap-1 rounded-md border bg-muted/40 p-1",
          vertical ? "flex-row-reverse" : "flex-col"
        )}
      >
        {/* The strip, with two tabs in it — the front one lit. */}
        <span
          className={cn(
            "flex shrink-0 gap-0.5 rounded-sm bg-primary/10 p-0.5",
            vertical ? "w-7 flex-col" : "h-3 flex-row"
          )}
        >
          <span
            className={cn(
              "rounded-[2px] bg-primary/70",
              vertical ? "h-1.5 w-full" : "h-full w-5"
            )}
          />
          <span
            className={cn(
              "rounded-[2px] bg-primary/25",
              vertical ? "h-1.5 w-full" : "h-full w-4"
            )}
          />
        </span>
        {/* The pane the tabs are for. */}
        <span className="flex-1 rounded-sm bg-background" />
      </span>

      <span className="flex items-center gap-2">
        {/* The radio's own dot, drawn here because the card is the radio. */}
        <span
          aria-hidden
          className={cn(
            "grid size-4 shrink-0 place-items-center rounded-full border",
            active ? "border-primary bg-primary" : "border-input"
          )}
        >
          {active && (
            <span className="size-2 rounded-full bg-primary-foreground" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium">{label}</span>
          <span className="block truncate text-[0.7rem] text-muted-foreground">
            {hint}
          </span>
        </span>
      </span>
    </button>
  )
}
