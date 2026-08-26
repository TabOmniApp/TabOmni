import { useState } from "react"
import {
  Folder,
  FolderOpen,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { useProjects } from "@/lib/projects"
import { useStudio } from "@/lib/store"
import { IconButton } from "../icon-button"
import { RenameRow, useMenuFocusHandoff } from "../rename-row"
import { SideRow } from "../side-row"
import { useShells } from "@/lib/shell/store"
import {
  chatsOf,
  ungroupedChats,
  useWorktreeChats,
} from "@/lib/worktree-chat/store"
import { since } from "@/lib/worktree-chat/since"

/**
 * The workspace's projects, and the chats held in each.
 *
 * One of the four sections the left column stacks — see `WorkspaceSidebar` for
 * why the other three are beside it rather than behind tabs on the right. It
 * carries no `Search` row and no settings button any more: those belong to the
 * column, not to this section, and a row that lived in whichever section
 * happened to be first was a row in the wrong place.
 *
 * A project's rows used to be its `git worktree` checkouts, with the chats
 * hidden a level below them — one row per branch, and no way to see from this
 * column what conversations a project actually held. That layer is gone, and
 * what a project opens onto is the thing the column was always navigating to:
 * its chats, listed, so a conversation from last week is one click rather than
 * a tab strip somebody has to remember opening.
 *
 * There was a **task** layer over this — a task was a name and a set of members
 * taken from any panel, listed here with a dashboard behind `Home` — and it is
 * gone, deleted rather than hidden.
 *
 * **The rows are drawn as a file tree rather than a disclosure list.** A folder
 * mark, open or shut, in place of the chevron that was there: what this column
 * lists is projects on disk, and the chevron said only "there is more below",
 * which is the one thing the indent already says. The chats under it carry no
 * mark at all — a column of identical speech bubbles is a column of noise, and
 * the only thing they distinguish is a chat from a chat. What that vacated
 * space is spent on instead is the **age** of each conversation, right-aligned,
 * which is the question actually asked of this list: not what a row is, but
 * which of four similarly-named chats is the one from this afternoon.
 */
export function ProjectsSection() {
  const collapsed = useProjects((state) => state.collapsed)
  const toggleFolder = useProjects((state) => state.toggleFolder)

  const folders = useStudio((state) => state.folders)
  const chats = useWorktreeChats((state) => state.chats)

  const orphans = ungroupedChats(chats)
  const ungroupedShut = collapsed.includes(UNGROUPED_ID)

  return (
    <nav
      aria-label="Projects"
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {folders.length === 0 && orphans.length === 0 && (
          <p className="px-3 py-1 text-xs leading-relaxed text-muted-foreground">
            No folders yet. Add one from Explorer and it will show up here.
          </p>
        )}

        {folders.map((folder) => {
          const shut = collapsed.includes(folder.id)
          return (
            <div key={folder.id}>
              <ProjectRow
                name={folder.name}
                shut={shut}
                onNewChat={() =>
                  void useWorktreeChats
                    .getState()
                    .create({ folderId: folder.id })
                }
                onToggle={() => {
                  toggleFolder(folder.id)
                  // And the dock's shell follows: a project row is the one
                  // place this app says "this project", so a terminal that
                  // stayed in the last one would be a `pwd` nobody asked for.
                  // It does not open the dock — see `showFor`.
                  useShells.getState().showFor(folder.id)
                  // So does Explorer: this row is the app saying "this
                  // project", and the tree draws the one project being worked
                  // in.
                  useProjects.getState().setActive(folder.id)
                }}
              />
              {!shut && <ProjectChats folderId={folder.id} />}
            </div>
          )
        })}

        {/*
          Last, and only when there is something in it: an empty `Ungrouped`
          would be a row explaining a situation nobody is in.
        */}
        {orphans.length > 0 && (
          <div>
            <ProjectRow
              name="Ungrouped"
              shut={ungroupedShut}
              // No `+`: a chat needs a directory to run in, and this row names
              // the absence of one.
              onNewChat={null}
              onToggle={() => toggleFolder(UNGROUPED_ID)}
            />
            {!ungroupedShut && <ProjectChats folderId={null} />}
          </div>
        )}
      </div>
    </nav>
  )
}

/**
 * The `Ungrouped` row's key in `collapsed`.
 *
 * A sentinel among folder ids, which are uuids, so it cannot collide with one.
 * Folding it is remembered the same way a real project's is — the store keeps a
 * list of strings and has no opinion about which of them name folders.
 */
const UNGROUPED_ID = "ungrouped"

/**
 * The pill an active row is drawn as, in this section only.
 *
 * `SideRow` is full-bleed with a bar down its left edge, which is right for the
 * Explorer's tree and for the three panel lists: those are dense, and a row that
 * inset itself would break the alignment of the guides beside it. This column is
 * not that — it holds a dozen rows with the whole height to themselves — and the
 * shape it wants is Conductor's, a rounded block sitting inside the column with
 * air around it. Overriding at the call site rather than adding a variant to
 * `SideRow`, since one section wanting a different shape is not yet a second
 * kind of row; if a second section asks for it, that is when it becomes one.
 *
 * The inset is `px-1` on the scrolling list rather than a margin on each row,
 * and that is not a matter of taste: a row given `w-auto` to make room for the
 * margin stops being `w-full`, so it sizes to its content, so `truncate` on the
 * title inside it never has a width to truncate against. What that looked like
 * was a column of clipped titles and a horizontal scrollbar under the list.
 */
const PILL = "rounded-md"
const PILL_ACTIVE = "shadow-none"

/**
 * One project: the folder's name, a `+` that starts a chat in it, and a menu
 * offering the same.
 *
 * The `+` is Conductor's, and it belongs on the row rather than in a header
 * above the list: it acts on *this* project. It made a `git worktree` once,
 * which was the expensive half of starting work here — a branch to name, a
 * directory to remove afterwards — and a chat is what somebody wanted from it
 * in nearly every case. `onNewChat` is nullable for the one row that is not a
 * project — see `UNGROUPED_ID`.
 */
function ProjectRow({
  name,
  shut,
  onToggle,
  onNewChat,
}: {
  name: string
  shut: boolean
  onToggle: () => void
  onNewChat: (() => void) | null
}) {
  // Open and shut rather than one mark rotated: a folder is the thing being
  // drawn, and its two states are two glyphs rather than two angles.
  const Mark = shut ? Folder : FolderOpen

  const row = (
    <div className="group/project relative flex items-center">
      <SideRow
        onClick={onToggle}
        title={name}
        className={cn(PILL, "font-medium text-foreground")}
      >
        <Mark
          className={cn(
            "size-4 shrink-0",
            // The open folder takes the section's own hue, which is what marks
            // the project being worked in from the ones merely listed. A shut
            // one is furniture and drawn as furniture.
            shut ? "text-muted-foreground" : "text-primary"
          )}
        />
        <span className="min-w-0 flex-1 truncate text-left">{name}</span>
      </SideRow>

      {/*
        Over the row rather than in it: a row is a button, and a button
        inside a button is neither valid markup nor clickable. Shown on
        hover, like the ✕ on a tab — a column of projects each wearing a
        permanent `+` is a column of plus signs.
      */}
      {onNewChat && (
        <IconButton
          label={`New chat in ${name}`}
          onClick={onNewChat}
          className="absolute right-1 size-5 opacity-0 transition-opacity group-hover/project:opacity-100 focus-visible:opacity-100"
        >
          <Plus className="size-3" />
        </IconButton>
      )}
    </div>
  )

  // A menu whose only item would be missing is no menu: `Ungrouped` right-clicks
  // to nothing rather than to an empty box.
  if (!onNewChat) return row

  return (
    <ContextMenu>
      <ContextMenuTrigger render={row} />
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onNewChat}>
          <MessageSquare className="text-muted-foreground" />
          New chat here
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * One project's chats, oldest first — the order they were started in.
 *
 * The row is the chat's **title**, which is the first thing that was asked in
 * it (`"Untitled"` until there is one). Listed here rather than only in the tab
 * strip because the strip holds what is open in *this* run: a chat is written
 * down as it happens, and the column is where one from last week is found
 * again.
 *
 * `folderId` is null for the `Ungrouped` group, which is the one list here whose
 * rows move nothing else when clicked: there is no project to point the shell
 * and the tree at, and pointing them at whichever project was last active would
 * be this app guessing.
 */
function ProjectChats({ folderId }: { folderId: string | null }) {
  const chats = useWorktreeChats((state) => state.chats)
  const selectedId = useWorktreeChats((state) => state.selectedId)
  const sending = useWorktreeChats((state) => state.sending)
  const select = useWorktreeChats((state) => state.select)
  const remove = useWorktreeChats((state) => state.remove)
  const rename = useWorktreeChats((state) => state.rename)

  /** Which chat's name is a field right now. In place, the way every other
   * sidebar in the studio renames — see `RenameRow`. */
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const menuFocus = useMenuFocusHandoff()

  const own = folderId ? chatsOf(chats, folderId) : ungroupedChats(chats)
  if (own.length === 0) return null

  return (
    <>
      {own.map((chat) => {
        const isSending = sending.includes(chat.id)

        // Outside the menu while it is a field: a right-click on a text field
        // belongs to the field, not to the row it stands in for.
        if (renamingId === chat.id) {
          return (
            <RenameRow
              key={chat.id}
              name={chat.title}
              indent={1}
              label="Chat name"
              onRename={async (name) => {
                rename(chat.id, name)
                setRenamingId(null)
                return null
              }}
              onCancel={() => setRenamingId(null)}
            />
          )
        }

        return (
          <ContextMenu key={chat.id}>
            <ContextMenuTrigger
              render={
                <SideRow
                  indent={1}
                  active={selectedId === chat.id}
                  title={chat.title}
                  // `text-foreground` because a chat's title is the content of
                  // this list rather than a label over it — the muted default
                  // is right for a tree of filenames and wrong for a dozen
                  // sentences somebody is reading to pick between.
                  className={cn(
                    PILL,
                    "text-foreground",
                    selectedId === chat.id && PILL_ACTIVE
                  )}
                  onClick={() => {
                    select(chat.id)
                    // The shell and the tree follow, the way a project row moves
                    // them: a chat editing this project with a terminal pointed
                    // at another one is a trap, not an inconvenience. Nothing to
                    // follow for an ungrouped chat — see the note above.
                    if (!folderId) return
                    useShells.getState().showFor(folderId)
                    useProjects.getState().setActive(folderId)
                  }}
                >
                  {isSending && (
                    <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left">
                    {chat.title}
                  </span>
                  {/*
                    `tabular-nums` so `9h` and `23h` end on the same pixel: a
                    right-aligned column that shifts by a digit reads as the
                    list twitching when a chat is answered.
                  */}
                  <span className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">
                    {since(chat.updatedAt)}
                  </span>
                </SideRow>
              }
            />
            <ContextMenuContent
              className="w-52"
              // Rename hands focus to the field it opens — see
              // `useMenuFocusHandoff`.
              finalFocus={menuFocus.finalFocus}
            >
              <ContextMenuItem
                onClick={() => {
                  menuFocus.handOff()
                  setRenamingId(chat.id)
                }}
              >
                <Pencil />
                Rename
              </ContextMenuItem>
              <ContextMenuSeparator />
              {/* The conversation is on disk, so this is the one way it goes. */}
              <ContextMenuItem
                variant="destructive"
                onClick={() => void remove(chat.id)}
              >
                <Trash2 />
                Delete chat
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </>
  )
}
