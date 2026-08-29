import { Folder, Settings2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { SETTINGS_TAB_ID, useApi } from "@/lib/http/store"
import { ApiWorkspace } from "./api-workspace"
import { METHOD_TONES, RequestList } from "./request-list"
import { PanelWindow } from "../panel-window"
import { TabStrip, type TabStripItem } from "../tab-strip"

/**
 * The API panel on its own, in the window `openPanelWindow` opens.
 *
 * The Database window's twin, and the same bargain: the studio's own list and
 * workspace against the studio's own store, with `PanelWindow` around them.
 * Nothing is refreshed here — `RequestList` reads the requests when it mounts,
 * which is the one thing this panel's boot has ever needed.
 */
export function ApiWindow() {
  const openIds = useApi((state) => state.openIds)
  const selectedId = useApi((state) => state.selectedId)
  const requests = useApi((state) => state.requests)
  const folders = useApi((state) => state.folders)

  const activeId =
    selectedId && openIds.includes(selectedId) ? selectedId : null

  const items = openIds.flatMap((id) => {
    const item = tabItem(id, requests, folders)
    return item ? [item] : []
  })

  return (
    <PanelWindow
      title="API"
      sidebar={<RequestList />}
      tabs={
        <TabStrip
          label="Open requests"
          items={items}
          activeId={activeId}
          copyLabel="Copy name"
          onSelect={(id) => useApi.getState().select(id)}
          onClose={(id) => useApi.getState().close(id)}
          onCloseOthers={(id) => useApi.getState().closeOthers(id)}
          onCloseAll={() => useApi.getState().closeAll()}
          onReorder={(ids) => useApi.getState().reorder(ids)}
        />
      }
    >
      <ApiWorkspace />
    </PanelWindow>
  )
}

/**
 * A tab as this strip draws it, or null for an id whose record has gone.
 *
 * The same three shapes `useTabItems` builds for the studio — a request, a
 * folder, and the panel's own settings — minus `lib/tabs.ts`'s `PREFIX`, which
 * is only there to keep five panels' ids apart in one strip.
 */
function tabItem(
  id: string,
  requests: ReturnType<typeof useApi.getState>["requests"],
  folders: ReturnType<typeof useApi.getState>["folders"]
): TabStripItem | null {
  if (id === SETTINGS_TAB_ID) {
    return {
      id,
      label: "API settings",
      icon: <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />,
    }
  }

  const request = requests.find((candidate) => candidate.id === id)
  if (request) {
    return {
      id,
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
    }
  }

  const folder = folders.find((candidate) => candidate.id === id)
  if (folder) {
    return {
      id,
      label: folder.name,
      icon: <Folder className="size-3 shrink-0 text-muted-foreground" />,
    }
  }

  return null
}
