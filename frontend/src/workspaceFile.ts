import { BODY_LANGUAGES } from './responseBody'
import { CODE_FONT_SIZE, SIDEBAR_WIDTH, SPLIT_RATIO, ZOOM, methodOptions } from './store'
import { PART_KINDS } from './types'
import type {
  BodyLanguage,
  BodyType,
  Environment,
  EnvironmentVariable,
  FormRow,
  HttpMethod,
  KeyValueRow,
  Locale,
  RequestDocument,
  SplitOrientation,
  ThemePreference,
  TreeNode,
} from './types'

/**
 * The on-disk schema.
 *
 * Go stores this number verbatim and never interprets it. Bump it whenever a change
 * to the payload cannot be absorbed by the defaults in the validators below — a
 * renamed field, a changed union member, a restructured node. Purely additive
 * changes do not need a bump, because every reader here already supplies a default.
 *
 * With no test framework in this project, nothing catches a forgotten bump. The
 * validators are therefore written to degrade rather than throw.
 *
 * **2 is burnt, and the payload at 3 is otherwise identical to 1's.** A local build
 * of the per-collection environments work (c00f4f8, reverted in d3d11f5) stamped 2
 * onto disk; the revert took the constant back to 1, and every build after it then
 * read that file as coming from the future. `hydrate` answers a newer file by
 * refusing to write at all — correctly, since half-understanding a payload and
 * saving the result truncates it — so the workspace went silently read-only and
 * nothing persisted at all.
 *
 * Hence the rule this number now follows: it is a one-way ratchet, and a value that
 * has ever been written to a disk is never re-issued, not even by a build that was
 * never released. Reverting a feature reverts the payload; it cannot revert the
 * files already stamped. Re-using the number instead would let two payload shapes
 * claim it and leave the `>` guard meaningless. Skipping one integer costs nothing:
 * a 2 file is read by the validators below, which ignore the `environments` key it
 * carries, and `toWorkspaceFile` drops the key on the first save.
 *
 * **4 carries per-collection environments.** 3 is spent too — it is 1's payload under a
 * new number, issued to escape the burnt 2 — and the bump to 4 is *not* about a field the
 * readers cannot default, which by the rule above would need no bump at all. It is about
 * the **credential store**, which this number is the only marker for. A build that reads
 * this file as 3 has readers that ignore `environments` on a collection node and a
 * `toStoredNode` that does not write it: its first autosave would delete every
 * environment in the workspace and leave their credentials named by nothing, in a store
 * that cannot be enumerated and therefore cannot ever be swept. Refusing the file is the
 * correct answer, and the `>` guard in `hydrate` is what produces it.
 */
export const WORKSPACE_VERSION = 4
export const PREFS_VERSION = 1

/**
 * Disk shapes, deliberately decoupled from the in-memory ones.
 *
 * Three fields are dropped on the way out and rebuilt on the way in:
 * - `dirty` no longer exists at all now that everything autosaves.
 * - `expanded` is view state and lives in the prefs file, as `collapsedNodeIds`.
 * - `RequestNode.name` is a denormalised copy of `documents[requestId].name`
 *   (see types.ts); on disk it is a field that can disagree with itself.
 *
 * `auth.token` and `auth.password` are also absent by construction — they go to the
 * OS credential store, never to this file. See internal/secrets.
 *
 * An attachment's **path** is written here in the clear, and its **contents** never
 * are. A path is not a credential: it is what the request is, it has to survive a
 * restart for the request to still mean anything, and it is exactly what a snippet
 * would print anyway. The bytes stay on disk where they already were, so this file —
 * and its `.bak` and quarantine copies — is still safe to copy or attach to a bug
 * report, which is the property `auth` is protecting.
 */
interface StoredAuth {
  type: RequestDocument['auth']['type']
  username: string
}
interface StoredDocument {
  id: string
  name: string
  method: HttpMethod
  url: string
  params: KeyValueRow[]
  headers: KeyValueRow[]
  body: RequestDocument['body']
  auth: StoredAuth
}
/**
 * A union rather than one shape with a blankable `value`, so a locked variable has
 * nowhere to put one: writing a credential into this file is a compile error, which is
 * the same construction `StoredAuth` uses one type up.
 *
 * No `id`. `readRows` already establishes that a row's id is regenerated from its
 * position rather than trusted, so storing one is churn in a file meant to be diffed by
 * hand — and it is why the credential-store key is built from the variable's **key** and
 * never from its id, which would move whenever a row was inserted above it.
 */
