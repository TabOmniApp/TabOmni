import path from "node:path"
import { pathToFileURL } from "node:url"

import { net, protocol } from "electron"

/**
 * The origin the built renderer is served from.
 *
 * `file://` would be simpler but is not viable: it has no real origin, so
 * service workers are unavailable — and almostnode's preview depends on one —
 * and storage APIs are restricted. A privileged scheme behaves like `https`
 * without needing a port, and keeps absolute asset paths (`/almostnode/...`)
 * resolving exactly as they do against the dev server.
 */
export const APP_SCHEME = "app"
export const APP_ORIGIN = `${APP_SCHEME}://studio`

/** Must run before `app.whenReady()`, or the privileges are ignored. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        allowServiceWorkers: true,
        stream: true,
      },
    },
  ])
}

/** Serves the built renderer out of `root`. Call once the app is ready. */
export function serveApp(root: string): void {
  const base = path.resolve(root)

  protocol.handle(APP_SCHEME, (request) => {
    const { pathname } = new URL(request.url)

    // decodeURIComponent so paths with spaces resolve; `path.join` on the
    // decoded value is what the traversal check below guards.
    const relative = decodeURIComponent(pathname).replace(/^\/+/, "")
    const target = path.resolve(base, relative || "index.html")

    if (target !== base && !target.startsWith(base + path.sep)) {
      return new Response("Forbidden", { status: 403 })
    }

    return net.fetch(pathToFileURL(target).toString())
  })
}
