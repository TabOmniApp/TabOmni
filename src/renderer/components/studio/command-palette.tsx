import { useEffect, useMemo, useState, type ReactNode } from "react"
import { defaultFilter } from "cmdk"
import { File, FileText, MessageSquare } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { useDatabases } from "@/lib/db/databases-store"
import { useDbTree } from "@/lib/db/tree-store"
import { useFiles } from "@/lib/files/store"
import { shortlist } from "@/lib/files/search"
import { useApi } from "@/lib/http/store"
import { nameOf } from "@/lib/files/paths"
import { useNotes } from "@/lib/note/store"
import { usePalette } from "@/lib/palette"
import { isStudioShortcut } from "@/lib/shortcuts"
import { useStudio } from "@/lib/store"
import { PREFIX } from "@/lib/tabs"
import { useWorktreeChats } from "@/lib/worktree-chat/store"
import { useWorktrees } from "@/lib/worktree/store"
import { METHOD_TONES } from "./api/request-list"
import { KIND_ICONS } from "./db/database-tree"

/**
 * One thing the palette can open.
 *
 * `value` exists only so cmdk can tell two rows apart — it keys its items by
 * it, and two sharing one are highlighted and picked together. What a search
 * matches is `keywords`; see `score`.
 */
type Entry = {
  value: string
  label: string
  /** The right-hand line: which database, which URL, who sent it. */
  hint?: string
  /** Everything a search should match, the label and the hint included. */
  keywords: string[]
  icon: ReactNode
  /** Opens it, resolving to why it could not be opened, or to null. */
  open: () => Promise<string | null>
}

type Group = { heading: string; entries: Entry[] }

type Notice = { tone: "muted" | "destructive"; text: string }

/**
 * Search the workspace, and open what comes back.
 *
 * The studio has one strip of tabs and six sidebars, so the thing being looked
 * for is only ever a few clicks away — but only if the rail is already on the
 * section that lists it. A table in a database whose branch is collapsed, a
 * request three folders deep and a note filed last week are each a trip through
 * a panel the user is not currently in, and none of them is the panel they
 * would go back to afterwards. This is the way in that does not move the
 * sidebar: type a name, get the tab.
 *
 * It opens things and nothing more. There is no "commands" half — a palette
 * that also ran actions would be the second place every action is spelled out,
 * and the actions here already sit in the header or the context menu of the
 * panel they belong to, where the thing they act on is on screen.
 */
export function CommandPalette() {
  // On a store, so the left column's Search row opens the same dialog this
  // key does rather than faking the key — see `lib/palette.ts`.
  const open = usePalette((state) => state.open)
  const setOpen = usePalette((state) => state.setOpen)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isStudioShortcut(event, "p")) return

      /*
       * Claimed on the capture phase, and with `preventDefault`, because Mod-P
       * is a key the app does not own by default: Chromium reads it as print,
       * and a palette that also sent the window to a printer would be one
       * nobody pressed twice.
       */
      event.preventDefault()
      usePalette.getState().toggle()
    }

    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true })
    }
  }, [])

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Go to"
      description="Search the workspace's files, tables, requests, sessions and notes."
      className="sm:max-w-xl"
    >
      {/* A child of the dialog, so the stores below are subscribed to
          while the palette is on screen and not for the whole run — a closed
          dialog renders none of its content. */}
      <Palette onOpened={() => setOpen(false)} />
    </CommandDialog>
  )
}

