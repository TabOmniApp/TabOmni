import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { DbEngine } from "../shared/api"

const run = promisify(execFile)

/** Marks a database's own container, keyed by database id rather than project id. */
const DB_LABEL = "vn.app.tabomni.database"

const DB_IMAGE: Record<DbEngine, string> = {
  postgres: "postgres:16-alpine",
  mysql: "mysql:8",
}

/** The port each engine listens on inside its own container. */
const DB_CONTAINER_PORT: Record<DbEngine, number> = {
  postgres: 5432,
  mysql: 3306,
}

/** Where each engine's image keeps its data directory. */
const DB_DATA_PATH: Record<DbEngine, string> = {
  postgres: "/var/lib/postgresql/data",
  mysql: "/var/lib/mysql",
}

export type DbContainerCredentials = {
  user: string
  password: string
  database: string
}

/** Ceilings so a runaway build cannot take the machine down with it. */
const LIMITS = {
  memory: "4g",
  cpus: "2",
  pids: "512",
}

export type DockerStatus =
  { available: true; version: string } | { available: false; reason: string }

/**
 * One container per Docker-managed database.
 *
 * This used to also run a container per project — the sandbox a dev server
 * and its preview ran in. That is gone with the preview; a database's
 * container is all that is left.
 */
export class DockerRuntime {
  private status: DockerStatus | null = null

  /** Whether Docker can be used, checked once and remembered. */
  async check(): Promise<DockerStatus> {
    this.status ??= await probe()
    return this.status
  }

  /** Forgets a cached negative result, so starting Docker later is picked up. */
  resetCheck(): void {
    this.status = null
  }

  /** Stops every container we started. Called when the app quits. */
  async stopAll(): Promise<void> {
    const names = await ours(DB_LABEL)
    await Promise.all(
      names.map((name) => run("docker", ["stop", name]).catch(() => {}))
    )
  }

  /**
   * Makes sure a database's own container is running, creating it if needed,
   * and returns the host port its server was published on.
   */
  async ensureDatabase(
    /** Whose network this database joins, so the workspace's own code can
     * reach it. */
    workspaceId: string,
    databaseId: string,
    engine: DbEngine,
    dataDir: string,
    credentials: DbContainerCredentials,
    onProgress?: (line: string) => void
  ): Promise<number> {
    const status = await this.check()
    if (!status.available) throw new Error(status.reason)

    const name = dbContainerName(databaseId)
    const image = DB_IMAGE[engine]

    const state = await inspectState(name)
    if (state !== null) {
      if (state !== "running") {
        onProgress?.(`Starting database ${name}…`)
        await run("docker", ["start", name])
      }
      // An existing container predates the network, or predates the workspace
      // having one; joining is enough, and cheaper than rebuilding a database.
      await this.joinNetwork(workspaceId, name, credentials.database)
      return this.databaseHostPort(databaseId, engine)
    }

    if (!(await hasImage(image))) {
      onProgress?.(`Pulling ${image} (first run, this can take a while)…`)
      await run("docker", ["pull", image], { maxBuffer: 1024 * 1024 * 32 })
    }

    onProgress?.("Creating database…")
    try {
      await run("docker", [
        "run",
        ...dbCreateArgs(name, databaseId, engine, dataDir, credentials, image),
      ])
    } catch (error) {
      if (!isNameConflict(error)) throw error
      await run("docker", ["start", name]).catch(() => {})
    }
    await this.joinNetwork(workspaceId, name, credentials.database)
    return this.databaseHostPort(databaseId, engine)
  }

  /**
   * Puts a container on the workspace's network, creating the network first.
   */
  private async joinNetwork(
    workspaceId: string,
    container: string,
    /** A second name to answer to, so a database is reachable as `shop`
     * rather than as `tabomni-db-<uuid>`. */
    alias?: string
  ) {
    const network = networkName(workspaceId)
    // Both of these are "already done" as often as not, and neither has a
    // failure worth stopping a start for.
    await run("docker", ["network", "create", network]).catch(() => {})
    await run("docker", [
      "network",
      "connect",
      ...(alias ? ["--alias", alias] : []),
      network,
      container,
    ]).catch(() => {})
  }

  /** Stops and deletes a database's container. Its data directory is the caller's to remove. */
  async removeDatabase(databaseId: string): Promise<void> {
    await run("docker", ["rm", "-f", dbContainerName(databaseId)]).catch(
      () => {}
    )
  }