type StoredVariable = { key: string; enabled: boolean; secret: false; value: string } | { key: string; enabled: boolean; secret: true }

interface StoredEnvironment {
  id: string
  name: string
  variables: StoredVariable[]
}

/**
 * Three members, where collection and folder used to share one. They are different shapes
 * now: only a collection carries environments, and the split is what makes a folder that
 * carries them unrepresentable rather than merely unwritten.
 */
type StoredNode =
  | { id: string; type: 'collection'; name: string; children: StoredNode[]; environments: StoredEnvironment[]; activeEnvironmentId: string | null }
  | { id: string; type: 'folder'; name: string; children: StoredNode[] }
  | { id: string; type: 'request'; requestId: string }

/**
 * The credential-store key for one environment variable.
 *
 * Here rather than in `environments.ts` because it is a **storage** identifier, next to
 * the shapes that decide what is not written to the file. It also keeps `persistence.ts`
 * off the resolver module.
 *
 * Keyed by the variable's **key**, never by its row id: a stored variable carries no id
 * and `readVariables` regenerates one from the position, so an id moves the moment a row
 * is inserted above — and a keychain entry that moved would be a credential silently
 * attached to a different variable.
 *
 * The **collection** id is in it because an environment id is only unique within its
 * collection. Without it, a collection copied wholesale by hand would alias the
 * original's credentials.
 *
 * Injective without escaping: the first three segments are fixed-position and neither a
 * collection id (`collection-<stamp>`) nor an environment id (a UUID) contains a colon,
 * so everything after the third is the user's key, whatever is in it. Nothing ever parses
 * this back apart — the save path, the load path and the signature all build it from the
 * same three inputs.
 */
export const environmentSecretKey = (collectionId: string, envId: string, key: string): string => `env:${collectionId}:${envId}:${key}`

export interface WorkspaceFile {
  tree: StoredNode[]
  documents: Record<string, StoredDocument>
}

/**
 * The store fields `workspace.json` is built from — the in-memory side of the DTO above.
 *
 * Named rather than spelled inline on `toWorkspaceFile`, so `persistence.ts` can key its
 * autosave pre-filter off the same type: a field added here and forgotten there would be
 * written by `toWorkspaceFile` and never reach disk, with nothing to notice.
 */
export interface WorkspaceState {
  tree: TreeNode[]
  documents: Record<string, RequestDocument>
}

export interface PrefsFile {
  tabs: string[]
  activeId: string | null
  selectedNodeId: string | null
  activeCollectionId: string | null
  recentIds: string[]
  collapsedNodeIds: string[]
  sidebarWidth: number
  sidebarCollapsed: boolean
  splitOrientation: SplitOrientation
  splitRatio: number
  theme: ThemePreference
  language: Locale
  /** A percentage: 100 is unscaled. */
  zoom: number
  /** Pixels, for the two editors only. */
  codeFontSize: number
  /** `null` is "automatic" — the viewer reads the body, then falls back to Go's classification. */
  defaultBodyLanguage: BodyLanguage | null
  /**
   * Whether the code view opens with credentials masked. The *default* is what is stored,
   * never the switch in the modal — that one is per visit, and a file older than this
   * field may still carry its old `redactSecrets` key, which is simply not read.
   */
  defaultRedactSecrets: boolean
}

/*
 * Four things this file deliberately does **not** carry, and one rule that decides it.
 *
 * `requestPanels`, `responsePanels`, `bodyViews` and `codeTarget` are where you happened
 * to leave a panel, not anything you went and configured. They live in the store for as
 * long as the window is open — switching tabs still returns each request to the section
 * you were on — and they start over on the next launch.
 *
 * The clearest case is `responsePanels`. `responses` is never persisted at all, so on the
 * next launch there is no response to have a Timeline of; restoring the tab meant reopening
 * on a view of something that no longer existed. `bodyViews` describes the same absent
 * response. The durable half of both is in Settings and does persist:
 * `defaultBodyLanguage`, next to `defaultRedactSecrets`, which already draws exactly this
 * line — the switch in the modal lasts one visit, the preference is what gets written.
 */

