import { useEffect } from "react"
import { cn } from "@/lib/utils"
import {
  File,
  FileText,
  Image,
  Folder,
  Mail,
  Plus,
  ScrollText,
  Settings2,
  Terminal,
} from "lucide-react"

import { useExplorer, type OpenTab } from "@/lib/db/explorer-store"
import { isDirty, isMissing, useFiles } from "@/lib/files/store"
import { gitStateOf, GIT_TONES, useGitStatus } from "@/lib/files/git-status"
import { iconFor } from "@/lib/files/icons"
import { isImage } from "@/lib/files/viewers"
import { SETTINGS_TAB_ID, useApi } from "@/lib/http/store"
import { SETTINGS_TAB, useInbox } from "@/lib/inbox/store"
import { useNotes } from "@/lib/note/store"
import {
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  relationId,
  reorderTabs,
  selectTab,
  useActiveTabId,
} from "@/lib/panels"
import { nameOf } from "@/lib/files/paths"
import { isStudioShortcut } from "@/lib/shortcuts"
import { useStudio, type Pane } from "@/lib/store"
import { arrange, PREFIX } from "@/lib/tabs"
import { SESSION_TYPES, sessionTitle } from "@/lib/terminal/catalog"
import { chatTabId, useConversations } from "@/lib/terminal/conversations"
import { liveSessions, useTerminal } from "@/lib/terminal/store"
import { KIND_ICONS, KIND_LABELS } from "./db/database-tree"
import { METHOD_TONES } from "./api/request-list"
import { IconButton } from "./icon-button"
import { TabStrip, type TabStripItem } from "./tab-strip"

/**
 * One strip of tabs for the whole workbench, above whichever panel is showing.
 *
 * The panels each used to draw their own, which meant that leaving Database
 * for API took the tables off the screen — they were still open, but nothing
 * said so, and coming back was a trip through the rail. Since the strips were
 * identical anyway, they are now one: a table, a request, a spec and a session
 * sit side by side, and clicking any of them goes to the panel that shows it.
 *
 * Tabs open grouped by panel rather than interleaved in the order they were
 * opened, so an untouched strip reads as runs rather than a shuffle. Dragging
 * overrides that and may put a tab anywhere, including between two of another
 * panel's: the arrangement is the user's, and a strip that silently sprang a
 * tab back to its own run was refusing a move for a reason only the code knew.
 *
 * The order that results cannot live in any one panel — a request between two
 * tables is a position none of the three stores has anywhere to record — so it
 * is `tabOrder` on the studio store, and the panels keep only their own
 * membership. `arrange` in `lib/tabs.ts` reconciles the two.
 *
 * What is left here is what a tab *looks* like: its label, its icon and the
 * line it shows on hover, which are the one thing about a tab that is genuinely
 * its panel's. Everything else — which tab the pane is showing, and what
 * picking, closing, reordering one does — is `lib/panels.ts`, where all six
 * panels are addressed alike.
 */
