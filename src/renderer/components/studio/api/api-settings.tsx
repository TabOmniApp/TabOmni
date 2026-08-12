import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { Plus, Trash2 } from "lucide-react"

import type { HttpVariable } from "@shared/api"
import { isExpired } from "@/lib/http/cookies"
import { useApi } from "@/lib/http/store"
import { IconButton } from "../icon-button"
import { RenameDialog } from "../db/rename-dialog"

type SettingsTab = "environments" | "cookies"

/** Where a new environment lands without the user naming one. */
function nextEnvironmentName(count: number): string {
  return count === 0 ? "Local" : `Environment ${count + 1}`
}

/**
 * What the whole collection shares — its environments and its cookie jar.
 *
 * A page in the workspace rather than a dialog: these are edited while looking
 * at the request that needs them, and a modal over the request is the one
 * arrangement that makes that impossible.
 */
export function ApiSettings() {
  const environments = useApi((state) => state.environments)
  const activeEnvironmentId = useApi((state) => state.activeEnvironmentId)
  const selectEnvironment = useApi((state) => state.selectEnvironment)
  const createEnvironment = useApi((state) => state.createEnvironment)
  const renameEnvironment = useApi((state) => state.renameEnvironment)
  const removeEnvironment = useApi((state) => state.removeEnvironment)
  const setVariables = useApi((state) => state.setVariables)

  const cookies = useApi((state) => state.cookies)
  const removeCookie = useApi((state) => state.removeCookie)
  const clearCookies = useApi((state) => state.clearCookies)

  const [tab, setTab] = useState<SettingsTab>("environments")
  const [renamingEnvironment, setRenamingEnvironment] = useState(false)

  const activeEnvironment = environments.find(
    (environment) => environment.id === activeEnvironmentId
  )
  const activeVariables = activeEnvironment?.variables ?? []

  function setVariable(index: number, patch: Partial<HttpVariable>) {
    if (!activeEnvironment) return
    setVariables(
      activeEnvironment.id,
      activeVariables.map((variable, position) =>
        position === index ? { ...variable, ...patch } : variable
      )
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as SettingsTab)}
          className="min-w-0"
        >
          <TabsList variant="line" className="h-7">
            <TabsTrigger value="environments" className="px-2 text-xs">
              Environments
              {environments.length > 0 && (
                <span className="ml-1 text-[0.65rem] text-muted-foreground tabular-nums">
                  {environments.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="cookies" className="px-2 text-xs">
              Cookies
              {cookies.length > 0 && (
                <span className="ml-1 text-[0.65rem] text-muted-foreground tabular-nums">
                  {cookies.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "cookies" && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            disabled={cookies.length === 0}
            onClick={clearCookies}
          >
            <Trash2 data-icon="inline-start" />
            Clear all
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === "environments" ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              A variable is used as{" "}
              <code className="font-mono">{"{{name}}"}</code> anywhere in a
              request — its URL, its headers, its body.{" "}
              <code className="font-mono">{"{{baseUrl}}"}</code> is the running
              dev server unless an environment defines its own.
            </p>

            <div className="flex items-center gap-1.5">
              <Select
                items={environments.map((environment) => ({
                  value: environment.id,
                  label: environment.name,
                }))}
                value={activeEnvironmentId}
                onValueChange={(value) =>
                  selectEnvironment(value ? String(value) : null)
                }
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Environment"
                  className="h-7 w-56 min-w-0"
                  disabled={environments.length === 0}
                >
                  <SelectValue placeholder="No environment" />
                </SelectTrigger>
                <SelectContent
                  align="start"
                  alignItemWithTrigger={false}
                  className="w-auto min-w-(--anchor-width)"
                >
                  {environments.map((environment) => (
                    <SelectItem key={environment.id} value={environment.id}>
                      {environment.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  createEnvironment(nextEnvironmentName(environments.length))
                }
              >
                <Plus data-icon="inline-start" />
                New
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={!activeEnvironment}
                onClick={() => setRenamingEnvironment(true)}
              >
                Rename
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={!activeEnvironment}
                className="text-destructive hover:text-destructive"
                onClick={() =>
                  activeEnvironment && removeEnvironment(activeEnvironment.id)
                }
              >
                Delete
              </Button>
            </div>

            {!activeEnvironment ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                No environment yet. One holds the values that differ between
                where you run this — a host, a token, an account id.
              </p>
            ) : (
              <>
                <ul className="space-y-1">
                  {activeVariables.length === 0 && (
                    <li className="py-2 text-xs text-muted-foreground">
                      No variables in {activeEnvironment.name}.
                    </li>
                  )}
                  {activeVariables.map((variable, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <Input
                        value={variable.name}
                        onChange={(event) =>
                          setVariable(index, { name: event.target.value })
                        }
                        placeholder="name"
                        spellCheck={false}
                        aria-label="Variable name"
                        className="h-7 w-56 font-mono text-xs md:text-xs"
                      />
                      <Input
                        value={variable.value}
                        onChange={(event) =>
                          setVariable(index, { value: event.target.value })
                        }
                        placeholder="value"
                        spellCheck={false}
                        aria-label="Variable value"
                        className="h-7 flex-1 font-mono text-xs md:text-xs"
                      />
                      <IconButton
                        label="Remove variable"
                        className="hover:text-destructive"
                        onClick={() =>
                          setVariables(
                            activeEnvironment.id,
                            activeVariables.filter(
                              (_, position) => position !== index
                            )
                          )
                        }
                      >
                        <Trash2 />
                      </IconButton>
                    </li>
                  ))}
                </ul>

                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    setVariables(activeEnvironment.id, [
                      ...activeVariables,
                      { name: "", value: "" },
                    ])
                  }
                >
                  <Plus data-icon="inline-start" />
                  Variable
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Kept from responses and sent back on requests they match, by
              domain and path. A request with its own{" "}
              <code className="font-mono">Cookie</code> header sends that
              instead.
            </p>

            {cookies.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                No cookies yet. One arrives the first time a response sets one.
              </p>
            ) : (
              <ul className="divide-y">
                {cookies.map((cookie, index) => {
                  const expired = isExpired(cookie)
                  return (
                    <li
                      key={`${cookie.domain}${cookie.path}${cookie.name}${index}`}
                      className="flex items-start gap-2 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs">
                          <span className="font-medium">{cookie.name}</span>
                          <span className="text-muted-foreground">
                            {" = "}
                            {cookie.value}
                          </span>
                        </p>
                        <p className="truncate text-[0.65rem] text-muted-foreground">
                          {cookie.hostOnly
                            ? cookie.domain
                            : `*.${cookie.domain}`}
                          {cookie.path}
                          {" · "}
                          <span className={cn(expired && "text-destructive")}>
                            {cookie.expiresAt
                              ? `${expired ? "expired" : "expires"} ${new Date(
                                  cookie.expiresAt
                                ).toLocaleString()}`
                              : "session"}
                          </span>
                          {cookie.secure && " · secure"}
                          {cookie.httpOnly && " · httpOnly"}
                        </p>
                      </div>
                      <IconButton
                        label={`Delete ${cookie.name}`}
                        className="hover:text-destructive"
                        onClick={() => removeCookie(cookie)}
                      >
                        <Trash2 />
                      </IconButton>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {renamingEnvironment && activeEnvironment && (
        <RenameDialog
          title="Rename environment"
          label="Environment name"
          currentName={activeEnvironment.name}
          onRename={async (name) => {
            renameEnvironment(activeEnvironment.id, name.trim())
            return null
          }}
          onClose={() => setRenamingEnvironment(false)}
        />
      )}
    </div>
  )
}