/**
 * What `readPrefs` hands back: the prefs file minus the one field of it that is not
 * store state.
 *
 * `collapsedNodeIds` is consumed earlier and separately, through `readCollapsed`, because
 * the tree has to be built with it — the store keeps `expanded` on each node instead of a
 * list of ids. Omitting it here is what lets `hydrate` apply this whole object with a
 * spread, and *that* is the point: a preference added to `PrefsFile` and to `readPrefs`
 * reaches the store by existing, rather than by someone remembering to add a line.
 * Forgetting used to be silent — `setState` takes a `Partial`, so the field would save
 * correctly and load into nothing.
 */
export type PrefsState = Omit<PrefsFile, 'collapsedNodeIds'>

/**
 * An import that has been read, repaired and had its credentials resolved, ready to be
 * committed to the store in one `setState`.
 *
 * Here rather than in `types.ts` because it is exactly "what the readers below hand
 * back": `layout` is `PrefsState`, so a preference added to `PrefsFile` reaches an
 * imported workspace by existing, the same dividend the `Omit` was defined for.
 * `types.ts` imports it back with `import type`, which is erased — the only runtime edge
 * between these two files remains the one that was already there.
 *
 * `summary` is carried rather than derived at render time because `ConfirmDialog`'s
 * `useCopy` resolves copy from small values, not by walking a workspace.
 */
export interface PreparedImport {
  tree: TreeNode[]
  documents: Record<string, RequestDocument>
  layout: PrefsState
  summary: {
    collections: number
    requests: number
    /** Whether the incoming workspace has any credential at all to write. */
    secrets: boolean
    /**
     * Whether the credential store failed to read this session. While it has, the
     * destructive half of the credential save is off, so the tokens being replaced cannot
     * be swept — and an id nobody names is an id nobody can delete. The confirmation says
     * so rather than letting it happen quietly.
     */
    stranded: boolean
  }
}

// ── Writing ────────────────────────────────────────────────────────────────────

const collapsedIn = (nodes: TreeNode[], out: string[] = []): string[] => {
  for (const node of nodes) {
    if (node.type === 'request') continue
    if (!node.expanded) out.push(node.id)
    collapsedIn(node.children, out)
  }
  return out
}

const toStoredVariable = (variable: EnvironmentVariable): StoredVariable =>
  variable.secret
    ? { key: variable.key, enabled: variable.enabled, secret: true }
    : { key: variable.key, enabled: variable.enabled, secret: false, value: variable.value }

const toStoredEnvironment = (env: Environment): StoredEnvironment => ({ id: env.id, name: env.name, variables: env.variables.map(toStoredVariable) })

/**
 * Three branches, mirroring `StoredNode`.
 *
 * One consequence worth knowing: a keystroke in a **locked** variable's value changes
 * nothing in `toStoredVariable`'s output, so `workspace.json` is not rewritten at all —
 * only the slower, separately debounced credential write fires.
 */
const toStoredNode = (node: TreeNode): StoredNode => {
  if (node.type === 'request') return { id: node.id, type: 'request', requestId: node.requestId }
  if (node.type === 'folder') return { id: node.id, type: 'folder', name: node.name, children: node.children.map(toStoredNode) }
  return {
    id: node.id,
    type: 'collection',
    name: node.name,
    children: node.children.map(toStoredNode),
    environments: node.environments.map(toStoredEnvironment),
    activeEnvironmentId: node.activeEnvironmentId,
  }
}

const toStoredDocument = (doc: RequestDocument): StoredDocument => ({
  id: doc.id,
  name: doc.name,
  method: doc.method,
  url: doc.url,
  params: doc.params,
  headers: doc.headers,
  body: doc.body,
  auth: { type: doc.auth.type, username: doc.auth.username },
})

export const toWorkspaceFile = (state: WorkspaceState): WorkspaceFile => ({
  tree: state.tree.map(toStoredNode),
  documents: Object.fromEntries(Object.entries(state.documents).map(([id, doc]) => [id, toStoredDocument(doc)])),
})

