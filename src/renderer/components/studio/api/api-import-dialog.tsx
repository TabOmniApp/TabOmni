import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { Sparkles } from "lucide-react"

import type { ApiImportRequest, ApiImportResult } from "@shared/api"
import { flattenFolders } from "@/lib/http/folders"
import { useApi } from "@/lib/http/store"
import { useStudio } from "@/lib/store"
import { METHOD_TONES } from "./request-list"

/** Not a real folder id, so it can share the same `<Select>` as real ones. */
const TOP_LEVEL = "__top-level__"

/**
 * Reads one of the workspace's folders with Claude Code and proposes API
 * folders/requests to add.
 *
 * Which folder is asked rather than assumed: the workspace holds several
 * repositories and only one of them is the API. It defaults to the first,
 * which is the right answer whenever there is only one.
 *
 * Proposes, never applies: what comes back sits here for the user to read
 * before Import commits it, the same rule the Data tab's AI filter follows.
 * Scanning a whole repository is much slower than that filter's one-shot
 * answer, so the loading state says as much rather than looking hung.
 */
export function ApiImportDialog({
  onClose,
  initialFolderId = null,
}: {
  onClose: () => void
  /** Pre-selects where the import lands — the folder that was right-clicked,
   * or the top level from the panel header's button. Still editable. */
  initialFolderId?: string | null
}) {
  const workspaceFolders = useStudio((state) => state.folders)
  const folders = useApi((state) => state.folders)
  const importFromAi = useApi((state) => state.importFromAi)

  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ApiImportResult | null>(null)
  const [targetFolderId, setTargetFolderId] = useState(initialFolderId)
  const [sourceId, setSourceId] = useState(workspaceFolders[0]?.id ?? "")

  const flatFolders = useMemo(() => flattenFolders(folders), [folders])

  async function scan() {
    if (!sourceId) return
    setScanning(true)
    setError(null)
    setResult(null)
    try {
      const proposed = await window.desktop.aiImportApi(sourceId)
      if (proposed.folders.length === 0 && proposed.requests.length === 0) {
        setError(
          "Found nothing that looked like an HTTP endpoint in that folder."
        )
        return
      }
      setResult(proposed)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
    } finally {
      setScanning(false)
    }
  }

  const total =
    (result?.requests.length ?? 0) +
    (result?.folders.reduce((sum, folder) => sum + folder.requests.length, 0) ??
      0)

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="flex max-h-[34rem] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>AI import</DialogTitle>
          <DialogDescription>
            Has Claude Code read a folder&apos;s source — routes, controllers,
            specs, schemas — and propose requests to add. Nothing is added until
            you say so below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">Read</span>
          <Select
            items={workspaceFolders.map((folder) => ({
              value: folder.id,
              label: folder.name,
            }))}
            value={sourceId}
            onValueChange={(value) => setSourceId(String(value))}
          >
            <SelectTrigger
              size="sm"
              aria-label="Folder to read"
              className="h-7 min-w-0 flex-1 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              align="start"
              alignItemWithTrigger={false}
              className="w-auto min-w-(--anchor-width)"
            >
              {workspaceFolders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>
                  {folder.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">
            Import into
          </span>
          <Select
            items={[
              { value: TOP_LEVEL, label: "Top level" },
              ...flatFolders.map(({ folder }) => ({
                value: folder.id,
                label: folder.name,
              })),
            ]}
            value={targetFolderId ?? TOP_LEVEL}
            onValueChange={(value) =>
              setTargetFolderId(value === TOP_LEVEL ? null : String(value))
            }
          >
            <SelectTrigger
              size="sm"
              aria-label="Destination folder"
              className="h-7 min-w-0 flex-1 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              align="start"
              alignItemWithTrigger={false}
              className="w-auto min-w-(--anchor-width)"
            >
              <SelectItem value={TOP_LEVEL}>Top level</SelectItem>
              {flatFolders.map(({ folder, depth }) => (
                <SelectItem
                  key={folder.id}
                  value={folder.id}
                  style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
                >
                  {folder.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!result && (
          <Button onClick={() => void scan()} disabled={scanning || !sourceId}>
            <Sparkles data-icon="inline-start" />
            {scanning
              ? "Scanning the project… this can take a couple of minutes"
              : "Scan project"}
          </Button>
        )}

        {error && (
          <p className="max-h-24 overflow-auto font-mono text-xs whitespace-pre-wrap text-destructive">
            {error}
          </p>
        )}

        {result && (
          <div className="min-h-0 flex-1 space-y-3 overflow-auto">
            {result.folders.map((folder) => (
              <div key={folder.name}>
                <p className="text-xs font-medium text-muted-foreground">
                  {folder.name}
                </p>
                <ul className="space-y-0.5">
                  {folder.requests.map((request, index) => (
                    <RequestPreviewRow key={index} request={request} />
                  ))}
                </ul>
              </div>
            ))}
            {result.requests.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Ungrouped
                </p>
                <ul className="space-y-0.5">
                  {result.requests.map((request, index) => (
                    <RequestPreviewRow key={index} request={request} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {result && (
            <Button
              variant="outline"
              onClick={() => void scan()}
              disabled={scanning}
            >
              Scan again
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!result || total === 0}
            onClick={() => {
              if (result) importFromAi(result, targetFolderId)
              onClose()
            }}
          >
            Import{result ? ` ${total}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "3 headers, body" — what else besides method/url this row will bring in. */
function extras(request: ApiImportRequest): string | null {
  const parts: string[] = []
  if (request.headers?.length) {
    parts.push(
      `${request.headers.length} header${request.headers.length > 1 ? "s" : ""}`
    )
  }
  if (request.body) parts.push("body")
  return parts.length > 0 ? parts.join(", ") : null
}

function RequestPreviewRow({ request }: { request: ApiImportRequest }) {
  const extra = extras(request)
  return (
    <li className="flex items-center gap-2 rounded-sm px-1 py-0.5 text-xs">
      <span
        className={cn(
          "w-14 shrink-0 font-mono font-medium",
          METHOD_TONES[request.method] ?? "text-muted-foreground"
        )}
      >
        {request.method}
      </span>
      <span className="min-w-0 flex-1 truncate">{request.name}</span>
      {extra && (
        <span className="shrink-0 text-[0.65rem] text-muted-foreground/70">
          {extra}
        </span>
      )}
      <span className="max-w-[40%] min-w-0 shrink-0 truncate font-mono text-muted-foreground">
        {request.url}
      </span>
    </li>
  )
}