function Palette({ onOpened }: { onOpened: () => void }) {
  /**
   * What has been typed, which the palette otherwise has no need of — cmdk owns
   * the input and the filtering both.
   *
   * The files are the exception: there are too many of them to hand over and
   * let cmdk score, so they are cut to a shortlist against this first. See
   * `lib/files/search.ts`.
   */
  const [query, setQuery] = useState("")
  const groups = useEntries(query)
  const [notice, setNotice] = useState<Notice | null>(null)

  async function run(entry: Entry) {
    /*
     * Every panel's own `select` is synchronous. The exception is a table in a
     * database the workspace is not on: that one dials a server first, and can
     * fail with a connection error nothing else here would show — the tree's
     * "unreachable" dialog belongs to the tree. The wait is so the usual case,
     * which resolves in a microtask, never flashes a line it did not need.
     */
    const waiting = setTimeout(() => {
      setNotice({ tone: "muted", text: `Opening ${entry.label}…` })
    }, 150)

    const failure = await entry.open()
    clearTimeout(waiting)

    if (failure) {
      setNotice({ tone: "destructive", text: failure })
      return
    }
    onOpened()
  }

  return (
    <Command filter={score}>
      <CommandInput
        autoFocus
        placeholder="Search files, tables, requests, sessions and notes…"
        // A failure is about the row that was picked, so the next keystroke —
        // which is on the way to picking another one — is what clears it.
        onValueChange={(value) => {
          setQuery(value)
          setNotice(null)
        }}
      />

      {notice && (
        <p
          className={cn(
            "px-3 pt-2 text-xs",
            notice.tone === "destructive"
              ? "text-destructive"
              : "text-muted-foreground"
          )}
        >
          {notice.text}
        </p>
      )}

      <CommandList className="max-h-[min(60vh,24rem)]">
        <CommandEmpty className="text-muted-foreground">
          {groups.length === 0
            ? "Nothing to open yet. Connect a database, add a request or write a note."
            : "No match."}
        </CommandEmpty>

        {groups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.entries.map((entry) => (
              <CommandItem
                key={entry.value}
                value={entry.value}
                keywords={entry.keywords}
                onSelect={() => void run(entry)}
              >
                {entry.icon}
                <span className="truncate">{entry.label}</span>
                {entry.hint && (
                  // The slot the check mark steps aside for, which is what
                  // keeps a hint from being pushed off the end by it.
                  <CommandShortcut className="max-w-[45%] truncate font-normal tracking-normal">
                    {entry.hint}
                  </CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  )
}

/**
 * How well a row matches what has been typed.
 *
 * Each searchable string is scored on its own and the best one wins, rather
 * than one string of them all: a query is about a name *or* a URL, and
 * concatenating the two lets a match straddle them — "user get" would find
 * `GET /users` through a gap of nothing.
 *
 * The row's `value` is deliberately not scored. It is an id, and cmdk offers no
 * way to filter on keywords alone, so a query of hex letters ("cafe", "dad")
 * would otherwise match whichever note's uuid happened to contain them.
 */
function score(_value: string, search: string, keywords?: string[]): number {
  return Math.max(
    0,
    ...(keywords ?? []).map((text) => defaultFilter(text, search))
  )
}

/**
 * Everything openable in the workspace, grouped the way the sections are
 * ordered.
 *
 * Read from the panels' own stores rather than from anything kept for this:
 * what the palette lists is what the panels would list, and a second index
 * would be one more thing to hold in step with them. The one consequence worth
 * knowing is that a database's tables are searchable once its branch has been
 * read — before that nothing on this machine knows their names, and reading
 * every database on the chance that ⌘D is pressed would dial every server the
 * workspace has.
 *
 * Files are the exception, and are an index — the only one. A folder's files
 * are not a list any store holds: the Explorer's tree is what has been expanded,
 * which is a handful of directories out of a repository, while ⌘P has to find a
 * file nobody has opened a folder of. So the workspace is walked once, the first
 * time the palette is opened, and held until the folder list itself changes —
 * adding or removing a folder drops it, since a walk that never saw that folder
 * is wrong rather than merely old; `Refresh` in the Explorer re-walks it for
 * everything else. Everything that follows from that — which directories are
 * skipped, the cap, and why the shortlist happens before cmdk sees a row — is in
 * `main/files.ts` and `lib/files/search.ts`.
 */
function useEntries(query: string): Group[] {
  const files = useFiles((state) => state.index)
  const loadIndex = useFiles((state) => state.loadIndex)

  /*
   * The one group with an index behind it rather than a store already holding
   * what it lists.
   *
   * Walked when the palette is first opened rather than at launch — this
   * component is a child of the dialog, so this effect runs when it opens —
   * and held until the workspace's folders change. A studio nobody presses ⌘P
   * in never walks the workspace at all, which is the same bargain the tree
   * makes by reading a directory only when it is expanded.
   */
  useEffect(() => {
    void loadIndex()
  }, [loadIndex])

  const databases = useDatabases((state) => state.databases)
  const branches = useDbTree((state) => state.branches)

  const requests = useApi((state) => state.requests)
  const apiFolders = useApi((state) => state.folders)

  const chats = useWorktreeChats((state) => state.chats)
  const worktrees = useWorktrees((state) => state.worktrees)
  const folders = useStudio((state) => state.folders)

  const notes = useNotes((state) => state.notes)
  const noteFolders = useNotes((state) => state.folders)

  return useMemo(() => {
    const fileEntries: Entry[] = shortlist(files, query).map((entry) => {
      const folder = folders.find(
        (candidate) => candidate.id === entry.folderId
      )
      // The branch as well as the project when the hit is in a checkout: two
      // worktrees of one repository hold the same `src/index.ts`, so the
      // folder's name alone would draw the same hint on both rows.
      const worktree = worktrees.find(
        (candidate) => candidate.id === entry.worktreeId
      )
      return {
        value: PREFIX.files + entry.path,
        label: entry.relative,
        // Which repository it is in, since two of them in one workspace both
        // have a `src/index.ts`.
        hint: worktree
          ? `${folder?.name ?? "Worktree"} · ${worktree.branch}`
          : folder?.name,
        // The path without its slashes as well as with them: the shortlist
        // that chose this row ignores separators — "libfiles" finds
        // `lib/files` — and cmdk, which scores it afterwards, does not. Without
        // this, the row a search had just found could be filtered back out by
        // the stricter of the two scorers.
        keywords: [
          entry.relative,
          nameOf(entry.relative),
          entry.relative.replace(/\//g, ""),
        ],
        icon: <File className="size-3.5 shrink-0" />,
        open: async () => {
          // Opened and revealed both: somebody who found a file this way
          // generally wants to see what is beside it.
          await useFiles.getState().open(entry.path)
          void useFiles.getState().reveal(entry.path)
          return null
        },
      }
    })

    const tables: Entry[] = databases.flatMap((database) =>
      (branches[database.id]?.relations ?? []).map((relation) => {
        const Icon = KIND_ICONS[relation.kind]
        const name = `${relation.schema}.${relation.name}`
        return {
          value: `${PREFIX.database}${database.id}:${name}`,
          label: name,
          hint: database.name,
          keywords: [name, relation.name, database.name],
          icon: <Icon className="size-3.5 shrink-0" />,
          // Moves the workspace to the table's own database first, which is
          // why this is the one entry that can fail.
          open: () => useDbTree.getState().open(database, relation),
        }
      })
    )

    const apiEntries: Entry[] = requests.map((request) => {
      const folder = apiFolders.find(
        (candidate) => candidate.id === request.folderId
      )
      return {
        value: PREFIX.api + request.id,
        label: request.name,
        hint: request.url,
        keywords: [
          request.name,
          request.url,
          request.method,
          ...(folder ? [folder.name] : []),
        ],
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
        open: async () => {
          useApi.getState().select(request.id)
          return null
        },
      }
    })

    // Every chat, not only the ones with a tab open: the palette is how a
    // conversation nobody has on screen is found again, and selecting one is
    // what opens its tab.
    const chatEntries: Entry[] = chats.map((chat) => {
      // The branch rather than the project: two checkouts of one repository are
      // what a chat has to be told apart by. A chat in the project's own working
      // tree has no branch to name, so it is named for the project.
      const where = chat.worktreeId
        ? worktrees.find((candidate) => candidate.id === chat.worktreeId)
            ?.branch
        : folders.find((candidate) => candidate.id === chat.folderId)?.name
      return {
        value: PREFIX.worktree + chat.id,
        label: chat.title,
        hint: where,
        keywords: [chat.title, ...(where ? [where] : [])],
        icon: <MessageSquare className="size-3.5 shrink-0" />,
        open: async () => {
          useWorktreeChats.getState().select(chat.id)
          return null
        },
      }
    })

    const noteEntries: Entry[] = notes.map((note) => {
      const folder = noteFolders.find(
        (candidate) => candidate.id === note.folderId
      )
      return {
        value: PREFIX.note + note.id,
        label: note.name,
        hint: folder?.name,
        keywords: [note.name, ...(folder ? [folder.name] : [])],
        icon: <FileText className="size-3.5 shrink-0" />,
        open: async () => {
          useNotes.getState().select(note.id)
          return null
        },
      }
    })

    return [
      // First, the way Explorer is first on the rail — and because a query
      // that names a file is usually a query about that file.
      { heading: "Files", entries: fileEntries },
      { heading: "Database", entries: tables },
      { heading: "API", entries: apiEntries },
      { heading: "Chats", entries: chatEntries },
      { heading: "Notes", entries: noteEntries },
      // A heading with nothing under it reads as something having failed to
      // load; cmdk hides a group whose rows are all filtered out, but not one
      // that never had any.
    ].filter((group) => group.entries.length > 0)
  }, [
    files,
    query,
    databases,
    branches,
    requests,
    apiFolders,
    chats,
    worktrees,
    folders,
    notes,
    noteFolders,
  ])
}