  /** The host port Docker assigned to a database's own port. */
  async databaseHostPort(
    databaseId: string,
    engine: DbEngine
  ): Promise<number> {
    const { stdout } = await run("docker", [
      "port",
      dbContainerName(databaseId),
      String(DB_CONTAINER_PORT[engine]),
    ])

    const match = /:(\d+)\s*$/m.exec(stdout.trim())
    if (!match) {
      throw new Error(`Could not read the database's port: ${stdout}`)
    }
    return Number(match[1])
  }
}

/**
 * The network a workspace and its databases share.
 *
 * Published ports reach a database from the host, which is where the studio
 * itself connects from. Keyed by workspace rather than fixed, so the day
 * sign-in brings a second one its databases are not reachable by guessing.
 */
function networkName(workspaceId: string): string {
  return `tabomni-net-${workspaceId}`
}

/**
 * Where a database answers from *inside* its network: its container name, and
 * the port the engine actually listens on — not the one Docker published to
 * the host, which is a different number and a different address entirely.
 */
function dbContainerName(databaseId: string): string {
  return `tabomni-db-${databaseId}`
}

/** The env vars each engine's image needs to come up with our credentials. */
function dbEnvArgs(
  engine: DbEngine,
  credentials: DbContainerCredentials
): string[] {
  if (engine === "postgres") {
    return [
      "--env",
      `POSTGRES_USER=${credentials.user}`,
      "--env",
      `POSTGRES_PASSWORD=${credentials.password}`,
      "--env",
      `POSTGRES_DB=${credentials.database}`,
    ]
  }
  return [
    "--env",
    `MYSQL_USER=${credentials.user}`,
    "--env",
    `MYSQL_PASSWORD=${credentials.password}`,
    "--env",
    `MYSQL_DATABASE=${credentials.database}`,
    // The account this app connects with is never root; a random password
    // nobody is told satisfies the image's requirement to set one.
    "--env",
    "MYSQL_RANDOM_ROOT_PASSWORD=yes",
  ]
}

/**
 * `docker run` flags for a database's container.
 *
 * This does not run as the host uid or drop capabilities: Postgres and
 * MySQL's own entrypoints start as root, `chown` the mounted data directory to
 * their internal user, and drop privileges themselves — the standard way both
 * images are meant to be run.
 */
function dbCreateArgs(
  name: string,
  databaseId: string,
  engine: DbEngine,
  dataDir: string,
  credentials: DbContainerCredentials,
  image: string
): string[] {
  return [
    "--detach",
    "--name",
    name,
    "--label",
    `${DB_LABEL}=${databaseId}`,

    "--volume",
    `${dataDir}:${DB_DATA_PATH[engine]}`,

    // Loopback only: this machine only. The host side is Docker's choice,
    // read back with `docker port`.
    "--publish",
    `127.0.0.1::${DB_CONTAINER_PORT[engine]}`,

    ...dbEnvArgs(engine, credentials),

    "--memory",
    LIMITS.memory,
    "--cpus",
    LIMITS.cpus,
    "--pids-limit",
    LIMITS.pids,

    image,
  ]
}

async function probe(): Promise<DockerStatus> {
  try {
    const { stdout } = await run("docker", [
      "version",
      "--format",
      "{{.Server.Version}}",
    ])
    const version = stdout.trim()
    if (!version) {
      return {
        available: false,
        reason: "Docker is installed but not running.",
      }
    }
    return { available: true, version }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A missing binary and a stopped daemon are different problems for the
    // user, and the distinction is worth keeping in the message.
    const reason = /ENOENT|not found/i.test(message)
      ? "Docker is not installed."
      : "Docker is installed but not running."
    return { available: false, reason }
  }
}

/**
 * Whether `docker run` failed only because the name was taken.
 *
 * Matched on the daemon's wording rather than an exit code, which is the same
 * for every failure.
 */
function isNameConflict(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message}${(error as { stderr?: string }).stderr ?? ""}`
      : String(error)
  return /already in use by container/i.test(text)
}

async function hasImage(image: string): Promise<boolean> {
  const { stdout } = await run("docker", ["images", "--quiet", image]).catch(
    () => ({ stdout: "" })
  )
  return stdout.trim().length > 0
}

/** `running`, some other Docker state, or null when there is no container. */
async function inspectState(name: string): Promise<string | null> {
  try {
    const { stdout } = await run("docker", [
      "inspect",
      "--format",
      "{{.State.Status}}",
      name,
    ])
    return stdout.trim()
  } catch {
    return null
  }
}

/** Every container carrying the given label — ours. */
async function ours(label: string): Promise<string[]> {
  const { stdout } = await run("docker", [
    "ps",
    "--all",
    "--filter",
    `label=${label}`,
    "--format",
    "{{.Names}}",
  ]).catch(() => ({ stdout: "" }))

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}