export const toPrefsFile = (state: {
  tree: TreeNode[]
  tabs: string[]
  activeId: string | null
  selectedNodeId: string | null
  activeCollectionId: string | null
  recentIds: string[]
  sidebarWidth: number
  sidebarCollapsed: boolean
  splitOrientation: SplitOrientation
  splitRatio: number
  theme: ThemePreference
  language: Locale
  zoom: number
  codeFontSize: number
  defaultBodyLanguage: BodyLanguage | null
  defaultRedactSecrets: boolean
}): PrefsFile => ({
  tabs: state.tabs,
  activeId: state.activeId,
  selectedNodeId: state.selectedNodeId,
  activeCollectionId: state.activeCollectionId,
  recentIds: state.recentIds,
  collapsedNodeIds: collapsedIn(state.tree),
  sidebarWidth: state.sidebarWidth,
  sidebarCollapsed: state.sidebarCollapsed,
  splitOrientation: state.splitOrientation,
  splitRatio: state.splitRatio,
  theme: state.theme,
  language: state.language,
  zoom: state.zoom,
  codeFontSize: state.codeFontSize,
  defaultBodyLanguage: state.defaultBodyLanguage,
  defaultRedactSecrets: state.defaultRedactSecrets,
})

// ── Reading ────────────────────────────────────────────────────────────────────
//
// Everything below is defensive on purpose. This is the one place where data the
// app did not write enters it — a hand edit, a file from a newer build, a partial
// sync — so nothing is asserted with `as` and every field has a fallback.
//
// The names those fallbacks supply — 'Untitled', 'Collection', 'Folder' — stay in
// English, unlike the names `store.ts` gives to nodes the user creates. They are
// repair markers on a damaged file rather than copy, they are most useful when they
// read the same in every bug report, and they are produced during hydration, before
// the stored language has been applied.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const clamped = (v: unknown, range: { min: number; max: number; default: number }): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(range.max, Math.max(range.min, v)) : range.default
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

/** `satisfies` so a type with no branch in the editor cannot be listed here as readable. */
const BODY_TYPES = ['none', 'json', 'text', 'form', 'urlencoded', 'binary'] as const satisfies readonly BodyType[]
const AUTH_TYPES = ['none', 'bearer', 'basic'] as const
const ORIENTATIONS = ['rows', 'columns'] as const
const THEMES = ['system', 'light', 'dark'] as const
/** `satisfies` so a locale that has no catalogue cannot be listed here as readable. */
const LOCALES = ['en', 'es'] as const satisfies readonly Locale[]

const readRows = (value: unknown, prefix: string): KeyValueRow[] => {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((row, index) => ({
    // A missing or duplicated id would collide as a React key, so it is always
    // regenerated from the position rather than trusted.
    id: str(row.id) || `${prefix}-${index}`,
    enabled: bool(row.enabled, true),
    key: str(row.key),
    value: str(row.value),
    description: str(row.description),
  }))
}

/**
 * The form-data rows, on the same defensive terms as `readRows`: the id is always
 * regenerated from the position rather than trusted, because a missing or duplicated
 * one collides as a React key.
 *
 * `kind` falls back to `'text'`, which is the safe direction — a row whose kind did not
 * survive becomes an editable field rather than a file reference to nowhere.
 */
const readFormRows = (value: unknown, prefix: string): FormRow[] => {
  const rows = Array.isArray(value) ? value.filter(isRecord) : []
  // Never a bare column header, which is the rule `parseParams` states for the params
  // grid: there has to be somewhere to start typing. It matters more here, because every
  // request written before form bodies existed has no rows at all.
  if (!rows.length) return [{ id: `${prefix}-0`, enabled: true, kind: 'text', key: '', value: '', path: '', contentType: '' }]
  return rows.map((row, index) => ({
    id: str(row.id) || `${prefix}-${index}`,
    enabled: bool(row.enabled, true),
    kind: oneOf(row.kind, PART_KINDS, 'text'),
    key: str(row.key),
    value: str(row.value),
    path: str(row.path),
    contentType: str(row.contentType),
  }))
}

/**
 * An environment's variables, on the same defensive terms as `readRows`: the id is
 * regenerated from the position rather than trusted, because a missing or duplicated one
 * collides as a React key.
 *
 * A locked variable's value is forced empty even when the file carries one. A hand edit
 * that put a credential into `workspace.json` must not be loaded and then written
 * straight back out — the value comes from the credential store or from nowhere, and
 * injecting one by hand means unticking the lock first. It is not data loss, and it is
 * worth saying so here because it looks like it.
 */
