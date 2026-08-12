import type { HttpCookie } from "@shared/api"

/**
 * The cookie jar, as far as an API client needs one.
 *
 * Enough of RFC 6265 to behave sensibly against a dev server — a login route
 * sets a session cookie and the next request carries it — without pretending
 * to be a browser. There is no public-suffix list here, so nothing stops a
 * response from `example.com` claiming a cookie for `example.com`; that is a
 * defence against *other* sites, and every request here is one the user typed.
 */

/** Splits a `Set-Cookie` line into a cookie, or null when it is unusable. */
export function parseSetCookie(
  line: string,
  requestUrl: string
): HttpCookie | null {
  const [pair, ...rest] = line.split(";")
  if (!pair) return null

  const equals = pair.indexOf("=")
  if (equals === -1) return null
  const name = pair.slice(0, equals).trim()
  if (!name) return null
  const value = pair.slice(equals + 1).trim()

  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }

  const cookie: HttpCookie = {
    name,
    value,
    domain: url.hostname,
    hostOnly: true,
    path: defaultPath(url.pathname),
    expiresAt: null,
    secure: false,
    httpOnly: false,
  }

  for (const attribute of rest) {
    const at = attribute.indexOf("=")
    const key = (at === -1 ? attribute : attribute.slice(0, at))
      .trim()
      .toLowerCase()
    const raw = at === -1 ? "" : attribute.slice(at + 1).trim()

    switch (key) {
      case "domain": {
        // A leading dot is legacy syntax for "and its subdomains", which is
        // what any explicit Domain means now.
        const domain = raw.replace(/^\./, "").toLowerCase()
        if (domain) {
          cookie.domain = domain
          cookie.hostOnly = false
        }
        break
      }
      case "path":
        if (raw.startsWith("/")) cookie.path = raw
        break
      case "expires": {
        const date = new Date(raw)
        if (!Number.isNaN(date.getTime())) {
          cookie.expiresAt = date.toISOString()
        }
        break
      }
      case "max-age": {
        const seconds = Number(raw)
        // Max-Age wins over Expires, and zero or less means "delete this".
        if (Number.isFinite(seconds)) {
          cookie.expiresAt = new Date(Date.now() + seconds * 1000).toISOString()
        }
        break
      }
      case "secure":
        cookie.secure = true
        break
      case "httponly":
        cookie.httpOnly = true
        break
    }
  }

  return cookie
}

/** RFC 6265's default path: the directory the response came from. */
function defaultPath(pathname: string): string {
  if (!pathname.startsWith("/")) return "/"
  const lastSlash = pathname.lastIndexOf("/")
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash)
}

/** Whether a cookie's lifetime has run out. A cookie given none never has. */
export function isExpired(cookie: HttpCookie, now = Date.now()): boolean {
  return cookie.expiresAt !== null && Date.parse(cookie.expiresAt) <= now
}

/** Same cookie, in the sense that a new one replaces an old one. */
function isSame(a: HttpCookie, b: HttpCookie): boolean {
  return a.name === b.name && a.domain === b.domain && a.path === b.path
}

/**
 * Folds what a response set into the jar.
 *
 * A cookie that arrives already expired is a deletion — that is how a logout
 * clears a session — so it takes the old one with it rather than being stored.
 */
export function mergeCookies(
  jar: HttpCookie[],
  setCookieLines: string[],
  requestUrl: string
): HttpCookie[] {
  let next = jar.filter((cookie) => !isExpired(cookie))

  for (const line of setCookieLines) {
    const cookie = parseSetCookie(line, requestUrl)
    if (!cookie) continue
    next = next.filter((existing) => !isSame(existing, cookie))
    if (!isExpired(cookie)) next.push(cookie)
  }
  return next
}

function domainMatches(host: string, cookie: HttpCookie): boolean {
  if (host === cookie.domain) return true
  return !cookie.hostOnly && host.endsWith(`.${cookie.domain}`)
}

function pathMatches(pathname: string, cookiePath: string): boolean {
  if (pathname === cookiePath) return true
  if (!pathname.startsWith(cookiePath)) return false
  // `/foo` covers `/foo/bar` but not `/foobar`.
  return cookiePath.endsWith("/") || pathname[cookiePath.length] === "/"
}

/** The cookies that belong on a request to this URL. */
export function cookiesFor(
  jar: HttpCookie[],
  requestUrl: string,
  now = Date.now()
): HttpCookie[] {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return []
  }
  const secureContext = url.protocol === "https:"

  return jar.filter(
    (cookie) =>
      !isExpired(cookie, now) &&
      domainMatches(url.hostname.toLowerCase(), cookie) &&
      pathMatches(url.pathname || "/", cookie.path) &&
      (!cookie.secure || secureContext)
  )
}

/** The `Cookie` header's value, or null when there is nothing to send. */
export function cookieHeader(cookies: HttpCookie[]): string | null {
  if (cookies.length === 0) return null
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
}
