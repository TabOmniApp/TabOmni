import { cn } from "@/lib/utils"
import {
  Columns3,
  File,
  FileText,
  Folder,
  GitCompare,
  Image,
  Loader2,
  MessageSquare,
  Settings2,
  ShieldQuestion,
  Terminal,
} from "lucide-react"

import { unfinishedCount } from "@/lib/board/cards"
import { useBoard } from "@/lib/board/store"
import { useExplorer, type OpenTab } from "@/lib/db/explorer-store"
import { useChanges } from "@/lib/files/changes"
import { isDeleted, isDirty, useFiles } from "@/lib/files/store"
import { gitStateOf, GIT_TONES, useGitStatus } from "@/lib/files/git-status"
import { iconFor } from "@/lib/files/icons"
import { nameOf } from "@/lib/files/paths"
import { isImage, isNote } from "@/lib/files/viewers"
import { groupRootId } from "@/lib/panels"
import { SETTINGS_TAB_ID, useApi } from "@/lib/http/store"
import { useNotes } from "@/lib/note/store"
import { relationId, useTabGroups } from "@/lib/panels"
import { useStudio, type Pane } from "@/lib/store"
import { groupTabId, PREFIX } from "@/lib/tabs"
import { useWorktreeChats } from "@/lib/worktree-chat/store"
import { KIND_ICONS, KIND_LABELS } from "./db/database-tree"
import { METHOD_TONES } from "./api/request-list"
import type { TabStripItem } from "./tab-strip"

/**
 * What every open tab looks like, by the id the strip addresses it with.
 *
 * The one thing about a tab that is genuinely its own panel's — its label, its
 * icon, the line it shows on hover, the dot on a file with unsaved edits. Both
 * strips draw from this: the workbench's, which holds a mixture of five
 * panels', and the one inside a folder's tab, which holds one panel's members.
 * They were the same code twice for as long as the second one existed.
 *
 * Keyed by strip id, so a caller with a list of ids has nothing left to decide.
 * A group's own tab is in here too, under `api:@<folderId>` — see `groupItem`
 * for what a folder's tab says that its members do not.
 */