const readVariables = (value: unknown, prefix: string): EnvironmentVariable[] => {
  const rows = Array.isArray(value) ? value.filter(isRecord) : []
  // Never a bare column header, the rule `readFormRows` above states.
  if (!rows.length) return [{ id: `${prefix}-0`, enabled: true, key: '', value: '', secret: false }]
  return rows.map((row, index) => {
    const secret = bool(row.secret, false)
    return { id: str(row.id) || `${prefix}-${index}`, enabled: bool(row.enabled, true), key: str(row.key), value: secret ? '' : str(row.value), secret }
  })
}

/**
 * One collection's environments.
 *
 * Ids key the credential store, so a duplicate *within a collection* is dropped the way
 * `readTree` drops a duplicate node id. Across collections they are unrelated and never
 * compared: the key carries the collection id, so a hand-copied collection block keeps
 * its environments working rather than having them silently discarded.
 */
const readEnvironments = (value: unknown): Environment[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: Environment[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const id = str(raw.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name: str(raw.name, 'Environment'), variables: readVariables(raw.variables, `${id}-v`) })
  }
  return out
}

const readFileBody = (value: unknown): RequestDocument['body']['file'] => {
  const file = isRecord(value) ? value : {}
  return { path: str(file.path), contentType: str(file.contentType) }
}

const readDocument = (value: unknown, id: string): RequestDocument | null => {
  if (!isRecord(value)) return null
  const body = isRecord(value.body) ? value.body : {}
  const auth = isRecord(value.auth) ? value.auth : {}
  return {
    id,
    kind: 'http',
    name: str(value.name, 'Untitled'),
    method: oneOf<HttpMethod>(value.method, methodOptions, 'GET'),
    url: str(value.url),
    params: readRows(value.params, `${id}-p`),
    headers: readRows(value.headers, `${id}-h`),
    // Every payload field is read whatever the type says, so a body saved as `form` and
    // opened by a build that does not know the member still has its rows once the type
    // is set again — the `oneOf` fallback loses the mode, and there is no reason for it
    // to take the content with it.
    body: {
      type: oneOf(body.type, BODY_TYPES, 'none'),
      content: str(body.content),
      form: readFormRows(body.form, `${id}-f`),
      urlencoded: readRows(body.urlencoded, `${id}-u`),
      file: readFileBody(body.file),
    },
    // Credentials are restored separately from the OS credential store; a
    // workspace opened on another machine simply has none.
    auth: { type: oneOf(auth.type, AUTH_TYPES, 'none'), token: '', username: str(auth.username), password: '' },
  }
}

/**
 * Rebuilds the tree, dropping anything that cannot be rendered: request nodes whose
 * document is missing, and duplicate ids. Hand editing produces valid JSON with
 * broken references far more often than it produces broken JSON.
 */
const readTree = (value: unknown, documents: Record<string, RequestDocument>, collapsed: Set<string>, seen: Set<string>): TreeNode[] => {
  if (!Array.isArray(value)) return []
  const out: TreeNode[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const id = str(raw.id)
    if (!id || seen.has(id)) continue

    if (raw.type === 'request') {
      const requestId = str(raw.requestId)
      const doc = documents[requestId]
      if (!doc) continue
      seen.add(id)
      // `name` is rebuilt from the document rather than read, so the two can never
      // be restored disagreeing with each other.
      out.push({ id, type: 'request', requestId, name: doc.name })
      continue
    }
    if (raw.type !== 'collection' && raw.type !== 'folder') continue
    seen.add(id)
    const shared = {
      id,
      name: str(raw.name, raw.type === 'collection' ? 'Collection' : 'Folder'),
      expanded: !collapsed.has(id),
      children: readTree(raw.children, documents, collapsed, seen),
    }
    if (raw.type === 'folder') {
      out.push({ ...shared, type: 'folder' })
      continue
    }
    const environments = readEnvironments(raw.environments)
    const active = str(raw.activeEnvironmentId)
    // An id naming an environment that is gone falls to **null**, never to the first
    // survivor. `deleteEnvironment` states the rule and this is the same one on the load
    // path: an environment is a host and a set of credentials, and a guessed one is worse
    // than none. The two are read three lines apart, which is the reason this field lives
    // on the node rather than in `ui.json` — there it would be a machine-local pointer
    // into a portable list, and validating it would mean handing `readPrefs` the tree.
    out.push({ ...shared, type: 'collection', environments, activeEnvironmentId: environments.some(env => env.id === active) ? active : null })
  }
  return out
}

