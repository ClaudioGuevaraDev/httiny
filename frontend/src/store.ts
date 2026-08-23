import { create } from 'zustand'
import { translate } from './i18n'
import { DEFAULT_BODY_VIEW } from './responseBody'
import { DEFAULT_SNIPPET_TARGET, type SnippetTarget } from './snippets'
import type {
  BodyLanguage,
  BodyView,
  CollectionNode,
  ConfirmIntent,
  Environment,
  EnvironmentVariable,
  HttpMethod,
  KeyValueRow,
  Locale,
  RequestDocument,
  RequestPanel,
  ResponsePanel,
  ResponseSearch,
  ResponseSnapshot,
  SplitOrientation,
  ThemePreference,
  TreeNode,
  UpdateState,
} from './types'

/** Closed, with nothing typed and both toggles off — the state Ctrl+F opens into. */
const DEFAULT_RESPONSE_SEARCH: ResponseSearch = { open: false, query: '', caseSensitive: false, regexp: false }

/**
 * Layout bounds, defined here because the store is what clamps them. They used to
 * live in `workspaceFile.ts` while `App.tsx` and the setters below each repeated the
 * literals — three copies of the same four numbers.
 *
 * `sidebarWidth` covers the rail *and* the panel, so the minimum is the old tree
 * minimum plus the rail. A width persisted before the rail existed still lands
 * inside the new range, so no migration is needed.
 */
export const SIDEBAR_WIDTH = { min: 268, max: 468, default: 330 } as const
export const SPLIT_RATIO = { min: 30, max: 72, default: 52 } as const

/**
 * A percentage, and an integer one: it is written to `ui.json` on every change, and a
 * ratio would accumulate the usual binary dust there for nothing.
 */
export const ZOOM = { min: 80, max: 150, default: 100 } as const
/** The stops the stepper and the shortcuts move between. `ZOOM.min`/`max` are its ends. */
export const ZOOM_STEPS = [80, 90, 100, 110, 125, 150] as const

/**
 * Pixels, and no list of stops: every integer is a legitimate type size. Governs
 * `--text-code`, which feeds nothing but the two editors — so this is the knob the zoom
 * cannot be, the one that leaves the chrome alone.
 */
export const CODE_FONT_SIZE = { min: 10, max: 22, default: 13 } as const

/**
 * What a fresh install gets, and what "Restore defaults" restores. One object so those two
 * cannot drift apart: the initial state spreads it and the action assigns it, instead of a
 * reset written out by hand becoming a third copy and the first to fall behind.
 *
 * `satisfies` ties every field to the type the store declares, so renaming one breaks here
 * rather than silently resetting nothing.
 *
 * `sidebarCollapsed` is deliberately absent: it is not a settings-modal preference but a
 * workspace state, toggled from `Ctrl+B` and its own button, and restoring settings has no
 * business unfolding a sidebar somebody hid.
 */
export const SETTINGS_DEFAULTS = {
  theme: 'system',
  language: 'en',
  zoom: ZOOM.default,
  codeFontSize: CODE_FONT_SIZE.default,
  defaultBodyLanguage: null,
  defaultRedactSecrets: false,
  splitOrientation: 'rows',
  sidebarWidth: SIDEBAR_WIDTH.default,
  splitRatio: SPLIT_RATIO.default,
} as const satisfies Pick<
  AppState,
  | 'theme'
  | 'language'
  | 'zoom'
  | 'codeFontSize'
  | 'defaultBodyLanguage'
  | 'defaultRedactSecrets'
  | 'splitOrientation'
  | 'sidebarWidth'
  | 'splitRatio'
>

/**
 * The next stop in a direction. `findIndex` rather than `indexOf` so a value that is not
 * a stop at all — a hand-edited `ui.json` — still moves instead of sticking: the first
 * stop past it in that direction wins.
 */
const stepZoom = (zoom: number, direction: 1 | -1): number => {
  const next = direction === 1 ? ZOOM_STEPS.find(stop => stop > zoom) : [...ZOOM_STEPS].reverse().find(stop => stop < zoom)
  return next ?? (direction === 1 ? ZOOM.max : ZOOM.min)
}

/**
 * What a request opens on when it has never chosen a panel of its own. Exported because
 * three places need the same answer: the two components that read the maps below, and
 * `workspaceFile.ts`, which leaves a request at its default out of the prefs file.
 */
export const DEFAULT_REQUEST_PANEL: RequestPanel = 'params'
export const DEFAULT_RESPONSE_PANEL: ResponsePanel = 'body'

interface AppState {
  tree: TreeNode[]
  documents: Record<string, RequestDocument>
  tabs: string[]
  activeId: string | null
  selectedNodeId: string | null
  /**
   * Which collection the sidebar is showing. The tree renders this collection's
   * children only, so this is what the rail switches — and what has to follow along
   * when a request is revealed from the command palette.
   */
  activeCollectionId: string | null
  /**
   * Which section each half of the workspace is showing, keyed by request id and in the
   * same class of state as `bodyViews` below: per request, absent until something is
   * chosen, meaningless once the request is gone.
   *
   * Both were single fields once, and that made the panel a property of the window:
   * leaving one request on Headers opened every *other* request on Headers too, including
   * ones that had never been looked at. Which section you are editing belongs to the
   * request, the way its URL does.
   *
   * Per request, but **not** across launches — these three never reach `ui.json`. Closing
   * the app on Timeline and finding it there again is restoring a view of a response that
   * no longer exists, since `responses` below is never persisted either. See the note in
   * `workspaceFile.ts`.
   */
  requestPanels: Record<string, RequestPanel>
  responsePanels: Record<string, ResponsePanel>
  responses: Record<string, ResponseSnapshot>
  /**
   * How each request's response body is being shown. Keyed by request id and pruned
   * alongside `documents` and `responses`, because it is the same class of state:
   * per request, and meaningless once the request is gone. Absent means
   * `DEFAULT_BODY_VIEW` — nothing is written until something is chosen.
   */
  bodyViews: Record<string, BodyView>