export function useTabItems(): Map<string, TabStripItem> {
  const requests = useApi((state) => state.requests)
  const apiFolders = useApi((state) => state.folders)
  const apiOpenIds = useApi((state) => state.openIds)

  const databaseId = useExplorer((state) => state.databaseId)
  const dbTabs = useExplorer((state) => state.openTabs)

  const notes = useNotes((state) => state.notes)
  const noteFolders = useNotes((state) => state.folders)
  const noteOpenIds = useNotes((state) => state.openIds)

  const chats = useWorktreeChats((state) => state.chats)
  const chatOpenIds = useWorktreeChats((state) => state.openIds)
  const chatSending = useWorktreeChats((state) => state.sending)
  // A held turn is not a working one, and the strip is where a chat that is
  // waiting on somebody has to say so: the pane's card is only visible to
  // whoever is already looking at that chat, and the spinner beside a tab reads
  // as "still going" — which is exactly the answer that stops you clicking it.
  const chatAsks = useWorktreeChats((state) => state.asks)

  const changesOpenIds = useChanges((state) => state.openIds)
  const changesByRoot = useChanges((state) => state.byRoot)

  const boardOpenIds = useBoard((state) => state.openIds)
  const boardCards = useBoard((state) => state.cards)
  // The columns too, because what the badge counts is the cards that are not in
  // the **last** one, and which column that is, is the project's own to decide.
  const boardColumns = useBoard((state) => state.columns)

  const fileOpenIds = useFiles((state) => state.openIds)
  // The one tab drawn in italics: a file being looked at rather than kept.
  const filePreviewId = useFiles((state) => state.previewId)
  const fileDocs = useFiles((state) => state.docs)
  const fileEntries = useFiles((state) => state.entries)
  // The whole record rather than one lookup: this builds every tab in a loop,
  // and the store changes only when a `git status` comes back.
  const gitStatus = useGitStatus()

  const workspaceFolders = useStudio((state) => state.folders)

  const groups = useTabGroups()

  const items = new Map<string, TabStripItem>()
  const add = (item: TabStripItem) => items.set(item.id, item)

  for (const filePath of fileOpenIds) {
    const git = gitStateOf(gitStatus, filePath)
    // A tab is the one place a deleted file is still visible — the tree lists
    // what is on disk, so the row went with the file. Which of git and the
    // tree's listing gets to say so is `isDeleted`, and worth reading before
    // trusting either.
    const deleted = isDeleted(git, { entries: fileEntries }, filePath)

    add({
      id: PREFIX.files + filePath,
      // The file's name, not its path: a strip of absolute paths is a strip of
      // one repeated prefix. The path is on the tab's own hover line, and in
      // the pane's header above the editor.
      label: nameOf(filePath),
      title: filePath,
      copyText: filePath,
      copyLabel: "Copy path",
      // The same icon the tree draws, so a tab and the row it came from are
      // recognisably the same file.
      icon: iconOf(filePath),
      // The same dot the tree marks the row with: whichever of the two is being
      // looked at says the file has edits that are not on disk.
      dirty: isDirty(fileDocs[filePath]),
      // The editors' own mark for a preview tab. Nothing else in a strip is
      // italic, so it reads as "this one is not staying" without a legend.
      italic: filePath === filePreviewId,
      // And the same colour, so a tab and its row agree about what the file is.
      // `deleted` wins whatever git last said, because it is the state that
      // makes the tab the only thing left of the file.
      tone: deleted ? GIT_TONES.deleted : git ? GIT_TONES[git] : undefined,
      note: deleted ? "deleted" : undefined,
    })
  }

  if (databaseId) for (const tab of dbTabs) add(dbItem(tab))

  for (const id of apiOpenIds) {
    if (id === SETTINGS_TAB_ID) {
      add({
        id: PREFIX.api + id,
        label: "API settings",
        icon: <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />,
      })
      continue
    }

    const request = requests.find((candidate) => candidate.id === id)
    if (request) {
      add({
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
      })
      continue
    }

    const folder = apiFolders.find((candidate) => candidate.id === id)
    if (folder) {
      add({
        id: PREFIX.api + id,
        label: folder.name,
        icon: <Folder className="size-3 shrink-0 text-muted-foreground" />,
      })
    }
  }

  /*
   * `Changes`, one per checkout — the diff of whichever file the Explorer's
   * `Changes` list has picked.
   *
   * The label is the same word for every one of them, which is the point: the
   * tab is about reviewing *here*, and *here* is said by the strip already — a
   * tab is in it only while its project is the one being worked in. Not the
   * file's name either, which would make one tab look like the twelve this
   * exists to avoid. The project goes on the hover line, as a chat's does, and
   * the count rides along as the `note`, since a tab that says how much is
   * waiting is the reason to look at it.
   */
  for (const rootId of changesOpenIds) {
    const folder = workspaceFolders.find((entry) => entry.id === rootId)?.name
    const count = changesByRoot[rootId]?.length

    add({
      id: PREFIX.changes + rootId,
      label: "Changes",
      icon: <GitCompare className="size-3.5 shrink-0" />,
      // Nothing until the first read, and nothing for a clean project: a badge
      // reading zero is a thing to notice saying there is nothing to notice.
      note: count ? String(count) : undefined,
      title: folder ?? "Changes",
    })
  }

  /*
   * `Board`, one per project — the same wording argument as `Changes` above:
   * the tab is about *this* project's board, and which project that is, the
   * strip already says by holding the tab only while that project is the one
   * being worked in. The count is what is **not** done, since a board whose
   * every card is finished is not a board to go and look at.
   */
  for (const rootId of boardOpenIds) {
    const folder = workspaceFolders.find((entry) => entry.id === rootId)?.name
    const waiting = unfinishedCount(boardCards, boardColumns, rootId)

    add({
      id: PREFIX.board + rootId,
      label: "Board",
      icon: <Columns3 className="size-3.5 shrink-0" />,
      note: waiting ? String(waiting) : undefined,
      title: folder ?? "Board",
    })
  }

  /*
   * A project's chats, named by what was first asked in them.
   *
   * `Untitled` until there is something to name it after, which is what the
   * record already says: a title asked of the model would be a second turn to
   * pay for and wait on, for something the first line says.
   */
  for (const id of chatOpenIds) {
    const chat = chats.find((candidate) => candidate.id === id)
    if (!chat) continue

    // Which project it is in, on hover, because the label cannot carry it:
    // ungrouped, two chats in two projects are two titles side by side with
    // nothing saying which is which.
    const where = workspaceFolders.find(
      (folder) => folder.id === chat.folderId
    )?.name

    const waiting = chatAsks[id] !== undefined
    const title = where ? `${chat.title} — ${where}` : chat.title

    add({
      id: PREFIX.worktree + id,
      label: chat.title,
      // Waiting wins over working: both are true while an ask is up — the turn
      // is held rather than finished — and only one of them is something to do.
      icon: waiting ? (
        <ShieldQuestion className="size-3.5 shrink-0 animate-pulse text-primary" />
      ) : chatSending.includes(id) ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <MessageSquare className="size-3.5 shrink-0" />
      ),
      title: waiting ? `${title} — waiting for your answer` : title,
    })
  }

  for (const id of noteOpenIds) {
    const note = notes.find((candidate) => candidate.id === id)
    if (!note) continue
    add({
      id: PREFIX.note + id,
      label: note.name,
      icon: <FileText className="size-3.5 shrink-0" />,
      title: note.name,
    })
  }

  /*
   * And the folders' own tabs, for whichever panels are grouping.
   *
   * Built from the members above rather than beside them: what a folder's tab
   * says is what its members say, gathered — the icon of the one on screen, the
   * dot if any of them is unsaved, and how many there are.
   */
  for (const { pane, group, members, shown } of groups) {
    const memberItems = members.flatMap((member) => {
      const item = items.get(PREFIX[pane] + member)
      return item ? [item] : []
    })
    const front = items.get(PREFIX[pane] + shown) ?? memberItems[0]
    if (!front) continue

    const name = groupName(pane, group, {
      workspaceFolders,
      apiFolders,
      noteFolders,
    })

    add({
      id: groupTabId(pane, group),
      label: name,
      // The icon of the tab it is showing, so the strip says what is on screen
      // rather than only which folder it came from.
      icon: front.icon,
      title: `${name} — ${front.label}`,
      // A folder is unsaved if anything filed under it is: the dot has to
      // survive being folded away, or closing the tab would be the first thing
      // to mention the edits inside it.
      dirty: memberItems.some((item) => item.dirty),
      // Only from the second onwards — a folder holding one tab has nothing to
      // count, and the number would read as part of the name.
      note: members.length > 1 ? String(members.length) : undefined,
    })
  }

  return items
}

