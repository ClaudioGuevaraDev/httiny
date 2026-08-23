import { Call, CancelError } from '@wailsio/runtime'
import { HTTPService } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/httpexec'
import type { KeyValue, TLSInfo } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/httpexec'
import { RequestFailure } from './errors'
import { resolveFor } from './environments'
import { toRequestDTO } from './requestDTO'
import { BYTE_FORMATS, TEXT_FORMATS } from './types'
import type { KeyValueRow, RequestExecutor, ResponseFormat, TlsInfo } from './types'

/**
 * Response headers are display-only, but they still need React keys. The name
 * alone is not unique — `Set-Cookie` legitimately repeats — so the index goes into
 * the id.
 */
const toRows = (pairs: readonly KeyValue[]): KeyValueRow[] =>
  pairs.map((pair, index) => ({ id: `${index}:${pair.key}`, enabled: true, key: pair.key, value: pair.value, description: '' }))

/**
 * A Go pointer crosses the binding as `T | null`, which is already the shape the panel
 * wants — no TLS state means the request went out over plain http. The nested slice
 * needs the same `?? []` every Go slice does, though, which is the whole reason this is
 * a function rather than a `??` at the call site.
 */
const toTls = (tls: TLSInfo | null): TlsInfo | null => (tls ? { ...tls, dnsNames: tls.dnsNames ?? [] } : null)

/**
 * Go's `format` is a bare string on the wire, so it is re-narrowed here rather than
 * asserted. The fallback is `'text'` and that is the safe direction: a format this
 * build does not know about is at worst shown as plain text, whereas trusting the
 * string would put an unhandled value into an exhaustive switch.
 *
 * Built from the two exported tuples so a format added to `types.ts` cannot be
 * forgotten here — which used to be a real hazard while the list was hand-written.
 */
const FORMATS: ReadonlySet<string> = new Set<string>([...TEXT_FORMATS, ...BYTE_FORMATS])
const toFormat = (value: string): ResponseFormat => (FORMATS.has(value) ? (value as ResponseFormat) : 'text')

/**
 * Executes requests in the Go process over the Wails binding.
 *
 * Everything the network cares about is resolved on the Go side — the
 * `Authorization` header, the default `Content-Type` for a JSON body, redirect and
 * timeout policy — so this module is only a translation between the editor's row
 * model and the binding's DTOs.
 *
 * `params` are deliberately not sent: `replaceQuery` keeps the query string inside
 * `url` as rows are edited, so shipping both would double-encode them.
 */
export const goExecutor: RequestExecutor = {
  async execute(request, signal) {
    signal.throwIfAborted()

    let result
    try {
      // `cancelOn` is the runtime's own AbortSignal bridge: it cancels the call,
      // which cancels the Go context, which aborts the socket. Aborting here is a
      // real network cancellation, not just the UI looking away.
      // The DTO is built in `requestDTO.ts`, so this and the code view cannot describe
      // different requests. `id` in it keys the bytes Go retains for a byte-backed
      // response, so `bodyUrl` can point back at them — the document id, which is what
      // `responses` and `bodyViews` are keyed by too, not the tree node id.
      result = await HTTPService.Send(toRequestDTO(request, resolveFor(request.id))).cancelOn(signal)
    } catch (error) {
      // `runRequest` discards results for an aborted controller, so a cancellation
      // just needs to stop unwinding here.
      if (error instanceof CancelError) throw error
      // Send returns no Go error, so a RuntimeError means the service itself
      // failed — worth surfacing verbatim. Anything else means the call never
      // reached a backend at all, which is what `pnpm run dev` in a plain browser
      // looks like: there is no Wails runtime behind the page.
      if (error instanceof Call.RuntimeError) throw new RequestFailure('UNKNOWN', error.message)
      console.error('Wails binding call failed', error)
      throw new RequestFailure('BACKEND_UNAVAILABLE')
    }

    // The chain hangs off the result rather than off `response`, which a failure does not
    // carry — that is what used to lose it. Go slices arrive as `T[] | null`.
    if (!result.ok) throw new RequestFailure(result.errorCode, result.errorText, result.redirects ?? [])

    const response = result.response
    return {
      state: 'success',
      status: response.status,
      statusText: response.statusText,
      time: response.timeMs,
      sizeBytes: response.sizeBytes,
      body: response.body,
      bodyUrl: response.bodyUrl,
      // Go slices cross the binding as `T[] | null`, so an empty header map
      // arrives as null rather than [].
      headers: toRows(response.headers ?? []),
      contentType: response.contentType,
      encoding: response.encoding,
      contentEncoding: response.contentEncoding,
      finalUrl: response.finalUrl,
      filename: response.filename,
      // Null for every format but zip, and for a zip whose directory would not read.
      archive: response.archive ?? [],
      timings: response.timings,
      tls: toTls(response.tls),
      redirects: result.redirects ?? [],
      format: toFormat(response.format),
      truncated: response.truncated,
    }
  },

  /**
   * Best effort by design. The bytes are held under a ceiling that evicts on its own,
   * so a failed release costs a little memory until the next large response pushes it
   * out — never correctness. Which is why this swallows rather than propagating into a
   * store subscriber, where there is nothing sensible to do with a rejection.
   */
  async release(id) {
    try {
      await HTTPService.Release(id)
    } catch (error) {
      console.warn('Could not release the retained response body', error)
    }
  },

  /**
   * Go opens the dialog and writes the file. It is already holding the bytes of a
   * byte-backed response — they never crossed the binding — so doing it here instead
   * would mean sending a filesystem path back the other way for Go to write to.
   *
   * `cancelled` arrives as its own field rather than as an error code, so a dismissed
   * dialog cannot be rendered as a failure. A rejection, by contrast, means the call
   * never completed and is a real failure.
   */
  async save(request) {
    const result = await HTTPService.SaveBody(request)
    if (!result.ok && !result.cancelled) console.error('Save failed:', result.errorCode, result.errorText)
    return { ok: result.ok, cancelled: result.cancelled }
  },
}
