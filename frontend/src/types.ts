import type { PreparedImport } from './workspaceFile'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export type TreeNode = CollectionNode | FolderNode | RequestNode

/**
 * A collection owns its environments outright. There is no workspace-wide pool and no
 * global picker: `{{baseUrl}}` in a request means whatever the collection that request
 * lives in says it means, and nothing else.
 *
 * On the node rather than in a side table keyed by collection id, and that is not the
 * denormalisation `RequestNode` warns about below — there is no second copy for this to
 * drift from, and `renameNode`, `toggleNode` and `insertNode` cannot reach it. What it
 * buys is that `removeNode` deletes a collection's environments with the collection,
 * `WorkspaceState` gains no field, and `readWorkspace`/`readPrefs` keep their signatures.
 *
 * `mapTree` copies a node as `{ ...node, expanded }`, so `environments` survives a folder
 * expand **by reference** — which is what `subscribeEnvironment` compares, and why a
 * `mapTree` callback must never rebuild a collection node from its parts.
 *
 * `activeEnvironmentId` is here and not in `ui.json`. It decides which host a send
 * reaches and which token signs it, so it is workspace data the way `auth.type` is, not
 * view state the way `expanded` is — and keeping it beside the list it indexes is what
 * lets `readTree` validate the reference where it reads both. `null` is "no environment",
 * a state the picker offers on purpose: every `{{name}}` is then left standing, which is
 * how you find out whether a request depends on one.
 */
export interface CollectionNode {
  id: string
  type: 'collection'
  name: string
  expanded: boolean
  children: TreeNode[]
  environments: Environment[]
  activeEnvironmentId: string | null
}
export interface FolderNode {
  id: string
  type: 'folder'
  name: string
  expanded: boolean
  children: TreeNode[]
}
/**
 * `method` used to be duplicated here from the backing document, and nothing kept
 * the two in sync — changing the method in the editor left the tree showing the old
 * one. The tree now reads it from `documents[requestId]` instead. `name` is still
 * denormalised because `renameNode` writes both sides and nothing else can change
 * it; if the editor ever grows a rename field, it has to follow `method` out.
 */
export interface RequestNode {
  id: string
  type: 'request'
  requestId: string
  name: string
}
export interface KeyValueRow {
  id: string
  enabled: boolean
  key: string
  value: string
  description: string
}
/**
 * One environment variable: the key/value row plus a lock.
 *
 * Not `KeyValueRow`, and not an interface extending it, for the reason `FormRow` is
 * neither: this row is persisted by its own reader and it spends a column the key/value
 * grid does not have. The decisive part is `KeyValueGrid`'s signature — its `onChange`
 * hands back `KeyValueRow[]`, and narrowing that to this type would take an `as`. The
 * grid cannot be shared whichever way the type is declared, so the declaration may as
 * well be the one that keeps a column added to `KeyValueRow` from silently landing in
 * the workspace file's environment section.
 *
 * There is no `description`. A variable's key *is* its documentation, and the column it
 * would take is spent on `secret` instead — the same trade `FormRow` makes for
 * `contentType`.
 *
 * `secret` decides where the value lives, not how it is drawn: a locked value goes to the
 * OS credential store and is absent from `workspace.json` by construction, exactly as
 * `auth.token` and `auth.password` are. Empty means the credential store had nothing for
 * it — or could not be reached at all.
 */
export interface EnvironmentVariable {
  id: string
  enabled: boolean
  key: string
  value: string
  secret: boolean
}
/**
 * A named set of variables belonging to one collection, with one active at a time.
 *
 * An array rather than a `Record` for the reason `tree` is one: the order is what the
 * picker lists, and it is the user's. Two collections may both hold a "Production" and
 * they are unrelated — which is the point.
 */
export interface Environment {
  id: string
  name: string
  variables: EnvironmentVariable[]
}
/**
 * What a request body *is*. Six members, and the split between them decides which of
 * the four payload fields on `body` is read — see `RequestDocument.body`.
 *
 * Mirrored by the `switch` in `resolveBody` (`internal/httpexec/body.go`) and by
 * `BODY_TYPES` in `workspaceFile.ts`; the three lists disagreeing is the bug to watch
 * for, the same way `TEXT_FORMATS` and `byteBacked` have to agree.
 */
