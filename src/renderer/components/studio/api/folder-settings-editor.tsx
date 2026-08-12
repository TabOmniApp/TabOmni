import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { Plus, Trash2 } from "lucide-react"

import type { HttpHeader } from "@shared/api"
import { useApi } from "@/lib/http/store"
import { IconButton } from "../icon-button"

type FolderEditorTab = "headers" | "params"

/**
 * A folder's own defaults — headers and params every request nested under
 * it picks up, unless the request sets the same name itself.
 *
 * No inline rename here: a folder's name is changed from the tree's own
 * context menu, the same place every other rename in this app happens.
 */
export function FolderSettingsEditor({ folderId }: { folderId: string }) {
  const folder = useApi((state) =>
    state.folders.find((candidate) => candidate.id === folderId)
  )
  const setFolderHeaders = useApi((state) => state.setFolderHeaders)
  const setFolderParams = useApi((state) => state.setFolderParams)

  const [tab, setTab] = useState<FolderEditorTab>("headers")

  if (!folder) return null

  const rows = tab === "headers" ? folder.headers : folder.params
  const noun = tab === "headers" ? "header" : "param"

  function setRows(next: HttpHeader[]) {
    if (tab === "headers") setFolderHeaders(folder!.id, next)
    else setFolderParams(folder!.id, next)
  }

  function setRow(index: number, patch: Partial<HttpHeader>) {
    setRows(
      rows.map((row, position) =>
        position === index ? { ...row, ...patch } : row
      )
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col gap-1 border-b px-3 py-2">
        <h2 className="truncate text-sm font-medium">{folder.name}</h2>
        <p className="text-xs text-muted-foreground">
          Applied to every request under this folder. A request&apos;s own
          header or param with the same name wins.
        </p>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as FolderEditorTab)}
          className="min-w-0"
        >
          <TabsList variant="line" className="h-7">
            <TabsTrigger value="headers" className="px-2 text-xs">
              Headers
              {folder.headers.length > 0 && (
                <span className="ml-1 text-[0.65rem] text-muted-foreground tabular-nums">
                  {folder.headers.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="params" className="px-2 text-xs">
              Params
              {folder.params.length > 0 && (
                <span className="ml-1 text-[0.65rem] text-muted-foreground tabular-nums">
                  {folder.params.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() =>
            setRows([...rows, { name: "", value: "", enabled: true }])
          }
        >
          <Plus data-icon="inline-start" />
          {tab === "headers" ? "Header" : "Param"}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No {tab}.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((row, index) => (
              <li key={index} className="flex items-center gap-2 px-2 py-1">
                <Checkbox
                  checked={row.enabled}
                  onCheckedChange={(enabled) =>
                    setRow(index, { enabled: Boolean(enabled) })
                  }
                  aria-label={`Send ${row.name || `this ${noun}`}`}
                />
                <Input
                  value={row.name}
                  onChange={(event) =>
                    setRow(index, { name: event.target.value })
                  }
                  placeholder={tab === "headers" ? "Header" : "Param"}
                  spellCheck={false}
                  aria-label={`${noun} name`}
                  className={cn(
                    "h-7 w-48 font-mono text-xs md:text-xs",
                    !row.enabled && "text-muted-foreground line-through"
                  )}
                />
                <Input
                  value={row.value}
                  onChange={(event) =>
                    setRow(index, { value: event.target.value })
                  }
                  placeholder="Value"
                  spellCheck={false}
                  aria-label={`${noun} value`}
                  className={cn(
                    "h-7 flex-1 font-mono text-xs md:text-xs",
                    !row.enabled && "text-muted-foreground"
                  )}
                />
                <IconButton
                  label={`Remove ${noun}`}
                  className="hover:text-destructive"
                  onClick={() =>
                    setRows(rows.filter((_, position) => position !== index))
                  }
                >
                  <Trash2 />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