  /** Most-recently-activated request ids, newest first, capped at 12. */
  recentIds: string[]

  // Persistence status, owned by persistence.ts and rendered in the sidebar footer.
  // `unavailable` is the browser dev server, which has no Wails runtime behind it;
  // `newer-version` is a workspace file written by a later build, which is read-only
  // by design rather than being silently truncated.
  persistenceState: 'loading' | 'ready' | 'unavailable' | 'newer-version'
  saveState: 'idle' | 'pending' | 'saving' | 'saved' | 'error'
  /** False when no OS credential store could be reached — tokens are session-only. */
  secretsAvailable: boolean
  /** Set when an unreadable workspace file was moved aside on load. */
  quarantinedPath: string | null
  dataDir: string

  // Layout preferences live here rather than in App's local state because two
  // independent surfaces mutate them — the workspace buttons and palette commands —
  // and AGENTS.md keeps shared state out of presentation components.
  sidebarWidth: number
  sidebarCollapsed: boolean
  splitOrientation: SplitOrientation
  splitRatio: number

  /** Applied by `zoom.ts` as a CSS `zoom` on the root, in percent. */
  zoom: number
  /** Applied by `codeFont.ts` as `--text-code`, in pixels. */
  codeFontSize: number
  /** Applied by `theme.ts`, which resolves `system` before CSS ever sees it. */
  theme: ThemePreference
  /** Applied by `language.ts`, which pushes it into the message runtime and onto `<html lang>`. */
  language: Locale
  /**
   * What the response viewer opens a body as when the request has no pick of its own.
   * `null` is "automatic", which defers to the body and then to Go's classification —
   * see `resolveLanguage`, which owns the precedence.
   */
  defaultBodyLanguage: BodyLanguage | null
  /**
   * What the code view opens its redaction switch on. A *default*, like the field above:
   * the switch in the modal still overrides it, for that visit only.
   *
   * The switch itself was persisted once, which meant one click quietly changed what every
   * later session showed — a control that rewrites a credential must not be able to stay on
   * behind your back. Saying so in Settings is a different act: it is deliberate, it is
   * visible, and it is somewhere you can find it again.
   */
  defaultRedactSecrets: boolean

  // Only open/closed lives here; the palette's query and highlighted index stay
  // local to the dialog, since they change on every keystroke and nothing outside
  // it reads them.
  paletteOpen: boolean
  paletteSeed: string
  /** Not persisted: an open modal is not a preference worth restoring. */
  settingsOpen: boolean
  /**
   * Which collection's environments the editor is open on, or `null` for closed.
   *
   * The id and not a boolean, so the dialog cannot drift onto another collection while it
   * is open: the rail moves under it whenever a palette jump reveals a request elsewhere,
   * and a dialog that followed would silently retarget every edit in it. Not persisted,
   * for the reason `settingsOpen` gives.
   */
  environmentsFor: string | null

  /**
   * The code view, and only what something outside the modal reads: whether it is open,
   * and which language it is showing. Its redaction switch is not here — it is a
   * `useState` in `CodeBody`, seeded from `defaultRedactSecrets` above, which is the rule
   * the palette's query already follows: state nothing outside the dialog reads belongs
   * to the dialog. The body only mounts while the dialog is open, so every opening
   * re-seeds itself and no one has to remember to reset it on the way out.
   *
   * The generated snippet is in neither place. It is derived from the request and from
   * `Wire`'s answer, both of which can change on any keystroke, so holding it would mean
   * keeping a copy in sync for no reader — and it is the one string in the app that can
   * contain a credential in plain text.
   *
   * `codeTarget` lasts the session and is not written to `ui.json`, for the reason its
   * neighbour above is: it is where you left the picker, not a preference you went and
   * set. Same rule as the panel maps.
   */
  codeOpen: boolean
  codeTarget: SnippetTarget

  /**
   * The response viewer's search bar. Unlike the palette's query, this one lives in the
   * store rather than in the component: three places open it — the global Ctrl+F, the
   * command palette and the viewer's own close button — and two of them have no way to
   * reach a `useState` inside `ResponseViewer`.
   *
   * Not persisted either. `toPrefsFile` is an explicit whitelist, so leaving it out of
   * that function is all it takes; a search bar that reopens on launch would be noise.
   */
  responseSearch: ResponseSearch

  /**
   * The update flow. Transient like `responseSearch` and for the same reason: two
   * places drive it — the startup check and the modal's own buttons — and neither
   * can reach a `useState` inside a component that is not mounted yet.
   */
  update: UpdateState

  /**
   * Whether the update modal has been closed. Kept apart from `update` on purpose:
   * that field says *what* update exists and this one says whether its modal is on
   * screen, so postponing hides the dialog without losing the finding — which is what
   * lets the sidebar footer keep offering it.
   *
   * Not persisted. The check runs again on the next launch and will re-open the modal
   * by itself, so remembering this across restarts would only suppress it.
   */
  updateDismissed: boolean

  /**
   * What a confirmation dialog is asking about, or `null` for none. Here rather than
   * in a `useState` because the two things that raise one — a tree row and the settings
   * panel — cannot host the dialog themselves: `TreeRowActions` renders inside a
   * `role="treeitem"`, whose only allowed children are groups and treeitems, and a
   * `<dialog>` nested there stays a treeitem descendant in the accessibility tree even
   * while it paints in the top layer. So one instance lives at the app root and this
   * field is how anything reaches it.
   *
   * An intent, never a callback — see `ConfirmIntent`.
   *
   * Not persisted, for the reason `settingsOpen` gives: `toPrefsFile` is an explicit
   * whitelist, and a question that reopens on launch asks about a click nobody made.
   */
  confirm: ConfirmIntent | null

