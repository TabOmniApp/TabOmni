import { create } from "zustand"

import type {
  ApiImportResult,
  HttpCookie,
  HttpEnvironment,
  HttpFolder,
  HttpHeader,
  HttpRequestRecord,
  HttpResponseResult,
} from "@shared/api"
import { useStudio } from "../store"
import { isRememberedTabs, recall, remember } from "../tab-memory"
import { cookieHeader, cookiesFor, mergeCookies } from "./cookies"
import {
  descendantFolderIds,
  isDescendant,
  resolveHeaders,
  withFolderParams,
} from "./folders"
import { substitute, unresolved } from "./query"
import { runPostResponseScript, type ScriptResult } from "./sandbox"

/** Methods offered in the picker, in the order they are reached for. */
export const METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const

/** Methods sent without a body, whatever is in the editor. */
const BODYLESS = new Set(["GET", "HEAD"])

/** Whether this method carries no body — HTTP forbids one on GET and HEAD.
 * DELETE and OPTIONS may have one, so they are not on the list. */
export function isBodyless(method: string): boolean {
  return BODYLESS.has(method)
}

/**
 * The id the settings page occupies in `openIds`/`selectedId`.
 *
 * Settings is a tab like a request or a folder rather than a dialog, so that
 * everything the workbench shows is reachable from the one strip. Requests and
 * folders are given `crypto.randomUUID()` ids, so a fixed word cannot collide
 * with one.
 */
export const SETTINGS_TAB_ID = "api-settings"

const TIMEOUT_MS = 30_000

/** How long typing settles before the collection is written back. */
const SAVE_DELAY_MS = 400

/** What a request's post-response script did the last time it ran — never
 * saved, like the response itself. */
export type ScriptOutcome = ScriptResult

/** What one request is doing, and what came back last time it ran. */
export type RequestOutcome = {
  sending: boolean
  result: HttpResponseResult | null
  /** A transport failure — no response at all. */
  error: string | null
  /** `null` until a response with a post-response script attached comes
   * back — a request with no script never sets this. */
  script: ScriptOutcome | null
}

const IDLE: RequestOutcome = {
  sending: false,
  result: null,
  error: null,
  script: null,
}

/** Where the chosen environment is remembered. */
const ACTIVE_ENVIRONMENT_KEY = "http.environment"

/** Which requests were open in the strip, and which was on screen. */
const OPEN_TABS_KEY = "http.tabs"

type ApiState = {
  requests: HttpRequestRecord[]
  loading: boolean
  /** Requests with a tab open, oldest first. */
  openIds: string[]
  selectedId: string | null
  /** Keyed by request id, for the session only — a response is not saved. */
  outcomes: Record<string, RequestOutcome>

  environments: HttpEnvironment[]
  /** Which environment's variables apply, or null for none. */
  activeEnvironmentId: string | null

  /** Cookies picked up from responses, sent back on matching requests. */
  cookies: HttpCookie[]

  /** Groups requests into a tree; a folder's headers/params cascade into
   * every request nested under it. */
  folders: HttpFolder[]

  refresh: () => Promise<void>
  create: (folderId?: string | null) => Promise<void>
  update: (id: string, patch: Partial<HttpRequestRecord>) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  /** Turns an AI import's proposal into real folders/requests and saves them,
   * nested under `targetFolderId` (top level when null — the default).
   * Additive: a re-run appends rather than diffing against what is already
   * there, same as `create`/`createFolder` never dedupe either — the import
   * dialog is where the user sees the proposal and can back out first. */
  importFromAi: (
    result: ApiImportResult,
    targetFolderId?: string | null
  ) => void

  select: (id: string) => void
  close: (id: string) => void
  closeOthers: (id: string) => void
  closeAll: () => void
  reorder: (ids: string[]) => void

  send: (id: string) => Promise<void>

  addCookie: (cookie: HttpCookie) => void
  removeCookie: (cookie: HttpCookie) => void
  clearCookies: () => void

  createEnvironment: (name: string) => void
  renameEnvironment: (id: string, name: string) => void
  removeEnvironment: (id: string) => void
  setVariables: (id: string, variables: HttpEnvironment["variables"]) => void
  selectEnvironment: (id: string | null) => void

  createFolder: (parentId: string | null) => HttpFolder
  renameFolder: (id: string, name: string) => void
  /** Deletes the folder and everything nested under it — its subfolders and
   * their requests included. The caller confirms first; there is no undo. */
  removeFolder: (id: string) => void
  /** Reparents a folder. A no-op if `parentId` is the folder itself or one of
   * its own descendants — that would make the tree a cycle. */
  moveFolder: (id: string, parentId: string | null) => void
  moveRequestToFolder: (requestId: string, folderId: string | null) => void
  setFolderHeaders: (id: string, headers: HttpHeader[]) => void
  setFolderParams: (id: string, params: HttpHeader[]) => void
}

