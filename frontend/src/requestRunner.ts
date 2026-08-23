import { RequestFailure } from './errors'
import { goExecutor } from './goExecutor'
import { useAppStore } from './store'
import type { RequestExecutor, SaveBodyRequest } from './types'

/**
 * Owns request execution and the in-flight AbortController registry.
 *
 * This exists so that the four surfaces that can start or stop a request — the Send
 * button, Ctrl+Enter, the command palette and the response placeholders — all go
 * through one code path and cannot diverge.
 *
 * The executor is a variable rather than a direct import so that a second
 * implementation can be swapped in without touching any call site. Today there is
 * one: `goExecutor`, which runs the request in the Go process.
 *
 * Module-level state is reset by HMR, which orphans controllers during a hot reload
 * in dev. That is an accepted dev-only edge rather than something worth engineering
 * around.
 */
let executor: RequestExecutor = goExecutor
const controllers = new Map<string, AbortController>()

export const setRequestExecutor = (next: RequestExecutor): void => {
  executor = next
}

export async function runRequest(id: string): Promise<void> {
  const state = useAppStore.getState()
  // Read the document at call time rather than closing over it: the previous
  // implementation captured whatever `document` existed in the render that built
  // the handler, so a request could be sent with stale headers or URL.
  const request = state.documents[id]
  if (!request || controllers.has(id)) return

  const controller = new AbortController()
  controllers.set(id, controller)
  state.setResponse(id, { state: 'loading', startedAt: Date.now() })

  try {
    const result = await executor.execute(request, controller.signal)
    // Stamped here rather than in the executor: when the app saw the response is a fact
    // about this process, not about the transport. Cookie expiry is measured from it.
    if (!controller.signal.aborted) useAppStore.getState().setResponse(id, { ...result, receivedAt: Date.now() })
  } catch (error) {
    if (controller.signal.aborted) return
    const code = error instanceof RequestFailure ? error.code : error instanceof Error ? error.message : 'UNKNOWN'
    // Only the code and the raw diagnostic are recorded. The prose is resolved from the
    // code where it is rendered, so a failure on screen follows a change of language
    // instead of being frozen in whichever one it happened in. `errors.ts` owns the
    // rule about which of the two wins.
    const detail = (error instanceof RequestFailure && error.detail) || ''
    // The chain survives the failure now. A redirect loop is the one thing you open this
    // panel to diagnose, and until this it reported the count without the URLs.
    const redirects = error instanceof RequestFailure ? [...error.redirects] : []
    useAppStore.getState().setResponse(id, { state: 'error', code, detail, redirects })
  } finally {
    controllers.delete(id)
  }
}

export function cancelRequest(id: string): void {
  const controller = controllers.get(id)
  if (!controller) return
  controller.abort()
  controllers.delete(id)
  useAppStore.getState().setResponse(id, { state: 'idle' })
}

export function toggleRequest(id: string): void {
  if (controllers.has(id)) cancelRequest(id)
  else void runRequest(id)
}

/**
 * Writes a response body to a file the user picks.
 *
 * Goes through the executor rather than the binding directly, for the reason the
 * executor exists at all: this module is the one place that knows how requests are
 * carried out, and a second import of `goExecutor` elsewhere would be a second
 * answer to that question. An executor with no `save` — a future in-browser one —
 * reports a cancel, which is the outcome that shows nothing rather than an error.
 */
export async function saveResponseBody(request: SaveBodyRequest): Promise<{ ok: boolean; cancelled: boolean }> {
  if (!executor.save) return { ok: false, cancelled: true }
  return executor.save(request)
}

/**
 * Tells Go it can stop holding the bytes of a response the UI has thrown away.
 *
 * A subscriber rather than a call at each discard site, for the reason the autosave
 * subscriber exists: there are four ways to clear a response and two to delete a
 * request, and one of them will be added later without this being remembered.
 *
 * Deliberately *not* triggered by closing a tab. The store's own comment is explicit
 * that a closed tab keeps its response — finding it still there when you reopen the
 * tab is a feature — and releasing the bytes would leave that reopened tab showing a
 * broken image beside an intact status line. Only a response that has genuinely been
 * discarded is released here; the store's 64 MiB ceiling handles everything else.
 *
 * Installed from `main.tsx` rather than on import, so the module stays side-effect
 * free and the subscription's lifetime is visible where the rest of the boot is.
 */
/**
 * Aborts any in-flight request whose document has gone.
 *
 * The sibling of `installBodyRelease` below, and the same construction: a subscriber that
 * watches one slice and reacts, rather than a call every writer has to remember.
 *
 * Without it a send that lands after its request was deleted — or after a whole workspace
 * was replaced by an import — resolves into `setResponse` for an id nothing owns, which
 * repopulates `responses` and, for a byte-backed body, re-pins the bytes in Go one tick
 * after `installBodyRelease` released them. On an import of a workspace that came from
 * *this* machine the ids collide exactly, so the stale response reattaches to a different
 * request. `runRequest` also refuses to start while `controllers.has(id)`, so the new
 * request with that id could not be sent until the old one finished.
 *
 * Nothing is written to `responses` here, unlike `cancelRequest`: both of `runRequest`'s
 * paths already return early on `signal.aborted`, and the document this would report to
 * no longer exists.
 *
 * Scoped to ids that *left* `documents`, and deliberately not to ids whose document
 * merely changed: that map gets a new identity on every keystroke in the URL bar, so
 * anything broader would abort the request being typed. The gap it leaves is narrow — an
 * import of a workspace exported from this machine, landing while a send with a surviving
 * id is still in flight, shows that response against the imported request of the same id.
 */
export function installOrphanAbort(): void {
  useAppStore.subscribe((state, prev) => {
    if (state.documents === prev.documents) return
    for (const [id, controller] of [...controllers]) {
      if (state.documents[id]) continue
      controller.abort()
      controllers.delete(id)
    }
  })
}

export function installBodyRelease(): void {
  useAppStore.subscribe((state, prev) => {
    if (state.responses === prev.responses) return
    for (const [id, before] of Object.entries(prev.responses)) {
      // Only byte-backed responses ever held anything; releasing an id Go has nothing
      // for is harmless, but checking keeps the IPC quiet on ordinary JSON traffic.
      if (before.state !== 'success' || !before.bodyUrl) continue
      const after = state.responses[id]
      if (after === before) continue
      // A fresh success for the same request replaces the bytes in Go on its own —
      // `put` evicts the previous entry — so only a discard needs saying.
      if (after?.state === 'success') continue
      void executor.release?.(id)
    }
  })
}
