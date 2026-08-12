import type {
  ConnectionTestResult,
  DatabaseConnectionInput,
  DatabaseRecord,
  NewDatabaseInput,
  UpdateDatabaseInput,
} from "@shared/api"

export type {
  ConnectionTestResult,
  DatabaseConnectionInput,
  DatabaseRecord,
  NewDatabaseInput,
  UpdateDatabaseInput,
}

/** Every database or connection in the workspace. */
export async function listDatabases(): Promise<DatabaseRecord[]> {
  return window.desktop.listDatabases()
}

/**
 * Adds a database: either a new one in a Docker container, or a connection to
 * one that already exists.
 */
export async function createDatabase(
  input: NewDatabaseInput
): Promise<DatabaseRecord> {
  return window.desktop.createDatabase(input)
}

/**
 * Removes a database. For a Docker-managed one, this also removes its
 * container and data; for a connection, only the record goes.
 */
/** Rewrites a connection's details. Only for `external` records. */
export async function updateDatabase(
  id: string,
  input: UpdateDatabaseInput
): Promise<DatabaseRecord> {
  return window.desktop.updateDatabase(id, input)
}

export async function deleteDatabase(id: string): Promise<void> {
  await window.desktop.deleteDatabase(id)
}

/** Tries a connection without saving it, for the "Test connection" button. */
export async function testDatabaseConnection(
  input: DatabaseConnectionInput
): Promise<ConnectionTestResult> {
  return window.desktop.testDatabaseConnection(input)
}

/** Deletes a Docker-managed database's data and recreates it empty. */
export async function resetDatabase(id: string): Promise<void> {
  await window.desktop.dbReset(id)
}
