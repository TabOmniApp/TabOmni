import type { DesktopApi } from "@shared/api"

declare global {
  interface Window {
    /** Exposed by the Electron preload script; see apps/desktop/electron/preload.ts. */
    desktop: DesktopApi
  }
}