  openRequest: (id: string) => void
  closeRequest: (id: string) => void
  setActive: (id: string) => void
  selectCollection: (id: string) => void
  setSaveState: (state: AppState['saveState']) => void
  setSecretsAvailable: (available: boolean) => void
  updateDocument: (id: string, patch: Partial<RequestDocument>) => void
  setRows: (id: string, key: 'params' | 'headers', rows: KeyValueRow[]) => void
  setBody: (id: string, patch: Partial<RequestDocument['body']>) => void
  toggleNode: (nodeId: string) => void
  addNode: (type: 'collection' | 'folder' | 'request', parentId?: string, name?: string) => void
  renameNode: (nodeId: string, name: string) => void
  deleteNode: (nodeId: string) => void
  revealNode: (requestId: string) => void
  setRequestPanel: (id: string, panel: RequestPanel) => void
  setResponsePanel: (id: string, panel: ResponsePanel) => void
  setResponse: (id: string, response: ResponseSnapshot) => void
  setBodyView: (id: string, patch: Partial<BodyView>) => void
  setSidebarWidth: (width: number) => void
  toggleSidebar: () => void
  setSplitOrientation: (orientation: SplitOrientation) => void
  toggleSplitOrientation: () => void
  setSplitRatio: (ratio: number) => void
  setZoom: (zoom: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  setCodeFontSize: (size: number) => void
  setTheme: (theme: ThemePreference) => void
  setLanguage: (language: Locale) => void
  resetSettings: () => void
  setDefaultBodyLanguage: (language: BodyLanguage | null) => void
  setDefaultRedactSecrets: (redact: boolean) => void
  openPalette: (seed?: string) => void
  closePalette: () => void
  /** A patch, like `setBodyView`: callers change one field and leave the rest alone. */
  setResponseSearch: (patch: Partial<ResponseSearch>) => void
  setUpdate: (update: UpdateState) => void
  dismissUpdate: () => void
  reopenUpdate: () => void
  openSettings: () => void
  closeSettings: () => void
  openEnvironments: (collectionId: string) => void
  closeEnvironments: () => void
  openCode: () => void
  closeCode: () => void
  setCodeTarget: (target: SnippetTarget) => void
  /**
   * The six environment actions, every one of them taking the collection explicitly.
   *
   * Explicit and not read from `collectionInPlay` inside the action, which is what the
   * workspace-global design did: there, the pool was shared and the pick was the only
   * per-collection thing, so there was one right answer. Here everything is per
   * collection, and a dialog opened for collection X has to keep writing to X even
   * though the palette and Ctrl+Tab can move `activeId` under it.
   *
   * `addEnvironment` and `duplicateEnvironment` take the new id rather than minting one,
   * so the caller has it to select the new environment with — the same reason `freshRow`
   * mints outside the store.
   */
  addEnvironment: (collectionId: string, id: string, name?: string) => void
  renameEnvironment: (collectionId: string, id: string, name: string) => void
  duplicateEnvironment: (collectionId: string, id: string, nextId: string) => void
  deleteEnvironment: (collectionId: string, id: string) => void
  setEnvironmentVariables: (collectionId: string, id: string, variables: EnvironmentVariable[]) => void
  setActiveEnvironment: (collectionId: string, id: string | null) => void
  askConfirm: (intent: ConfirmIntent) => void
  closeConfirm: () => void
  /**
   * Carry out whatever is pending and clear it. The switch lives here rather than in the
   * dialog so the mapping from intent to action sits beside the actions themselves —
   * `ConfirmDialog` only has to know how to word the question.
   */
  runConfirm: () => void
}

const mapTree = (nodes: TreeNode[], fn: (node: TreeNode) => TreeNode): TreeNode[] =>
  nodes.map(n => {
    const node = fn(n)
    return node.type !== 'request' ? { ...node, children: mapTree(node.children, fn) } : node
  })

const removeNode = (nodes: TreeNode[], id: string): TreeNode[] =>
  nodes.filter(n => n.id !== id).map(n => (n.type === 'request' ? n : { ...n, children: removeNode(n.children, id) }))

/**
 * One collection, replaced.
 *
 * A flat `map` and not `mapTree`, for two reasons. A collection is always a root node —
 * `addNode` forces it and `adopt` repairs it — so there is nothing to recurse into. And
 * every other node has to keep its identity: `subscribeEnvironment` compares the
 * resolved `Environment` object, which only survives because a copy of an untouched
 * node is not made at all.
 */
const mapCollection = (nodes: TreeNode[], id: string, fn: (collection: CollectionNode) => CollectionNode): TreeNode[] =>
  nodes.map(node => (node.type === 'collection' && node.id === id ? fn(node) : node))

/** The same, narrowed to one environment inside it. A no-op when either id names nothing. */
const mapEnvironment = (nodes: TreeNode[], collectionId: string, envId: string, fn: (env: Environment) => Environment): TreeNode[] =>
  mapCollection(nodes, collectionId, collection => ({
    ...collection,
    environments: collection.environments.map(env => (env.id === envId ? fn(env) : env)),
  }))

const insertNode = (nodes: TreeNode[], parentId: string | undefined, child: TreeNode): TreeNode[] => {
  if (!parentId) return [...nodes, child]
  return nodes.map(n =>
    n.id === parentId && n.type !== 'request'
      ? { ...n, expanded: true, children: [...n.children, child] }
      : n.type === 'request'
        ? n
        : { ...n, children: insertNode(n.children, parentId, child) },
  )
}

/** The tree node pointing at a given document, or null if it has been deleted. */
const findRequestNodeId = (nodes: TreeNode[], requestId: string): string | null => {
  for (const node of nodes) {
    if (node.type === 'request') {
      if (node.requestId === requestId) return node.id
      continue
    }
    const found = findRequestNodeId(node.children, requestId)
    if (found) return found
  }
  return null
}

export const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.type !== 'request') {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

/** Every document id in a subtree, so deleting a folder prunes its requests too. */
export const requestIdsIn = (node: TreeNode): string[] => (node.type === 'request' ? [node.requestId] : node.children.flatMap(requestIdsIn))

export interface VisibleRow {
  node: TreeNode
  depth: number
  parentId: string | null
  /** 1-based position among siblings, and the sibling count — `aria-posinset`/`aria-setsize`. */
  position: number
  siblings: number
}

/**
 * The tree flattened to exactly the rows a user can see, in visual order. This is what
 * makes keyboard navigation possible: `↑`/`↓` are a step through this array, and `←`/`→`
 * need the parent id, which the nested structure does not carry.
 *
 * Collapsed branches contribute their own row and nothing beneath it, which is the whole
 * point — arrow keys must not walk into rows that are not on screen. The flat shape is
 * also what the sidebar renders: an ARIA tree may be authored flat as long as every row
 * declares its level and position, and that avoids a wrapper element per branch.
 */
export const flattenVisible = (nodes: TreeNode[], depth = 0, parentId: string | null = null): VisibleRow[] =>
  nodes.flatMap((node, index) => {
    const row: VisibleRow = { node, depth, parentId, position: index + 1, siblings: nodes.length }
    return node.type !== 'request' && node.expanded ? [row, ...flattenVisible(node.children, depth + 1, node.id)] : [row]
  })

/** Ids of every ancestor of `id`, outermost first — used to expand a revealed row. */
const ancestorIds = (nodes: TreeNode[], id: string, trail: string[] = []): string[] | null => {
  for (const node of nodes) {
    if (node.id === id) return trail
    if (node.type !== 'request') {
      const found = ancestorIds(node.children, id, [...trail, node.id])
      if (found) return found
    }
  }
  return null
}

const remember = (recentIds: string[], id: string): string[] => [id, ...recentIds.filter(recent => recent !== id)].slice(0, 12)

/**
 * What it takes to make a request visible in the sidebar: switch to its collection,
 * expand every ancestor, select its row.
 *
 * The tree only renders one collection's children, so activating a tab without this
 * left the selection on a row that was not on screen — and `containerFor` would then
 * place a new request beside it, inside a collection you were not looking at.
 *
 * Takes `tree` rather than the whole state because `deleteNode` applies it to the
 * tree it has just pruned, not to the one still in the store. Returns its inputs
 * unchanged when the request is not in the tree — the same fallback `setActive`
 * spelled out as `?? s.selectedNodeId`.
 *
 * This is the invariant tying `activeId`, `activeCollectionId` and `selectedNodeId`
 * together, so **every** writer of `activeId` applies it — hydration included, which
 * used to be the one exception. `selectCollection` and `addNode('collection')` move the
 * rail and clear the selection *without* touching `activeId`, and all three fields are
 * persisted, so `ui.json` can legitimately hold a pair that disagrees; `readPrefs`
 * validates each field on its own and cannot repair it. Exported for that one caller.
 */
export const revealPatch = (tree: TreeNode[], requestId: string | null, selectedNodeId: string | null, activeCollectionId: string | null) => {
  const nodeId = requestId ? findRequestNodeId(tree, requestId) : null
  if (!nodeId) return { tree, selectedNodeId, activeCollectionId }
  const ancestors = ancestorIds(tree, nodeId) ?? []
  // Only rebuild the tree when something is actually collapsed. `mapTree` gives every
  // node a new identity, and the autosave subscriber serialises the whole workspace
  // the moment `tree` changes reference (persistence.ts:116) — too much for a click
  // on a tab that reveals nothing.
  const collapsed = ancestors.some(id => {
    const node = findNode(tree, id)
    return node !== null && node.type !== 'request' && !node.expanded
  })
  return {
    tree: collapsed ? mapTree(tree, n => (n.type !== 'request' && ancestors.includes(n.id) ? { ...n, expanded: true } : n)) : tree,
    selectedNodeId: nodeId,
    // `ancestors[0]` is the collection: collections are always root nodes.
    activeCollectionId: ancestors[0] ?? activeCollectionId,
  }
}

/**
 * Where a new node goes when the caller does not name a parent: into the selected
 * container, or alongside the selected request, else at the root.
 *
 * Three call sites used to hardcode `'main'` — the id of a collection that existed
 * only in the deleted fixtures. `insertNode` returns the tree unchanged when no
 * node matches, so with an empty tree the sidebar's New folder and New request
 * buttons silently did nothing, and `addNode('request', 'main')` was worse than a
 * no-op: it still created the document and opened a tab, leaving a request that
 * belonged to no tree and could never be found again once the tab was closed.
 */
const containerFor = (nodes: TreeNode[], selectedNodeId: string | null, activeCollectionId: string | null): string | undefined => {
  if (selectedNodeId) {
    const node = findNode(nodes, selectedNodeId)
    if (node && node.type !== 'request') return node.id
    const parent = ancestorIds(nodes, selectedNodeId)?.at(-1)
    if (parent) return parent
  }
  // Falling back to the active collection rather than the root is what keeps a new
  // request inside the collection you are looking at. Landing it at the root would
  // now make it invisible, because the tree only renders one collection's children.
  return activeCollectionId ?? undefined
}

/** Root-level collections, in order — exactly what the rail lists. */
export const collectionsIn = (nodes: TreeNode[]): CollectionNode[] => nodes.filter((n): n is CollectionNode => n.type === 'collection')

/**
 * Exactly the state environment resolution reads.
 *
 * Named for the reason `WorkspaceState` is: `environments.ts` types itself against this,
 * so a fourth field joining the resolution is a deliberate edit here rather than a silent
 * widening at a call site. There is no `environments` member — the pool is inside `tree`,
 * which is the whole point of the design.
 */
export type ResolutionState = Pick<AppState, 'tree' | 'activeId' | 'activeCollectionId'>

/**
 * Which collection each request belongs to, keyed by **document** id — the id `tabs`,
 * `documents` and `responses` are keyed by, not the tree node id.
 *
 * The **node**, not its id: every caller wants `environments` off it, and returning the
 * id would make each one walk the tree a second time. One walk for the whole tree rather
 * than one per question, because the callers ask about the active request on every store
 * change. A request loose at the root belongs to no collection and is simply absent —
 * `adopt` prevents that shape on load and nothing in the app can create it.
 */
const requestOwners = (nodes: TreeNode[]): Map<string, CollectionNode> => {
  const out = new Map<string, CollectionNode>()
  for (const node of nodes) {
    if (node.type !== 'collection') continue
    for (const requestId of requestIdsIn(node)) out.set(requestId, node)
  }
  return out
}

/**
 * The same, cached on `tree` identity.
 *
 * Cache-on-read, and keyed on the tree it is *handed* rather than on the one in the store,
 * for two reasons. Hydration replaces `tree` before `createRoot`, so a map built at module
 * load would already be stale by the first render with nothing to correct it. And the
 * subscription guard asks the same question of `state` and of `previous`; a cache that
 * read `getState()` would answer both with the current tree.
 *
 * Identity is a sound key because nothing mutates a `TreeNode` in place: `mapTree`,
 * `insertNode`, `removeNode` and `mapCollection` are all copy-on-write. `toggleNode`
 * therefore rebuilds this on every folder expand — harmless precisely because the guard
 * compares the resolved `Environment`, and that object survives the copy.
 */
let ownerTree: TreeNode[] | null = null
let owners: ReadonlyMap<string, CollectionNode> = new Map()
const ownersOf = (tree: TreeNode[]): ReadonlyMap<string, CollectionNode> => {
  if (ownerTree !== tree) {
    ownerTree = tree
    owners = requestOwners(tree)
  }
  return owners
}

/** The collection a request lives in, or null when it is not in the tree. */
export const collectionOf = (state: ResolutionState, requestId: string): CollectionNode | null => ownersOf(state.tree).get(requestId) ?? null

/**
 * Which collection the sidebar is *showing* — not the same as `activeCollectionId`.
 *
 * `CollectionRail`, `Sidebar`, `useTreeNavigation` and `readPrefs` each fall back to
 * `collections[0]` on their own, so `activeCollectionId` can be null or stale while the
 * rail visibly shows a collection. Anything asking "which collection is the user looking
 * at" has to ask the same way they do.
 */
export const shownCollection = (state: Pick<ResolutionState, 'tree' | 'activeCollectionId'>): CollectionNode | null => {
  const collections = collectionsIn(state.tree)
  return collections.find(c => c.id === state.activeCollectionId) ?? collections[0] ?? null
}

/**
 * The collection whose environments the *interface* is pointed at: the active request's,
 * else the rail's.
 *
 * The fallback is what separates this from `environmentFor`, which has none. This answers
 * "which collection does a control act on"; that one answers "which environment does this
 * send resolve against", and borrowing the rail there would point a send at another
 * server's credentials.
 */
export const collectionInPlay = (state: ResolutionState): CollectionNode | null =>
  (state.activeId ? collectionOf(state, state.activeId) : null) ?? shownCollection(state)

/**
 * A collection's active environment, or undefined.
 *
 * Validated rather than trusted, even though `deleteEnvironment` and `readTree` both
 * prune: a `Select` whose `value` matches no option renders blank, so a stale id has to
 * read as "none" here too.
 */
export const activeEnvironmentOf = (collection: CollectionNode | null): Environment | undefined =>
  collection?.environments.find(env => env.id === collection.activeEnvironmentId)

export const useAppStore = create<AppState>((set, get) => ({
  // The app starts genuinely empty. There are no fixtures to seed from any more:
  // demo data against a domain that does not exist made every surface look
  // populated while nothing worked, and it hid the first-run experience.
  tree: [],
  documents: {},
  tabs: [],
  activeId: null,
  selectedNodeId: null,
  activeCollectionId: null,
  requestPanels: {},
  responsePanels: {},
  responses: {},
  bodyViews: {},
  recentIds: [],
  ...SETTINGS_DEFAULTS,
  // Not one of them: hiding the sidebar is a workspace gesture, not a setting.
  sidebarCollapsed: false,
  responseSearch: DEFAULT_RESPONSE_SEARCH,
  update: { state: 'idle' },
  updateDismissed: false,
  paletteOpen: false,
  paletteSeed: '',
  settingsOpen: false,
  environmentsFor: null,
  codeOpen: false,
  codeTarget: DEFAULT_SNIPPET_TARGET,
  confirm: null,
  persistenceState: 'loading',
  saveState: 'idle',
  secretsAvailable: true,
  quarantinedPath: null,
  dataDir: '',

  // `selectedNodeId` used to be derived as `node-${activeId}`, a convention that only
  // held for the seeded fixtures in data.ts. Requests created through `addNode` got
  // ids like `request-1699…`, so they never highlighted in the tree. `revealPatch`
  // looks the node up, so selection is correct for every request however it was
  // created — and the sidebar follows it into its own collection.
  openRequest: id =>
    set(s => ({
      ...revealPatch(s.tree, id, s.selectedNodeId, s.activeCollectionId),
      tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id],
      activeId: id,
      recentIds: remember(s.recentIds, id),
    })),

  // Closing a tab is a view operation, not a delete: the request still exists in the
  // tree, so `documents[id]` stays. The stored response stays too — finding your last
  // response still there when you reopen a tab is a feature, not a leak.
  closeRequest: id =>
    set(s => {
      const index = s.tabs.indexOf(id)
      const tabs = s.tabs.filter(tab => tab !== id)
      const activeId = s.activeId === id ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : s.activeId
      return {
        tabs,
        activeId,
        recentIds: s.recentIds.filter(recent => recent !== id),
        // Only when the neighbour tab took over. Closing a background tab must not
        // move the sidebar out from under you.
        ...(activeId === s.activeId ? {} : revealPatch(s.tree, activeId, s.selectedNodeId, s.activeCollectionId)),
      }
    }),

  // The sidebar follows the tab strip: the rail switches to the request's collection
  // and its row is revealed, so what the tree shows always matches what the editor
  // holds. The command palette has done this since it existed; tabs did not.
  setActive: id =>
    set(s => ({
      ...revealPatch(s.tree, id, s.selectedNodeId, s.activeCollectionId),
      activeId: id,
      recentIds: remember(s.recentIds, id),
    })),

  // Clears the tree selection: it belonged to the collection being left, and
  // leaving it set would keep `containerFor` placing new nodes in the old one.
  selectCollection: id => set({ activeCollectionId: id, selectedNodeId: null }),

  setSaveState: saveState => set({ saveState }),
  setSecretsAvailable: secretsAvailable => set({ secretsAvailable }),

  // There is no `dirty` flag any more. Everything autosaves, so "unsaved" was a
  // state the app could no longer be in — and a confirmation dialog guarding
  // against losing changes that were already on disk was simply lying.
  updateDocument: (id, patch) => set(s => ({ documents: { ...s.documents, [id]: { ...s.documents[id], ...patch } } })),

  setRows: (id, key, rows) => set(s => ({ documents: { ...s.documents, [id]: { ...s.documents[id], [key]: rows } } })),

  // A body is now four payload fields under one `type`, so the merge that used to sit
  // loose inside the editor is an action. `updateDocument(id, { body: { ...body, ...patch } })`
  // spelled out at every call site is one forgotten spread away from clearing the rows
  // of whichever body type is not being edited.
  setBody: (id, patch) => set(s => ({ documents: { ...s.documents, [id]: { ...s.documents[id], body: { ...s.documents[id].body, ...patch } } } })),

  toggleNode: nodeId => set(s => ({ tree: mapTree(s.tree, n => (n.id === nodeId && n.type !== 'request' ? { ...n, expanded: !n.expanded } : n)) })),

  addNode: (type, parentId, name) =>
    set(s => {
      const stamp = Date.now()

      // A request or folder always ends up inside a collection, the way a channel
      // always belongs to a server. Without this an empty workspace would put the
      // first request at the root, where the collection-scoped tree cannot show it.
      let tree = s.tree
      let activeCollectionId = s.activeCollectionId
      if (type !== 'collection' && !parentId && !collectionsIn(tree).length) {
        activeCollectionId = `collection-${stamp}`
        tree = [...tree, { id: activeCollectionId, type: 'collection', name: translate('data.myCollection'), expanded: true, children: [], environments: [], activeEnvironmentId: null }]
      }

      const parent = parentId ?? containerFor(tree, s.selectedNodeId, activeCollectionId)
      if (type === 'request') {
        // The node id and the document id were both `request-${Date.now()}` in the
        // same tick, so they came out identical — a latent collision between tree
        // identity and document key. They are now distinct by construction.
        const nodeId = `node-${stamp}`
        const requestId = `request-${stamp}`
        const doc: RequestDocument = {
          id: requestId,
          kind: 'http',
          // Named in the app's language and then stored as ordinary user data, which is
          // what it is: switching language later does not rename anything that exists,
          // because by then the name is content and not copy.
          name: name?.trim() || translate('data.newRequest'),
          method: 'GET',
          // Empty rather than a `https://` stub: the input's placeholder already
          // shows the expected shape, and a prefilled scheme has to be deleted
          // before a pasted URL will go in.
          url: '',
          params: [{ id: `${requestId}-p`, enabled: true, key: '', value: '', description: '' }],
          headers: [{ id: `${requestId}-h`, enabled: true, key: '', value: '', description: '' }],
          // One blank row in each grid, for the same reason params and headers get one:
          // there has to be somewhere to start typing. A form row starts as `text`
          // because that is the half of it that can be filled in without a dialog; the
          // toggle in the row turns it into a file.
          body: {
            type: 'none',
            content: '',
            form: [{ id: `${requestId}-f`, enabled: true, kind: 'text', key: '', value: '', path: '', contentType: '' }],
            urlencoded: [{ id: `${requestId}-u`, enabled: true, key: '', value: '', description: '' }],
            file: { path: '', contentType: '' },
          },
          auth: { type: 'none', token: '', username: '', password: '' },
        }
        return {
          tree: insertNode(tree, parent, { id: nodeId, type, requestId, name: doc.name }),
          documents: { ...s.documents, [requestId]: doc },
          tabs: [...s.tabs, requestId],
          activeId: requestId,
          selectedNodeId: nodeId,
          activeCollectionId,
          recentIds: remember(s.recentIds, requestId),
        }
      }
      const id = `${type}-${stamp}`
      // Two literals where there used to be one. Only a collection carries environments,
      // and spelling both out is what makes a folder that carries them unrepresentable
      // rather than merely unwritten — the same split `StoredNode` now makes on disk.
      const shared = { id, name: name?.trim() || translate(type === 'collection' ? 'data.newCollection' : 'data.newFolder'), expanded: true, children: [] }
      const child: TreeNode =
        type === 'collection' ? { ...shared, type: 'collection', environments: [], activeEnvironmentId: null } : { ...shared, type: 'folder' }
      return {
        // A collection is always a root node, whatever happens to be selected —
        // nesting one inside a folder would hide it from the rail.
        tree: insertNode(tree, type === 'collection' ? undefined : parent, child),
        selectedNodeId: type === 'collection' ? null : id,
        // A new collection becomes the one you are looking at, so the panel is not
        // still showing the previous one's contents under its name.
        activeCollectionId: type === 'collection' ? id : activeCollectionId,
      }
    }),

  renameNode: (nodeId, name) =>
    set(s => {
      let requestId: string | undefined
      const tree = mapTree(s.tree, n => {
        if (n.id !== nodeId) return n
        if (n.type === 'request') requestId = n.requestId
        return { ...n, name }
      })
      return { tree, documents: requestId ? { ...s.documents, [requestId]: { ...s.documents[requestId], name } } : s.documents }
    }),

  // Used to touch only `tree` and `selectedNodeId`, which left the deleted request's
  // document, tab and stored response behind — you could keep editing a tab backed by
  // a document that no longer existed anywhere in the tree. Deleting a folder now
  // prunes every request beneath it, because `requestIdsIn` walks the subtree the
  // same way `removeNode` drops it.
  deleteNode: nodeId =>
    set(s => {
      const target = findNode(s.tree, nodeId)
      const removed = target ? requestIdsIn(target) : []
      const documents = { ...s.documents }
      const responses = { ...s.responses }
      const bodyViews = { ...s.bodyViews }
      const requestPanels = { ...s.requestPanels }
      const responsePanels = { ...s.responsePanels }
      removed.forEach(id => {
        delete documents[id]
        delete responses[id]
        delete bodyViews[id]
        delete requestPanels[id]
        delete responsePanels[id]
      })
      const index = s.activeId ? s.tabs.indexOf(s.activeId) : -1
      const tabs = s.tabs.filter(tab => !removed.includes(tab))
      const activeId = s.activeId && removed.includes(s.activeId) ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : s.activeId

      const tree = removeNode(s.tree, nodeId)
      // Deleting the collection you were looking at has to leave the rail pointing
      // somewhere, or the panel renders under a name that no longer exists.
      const collections = collectionsIn(tree)
      const activeCollectionId =
        s.activeCollectionId && collections.some(c => c.id === s.activeCollectionId) ? s.activeCollectionId : (collections[0]?.id ?? null)

      // Was only cleared when the selection *was* the deleted node, so deleting a
      // folder left `selectedNodeId` pointing inside the subtree that just went
      // away — a dangling id that `containerFor` would then resolve against.
      const selectedNodeId = s.selectedNodeId && findNode(tree, s.selectedNodeId) ? s.selectedNodeId : null

      return {
        tree,
        documents,
        responses,
        bodyViews,
        requestPanels,
        responsePanels,
        tabs,
        activeId,
        activeCollectionId,
        selectedNodeId,
        recentIds: s.recentIds.filter(recent => !removed.includes(recent)),
        // Same rule as closing a tab, against the pruned tree and the already
        // validated ids: follow the request that took over, and only then — deleting
        // an unrelated folder must not yank the selection across the panel.
        ...(activeId === s.activeId ? {} : revealPatch(tree, activeId, selectedNodeId, activeCollectionId)),
      }
    }),

  /**
   * Reveal a request without activating it — the palette's "Reveal in sidebar".
   *
   * The palette's other two paths used to call this straight after `setActive` /
   * `openRequest`; they no longer need to, because those actions reveal on their own.
   */
  revealNode: requestId => set(s => revealPatch(s.tree, requestId, s.selectedNodeId, s.activeCollectionId)),

  setRequestPanel: (id, panel) => set(s => ({ requestPanels: { ...s.requestPanels, [id]: panel } })),
  setResponsePanel: (id, panel) => set(s => ({ responsePanels: { ...s.responsePanels, [id]: panel } })),
  setResponse: (id, response) => set(s => ({ responses: { ...s.responses, [id]: response } })),
  // Merged over the default rather than over the stored entry alone, so setting one
  // field on a request that has never been touched still yields a whole `BodyView`.
  setBodyView: (id, patch) => set(s => ({ bodyViews: { ...s.bodyViews, [id]: { ...DEFAULT_BODY_VIEW, ...s.bodyViews[id], ...patch } } })),

  setSidebarWidth: width => set({ sidebarWidth: Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)) }),
  toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSplitOrientation: splitOrientation => set({ splitOrientation }),
  toggleSplitOrientation: () => set(s => ({ splitOrientation: s.splitOrientation === 'rows' ? 'columns' : 'rows' })),
  setSplitRatio: ratio => set({ splitRatio: Math.min(SPLIT_RATIO.max, Math.max(SPLIT_RATIO.min, ratio)) }),
  // Stepping lives here rather than in the stepper for the same reason the split toggle
  // does: three surfaces call it — the buttons, the keyboard and the palette.
  setZoom: zoom => set({ zoom: Math.min(ZOOM.max, Math.max(ZOOM.min, zoom)) }),
  zoomIn: () => set(s => ({ zoom: stepZoom(s.zoom, 1) })),
  zoomOut: () => set(s => ({ zoom: stepZoom(s.zoom, -1) })),
  resetZoom: () => set({ zoom: ZOOM.default }),
  // No `increase`/`decrease`/`reset` beside it, unlike the zoom: those exist because three
  // surfaces step the zoom, while this has one. The stepper does the arithmetic and lets
  // the clamp here be the only thing that decides what is in range.
  setCodeFontSize: size => set({ codeFontSize: Math.min(CODE_FONT_SIZE.max, Math.max(CODE_FONT_SIZE.min, size)) }),
  setTheme: theme => set({ theme }),
  setLanguage: language => set({ language }),
  setDefaultBodyLanguage: defaultBodyLanguage => set({ defaultBodyLanguage }),
  setDefaultRedactSecrets: defaultRedactSecrets => set({ defaultRedactSecrets }),
  // One `set` is the whole feature: `initTheme`, `initLanguage`, `initZoom` and
  // `initCodeFontSize` are all subscribed and push their own field onto the document,
  // `App.tsx` reads the layout fields at render, and the autosave subscriber rewrites
  // `ui.json`. Nothing here has to know about any of that.
  resetSettings: () => set(SETTINGS_DEFAULTS),
  openPalette: (seed = '') => set({ paletteOpen: true, paletteSeed: seed }),
  closePalette: () => set({ paletteOpen: false, paletteSeed: '' }),
  // The query and its two options survive a close, so reopening with Ctrl+F puts back
  // what you were looking for — which is what every editor does and what makes the
  // shortcut worth pressing twice.
  setResponseSearch: patch => set(s => ({ responseSearch: { ...s.responseSearch, ...patch } })),
  /**
   * Clears `updateDismissed` as well: every phase change is worth surfacing, so a
   * download that starts or a failure that lands re-opens the modal even if the
   * previous phase had been closed.
   */
  setUpdate: update => set({ update, updateDismissed: false }),
  /**
   * Hides the modal without forgetting the update, so the sidebar footer can go on
   * offering it. Nothing is persisted — the next launch checks again anyway.
   */
  dismissUpdate: () => set({ updateDismissed: true }),
  reopenUpdate: () => set({ updateDismissed: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openEnvironments: collectionId => set({ environmentsFor: collectionId }),
  closeEnvironments: () => set({ environmentsFor: null }),
  openCode: () => set({ codeOpen: true }),
  closeCode: () => set({ codeOpen: false }),
  setCodeTarget: codeTarget => set({ codeTarget }),
  addEnvironment: (collectionId, id, name) =>
    set(s => ({
      tree: mapCollection(s.tree, collectionId, collection => ({
        ...collection,
        // A blank variable comes with it: never a bare column header, the rule
        // `readFormRows` and `parseParams` both state.
        environments: [...collection.environments, { id, name: name?.trim() || translate('data.newEnvironment'), variables: [freshVariable()] }],
      })),
    })),

  renameEnvironment: (collectionId, id, name) => set(s => ({ tree: mapEnvironment(s.tree, collectionId, id, env => ({ ...env, name })) })),

  /**
   * Rows get fresh ids: the copy is a different environment, and two grids sharing a
   * React key would destroy and rebuild an editor across the switch.
   *
   * Locked values are whatever is in memory. With a reachable credential store those are
   * the real ones and the next save writes fresh entries under the new id; without one
   * they are empty, and the copy is honest about it.
   */
  duplicateEnvironment: (collectionId, id, nextId) =>
    set(s => ({
      tree: mapCollection(s.tree, collectionId, collection => {
        const source = collection.environments.find(env => env.id === id)
        if (!source) return collection
        const copy: Environment = {
          id: nextId,
          name: translate('data.copyOf', { name: source.name }),
          variables: source.variables.map(variable => ({ ...variable, id: crypto.randomUUID() })),
        }
        return { ...collection, environments: [...collection.environments, copy] }
      }),
    })),

  /**
   * The pick falls to *none*, never to the next survivor — the opposite of what
   * `deleteNode` does with collections, and deliberately so. A collection is a place to
   * look, so promoting one costs nothing. An environment is a host and a set of
   * credentials, and promoting one would send the next request somewhere never chosen.
   * `readTree` applies the same rule to a stale id on disk.
   *
   * Nothing is pruned from the credential store here. The departed keys were in the
   * previous save's `keep` list, so the next save names them once more and Go deletes
   * them — the mechanism a deleted request's token already rides on.
   */
  deleteEnvironment: (collectionId, id) =>
    set(s => ({
      tree: mapCollection(s.tree, collectionId, collection => ({
        ...collection,
        environments: collection.environments.filter(env => env.id !== id),
        activeEnvironmentId: collection.activeEnvironmentId === id ? null : collection.activeEnvironmentId,
      })),
    })),

  setEnvironmentVariables: (collectionId, id, variables) => set(s => ({ tree: mapEnvironment(s.tree, collectionId, id, env => ({ ...env, variables })) })),

  // Validated against the collection's own list rather than trusted, so no call site can
  // point a collection at an environment belonging to another one. `null` is a real value
  // and not an absence: the field exists whether or not anything is picked.
  setActiveEnvironment: (collectionId, id) =>
    set(s => ({
      tree: mapCollection(s.tree, collectionId, collection => ({
        ...collection,
        activeEnvironmentId: id && collection.environments.some(env => env.id === id) ? id : null,
      })),
    })),

  askConfirm: confirm => set({ confirm }),
  closeConfirm: () => set({ confirm: null }),
  runConfirm: () => {
    const intent = get().confirm
    if (!intent) return
    // Cleared before the action runs, not after: both actions re-enter the subscribers
    // that autosave and re-render, and none of them should see a question that has
    // already been answered.
    set({ confirm: null })
    switch (intent.kind) {
      case 'deleteNode':
        get().deleteNode(intent.nodeId)
        return
      case 'deleteEnvironment':
        get().deleteEnvironment(intent.collectionId, intent.environmentId)
        return
      case 'resetSettings':
        get().resetSettings()
        return
      default: {
        // Not reachable: the switch above covers ConfirmIntent. This exists so that
        // adding a member without a branch fails to compile rather than shipping a
        // confirm button that does nothing.
        const exhaustive: never = intent
        return exhaustive
      }
    }
  },
}))