export function WorkspaceTabs({ pane }: { pane: Pane }) {
  const tabOrder = useStudio((state) => state.tabOrder)

  const databaseId = useExplorer((state) => state.databaseId)
  const dbTabs = useExplorer((state) => state.openTabs)
  const openQueryTab = useExplorer((state) => state.openQueryTab)

  const requests = useApi((state) => state.requests)
  const folders = useApi((state) => state.folders)
  const openIds = useApi((state) => state.openIds)

  const inboxMessages = useInbox((state) => state.messages)
  const inboxOpenIds = useInbox((state) => state.openIds)

  const captureItems: TabStripItem[] = inboxOpenIds.flatMap((id) => {
    if (id === SETTINGS_TAB) {
      return [
        {
          id: PREFIX.mail + id,
          label: "Mail settings",
          icon: (
            <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />
          ),
        },
      ]
    }
    const message = inboxMessages.find((candidate) => candidate.id === id)
    if (!message) return []
    return [
      {
        id: PREFIX.mail + id,
        label: message.summary,
        title: `${message.mail.from} \u2192 ${message.mail.to.join(", ")}`,
        icon: <Mail className="size-3.5 shrink-0" />,
      },
    ]
  })

  const notes = useNotes((state) => state.notes)
  const noteOpenIds = useNotes((state) => state.openIds)

  // Filtered here rather than in the selector: `liveSessions` builds a new
  // array, and a selector that never returns the same reference twice re-renders
  // on every store write.
  const allSessions = useTerminal((state) => state.sessions)
  // The strip is the running sessions. A closed one is a row in the Terminal
  // sidebar and nothing else — it has no pty, so there is no pane for a tab
  // here to switch to.
  const sessions = liveSessions(allSessions)

  const fileOpenIds = useFiles((state) => state.openIds)
  const fileDocs = useFiles((state) => state.docs)
  const fileEntries = useFiles((state) => state.entries)
  // The whole record rather than one lookup: this builds every tab in a loop,
  // and the store changes only when a `git status` comes back.
  const gitStatus = useGitStatus()
  const chats = useConversations((state) => state.open)

  /** Every open tab, grouped by panel — the order a strip nobody has dragged
   * in is shown in, and the fallback `arrange` places new tabs against. */
  const grouped: TabStripItem[] = [
    ...fileOpenIds.map((filePath) => {
      const git = gitStateOf(gitStatus, filePath)
      // A tab is the one place a deleted file is still visible — the tree
      // lists what is on disk, so the row went with the file. Either source
      // answers: git knows a tracked file was deleted, and the listing the
      // tree holds knows an untracked one was, which git stops mentioning the
      // moment it is gone.
      const deleted =
        git === "deleted" || isMissing({ entries: fileEntries }, filePath)

      return {
        id: PREFIX.files + filePath,
        // The file's name, not its path: a strip of absolute paths is a strip
        // of one repeated prefix. The path is on the tab's own hover line, and
        // in the pane's header above the editor.
        label: nameOf(filePath),
        title: filePath,
        copyText: filePath,
        copyLabel: "Copy path",
        // The same icon the tree draws, so a tab and the row it came from are
        // recognisably the same file.
        icon: iconOf(filePath),
        // The same dot the tree marks the row with: whichever of the two is
        // being looked at says the file has edits that are not on disk. The
        // strip has had this since it was the editor's own — no panel until now
        // had a tab that could be unsaved.
        dirty: isDirty(fileDocs[filePath]),
        // And the same colour, so a tab and its row agree about what the file
        // is. `deleted` wins whatever git last said, because it is the state
        // that makes the tab the only thing left of the file.
        tone: deleted ? GIT_TONES.deleted : git ? GIT_TONES[git] : undefined,
        note: deleted ? "deleted" : undefined,
      }
    }),
    // Beside the files because they are the same pane's — a conversation opened
    // from the Explorer sidebar, read and not run. The session icon, since it is
    // the same kind of thing as a `claude` tab; what says it is not running is
    // the pane's own header.
    ...chats.map((conversation) => ({
      id: PREFIX.files + chatTabId(conversation.id),
      label: conversation.title,
      title: `${conversation.title}\nclaude --resume ${conversation.id}`,
      copyText: conversation.id,
      copyLabel: "Copy session id",
      icon: <ScrollText className="size-3.5 shrink-0 text-muted-foreground" />,
    })),
    ...(databaseId ? dbTabs.map(dbItem) : []),
    ...openIds.flatMap((id) => {
      if (id === SETTINGS_TAB_ID) {
        return [
          {
            id: PREFIX.api + id,
            label: "API settings",
            icon: (
              <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />
            ),
          },
        ]
      }
      const request = requests.find((candidate) => candidate.id === id)
      if (request) {
        return [
          {
            id: PREFIX.api + id,
            label: request.name,
            title: `${request.method} ${request.url}`,
            copyText: request.url,
            copyLabel: "Copy URL",
            icon: (
              <span
                className={cn(
                  "shrink-0 font-mono text-[0.6rem] font-semibold",
                  METHOD_TONES[request.method] ?? "text-muted-foreground"
                )}
              >
                {request.method}
              </span>
            ),
          },
        ]
      }
      const folder = folders.find((candidate) => candidate.id === id)
      if (!folder) return []
      return [
        {
          id: PREFIX.api + id,
          label: folder.name,
          icon: <Folder className="size-3 shrink-0 text-muted-foreground" />,
        },
      ]
    }),
    ...captureItems,
    ...sessions.map((session, index) => {
      const { icon: Icon } = SESSION_TYPES[session.kind]
      const label = sessionTitle(sessions, index)

      return {
        id: PREFIX.terminal + session.id,
        label,
        icon: <Icon className="size-3.5 shrink-0" />,
        title: session.exited ? `${label} — ended` : label,
      }
    }),
    ...noteOpenIds.flatMap((id) => {
      const note = notes.find((candidate) => candidate.id === id)
      if (!note) return []
      return [
        {
          id: PREFIX.note + id,
          label: note.name,
          icon: <FileText className="size-3.5 shrink-0" />,
          title: note.name,
        },
      ]
    }),
  ]

  const items = arrange(grouped, tabOrder)

  const activeId = useActiveTabId(pane)

  /*
   * ⌘W closes the tab the pane is showing, the way an editor's does.
   *
   * Answered here because the strip is where the key belongs: the File menu
   * cannot claim the accelerator — see `registerAccelerator` in
   * `electron/menu.ts` — so it displays the key and sends the intent, and this
   * is where both arrive.
   *
   * With an empty strip the key is left alone rather than swallowed: there is
   * no tab to close, and the window's own ⇧⌘W is the menu's.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isStudioShortcut(event, "w")) return
      if (!activeId) return

      event.preventDefault()
      closeTab(activeId)
    }

    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true })
    }
  }, [activeId])

  // The same intent from the menu, which is the way to it without a keyboard —
  // and, on the platforms where a session's terminal keeps Ctrl+W, the way to
  // it from a terminal.
  useEffect(
    () =>
      window.desktop.onMenuCommand((command) => {
        if (command === "close-tab" && activeId) closeTab(activeId)
      }),
    [activeId]
  )

  return (
    <TabStrip
      label="Open tabs"
      items={items}
      activeId={activeId}
      trailing={
        // Only the query tab: a new session and a new request are both
        // buttons in their own sidebar already, and a query tab has nowhere
        // else to be started from.
        pane === "database" ? (
          <IconButton
            label="New query tab"
            disabled={!databaseId}
            onClick={() => openQueryTab()}
          >
            <Plus />
          </IconButton>
        ) : undefined
      }
      onSelect={selectTab}
      onClose={closeTab}
      onCloseOthers={closeOtherTabs}
      onCloseAll={closeAllTabs}
      onReorder={reorderTabs}
    />
  )
}

/** A file's icon: the vendored file-type one, or the glyph the studio uses for
 * anything it has no icon checked in for. */
function iconOf(filePath: string) {
  const url = iconFor(filePath)
  if (url) {
    return <img src={url} alt="" aria-hidden className="size-3.5 shrink-0" />
  }
  return isImage(filePath) ? (
    <Image className="size-3.5 shrink-0" />
  ) : (
    <File className="size-3.5 shrink-0" />
  )
}

function dbItem(tab: OpenTab): TabStripItem {
  if (tab.kind === "query") {
    return {
      id: PREFIX.database + tab.query.id,
      label: tab.query.title,
      icon: <Terminal className="size-3.5 shrink-0" />,
      title: tab.query.title,
    }
  }

  const Icon = KIND_ICONS[tab.relation.kind]
  const id = relationId(tab.relation)
  return {
    id: PREFIX.database + id,
    label: tab.relation.name,
    icon: <Icon className="size-3.5 shrink-0" />,
    title: `${id} — ${KIND_LABELS[tab.relation.kind]}`,
    copyText: id,
  }
}
