import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { Trash2 } from "lucide-react"

import { isExpired } from "@/lib/http/cookies"
import { useApi } from "@/lib/http/store"
import { IconButton } from "../icon-button"

/**
 * The project's cookie jar: what responses have set, and the chance to throw
 * any of it away.
 *
 * Read-only apart from deleting. A cookie is something a server said, and
 * hand-editing one is the kind of thing that leaves you debugging the client
 * instead of the server — a request can always carry a `Cookie` header of its
 * own, which wins over the jar.
 */
export function CookieDialog({ onClose }: { onClose: () => void }) {
  const cookies = useApi((state) => state.cookies)
  const removeCookie = useApi((state) => state.removeCookie)
  const clearCookies = useApi((state) => state.clearCookies)

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cookies</DialogTitle>
          <DialogDescription>
            Kept from responses and sent back on requests they match, by domain
            and path. A request with its own{" "}
            <code className="font-mono">Cookie</code> header sends that instead.
          </DialogDescription>
        </DialogHeader>

        {cookies.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            No cookies yet. One arrives the first time a response sets one.
          </p>
        ) : (
          <ul className="max-h-96 divide-y overflow-auto">
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
                      {cookie.hostOnly ? cookie.domain : `*.${cookie.domain}`}
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

        <DialogFooter showCloseButton>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={cookies.length === 0}
            onClick={clearCookies}
          >
            Clear all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
