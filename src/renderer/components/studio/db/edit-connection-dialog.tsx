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
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

import type { DatabaseRecord } from "@shared/api"
import { testDatabaseConnection } from "@/lib/db/databases"
import { useDatabases } from "@/lib/db/databases-store"

/**
 * Changes where a connection points.
 *
 * Only for a database the studio did not create: a Docker-managed one has an
 * address Docker decides and credentials baked into its container, so there is
 * nothing here that could be edited into anything but a broken record.
 *
 * The password is the one field that starts empty. The renderer is never told
 * the stored one — it lives encrypted in the manifest and is decrypted only in
 * the main process — so an empty box means "keep it" rather than "clear it".
 */
export function EditConnectionDialog({
  database,
  onClose,
}: {
  database: DatabaseRecord
  onClose: () => void
}) {
  const update = useDatabases((state) => state.update)

  const [name, setName] = useState(database.name)
  const [host, setHost] = useState(database.host)
  const [port, setPort] = useState(String(database.port))
  const [user, setUser] = useState(database.user)
  const [password, setPassword] = useState("")
  const [dbName, setDbName] = useState(database.database)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<
    { ok: true; version: string } | { ok: false; error: string } | null
  >(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch = {
    name: name.trim(),
    host: host.trim(),
    port: Number(port) || database.port,
    user: user.trim(),
    database: dbName.trim(),
    ...(password ? { password } : {}),
  }
  const canSubmit = patch.name && patch.host && patch.user && patch.database

  async function test() {
    setTesting(true)
    setTestResult(null)
    // Without a password typed there is nothing to test with: the stored one
    // never leaves the main process, and this call carries its own.
    setTestResult(
      await testDatabaseConnection({
        engine: database.engine,
        host: patch.host,
        port: patch.port,
        user: patch.user,
        password,
        database: patch.database,
      })
    )
    setTesting(false)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await update(database.id, patch)
      onClose()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Edit connection</DialogTitle>
            <DialogDescription>
              Changes where this connection points. The database itself is
              untouched.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>

            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Field label="Host">
                <Input
                  value={host}
                  onChange={(e) => {
                    setHost(e.target.value)
                    setTestResult(null)
                  }}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="Port">
                <Input
                  value={port}
                  onChange={(e) =>
                    setPort(e.target.value.replace(/[^\d]/g, ""))
                  }
                  inputMode="numeric"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="User">
                <Input
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setTestResult(null)
                  }}
                  placeholder="unchanged"
                />
              </Field>
            </div>

            <Field label="Database">
              <Input
                value={dbName}
                onChange={(e) => setDbName(e.target.value)}
                spellCheck={false}
                className="font-mono text-xs"
              />
            </Field>

            {/* A project's own code reaches this from inside a container,
                where `127.0.0.1` is that container rather than this machine. */}
            {LOCAL_HOSTS.has(host.trim().toLowerCase()) && (
              <p className="rounded-lg border p-2.5 text-[0.7rem] text-muted-foreground">
                This address is right for the studio, which connects from your
                machine. The project runs in a container, and reaches the same
                server as{" "}
                <code className="font-mono">host.docker.internal</code>.
              </p>
            )}

            {testResult && (
              <p
                className={cn(
                  "font-mono text-xs whitespace-pre-wrap",
                  testResult.ok ? "text-success" : "text-destructive"
                )}
              >
                {testResult.ok
                  ? `Connected — ${testResult.version}`
                  : testResult.error}
              </p>
            )}
            {error && (
              <p className="font-mono text-xs whitespace-pre-wrap text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              disabled={testing || !password}
              title={
                password ? undefined : "Type the password to test a connection"
              }
              onClick={() => void test()}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button type="submit" disabled={busy || !canSubmit}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Addresses that mean this machine — and something else inside a container. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"])

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <Label className="flex flex-col items-stretch gap-1.5 text-xs font-medium">
      {label}
      {children}
    </Label>
  )
}