/**
 * Every variable a request can use, from the active environment.
 *
 * `baseUrl` has no built-in value here — an environment that defines its own
 * is what lets a bare path like `/api/users` resolve to something.
 */
export function variablesFrom(
  environments: HttpEnvironment[],
  activeId: string | null
): Record<string, string> {
  const variables: Record<string, string> = {}

  const active = environments.find((environment) => environment.id === activeId)
  for (const variable of active?.variables ?? []) {
    const name = variable.name.trim()
    if (name) variables[name] = variable.value
  }
  return variables
}

/**
 * Turns what the user typed into an address to send to.
 *
 * Variables are substituted first; a bare path is then taken as one on
 * `baseUrl`, because typing `/api/users` is the common case and should not
 * need a hostname. Anything already absolute is left exactly as written.
 */
export function resolveUrl(
  url: string,
  variables: Record<string, string>
): { url: string; error: string | null } {
  const typed = url.trim()
  if (!typed) return { url: "", error: "This request has no URL." }

  const substituted = substitute(typed, variables)
  const missing = unresolved(substituted)
  if (missing.length > 0) {
    // The one variable nobody defines by hand deserves its own explanation.
    const error =
      missing.length === 1 && missing[0] === "baseUrl"
        ? "No environment defines baseUrl."
        : `No value for ${missing.map((name) => `{{${name}}}`).join(", ")}.`
    return { url: substituted, error }
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(substituted)) {
    return { url: substituted, error: null }
  }
  if (substituted.startsWith("/")) {
    if (!variables.baseUrl) {
      return { url: substituted, error: "No environment defines baseUrl." }
    }
    return { url: variables.baseUrl + substituted, error: null }
  }
  // Neither absolute nor rooted: assume it is a host that was typed without
  // its scheme, which is how everyone types one.
  return { url: `http://${substituted}`, error: null }
}

function now(): string {
  return new Date().toISOString()
}

function blankRequest(
  index: number,
  folderId: string | null
): HttpRequestRecord {
  return {
    id: crypto.randomUUID(),
    name: index === 0 ? "New request" : `New request ${index + 1}`,
    method: "GET",
    url: "{{baseUrl}}/",
    headers: [],
    body: "",
    folderId,
    createdAt: now(),
    updatedAt: now(),
  }
}

function blankImportedRequest(
  item: ApiImportResult["requests"][number],
  folderId: string | null
): HttpRequestRecord {
  return {
    id: crypto.randomUUID(),
    name: item.name,
    method: item.method,
    url: item.url,
    headers: (item.headers ?? []).map((header) => ({
      ...header,
      enabled: true,
    })),
    body: item.body ?? "",
    folderId,
    createdAt: now(),
    updatedAt: now(),
  }
}

function blankFolder(parentId: string | null): HttpFolder {
  return {
    id: crypto.randomUUID(),
    name: "New folder",
    parentId,
    headers: [],
    params: [],
    createdAt: now(),
    updatedAt: now(),
  }
}

