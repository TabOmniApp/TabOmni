import { homedir } from "node:os"
import path from "node:path"

/**
 * Where everything this app keeps on disk lives, under the user's home.
 *
 * Its own module, tiny as it is, because `store.ts` reaches Electron's
 * `safeStorage` to encrypt database passwords — so anything importing the path
 * from there drags a running Electron in with it, which a test running under
 * plain `bun` cannot do.
 */
export const DATA_DIR_NAME = ".tabula"

/**
 * `TABULA_DATA_DIR` moves the whole tree — the manifest, the workspace's own
 * files and the agent settings alike.
 *
 * Read on every call rather than captured once, so that a test can point it
 * somewhere disposable before the first read. That is not a detail: the
 * alternative for a test is `$HOME`, and `homedir()` is resolved at startup by
 * at least one of the runtimes this repo uses, which makes redirecting it from
 * inside the process silently do nothing.
 */
export function dataDir(): string {
  return process.env.TABULA_DATA_DIR ?? path.join(homedir(), DATA_DIR_NAME)
}