export type BodyType = 'none' | 'json' | 'text' | 'form' | 'urlencoded' | 'binary'
/**
 * One part of a `multipart/form-data` body.
 *
 * A file part carries a **path**, never bytes. That is not a shortcut: a webview cannot
 * read a filesystem path out of an `<input type="file">`, and shipping the contents
 * across the binding in base64 was rejected for response bodies for reasons that apply
 * just as well going the other way. So the document holds a path, `HTTPService.PickFiles`
 * is what produces one, and the Go process is the only thing that ever opens the file.
 *
 * `kind` is derived from `PART_KINDS` rather than written out beside it, for the reason
 * `TextFormat` is derived from `TEXT_FORMATS`: the grid's picker and the file reader in
 * `workspaceFile.ts` both walk the list, and a member added to a hand-written union but
 * not to the list would be silently unreachable in one and unreadable in the other.
 *
 * There is no `description` — unlike `KeyValueRow`, whose grid has a column for one.
 * The form grid spends that column on `contentType` instead, which is what an API that
 * validates the type of an upload actually needs. Empty means "derive it": from the
 * file's extension for a file part, and omitted entirely for a text one.
 */
export const PART_KINDS = ['text', 'file'] as const
export type PartKind = (typeof PART_KINDS)[number]

export interface FormRow {
  id: string
  enabled: boolean
  kind: PartKind
  key: string
  /** The value, for a `text` part. Unused by a `file` one. */
  value: string
  /** An absolute path, for a `file` part. Unused by a `text` one. */
  path: string
  contentType: string
}
export interface RequestDocument {
  id: string
  kind: 'http'
  name: string
  method: HttpMethod
  url: string
  params: KeyValueRow[]
  headers: KeyValueRow[]
  /**
   * Exactly one of `content`, `form`, `urlencoded` and `file` is read, and `type`
   * decides which: `content` for json and text, `form` for form, and so on. The other
   * three are kept rather than cleared, so switching body type and switching back
   * returns what was there — which is what `content` has always done between json and
   * text.
   *
   * `urlencoded` uses `KeyValueRow` rather than `FormRow` on purpose. It is the params
   * grid pointed at the body: it cannot carry a file, so it needs neither `kind` nor
   * `contentType`, and sharing one array with `form` would only raise the question of
   * what a file row means in a body that has no way to send one.
   */
  body: {
    type: BodyType
    content: string
    form: FormRow[]
    urlencoded: KeyValueRow[]
    /** The `binary` body: one file sent as the whole payload, with an optional type override. */
    file: { path: string; contentType: string }
  }
  /**
   * `token` and `password` are the only fields that never reach the workspace file:
   * they are written to the OS credential store and merged back in on load, so a
   * workspace can be copied, diffed or attached to a bug report without leaking a
   * credential for someone else's API.
   */
  auth: { type: 'none' | 'bearer' | 'basic'; token: string; username: string; password: string }
}
/**
 * How the response body should be labelled and rendered. Decided in Go from the
 * Content-Type — and overridden to `binary` when a payload that claims to be text
 * turns out not to be valid UTF-8 — so the viewer never has to re-sniff it.
 *
 * The split matters more than the individual members. `TEXT_FORMATS` arrive as a
 * string in `body` and are read by an editor; `BYTE_FORMATS` arrive as nothing at all
 * and carry a `bodyUrl` the webview fetches instead, which is the only way an `<img>`
 * or a `<video>` can render a response. `binary` is the catch-all of the second group
 * and now means "show the bytes in the hex viewer" rather than "show nothing".
 *
 * `svg` sits in the textual group on purpose even though it renders as a picture: it
 * is XML, its source is worth reading, and keeping a scriptable document off the byte
 * route is what stops it being served from the app's own origin. Mirrors the constants
 * in `internal/httpexec/classify.go`.
 */
export const TEXT_FORMATS = ['json', 'ndjson', 'xml', 'html', 'svg', 'csv', 'markdown', 'yaml', 'javascript', 'css', 'sse', 'text'] as const
export const BYTE_FORMATS = ['image', 'audio', 'video', 'pdf', 'font', 'archive', 'binary'] as const

export type TextFormat = (typeof TEXT_FORMATS)[number]
export type ByteFormat = (typeof BYTE_FORMATS)[number]
export type ResponseFormat = TextFormat | ByteFormat

const BYTE_FORMAT_SET: ReadonlySet<string> = new Set(BYTE_FORMATS)

/** Narrows to the group that has no `body` and must be rendered from `bodyUrl`. */
export const isByteFormat = (format: ResponseFormat): format is ByteFormat => BYTE_FORMAT_SET.has(format)

