import { useEffect, useState } from 'react'
import { Call } from '@wailsio/runtime'
import { environmentFor } from './environments'
import { fromResult, type Wire } from './snippets/types'
import { useAppStore } from './store'
import type { RequestDocument } from './types'
import { wireFor } from './wire'

/**
 * The resolved request, straight from Go.
 *
 * Not a second resolver in TypeScript, and that is why this hook exists at all. Everything
 * the wire format depends on — the percent-encoding of the query, the header precedence,
 * the `User-Agent` and `Content-Type` defaults, the `Authorization` the Auth panel builds
 * — is decided in `internal/httpexec`, and a copy of those rules over here would drift the
 * first time one of them changed. So the code view asks rather than guessing.
 *
 * `WireState` is a small union rather than a value plus two flags, for the same reason
 * `ResponseSnapshot` is one: the modal branches on it exhaustively.
 */
export type WireState = { state: 'loading' } | { state: 'ready'; wire: Wire } | { state: 'failed'; code: string; detail: string } | { state: 'unavailable' }

/**
 * How long the code view waits after the last keystroke before asking Go again.
 *
 * Shorter than the workspace autosave's 600 ms on purpose: this is a live view of what is
 * on screen, not a write, so it has to read as immediate. Long enough that a burst of
 * typing is one call rather than one per character.
 */
const WIRE_DEBOUNCE_MS = 120

export function useWire(request: RequestDocument | undefined): WireState {
  const [result, setResult] = useState<WireState>({ state: 'loading' })
  // `{{variables}}` are resolved inside `wireFor`, and the environment is not part of
  // `request` — so without this in the dependency list the code view would keep showing
  // the previous environment's snippet until the next keystroke. Keyed by *this* request
  // rather than by the active one, the same rule `resolveFor` follows: the snippet has to
  // describe the request on screen, not whatever the rail happens to be showing.
  const environment = useAppStore(s => environmentFor(s, request?.id))

  // Re-resolved on every edit to the request, so the snippet follows the URL bar as it is
  // typed. `request` is a fresh object per store update, so identity is the right trigger.
  //
  // Debounced, because that trigger fires per character and each one is a round trip into
  // Go preceded by a full `toRequestDTO` and a rebuilt resolver. Typing a URL fast used to
  // put one call in flight per keystroke, all of them resolving in whatever order Go
  // finished them, with only the `live` flag below sorting out which answer counted. Now
  // the cleanup cancels the timer as well as disowning the answer, so a burst costs one
  // call. `WIRE_DEBOUNCE_MS` is short enough that the snippet still reads as following the
  // typing rather than lagging behind it.
  useEffect(() => {
    if (!request) return
    let live = true
    const timer = window.setTimeout(() => {
      wireFor(request).then(
        answer => {
          if (!live) return
          setResult(answer.ok ? { state: 'ready', wire: fromResult(answer) } : { state: 'failed', code: answer.errorCode, detail: answer.errorText })
        },
        (error: unknown) => {
          if (!live) return
          // A RuntimeError means the service itself failed and is worth showing verbatim.
          // Anything else means the call never reached a backend at all, which is what
          // `pnpm run dev` in a plain browser looks like: there is no Wails runtime behind
          // the page, and no request would send either.
          if (error instanceof Call.RuntimeError) setResult({ state: 'failed', code: 'UNKNOWN', detail: error.message })
          else setResult({ state: 'unavailable' })
        },
      )
    }, WIRE_DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [request, environment])

  return request ? result : { state: 'loading' }
}