/** Every document id reachable from the tree — anything else is unreachable and dropped. */
const reachable = (nodes: TreeNode[], out: Set<string> = new Set()): Set<string> => {
  for (const node of nodes) {
    if (node.type === 'request') out.add(node.requestId)
    else reachable(node.children, out)
  }
  return out
}

/**
 * Moves any root-level folder or request into a collection.
 *
 * The sidebar only renders one collection's children, so anything left loose at the
 * root would be unreachable through the UI — invisible, undeletable, and still
 * taking up space in the file. Hand-edited workspaces and files written before the
 * rail existed are both sources of these, so the reader repairs rather than trusts.
 *
 * This is no longer neutral for what a request *means*. The first collection is also the
 * one whose environments those requests now resolve against, so a reparented request can
 * come back with a different `{{baseUrl}}` than it went in with. There is nothing better
 * to do — the alternative is leaving it invisible — but it is the kind of thing that gets
 * diagnosed as a resolver bug.
 */
const adopt = (nodes: TreeNode[]): TreeNode[] => {
  const stray = nodes.filter(node => node.type !== 'collection')
  if (!stray.length) return nodes

  const collections = nodes.filter(node => node.type === 'collection')
  const first = collections[0]
  if (first && first.type === 'collection') {
    return [{ ...first, children: [...first.children, ...stray] }, ...collections.slice(1)]
  }
  return [{ id: 'collection-recovered', type: 'collection', name: 'My Collection', expanded: true, children: stray, environments: [], activeEnvironmentId: null }]
}

export interface LoadedWorkspace {
  tree: TreeNode[]
  documents: Record<string, RequestDocument>
}

export function readWorkspace(payload: unknown, collapsedNodeIds: readonly string[]): LoadedWorkspace {
  if (!isRecord(payload)) return { tree: [], documents: {} }

  const documents: Record<string, RequestDocument> = {}
  if (isRecord(payload.documents)) {
    for (const [id, raw] of Object.entries(payload.documents)) {
      const doc = readDocument(raw, id)
      if (doc) documents[id] = doc
    }
  }

  const tree = adopt(readTree(payload.tree, documents, new Set(collapsedNodeIds), new Set()))

  // Drop orphans: a document no node points at can never be opened or deleted
  // through the UI, so keeping it would only grow the file forever.
  const live = reachable(tree)
  for (const id of Object.keys(documents)) {
    if (!live.has(id)) delete documents[id]
  }

  return { tree, documents }
}