/**
 * How the viewer is showing a response body, remembered per request.
 *
 * `language` overrides what Go decided, because a `Content-Type` is a claim and not
 * a fact — a JSON endpoint answering with an HTML error page, or a body labelled
 * `text/plain` that the automatic reading guessed wrong, both have to be correctable.
 * `binary` is not offered: those bytes never cross the binding, so there is nothing to
 * interpret.
 *
 * `null` is "nothing chosen yet", not a menu entry: the picker offers four real
 * languages and falls through to the default in Settings, which itself falls through to
 * whatever the response turned out to be. Once a request has been given one it keeps it
 * — that is the point of choosing, and it is why a per-request pick outranks the
 * preference rather than the other way round.
 *
 * `mode` picks how far from the raw bytes the presentation goes. `pretty` is what the
 * request editor's "Format JSON" button does minus the writing back, `raw` is exactly
 * what the server sent, and `rich` is the format's own viewer — the collapsible tree
 * for JSON, the rendered page for HTML and Markdown, the table for CSV, the event list
 * for an SSE transcript, the picture for SVG.
 *
 * One name for all of those rather than five, because they are one choice: how much
 * interpretation do you want. Naming them separately would put five members in a
 * persisted enum to express a single axis, and would make "the same view as last time"
 * meaningless across a request whose Content-Type changed.
 *
 * `null` is "nothing chosen", as it is for `language`, and it resolves to whatever
 * suits the format: source for JSON, the render for a page. See `resolveMode`.
 */
export type BodyLanguage = TextFormat
export type BodyMode = 'rich' | 'pretty' | 'raw'
export interface BodyView {
  mode: BodyMode | null
  language: BodyLanguage | null
}

/**
 * `sizeBytes` is a number rather than a pre-baked `'1.2 KB'` string: formatting is
 * the view's job, and a real network executor hands back a byte count. `startedAt`
 * lets the loading state render a live elapsed counter without a second source of
 * truth, and `code` keeps the raw failure code so the UI can special-case it — and,
 * since the copy is resolved from it at render, so that switching language retranslates
 * a failure that is already on screen.
 *
 * On failure, `detail` is the executor's own diagnostic verbatim — Winsock or x509 text
 * produced in Go — or empty. It is deliberately not the curated advice: a system
 * message is not copy and is not translated. See `errors.ts`.
 *
 * On success, `body` is empty for every format in `BYTE_FORMATS`: those bytes are
 * still deliberately not shipped across the binding — base64 would inflate them by a
 * third, hold them twice and give up Range requests — and are fetched from `bodyUrl`
 * instead. `truncated` says the body was capped, in which case `sizeBytes` is the full
 * size reported by the server rather than the length of what is on screen.
 *
 * `encoding` names the charset the payload was transcoded *from*, empty when it
 * already was UTF-8. `contentEncoding` is the compression found on the response: with
 * a readable body it was undone in Go, with a binary one the algorithm is unsupported.
 */
/**
 * The response viewer's search bar.
 *
 * `caseSensitive` and `regexp` are the two toggles the bar offers, and they are here
 * rather than local to it so that closing the bar does not silently reset them — a
 * regex you spent a minute writing should still be there on the next Ctrl+F.
 */
export interface ResponseSearch {
  open: boolean
  query: string
  caseSensitive: boolean
  regexp: boolean
}

/**
 * One segment of the timing waterfall: where it starts and how long it lasts, both in
 * milliseconds from the moment the send began.
 *
 * `ms === 0` means the phase did not happen — a reused connection has no DNS, no TCP
 * and no TLS — which `Timings.reused` is what explains.
 */
export interface Phase {
  at: number
  ms: number
}

/**
 * Where the time went. The five phases partition the total rather than overlapping,
 * which is why `ttfb` is the gap between the connection being ready and the first byte
 * arriving — the server's own thinking — and not the conventional "everything up to
 * the first byte".
 */
export interface Timings {
  dns: Phase
  connect: Phase
  tls: Phase
  ttfb: Phase
  download: Phase
  totalMs: number
  /** The connection came from the pool, so nothing was resolved, dialled or negotiated. */
  reused: boolean
}

/** The connection the final response arrived on. Null for `http://`. */
export interface TlsInfo {
  version: string
  cipherSuite: string
  alpn: string
  resumed: boolean
  serverName: string
  subject: string
  issuer: string
  /** RFC 3339, or empty when the peer sent no certificate. */
  notBefore: string
  notAfter: string
  dnsNames: string[]
}

