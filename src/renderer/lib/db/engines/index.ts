import type { DbEngine } from "@shared/api"

import { mysqlAdapter } from "./mysql"
import { postgresAdapter } from "./postgres"
import type { EngineAdapter } from "./types"

export * from "./shared"
export * from "./types"

/** Everything the Database panel needs, dispatched by which engine a database speaks. */
export function getAdapter(engine: DbEngine): EngineAdapter {
  return engine === "postgres" ? postgresAdapter : mysqlAdapter
}