export function readPrefs(payload: unknown, documents: Record<string, RequestDocument>, tree: TreeNode[]): PrefsState {
  const raw = isRecord(payload) ? payload : {}
  const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])

  // Restoring a tab for a request that no longer exists would render an empty tab
  // strip entry, so the session is filtered down to what actually survived.
  const tabs = ids(raw.tabs).filter(id => documents[id])
  // `null` is a real answer here and not a missing one: closing the app with a collection
  // selected and nothing open has to come back that way. This used to fall through to the
  // last entry in `tabs`, which was right while the strip was workspace-global and is wrong
  // now that it is scoped — that tab belongs to whatever collection happens to own it, and
  // the `revealPatch` at the end of `hydrate` would then move the rail to meet it, throwing
  // away the `activeCollectionId` resolved below. A stale id resolves to `null` for the same
  // reason: the rail stays where it was left, and the tabs in it are one click from active.
  const activeCandidate = typeof raw.activeId === 'string' ? raw.activeId : null
  const activeId = activeCandidate && tabs.includes(activeCandidate) ? activeCandidate : null

  const nodeIds = new Set<string>()
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      nodeIds.add(node.id)
      if (node.type !== 'request') walk(node.children)
    }
  }
  walk(tree)
  const selectedCandidate = typeof raw.selectedNodeId === 'string' ? raw.selectedNodeId : null

  // Falls back to the first collection rather than to null: with the tree scoped to
  // the active collection, a null here would render an empty panel on a workspace
  // that plainly has collections in it.
  const collectionIds = tree.filter(node => node.type === 'collection').map(node => node.id)
  const collectionCandidate = typeof raw.activeCollectionId === 'string' ? raw.activeCollectionId : null

  return {
    tabs,
    activeId,
    selectedNodeId: selectedCandidate && nodeIds.has(selectedCandidate) ? selectedCandidate : null,
    activeCollectionId: collectionCandidate && collectionIds.includes(collectionCandidate) ? collectionCandidate : (collectionIds[0] ?? null),
    recentIds: ids(raw.recentIds).filter(id => documents[id]).slice(0, 12),
    sidebarWidth: clamped(raw.sidebarWidth, SIDEBAR_WIDTH),
    sidebarCollapsed: bool(raw.sidebarCollapsed, false),
    splitOrientation: oneOf(raw.splitOrientation, ORIENTATIONS, 'rows'),
    splitRatio: clamped(raw.splitRatio, SPLIT_RATIO),
    theme: oneOf(raw.theme, THEMES, 'system'),
    language: oneOf(raw.language, LOCALES, 'en'),
    zoom: clamped(raw.zoom, ZOOM),
    codeFontSize: clamped(raw.codeFontSize, CODE_FONT_SIZE),
    // Not `oneOf`: the fallback is `null` — nothing chosen — which is not one of the
    // allowed values.
    defaultBodyLanguage: BODY_LANGUAGES.find(candidate => candidate === raw.defaultBodyLanguage) ?? null,
    defaultRedactSecrets: bool(raw.defaultRedactSecrets, false),
  }
}

/**
 * The credential-store ids left behind by the environment variables feature as it existed
 * in 0.31.0, which was removed in 0.32.0.
 *
 * Transitional, and deletable together with the field it reads. `go-keyring` cannot
 * enumerate a store, so an id nobody names is an id nobody can delete — and these were
 * named `env:<environment id>:<variable key>` by a module that no longer exists. The
 * shape is read here rather than reconstructed at the call site because this file is
 * where untrusted payloads are read; a locked variable stored no value, so only its key
 * was ever in the file.
 *
 * **Do not repurpose this for the environments that came back in 0.33.0.** It does not
 * cover them and must not: they hang off a collection node, are keyed
 * `env:<collection id>:<environment id>:<variable key>` — four segments, with a
 * `collection-<stamp>` where this emits an `env-<stamp>` — and need no sweeper at all,
 * because `secretKeysOf` names every live key on every save and `lastKeep` names every
 * departed one exactly once. The two id namespaces are disjoint, which is what makes it
 * safe for this to still run.
 *
 * It also only emits anything while the payload still carries a *top-level* `environments`
 * key, which `toWorkspaceFile` at version 4 never writes. So it fires at most once per
 * machine, from a pre-4 file that has never been re-saved. Delete it, its call site in
 * `persistence.ts` and that call site's `orphans` list in the release after the one that
 * shipped version 4.
 */
export const legacySecretKeys = (payload: unknown): string[] => {
  if (!isRecord(payload)) return []
  // Two shapes reached disk under the same field name: one flat list of environments,
  // and — from the build that stamped workspace version 2 — a map keyed by collection
  // id. Reading only the list would walk straight past every credential the other one
  // left behind, and this sweep has exactly one chance to run, because the first save
  // rewrites the file without the field.
  const stored: unknown = payload.environments
  const environments: unknown[] = Array.isArray(stored) ? stored : isRecord(stored) ? Object.values(stored).flat() : []
  const out: string[] = []
  for (const environment of environments) {
    if (!isRecord(environment)) continue
    const id = str(environment.id)
    if (!id || !Array.isArray(environment.variables)) continue
    for (const variable of environment.variables) {
      if (!isRecord(variable) || variable.secret !== true) continue
      const key = str(variable.key).trim()
      if (key) out.push(`env:${id}:${key}`)
    }
  }
  return out
}

/** `collapsedNodeIds` is needed to build the tree, so it is read before the rest. */
export const readCollapsed = (payload: unknown): string[] => {
  if (!isRecord(payload) || !Array.isArray(payload.collapsedNodeIds)) return []
  return payload.collapsedNodeIds.filter((v): v is string => typeof v === 'string')
}