/** One redirect that was followed. The chain is otherwise invisible. */
export interface RedirectHop {
  status: number
  /** The URL that answered with this redirect. */
  url: string
  /** Verbatim from the Location header, so a relative one stays relative. */
  location: string
  /** A 302 turns a POST into a GET, and seeing that is most of the value of a chain. */
  method: string
  ms: number
}

export interface ArchiveEntry {
  name: string
  size: number
  compressedSize: number
  /** RFC 3339, or empty when the entry carried no usable timestamp. */
  modified: string
  directory: boolean
}

export type ResponseSnapshot =
  | { state: 'idle' }
  | { state: 'loading'; startedAt: number }
  | {
      state: 'error'
      code: string
      detail: string
      /**
       * The redirects followed before this went wrong. The chain is a property of the
       * exchange rather than of whatever answered last, which is why Go carries it on
       * `Result` and not on `Response` — on the latter it was unreachable from here, and
       * a redirect loop reported "stopped after 10 redirects" without saying which ten.
       */
      redirects: RedirectHop[]
    }
  | {
      state: 'success'
      /**
       * When this response landed, in epoch milliseconds. Stamped by `requestRunner`
       * rather than by the executor, which is transport and has no business deciding it.
       *
       * It exists for cookie expiry: RFC 6265 defines `Max-Age` as a duration from the
       * moment the cookie was *received*, so the absolute instant can only be computed
       * from here. Reading the clock while rendering instead would be both wrong — the
       * answer would drift every time the panel repainted — and impure, which the React
       * Compiler rejects outright.
       */
      receivedAt: number
      status: number
      statusText: string
      time: number
      sizeBytes: number
      body: string
      bodyUrl: string
      headers: KeyValueRow[]
      contentType: string
      encoding: string
      contentEncoding: string
      finalUrl: string
      /**
       * What to call this body if it is saved, decided in Go: the server's
       * `Content-Disposition` where there is one, else the URL's last segment, else
       * a generic name with the format's extension.
       */
      filename: string
      /** Populated for a zip response only; empty for everything else. */
      archive: ArchiveEntry[]
      timings: Timings
      /** Null for `http://`, and for a response that never reached a handshake. */
      tls: TlsInfo | null
      /** The redirects followed, oldest first, and empty when there were none. */
      redirects: RedirectHop[]
      format: ResponseFormat
      truncated: boolean
    }

/**
 * The one variant every body viewer takes. Named rather than re-`Extract`ed at each
 * call site, because a dozen components needing the same narrowing is exactly what a
 * type alias is for.
 */
export type SuccessResponse = Extract<ResponseSnapshot, { state: 'success' }>

export interface RequestExecutor {
  /**
   * `receivedAt` is not the executor's to supply — it is a fact about the app's clock,
   * not about the wire — so `requestRunner` stamps it on the way into the store.
   */
  execute(request: RequestDocument, signal: AbortSignal): Promise<Omit<SuccessResponse, 'receivedAt'>>
  /**
   * Lets the executor drop whatever it retained for a response the UI has discarded.
   * Optional because it is a property of *how* an executor ships a payload: only one
   * that keeps bytes out of the response object has anything to release.
   */
  release?(id: string): Promise<void>
  /**
   * Writes a body to a file the user picks, and reports which of the three things
   * happened. `cancelled` is separate from `ok` on purpose: dismissing the dialog is
   * not a failure and must never be shown as one.
   *
   * Optional for the same reason as `release`: only an executor that can reach a
   * native dialog and holds the bytes can do this at all.
   */
  save?(request: SaveBodyRequest): Promise<{ ok: boolean; cancelled: boolean }>
}

/**
 * `text` is the body as the viewer has it, and is used only when the executor has no
 * bytes of its own for this request — which is every textual response, since those
 * cross the binding as a string and are deliberately not retained on the Go side.
 */
export interface SaveBodyRequest {
  id: string
  text: string
  filename: string
  /** The dialog's title. Translated here, because the catalogue is not in Go. */
  title: string
}

/**
 * Which section of each half of the workspace is on screen. Both are **per request**,
 * held as `requestPanels` / `responsePanels` in the store: which section you are editing
 * is a property of the request you are looking at, not of the window. They live here
 * rather than beside the store because `workspaceFile.ts` persists them too, and the
 * union was previously written out three times.
 */
export type RequestPanel = 'params' | 'headers' | 'body' | 'auth'
export type ResponsePanel = 'body' | 'headers' | 'cookies' | 'timeline'

export type SplitOrientation = 'rows' | 'columns'