/** A group's own name: the folder it stands for, or what the panel calls the
 * tabs that are filed under nothing. */
function groupName(
  pane: Pane,
  group: string,
  lists: {
    workspaceFolders: { id: string; name: string }[]
    apiFolders: { id: string; name: string }[]
    noteFolders: { id: string; name: string }[]
  }
): string {
  // A schema is its own name rather than a record to look up — the Database
  // panel groups by the schema a table belongs to, and there is no id in it.
  if (pane === "database") return group || "Queries"

  // A chat's group is where it runs, and its id is a root's — the project.
  const rootId = groupRootId(group)
  if (rootId) {
    return (
      lists.workspaceFolders.find((entry) => entry.id === rootId)?.name ??
      // Between the project leaving the workspace and its chats closing.
      "Project"
    )
  }

  const found = {
    files: lists.workspaceFolders,
    api: lists.apiFolders,
    note: lists.noteFolders,
    database: [],
    // `Changes` has no `groupOf` either, for the reason a chat's group is
    // never reached: there is one of these per project already.
    changes: [],
    // Nor has `board`, and for exactly that reason.
    board: [],
    // Every chat is in a project, so the name above is always the answer and
    // this is never reached for one.
    worktree: [],
  }[pane].find((folder) => folder.id === group)

  if (found) return found.name

  // The top level of a panel's own tree, which is a real place to file a
  // request or a note rather than an absence of one — so it is named for the
  // panel, not "Ungrouped". A file is always inside a root, so it only reaches
  // here between a folder going and its tabs closing.
  return {
    files: "Files",
    api: "Requests",
    note: "Notes",
    worktree: "Chats",
    changes: "",
    database: "",
    board: "",
  }[pane]
}

/** A file's icon: the vendored file-type one, or the glyph the studio uses for
 * anything it has no icon checked in for. */
function iconOf(filePath: string) {
  const url = iconFor(filePath)
  if (url) {
    return <img src={url} alt="" aria-hidden className="size-3.5 shrink-0" />
  }
  if (isImage(filePath)) return <Image className="size-3.5 shrink-0" />
  // The glyph the Notes panel's own tabs carry, since a `.note` tab is the
  // same editor over a file instead of over a record.
  if (isNote(filePath)) return <FileText className="size-3.5 shrink-0" />
  return <File className="size-3.5 shrink-0" />
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