/**
 * `base?query#hash`, split once so the two directions of the URL/params sync cannot
 * disagree about where the query starts. `replaceQuery` writes rows into a URL and
 * `parseParams` reads them back out; both go through here.
 *
 * `replaceQuery` itself lives in `template.ts`, which imports this — the encoder has to
 * sit beside `resolveUrl`, the decoder it must agree with, and the dependency only runs
 * one way. Do not import from `template.ts` here: that closes the cycle.
 *
 * The fragment wins: `?a=1` after a `#` is part of the fragment, not the query.
 */
export const splitUrl = (url: string): { base: string; query: string; hash: string } => {
  const hashAt = url.indexOf('#')
  const hash = hashAt >= 0 ? url.slice(hashAt) : ''
  const clean = hashAt >= 0 ? url.slice(0, hashAt) : url
  const queryAt = clean.indexOf('?')
  return queryAt >= 0 ? { base: clean.slice(0, queryAt), query: clean.slice(queryAt + 1), hash } : { base: clean, query: '', hash }
}

/**
 * A blank grid row. Here rather than beside the grid that renders one, because a file
 * that exports both a component and a helper breaks Fast Refresh for everything
 * importing it.
 */
export const freshRow = (): KeyValueRow => ({ id: crypto.randomUUID(), enabled: true, key: '', value: '', description: '' })

/**
 * A blank environment variable. `freshRow`'s neighbour, for the same Fast Refresh reason.
 *
 * A UUID and not `env-${Date.now()}`: `addNode` already carries a comment about
 * `node-${Date.now()}` and `request-${Date.now()}` colliding in the same tick, and
 * `duplicateEnvironment` mints a second id in the same gesture as the first. The same
 * applies to the environment ids the dialog mints — a collision there would alias two
 * credentials, and a UUID kills the class without a uniqueness check anywhere.
 */
export const freshVariable = (): EnvironmentVariable => ({ id: crypto.randomUUID(), enabled: true, key: '', value: '', secret: false })

export const methodOptions: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