/**
 * `system` is a preference, not a theme: it is stored, but it never reaches CSS —
 * `theme.ts` resolves it against `prefers-color-scheme` first. Default, because an
 * app that ignores the OS setting is making a decision it was not asked to make.
 */
export type ThemePreference = 'system' | 'light' | 'dark'

/**
 * The locales with a catalogue. There is no `system` member on purpose: unlike a theme,
 * which the OS publishes and can change under a running window, the interface language
 * is a deliberate choice, and the app opens in English until one is made.
 *
 * `i18n/index.ts` types its catalogue map as `Record<Locale, Catalog>`, so adding a
 * member here is a compile error until the catalogue for it exists.
 */
export type Locale = 'en' | 'es'

export type MethodToken = Lowercase<HttpMethod>
export const methodToken = (method: HttpMethod): MethodToken => method.toLowerCase() as MethodToken

/**
 * Where the update flow currently is. A discriminated union for the same reason
 * `ResponseSnapshot` is one: the modal branches on it exhaustively, so a state added
 * without a branch fails to compile rather than rendering nothing.
 *
 * `idle`, `checking` and `downloading` are silent — the modal only shows for the three
 * states that need an answer. That is what "tell me before restarting" means here: the
 * download happens without interrupting, and the question comes when it is ready.
 */
/**
 * Whether the update dialog is on screen. Exported because two places need the answer
 * and they must not drift apart: the modal decides whether to render, and the global
 * shortcut handler decides whether the keyboard belongs to the dialog. Asking `update`
 * alone would leave the shortcuts dead for the rest of the session once an update was
 * found and postponed.
 */
export const isUpdateModalOpen = (update: UpdateState, dismissed: boolean): boolean =>
  update.state !== 'idle' && update.state !== 'checking' && !dismissed

export type UpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  /** Found, and nothing downloaded yet. The click is what starts the transfer. */
  | { state: 'available'; version: string; notes: string }
  /** `total` is 0 when the size is unknown, which the bar shows as indeterminate. */
  | { state: 'downloading'; version: string; received: number; total: number }
  /**
   * Verifying the signature and unpacking. Deliberately indeterminate: the updater
   * emits no progress for these, so a bar left at 100% would look hung. Also covers
   * the install itself, right up to the process exiting.
   */
  | { state: 'preparing'; version: string }
  /** A new version exists but this install cannot replace itself — Linux, always. */
  | { state: 'manual'; version: string; notes: string }
  /** Downloading or installing failed after an update was known to exist. */
  | { state: 'error'; version: string; code: string; detail: string }

/**
 * What a confirmation dialog is currently asking about. Data, never a callback: a
 * function in the store would be state nothing could compare, serialise or reason
 * about, and the mapping from intent to action belongs beside the actions it calls
 * (`runConfirm` in `store.ts`) rather than in the dialog that draws the question.
 *
 * A discriminated union on `kind` for the reason `UpdateState` is one: the dialog
 * branches on it exhaustively, so an intent added without copy fails to compile.
 */
/**
 * Why an import was refused, as a token rather than a sentence: the copy is resolved at
 * render so it follows a change of language, the rule `errors.ts` already follows for
 * failure codes.
 */
export type ImportRejection = 'malformed' | 'newer-app' | 'newer-workspace' | 'unreadable'

export type ConfirmIntent =
  | { kind: 'deleteNode'; nodeId: string }
  | { kind: 'deleteEnvironment'; collectionId: string; environmentId: string }
  | { kind: 'resetSettings' }
  /**
   * A workspace that has already been read, validated and had its credentials resolved,
   * waiting for the one confirmation that commits it. Still data by the rule above — a
   * validated payload is a value, not a callback — and carrying it here rather than
   * parking it in a module is what stops a dismissed dialog from leaving an import armed.
   */
  | { kind: 'importWorkspace'; prepared: PreparedImport }

/**
 * Labels for the filled chips — the sidebar tree, the tab strip and the command palette.
 * The method picker does not use these: it is choosing a method and names it in full.
 *
 * Only OPTIONS is shortened. At seven characters it is the one method wide enough to be
 * worth it, and "OPTS" is not another word. DELETE used to be "DEL" in the tab strip,
 * which made a tab and its own tree row disagree about what the request was; it spells
 * itself out now and drops to 10px where the column is tight (see
 * `.method-chip-chip.method-delete`).
 */
export const methodLabel: Record<HttpMethod, string> = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
  HEAD: 'HEAD',
  OPTIONS: 'OPTS',
}
