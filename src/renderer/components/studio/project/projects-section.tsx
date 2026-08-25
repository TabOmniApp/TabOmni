import { Bot, ChevronRight, MessageSquare, Plus, Trash2 } from "lucide-react"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { useProjects } from "@/lib/projects"
import { useStudio } from "@/lib/store"
import { IconButton } from "../icon-button"
import { SideRow } from "../side-row"
import { useShells } from "@/lib/shell/store"
import { chatsOf, useWorktreeChats } from "@/lib/worktree-chat/store"
import { DEEPSEEK_TAB_ID, useDeepseekChats } from "@/lib/deepseek/store"

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
 */
export function ProjectsSection() {
  const collapsed = useProjects((state) => state.collapsed)
  const toggleFolder = useProjects((state) => state.toggleFolder)

  const folders = useStudio((state) => state.folders)

  // The DeepSeek row's active state, read here so the column marks the tab
  // that is open the way a project's chat row does.
  const deepseekOpen = useDeepseekChats(
    (state) => state.selectedId === DEEPSEEK_TAB_ID
  )

  return (
    <nav
      aria-label="Projects"
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {/*
          The one conversation with the DeepSeek Harness gateway, above the
          projects: it is not a project's — the gateway owns the session's
          directory — and it is the only row here that is not one.
        */}
        <SideRow
          active={deepseekOpen}
          title="DeepSeek chat"
          onClick={() => useDeepseekChats.getState().open()}
        >
          <Bot className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">
            DeepSeek chat
          </span>
        </SideRow>

        {folders.length === 0 && (
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
      </div>
    </nav>
  )
}

/**
 * One project: the folder's name, a `+` that starts a chat in it, and a menu
 * offering the same.
 *
 * The `+` is Conductor's, and it belongs on the row rather than in a header
 * above the list: it acts on *this* project. It made a `git worktree` once,
 * which was the expensive half of starting work here — a branch to name, a
 * directory to remove afterwards — and a chat is what somebody wanted from it
 * in nearly every case.
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
  onNewChat: () => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div className="group/project relative flex items-center">
            <SideRow onClick={onToggle} title={name} className="font-medium">
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                  !shut && "rotate-90"
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
            <IconButton
              label={`New chat in ${name}`}
              onClick={onNewChat}
              className="absolute right-1 size-5 opacity-0 transition-opacity group-hover/project:opacity-100 focus-visible:opacity-100"
            >
              <Plus className="size-3" />
            </IconButton>
          </div>
        }
      />
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
 */
function ProjectChats({ folderId }: { folderId: string }) {
  const chats = useWorktreeChats((state) => state.chats)
  const selectedId = useWorktreeChats((state) => state.selectedId)
  const select = useWorktreeChats((state) => state.select)
  const remove = useWorktreeChats((state) => state.remove)

  const own = chatsOf(chats, folderId)
  if (own.length === 0) return null

  return (
    <>
      {own.map((chat) => (
        <ContextMenu key={chat.id}>
          <ContextMenuTrigger
            render={
              <SideRow
                indent={1}
                active={selectedId === chat.id}
                title={chat.title}
                onClick={() => {
                  select(chat.id)
                  // The shell and the tree follow, the way a project row moves
                  // them: a chat editing this project with a terminal pointed
                  // at another one is a trap, not an inconvenience.
                  useShells.getState().showFor(folderId)
                  useProjects.getState().setActive(folderId)
                }}
              >
                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {chat.title}
                </span>
              </SideRow>
            }
          />
          <ContextMenuContent className="w-52">
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
      ))}
    </>
  )
}