export const useApi = create<ApiState>((set, get) => {
  let pendingSave: ReturnType<typeof setTimeout> | undefined
  let pendingEnvironmentSave: ReturnType<typeof setTimeout> | undefined
  let pendingFolderSave: ReturnType<typeof setTimeout> | undefined
  /** Whether the strip has already been put back — see `refresh`. */
  let restored = false

  function rememberTabs() {
    const { openIds, selectedId } = get()
    remember(OPEN_TABS_KEY, { openIds, selectedId })
  }

  /**
   * Reopens what the last launch had open, dropping anything that no longer
   * resolves: a request or folder deleted since is an id that names nothing,
   * and reopening it would put a tab in the strip with no panel behind it.
   */
  function restoreTabs(requests: HttpRequestRecord[], folders: HttpFolder[]) {
    void recall(OPEN_TABS_KEY, isRememberedTabs).then((stored) => {
      if (!stored) return
      // Anything opened while this read was in flight wins: the user is here
      // now, and a stored strip is only a starting point.
      if (get().openIds.length > 0) return

      const exists = (id: string) =>
        id === SETTINGS_TAB_ID ||
        requests.some((request) => request.id === id) ||
        folders.some((folder) => folder.id === id)

      const openIds = stored.openIds.filter(exists)
      if (openIds.length === 0) return
      set({
        openIds,
        selectedId:
          stored.selectedId && openIds.includes(stored.selectedId)
            ? stored.selectedId
            : (openIds[0] ?? null),
      })
    })
  }

  /** Writes the whole collection back. */
  function persist(requests: HttpRequestRecord[]) {
    void window.desktop.saveRequests(requests).catch((error) => {
      console.error("Could not save requests", error)
    })
  }

  function commitCookies(next: HttpCookie[]) {
    set({ cookies: next })
    void window.desktop.saveCookies(next).catch((error) => {
      console.error("Could not save cookies", error)
    })
  }

  /** Saves what a post-response script asked for — upserted by name into the
   * active environment, since `setVariables` itself replaces the whole array
   * rather than patching one name — and records the run for the Tests tab.
   * A script that set something with no active environment to land in gets
   * that folded into its own error, rather than silently doing nothing. */
  function applyScriptOutcome(id: string, result: ScriptResult) {
    let error = result.error

    if (result.setVariables.length > 0) {
      const { activeEnvironmentId, environments } = get()
      const environment = environments.find(
        (candidate) => candidate.id === activeEnvironmentId
      )
      if (environment) {
        const byName = new Map(
          environment.variables.map((variable) => [variable.name, variable])
        )
        for (const { name, value } of result.setVariables) {
          byName.set(name, { name, value })
        }
        get().setVariables(environment.id, [...byName.values()])
      } else {
        const note = "No active environment — nothing was saved."
        error = error ? `${error}\n${note}` : note
      }
    }

    set((state) => ({
      outcomes: {
        ...state.outcomes,
        [id]: { ...(state.outcomes[id] ?? IDLE), script: { ...result, error } },
      },
    }))
  }

  function persistEnvironments(environments: HttpEnvironment[]) {
    void window.desktop.saveEnvironments(environments).catch((error) => {
      console.error("Could not save environments", error)
    })
  }

  /** Applies a change to the environments and writes it. Variables are typed
   * a keystroke at a time like everything else, so this shares the delay. */
  function commitEnvironments(next: HttpEnvironment[], immediate = true) {
    set({ environments: next })

    clearTimeout(pendingEnvironmentSave)
    if (immediate) {
      persistEnvironments(next)
      return
    }
    pendingEnvironmentSave = setTimeout(
      () => persistEnvironments(next),
      SAVE_DELAY_MS
    )
  }

  /**
   * Applies a change and saves it.
   *
   * Typing in a URL or a body is one change per keystroke, so those are held
   * briefly and written once the typing stops; anything structural — a
   * request added, renamed, removed — is written straight away, because it is
   * the kind of change a crash a second later should not undo.
   */
  function commit(next: HttpRequestRecord[], immediate = true) {
    set({ requests: next })

    clearTimeout(pendingSave)
    if (immediate) {
      persist(next)
      return
    }
    pendingSave = setTimeout(() => persist(next), SAVE_DELAY_MS)
  }

  function persistFolders(folders: HttpFolder[]) {
    void window.desktop.saveRequestFolders(folders).catch((error) => {
      console.error("Could not save folders", error)
    })
  }

  /** Same shape as `commitEnvironments` — structural changes (a folder added,
   * renamed, moved, removed) write at once; header/param keystrokes debounce. */
  function commitFolders(next: HttpFolder[], immediate = true) {
    set({ folders: next })

    clearTimeout(pendingFolderSave)
    if (immediate) {
      persistFolders(next)
      return
    }
    pendingFolderSave = setTimeout(() => persistFolders(next), SAVE_DELAY_MS)
  }

  return {
    requests: [],
    loading: false,
    openIds: [],
    selectedId: null,
    outcomes: {},
    environments: [],
    activeEnvironmentId: null,
    cookies: [],
    folders: [],

    async refresh() {
      set({ loading: true })
      const [requests, environments, folders, cookies, active] =
        await Promise.all([
          window.desktop.listRequests(),
          window.desktop.listEnvironments(),
          window.desktop.listRequestFolders(),
          window.desktop.listCookies(),
          window.desktop.getSetting(ACTIVE_ENVIRONMENT_KEY),
        ])
      set({
        requests,
        environments,
        folders,
        cookies,
        // A remembered environment that has since been deleted is no
        // environment at all.
        activeEnvironmentId:
          active && environments.some((item) => item.id === active)
            ? active
            : null,
        loading: false,
      })

      // Only on the first read: a later refresh — an import, a folder
      // deleted — must not reopen what has been closed since.
      if (!restored) {
        restored = true
        restoreTabs(requests, folders)
      }
    },

    async create(folderId = null) {
      const { requests } = get()
      const request = blankRequest(requests.length, folderId)
      commit([...requests, request])
      get().select(request.id)
    },

    update(id, patch) {
      commit(
        get().requests.map((request) =>
          request.id === id
            ? { ...request, ...patch, updatedAt: now() }
            : request
        ),
        // A rename comes from a dialog and is worth writing at once; the rest
        // arrive a keystroke at a time.
        patch.name !== undefined
      )
    },

    remove(id) {
      commit(get().requests.filter((request) => request.id !== id))
      get().close(id)
    },

    duplicate(id) {
      const { requests } = get()
      const source = requests.find((request) => request.id === id)
      if (!source) return
      const copy: HttpRequestRecord = {
        ...source,
        id: crypto.randomUUID(),
        name: `${source.name} copy`,
        createdAt: now(),
        updatedAt: now(),
      }
      const index = requests.findIndex((request) => request.id === id)
      const next = [...requests]
      next.splice(index + 1, 0, copy)
      commit(next)
      get().select(copy.id)
    },

    select(id) {
      useStudio.getState().showPane("api")
      const { openIds } = get()
      set({
        selectedId: id,
        openIds: openIds.includes(id) ? openIds : [...openIds, id],
      })
      rememberTabs()
    },

    close(id) {
      const { openIds, selectedId } = get()
      const index = openIds.indexOf(id)
      if (index === -1) return
      const remaining = openIds.filter((_, position) => position !== index)
      set({
        openIds: remaining,
        selectedId:
          selectedId === id
            ? (remaining[index] ?? remaining[index - 1] ?? null)
            : selectedId,
      })
      rememberTabs()
    },

    closeOthers(id) {
      set({ openIds: [id], selectedId: id })
      rememberTabs()
    },

    closeAll() {
      set({ openIds: [], selectedId: null })
      rememberTabs()
    },

    reorder(ids) {
      const { openIds } = get()
      const reordered = ids.filter((id) => openIds.includes(id))
      if (reordered.length !== openIds.length) return
      set({ openIds: reordered })
      rememberTabs()
    },

    async send(id) {
      const request = get().requests.find((candidate) => candidate.id === id)
      if (!request || get().outcomes[id]?.sending) return

      const variables = variablesFrom(
        get().environments,
        get().activeEnvironmentId
      )
      const urlWithFolderParams = withFolderParams(
        request.url,
        request.folderId,
        get().folders
      )
      const { url, error } = resolveUrl(urlWithFolderParams, variables)
      if (error) {
        set((state) => ({
          outcomes: { ...state.outcomes, [id]: { ...IDLE, error } },
        }))
        return
      }

      set((state) => ({
        outcomes: {
          ...state.outcomes,
          [id]: { sending: true, result: null, error: null, script: null },
        },
      }))

      try {
        const result = await window.desktop.httpSend({
          method: request.method,
          url,
          headers: withCookies(
            resolveHeaders(request, get().folders, variables),
            get().cookies,
            url
          ),
          body: BODYLESS.has(request.method)
            ? null
            : substitute(request.body, variables) || null,
          timeoutMs: TIMEOUT_MS,
        })
        set((state) => ({
          outcomes: {
            ...state.outcomes,
            [id]: { sending: false, result, error: null, script: null },
          },
        }))
        if (result.setCookies.length > 0) {
          commitCookies(mergeCookies(get().cookies, result.setCookies, url))
        }

        // Only on an actual response — a transport failure below never runs
        // a script, the same as Postman only runs its Tests tab on one.
        const script = request.postResponseScript?.trim()
        if (script) {
          const scriptResult = await runPostResponseScript(script, {
            request: {
              method: request.method,
              url,
              headers: resolveHeaders(request, get().folders, variables),
            },
            response: result,
            variables,
          })
          applyScriptOutcome(id, scriptResult)
        }
      } catch (failure) {
        set((state) => ({
          outcomes: {
            ...state.outcomes,
            [id]: {
              sending: false,
              result: null,
              error:
                failure instanceof Error ? failure.message : String(failure),
              script: null,
            },
          },
        }))
      }
    },
    addCookie(cookie) {
      // Same name, domain and path is the same cookie: replace rather than
      // stack two that could never both be sent.
      commitCookies([
        ...get().cookies.filter(
          (candidate) =>
            !(
              candidate.name === cookie.name &&
              candidate.domain === cookie.domain &&
              candidate.path === cookie.path
            )
        ),
        cookie,
      ])
    },

    removeCookie(cookie) {
      commitCookies(
        get().cookies.filter(
          (candidate) =>
            !(
              candidate.name === cookie.name &&
              candidate.domain === cookie.domain &&
              candidate.path === cookie.path
            )
        )
      )
    },

    clearCookies() {
      commitCookies([])
    },

    createEnvironment(name) {
      const environment: HttpEnvironment = {
        id: crypto.randomUUID(),
        name,
        variables: [],
      }
      commitEnvironments([...get().environments, environment])
      get().selectEnvironment(environment.id)
    },

    renameEnvironment(id, name) {
      commitEnvironments(
        get().environments.map((environment) =>
          environment.id === id ? { ...environment, name } : environment
        )
      )
    },

    removeEnvironment(id) {
      commitEnvironments(
        get().environments.filter((environment) => environment.id !== id)
      )
      if (get().activeEnvironmentId === id) get().selectEnvironment(null)
    },

    setVariables(id, variables) {
      commitEnvironments(
        get().environments.map((environment) =>
          environment.id === id ? { ...environment, variables } : environment
        ),
        false
      )
    },

    selectEnvironment(id) {
      set({ activeEnvironmentId: id })
      void window.desktop.setSetting(ACTIVE_ENVIRONMENT_KEY, id ?? "")
    },

    createFolder(parentId) {
      const folder = blankFolder(parentId)
      commitFolders([...get().folders, folder])
      return folder
    },

    importFromAi(result, targetFolderId = null) {
      const { folders, requests } = get()

      const newFolders: HttpFolder[] = result.folders.map((group) => ({
        id: crypto.randomUUID(),
        name: group.name,
        parentId: targetFolderId,
        headers: [],
        params: [],
        createdAt: now(),
        updatedAt: now(),
      }))

      const newRequests: HttpRequestRecord[] = [
        ...result.folders.flatMap((group, index) =>
          group.requests.map((item) =>
            blankImportedRequest(item, newFolders[index]!.id)
          )
        ),
        ...result.requests.map((item) =>
          blankImportedRequest(item, targetFolderId)
        ),
      ]

      if (newFolders.length > 0) commitFolders([...folders, ...newFolders])
      if (newRequests.length > 0) commit([...requests, ...newRequests])
    },

    renameFolder(id, name) {
      commitFolders(
        get().folders.map((folder) =>
          folder.id === id ? { ...folder, name, updatedAt: now() } : folder
        )
      )
    },

    removeFolder(id) {
      const { folders, requests, openIds } = get()
      const removedFolderIds = descendantFolderIds(id, folders)
      const removedRequestIds = new Set(
        requests
          .filter((request) => removedFolderIds.has(request.folderId ?? ""))
          .map((request) => request.id)
      )
      commitFolders(
        folders.filter((folder) => !removedFolderIds.has(folder.id))
      )
      commit(requests.filter((request) => !removedRequestIds.has(request.id)))
      // Same cleanup `remove()` does for one request, for everything this
      // folder took with it.
      for (const openId of openIds) {
        if (removedFolderIds.has(openId) || removedRequestIds.has(openId)) {
          get().close(openId)
        }
      }
    },

    moveFolder(id, parentId) {
      // A folder can't become its own descendant — `isDescendant` already
      // covers `parentId === id` too, since a folder is its own descendant
      // of depth zero.
      if (parentId && isDescendant(parentId, id, get().folders)) return
      commitFolders(
        get().folders.map((folder) =>
          folder.id === id ? { ...folder, parentId, updatedAt: now() } : folder
        )
      )
    },

    moveRequestToFolder(requestId, folderId) {
      commit(
        get().requests.map((request) =>
          request.id === requestId ? { ...request, folderId } : request
        )
      )
    },

    setFolderHeaders(id, headers) {
      commitFolders(
        get().folders.map((folder) =>
          folder.id === id ? { ...folder, headers } : folder
        ),
        false
      )
    },

    setFolderParams(id, params) {
      commitFolders(
        get().folders.map((folder) =>
          folder.id === id ? { ...folder, params } : folder
        ),
        false
      )
    },
  }
})

/**
 * The headers plus a `Cookie` for whatever the jar has for this URL.
 *
 * A `Cookie` header typed by hand wins outright: it is the more specific
 * instruction, and silently appending to it would make a header the user can
 * read say something other than what is sent.
 */
function withCookies(
  headers: { name: string; value: string }[],
  jar: HttpCookie[],
  url: string
): { name: string; value: string }[] {
  const typed = headers.some((header) => header.name.toLowerCase() === "cookie")
  if (typed) return headers

  const value = cookieHeader(cookiesFor(jar, url))
  return value ? [...headers, { name: "Cookie", value }] : headers
}

/** What the request panel shows for a request that has never run. */
export function outcomeOf(
  outcomes: Record<string, RequestOutcome>,
  id: string | null
): RequestOutcome {
  return (id && outcomes[id]) || IDLE
}
