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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { AlertTriangle, Check, Database, Plug } from "lucide-react"

import type { DbEngine } from "@shared/api"
import { testDatabaseConnection } from "@/lib/db/databases"
import { useDatabases } from "@/lib/db/databases-store"

const DEFAULT_PORT: Record<DbEngine, number> = {
  postgres: 5432,
  mysql: 3306,
}

const ENGINE_LABEL: Record<DbEngine, string> = {
  postgres: "Postgres",
  mysql: "MySQL",
}

type Mode = "choose" | "create" | "connect"

export function NewDatabaseDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("choose")

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        {mode === "choose" ? (
          <ChooseMode onClose={onClose} onPick={setMode} />
        ) : mode === "create" ? (
          <CreateForm onBack={() => setMode("choose")} onClose={onClose} />
        ) : (
          <ConnectForm onBack={() => setMode("choose")} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ChooseMode({
  onClose,
  onPick,
}: {
  onClose: () => void
  onPick: (mode: Mode) => void
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a database</DialogTitle>
        <DialogDescription>
          Create a new one in a container of its own, or connect to a database
          you already have.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => onPick("create")}
          className="flex items-start gap-3 rounded-lg border p-3 text-left hover:bg-accent/50"
        >
          <Database className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <span>
            <span className="block text-sm font-medium">
              Create a new database
            </span>
            <span className="block text-xs text-muted-foreground">
              Postgres or MySQL, run in a Docker container this app manages.
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => onPick("connect")}
          className="flex items-start gap-3 rounded-lg border p-3 text-left hover:bg-accent/50"
        >
          <Plug className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <span>
            <span className="block text-sm font-medium">
              Connect to an existing database
            </span>
            <span className="block text-xs text-muted-foreground">
              Postgres or MySQL, reached wherever it already runs.
            </span>
          </span>
        </button>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  )
}

/** The engine picker shared by the create and connect forms. */
function EngineChoice({
  engine,
  onChange,
}: {
  engine: DbEngine
  onChange: (engine: DbEngine) => void
}) {
  return (
    <div>
      <Label className="text-xs font-medium">Engine</Label>
      <RadioGroup
        value={engine}
        onValueChange={(value) => onChange(value as DbEngine)}
        className="mt-1.5 grid grid-cols-2 gap-2"
      >
        {(["postgres", "mysql"] as const).map((candidate) => (
          <Label
            key={candidate}
            className="flex items-center gap-2 rounded-lg border p-2.5 text-sm font-normal has-data-checked:border-primary"
          >
            <RadioGroupItem value={candidate} />
            {ENGINE_LABEL[candidate]}
          </Label>
        ))}
      </RadioGroup>
    </div>
  )
}

function CreateForm({
  onBack,
  onClose,
}: {
  onBack: () => void
  onClose: () => void
}) {
  const create = useDatabases((state) => state.create)

  const [engine, setEngine] = useState<DbEngine>("postgres")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await create({ name: name.trim(), engine, origin: "docker" })
      onClose()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Create a database</DialogTitle>
        <DialogDescription>
          Runs in a Docker container this app creates, with its data kept beside
          the project&apos;s own files.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-4">
        <EngineChoice engine={engine} onChange={setEngine} />

        <div>
          <Label htmlFor="db-name" className="text-xs font-medium">
            Name
          </Label>
          <Input
            id="db-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="app"
            spellCheck={false}
            className="mt-1.5"
          />
        </div>

        {busy && (
          <p className="text-xs text-muted-foreground">
            Creating the database — pulling the image can take a minute the
            first time…
          </p>
        )}

        {error && (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        )}
      </div>

      <DialogFooter className="mt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={busy}
        >
          Back
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function ConnectForm({
  onBack,
  onClose,
}: {
  onBack: () => void
  onClose: () => void
}) {
  const create = useDatabases((state) => state.create)

  const [engine, setEngine] = useState<DbEngine>("postgres")
  const [name, setName] = useState("")
  const [host, setHost] = useState("127.0.0.1")
  const [port, setPort] = useState(String(DEFAULT_PORT.postgres))
  const [user, setUser] = useState("")
  const [password, setPassword] = useState("")
  const [database, setDatabase] = useState("")

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<
    { ok: true; version: string } | { ok: false; error: string } | null
  >(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function pickEngine(next: DbEngine) {
    setEngine(next)
    // Only replaces the port while it still matches the previous engine's
    // default — a port the user actually typed is left alone.
    setPort((current) =>
      current === String(DEFAULT_PORT[engine])
        ? String(DEFAULT_PORT[next])
        : current
    )
    setTestResult(null)
  }

  const connection = {
    engine,
    host: host.trim(),
    port: Number(port) || DEFAULT_PORT[engine],
    user: user.trim(),
    password,
    database: database.trim(),
  }
  const canSubmit =
    connection.host && connection.user && connection.database && name.trim()

  async function test() {
    setTesting(true)
    setTestResult(null)
    const result = await testDatabaseConnection(connection)
    setTesting(false)
    setTestResult(result)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await create({
        name: name.trim(),
        origin: "external",
        ...connection,
      })
      onClose()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Connect to a database</DialogTitle>
        <DialogDescription>
          Nothing is created — this only adds a connection to a database that
          already exists.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-4">
        <EngineChoice engine={engine} onChange={pickEngine} />

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Host"
            value={host}
            onChange={setHost}
            placeholder="127.0.0.1"
          />
          <Field
            label="Port"
            value={port}
            onChange={setPort}
            placeholder={String(DEFAULT_PORT[engine])}
          />
          <Field
            label="User"
            value={user}
            onChange={setUser}
            placeholder="postgres"
          />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
          />
          <Field
            label="Database"
            value={database}
            onChange={setDatabase}
            placeholder="app"
          />
          <Field
            label="Name"
            value={name}
            onChange={setName}
            placeholder="app"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testing || !connection.host || !connection.user}
            onClick={() => void test()}
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>

          {testResult?.ok && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="size-3.5" />
              {testResult.version}
            </span>
          )}
          {testResult && !testResult.ok && (
            <span className="text-xs text-destructive">{testResult.error}</span>
          )}
        </div>

        {error && (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        )}
      </div>

      <DialogFooter className="mt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={busy}
        >
          Back
        </Button>
        <Button type="submit" disabled={busy || !canSubmit}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <Label className="flex flex-col items-start gap-1.5 text-xs font-medium">
      {label}
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="w-full font-mono text-xs"
      />
    </Label>
  )
}
