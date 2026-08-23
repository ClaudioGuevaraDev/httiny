import type { Request } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/httpexec'
import { resolveUrl } from './template'
import type { Resolve } from './template'
import type { RequestDocument } from './types'

/**
 * The body half of the `Request` DTO, built from the editor's model.
 *
 * `goExecutor` and `wire.ts` used to be deliberate duplicates of the same translation —
 * if they disagreed, the code view would describe a request nobody makes — and the body
 * was the part of it with four payload fields and a rule about which one is read. Two
 * hand-written copies of that would drift, so there is one, and it lives here rather
 * than in either caller because neither owns it. `toRequestDTO` below is the rest of
 * the same argument: variable substitution multiplied the number of fields that could
 * disagree, so the whole literal moved here and the two callers are one call each.
 *
 * Rows are an editor model: the enable checkbox and the blank trailing row are there
 * so the grid is editable, and neither belongs on the wire. The same filter runs over
 * every grid — params, headers, urlencoded and form alike.
 */
const toBodyDTO = (body: RequestDocument['body'], resolve: Resolve): Pick<Request, 'bodyType' | 'body' | 'form' | 'urlencoded' | 'file'> => ({
  bodyType: body.type,
  body: resolve(body.content),
  form: body.form
    .filter(row => row.enabled && row.key.trim())
    .map(row => ({
      kind: row.kind,
      // Resolved like every other grid's key — `headers[].key` and `urlencoded[].key`
      // both are, and the comment below justifies excluding the path and the content
      // type without ever mentioning the name.
      name: resolve(row.key.trim()),
      // A file row's typed-in value and a text row's chosen path are both kept in the
      // document — switching a row's kind and back should not lose what was there —
      // so each is cleared on the way out rather than sent as a field Go would have to
      // learn to ignore.
      value: row.kind === 'file' ? '' : resolve(row.value),
      // A path is not a template. It is produced by `PickFiles`, validated by the OS and
      // `Stat`ed by `useAttachments` to draw the chip — so a templated one would make the
      // grid report every attachment as missing, and a wrong substitution would surface as
      // `FILE_UNREADABLE` with nothing on screen matching what failed. Same for the
      // content type, which is a fixed token with no environment that changes it.
      path: row.kind === 'file' ? row.path : '',
      contentType: row.contentType.trim(),
    })),
  urlencoded: body.urlencoded
    .filter(row => row.enabled && row.key.trim())
    .map(row => ({ key: resolve(row.key.trim()), value: resolve(row.value) })),
  file: { path: body.file.path, contentType: body.file.contentType.trim() },
})

/**
 * The whole `Request` DTO, for both `Send` and `Wire`.
 *
 * Every free-text field the user can type into goes through `resolve`, which is what
 * turns `{{baseUrl}}/users` into a request. Three groups deliberately do not: paths and
 * content types (see above), the unions `method`, `bodyType` and `auth.type`, which a
 * `Select` narrows and Go mirrors, and `id`, which keys the retained response bytes and
 * seeds the multipart boundary.
 *
 * `auth` **has** to be resolved here rather than left for Go: `applyAuth` base64s the
 * basic credentials, so a placeholder that reached it would come back as unrecoverable
 * base64 — the one field where leaving an unknown name standing would stop being
 * diagnosable.
 *
 * `resolve` is a parameter and not read from the store, so this module stays pure. The
 * result is a read-only projection: nothing resolved is ever written back into
 * `documents`, which is what lets the code view re-ask Go on every keystroke without
 * the document mutating under the user, and makes switching environments instant
 * rather than a rewrite of every request.
 *
 * `params` is deliberately absent: `replaceQuery` keeps the query string inside `url` as
 * rows are edited, so shipping both would double-encode them — which is also why
 * `resolveUrl` has to walk that query structurally rather than run a plain `replace`.
 */
export const toRequestDTO = (request: RequestDocument, resolve: Resolve): Request => ({
  id: request.id,
  method: request.method,
  url: resolveUrl(request.url, resolve),
  headers: request.headers
    .filter(row => row.enabled && row.key.trim())
    .map(row => ({ key: resolve(row.key.trim()), value: resolve(row.value) })),
  ...toBodyDTO(request.body, resolve),
  auth: {
    type: request.auth.type,
    token: resolve(request.auth.token),
    username: resolve(request.auth.username),
    password: resolve(request.auth.password),
  },
  timeoutMs: 0,
})
