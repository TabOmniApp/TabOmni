import type { HttpResponseResult, HttpSendInput } from "../shared/api"

/** Bodies larger than this are described rather than returned: the renderer
 * has to hold whatever comes back in a string, and a stray file download
 * should not take the window with it. */
const MAX_BODY_BYTES = 8 * 1024 * 1024

/**
 * Content types read back as text. Anything else is reported by size — an
 * image or a zip rendered into a `<pre>` is noise at best.
 */
function isTextual(contentType: string): boolean {
  const type = contentType.toLowerCase()
  return (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("xml") ||
    type.includes("javascript") ||
    type.includes("x-www-form-urlencoded") ||
    type === ""
  )
}

function describe(size: number, contentType: string): string {
  const kind = contentType.split(";")[0]?.trim() || "unknown type"
  return `${size} bytes of ${kind}`
}

/**
 * Sends one request and waits for the whole response.
 *
 * Runs in the main process on purpose: from here there is no page origin, so
 * no CORS preflight and no cookie jar of the studio's own, and headers a
 * renderer is forbidden to set (`Host`, `Origin`, …) go out as typed. A failed
 * request is an error rather than a result — there is no status to report.
 */
export async function sendHttp(
  input: HttpSendInput
): Promise<HttpResponseResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs)
  const started = performance.now()

  try {
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers.map(
        (header) => [header.name, header.value] as [string, string]
      ),
      body: input.body,
      signal: controller.signal,
      // The studio has no session to protect and follows what the user typed:
      // a 302 is worth seeing rather than silently following.
      redirect: "manual",
    })

    const buffer = await response.arrayBuffer()
    const contentType = response.headers.get("content-type") ?? ""
    const textual =
      isTextual(contentType) && buffer.byteLength <= MAX_BODY_BYTES

    const headers: Record<string, string> = {}
    response.headers.forEach((value, name) => {
      headers[name] = value
    })

    return {
      // `getSetCookie` is the only way back to the individual lines; the
      // header map has already joined them by the time anyone else looks.
      setCookies: response.headers.getSetCookie(),
      status: response.status,
      statusText: response.statusText,
      headers,
      body: textual
        ? new TextDecoder().decode(buffer)
        : describe(buffer.byteLength, contentType),
      isText: textual,
      size: buffer.byteLength,
      timeMs: Math.round(performance.now() - started),
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`No response within ${input.timeoutMs}ms.`)
    }
    // `fetch` reports every transport failure as the same "fetch failed"; the
    // cause is where the refused connection or the bad host actually is.
    const cause = (error as { cause?: unknown }).cause
    const detail =
      cause instanceof Error
        ? cause.message
        : error instanceof Error
          ? error.message
          : String(error)
    throw new Error(detail)
  } finally {
    clearTimeout(timeout)
  }
}
