import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"

import type { HttpVariable } from "@shared/api"
import { useApi } from "@/lib/http/store"
import { IconButton } from "../icon-button"
import { RenameDialog } from "../db/rename-dialog"

/**
 * Environments and their variables, in one place.
 *
 * One environment is edited at a time — the picker at the top chooses which,
 * and it is the same choice the panel itself is set to, so opening this and
 * changing a value is the shortest path from "wrong token" to "right token".
 */
export function EnvironmentDialog({ onClose }: { onClose: () => void }) {
  const environments = useApi((state) => state.environments)
  const activeId = useApi((state) => state.activeEnvironmentId)
  const select = useApi((state) => state.selectEnvironment)
  const create = useApi((state) => state.createEnvironment)
  const rename = useApi((state) => state.renameEnvironment)
  const remove = useApi((state) => state.removeEnvironment)
  const setVariables = useApi((state) => state.setVariables)

  const [renaming, setRenaming] = useState(false)

  const active = environments.find((environment) => environment.id === activeId)
  const variables = active?.variables ?? []

  function setVariable(index: number, patch: Partial<HttpVariable>) {
    if (!active) return
    setVariables(
      active.id,
      variables.map((variable, position) =>
        position === index ? { ...variable, ...patch } : variable
      )
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Environments</DialogTitle>
          <DialogDescription>
            A variable is used as{" "}
            <code className="font-mono">{"{{name}}"}</code> anywhere in a
            request — its URL, its headers, its body.{" "}
            <code className="font-mono">{"{{baseUrl}}"}</code> is the running
            dev server unless an environment defines its own.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1.5">
          <Select
            items={environments.map((environment) => ({
              value: environment.id,
              label: environment.name,
            }))}
            value={activeId}
            onValueChange={(value) => select(value ? String(value) : null)}
          >
            <SelectTrigger
              size="sm"
              aria-label="Environment"
              className="h-8 min-w-0 flex-1"
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
            onClick={() => create(nextEnvironmentName(environments.length))}
          >
            <Plus data-icon="inline-start" />
            New
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={!active}
            onClick={() => setRenaming(true)}
          >
            Rename
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={!active}
            className="text-destructive hover:text-destructive"
            onClick={() => active && remove(active.id)}
          >
            Delete
          </Button>
        </div>

        {!active ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            No environment yet. One holds the values that differ between where
            you run this — a host, a token, an account id.
          </p>
        ) : (
          <>
            <ul className="max-h-72 space-y-1 overflow-auto">
              {variables.length === 0 && (
                <li className="py-2 text-xs text-muted-foreground">
                  No variables in {active.name}.
                </li>
              )}
              {variables.map((variable, index) => (
                <li key={index} className="flex items-center gap-2">
                  <Input
                    value={variable.name}
                    onChange={(event) =>
                      setVariable(index, { name: event.target.value })
                    }
                    placeholder="name"
                    spellCheck={false}
                    aria-label="Variable name"
                    className="h-7 w-48 font-mono text-xs md:text-xs"
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
                        active.id,
                        variables.filter((_, position) => position !== index)
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
              className="self-start"
              onClick={() =>
                setVariables(active.id, [...variables, { name: "", value: "" }])
              }
            >
              <Plus data-icon="inline-start" />
              Variable
            </Button>
          </>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>

      {renaming && active && (
        <RenameDialog
          title="Rename environment"
          label="Environment name"
          currentName={active.name}
          onRename={async (name) => {
            rename(active.id, name.trim())
            return null
          }}
          onClose={() => setRenaming(false)}
        />
      )}
    </Dialog>
  )
}

function nextEnvironmentName(count: number): string {
  return count === 0 ? "Local" : `Environment ${count + 1}`
}
