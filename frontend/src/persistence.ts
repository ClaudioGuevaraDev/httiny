import { Service as WorkspaceService } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/workspace'
import type { Secret } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/workspace/models'
import { collectionsIn, revealPatch, useAppStore } from './store'
import type { RequestDocument, TreeNode } from './types'
import type { PrefsSource, WorkspaceState } from './workspaceFile'
import type { LoadedWorkspace, PreparedImport } from './workspaceFile'
import {
  PREFS_VERSION,
  WORKSPACE_VERSION,
  environmentSecretKey,
  legacySecretKeys,
  readCollapsed,
  readPrefs,
  readWorkspace,
  toPrefsFile,
  toWorkspaceFile,
} from './workspaceFile'

/**
 * Disk persistence: hydrate once at startup, then autosave.
 *
 * Deliberately not zustand's `persist` middleware. That is shaped around a
 * synchronous localStorage-like store, and it cannot express two files with
 * different debounce windows, a separate credential store, or a load that must
 * complete before the first render.
 */

// A trailing debounce alone never fires while a key is held down in the body
// editor, so the ceiling bounds how much continuous typing a hard kill can cost.
const WORKSPACE_DEBOUNCE_MS = 600
const WORKSPACE_MAX_WAIT_MS = 2000
// Layout changes come from pointer drags, which end on their own.
const PREFS_DEBOUNCE_MS = 400
// A hung IPC should degrade to an in-memory session, not an app that never paints.
const HYDRATE_TIMEOUT_MS = 2000

type Writer = {
  /**
   * Queues a write. Takes a **thunk**, not a payload: the debounce exists because
   * writing on every keystroke is too much, and serialising on every keystroke was too
   * much for exactly the same reason. `build` runs once, in `run()`, so a forty-character
   * burst pays one whole-workspace `JSON.stringify` instead of forty.
   */
  schedule: (build: () => string) => void
  flush: () => void
  /** Seeds the "already on disk" payload at hydration, so the first edit is not a rewrite. */
  seed: (payload: string) => void
}

function createWriter(write: (payload: string) => Promise<void>, debounceMs: number, maxWaitMs: number): Writer {
  let timer: number | undefined
  let firstDirtyAt = 0
  let pending: (() => string) | null = null
  /**
   * The last payload this writer put on disk, compared against before every write.
   *
   * Held here rather than beside the subscriber because the comparison has to happen
   * where the serialisation does. It is what keeps `toggleNode` from rewriting
   * `workspace.json` — it rebuilds `tree`, but only changes `expanded`, which is a prefs
   * field — and what makes edit-then-undo a no-op.
   */
  let lastWritten = ''
  /** Whether anything has ever been written, so the no-op path can settle honestly. */
  let written = false

  const run = () => {
    timer = undefined
    firstDirtyAt = 0
    const build = pending
    if (build === null) return
    pending = null
    const payload = build()
    if (payload === lastWritten) {
      // Nothing to write, but `schedule` already announced 'pending'. Settling it here is
      // what stops the footer sitting on "Saving…" forever after a change that serialised
      // to the same bytes — a locked variable's value, or an edit and its undo.
      useAppStore.getState().setSaveState(written ? 'saved' : 'idle')
      return
    }
    lastWritten = payload
    written = true
    useAppStore.getState().setSaveState('saving')
    write(payload).then(
      () => useAppStore.getState().setSaveState('saved'),
      (error: unknown) => {
        console.error('[persistence] write failed', error)
        useAppStore.getState().setSaveState('error')
      },
    )
  }

  return {
    schedule(build) {
      pending = build
      const now = Date.now()
      if (!firstDirtyAt) firstDirtyAt = now
      if (timer !== undefined) clearTimeout(timer)
      const wait = maxWaitMs > 0 ? Math.min(debounceMs, Math.max(0, firstDirtyAt + maxWaitMs - now)) : debounceMs
      timer = window.setTimeout(run, wait)
      useAppStore.getState().setSaveState('pending')
    },
    flush() {
      if (timer !== undefined) clearTimeout(timer)
      run()
    },
    seed(payload) {
      lastWritten = payload
    },
  }
}

const workspaceWriter = createWriter(payload => WorkspaceService.SaveWorkspace(payload, WORKSPACE_VERSION), WORKSPACE_DEBOUNCE_MS, WORKSPACE_MAX_WAIT_MS)
const prefsWriter = createWriter(payload => WorkspaceService.SavePrefs(payload, PREFS_VERSION), PREFS_DEBOUNCE_MS, 0)

/** Requests whose credentials belong in the OS credential store. */
export const secretsOf = (documents: Record<string, RequestDocument>) =>
  Object.values(documents)
    .filter(doc => doc.auth.type !== 'none' && (doc.auth.token || doc.auth.password))
    .map(doc => ({ id: doc.id, token: doc.auth.token, password: doc.auth.password }))

/**
 * The environment variables the user locked, one credential entry per variable.
 *
 * Per variable and not one blob per environment: `secrets.Set` rejects a marshalled entry
 * over 2560 bytes and a blob would be doubly encoded, so one oversized value would fail
 * the write for every secret in that environment at once — reported only in
 * `SecretsResult.error`, which nothing surfaces per row. Per variable the cap is spent on
 * one credential and a failure is isolated. It is also what lets the `keep` sweep name a
 * single renamed variable.
 *
 * The value goes in `token` and `password` stays empty. `Entry.Empty()` is both fields
 * blank, so clearing a value deletes the entry without Go needing to know what this is —
 * which is why environments need no Go change at all.
 *
 * Not filtered on `enabled`: unticking a row is not deleting it, and the value has to come
 * back when it is ticked again. `secretsIn` in `environments.ts` *does* filter, because a
 * mask for a value that is not being substituted would blank a snippet for nothing.
 *
 * A `Map`, so two rows typed with the same key write one entry instead of racing. Last
 * wins, which is the rule `variableMap` applies to the same collision.
 */
export const environmentSecretsOf = (tree: TreeNode[]) => {
  const entries = new Map<string, { id: string; token: string; password: string }>()
  for (const collection of collectionsIn(tree)) {
    for (const env of collection.environments) {
      for (const variable of env.variables) {
        const key = variable.key.trim()
        if (!variable.secret || !key || !variable.value) continue
        const id = environmentSecretKey(collection.id, env.id, key)
        entries.set(id, { id, token: variable.value, password: '' })
      }
    }
  }
  return [...entries.values()]
}

/**
 * Every id the credential store is reconciled against.
 *
 * The environment half names only the **locked** variables. That is deliberately narrower
 * than naming every keyed one so that taking a lock off would delete the credential:
 * `lastKeep` already does that job, and for free — an unlocked-just-now variable was in
 * the previous save's list, so the next save names it once more and Go deletes it. Naming
 * them all instead would put one `keyring.Delete` per unlocked row into every save, a
 * D-Bus round trip each on Linux, and would fire that whole pass whenever an *unlocked*
 * key was retyped.
 */
const secretKeysOf = (documents: Record<string, RequestDocument>, tree: TreeNode[]) => [
  ...Object.keys(documents),
  ...collectionsIn(tree).flatMap(collection =>
    collection.environments.flatMap(env =>
      env.variables.filter(v => v.secret && v.key.trim()).map(v => environmentSecretKey(collection.id, env.id, v.key.trim())),
    ),
  ),
]

let secretsTimer: number | undefined
let lastSecrets = ''
/**
 * The ids handed to the previous save, union'd into the next `keep`.
 *
 * `SaveSecrets` iterates `keep` and deletes the ids in it that were not written; it
 * never enumerates the store, because `go-keyring` has no cross-platform way to. So an
 * id that leaves both lists at once — a deleted request — would otherwise keep its
 * credential forever. Naming it once more is the only way to reach it.
 */
let lastKeep: string[] = []
/**
 * Set when a load came back with an error beside its entries.
 *
 * `LoadSecrets` skips an entry it could not read and reports it, so the in-memory
 * picture is incomplete — and the next save would see that entry in `keep`, absent from
 * the written set, and delete it for looking empty. While this is set the destructive
 * half of the save is switched off for the session.
 */
let secretsReadFailed = false

/**
 * Only touches the credential store when the credentials themselves changed.
 *
 * Without the signature check every keystroke in the URL bar would queue a write to
 * Credential Manager / Keychain, which is far more expensive than a file write and
 * has nothing to do with what was edited. The id list is part of the signature
 * because deleting a request also has to delete its entry.
 *
 * `tree` joined it when environments did, which means a folder expand recomputes this. The
 * cost is one `JSON.stringify` over the secret set that then returns early on equality —
 * strictly smaller than the whole-workspace `stringify` the same subscriber already does
 * on that same transition.
 */
const secretsSignature = (documents: Record<string, RequestDocument>, tree: TreeNode[]) =>
  JSON.stringify([secretsOf(documents), environmentSecretsOf(tree), secretKeysOf(documents, tree).sort()])

/**
 * Whether a transition can possibly have moved a credential, in pointer comparisons.
 *
 * Exact rather than heuristic, and that is what makes it safe to put in front of
 * `secretsSignature`: the three functions behind that signature read exactly four things —
 * the key set of `documents`, each document's `auth` object, the ids of the root
 * collections, and each collection's `environments` array. If none of those moved, all
 * three return the same values and the signature cannot differ. The converse is not
 * claimed; an identity that changed without its content changing simply falls through to
 * the signature, which still returns early on equality.
 *
 * It exists because the signature was three full traversals, a sort and a `JSON.stringify`
 * on **every** `documents` or `tree` change — so every keystroke in a URL, a body or a
 * header paid for it before being rejected. Its own doc comment said as much about a
 * folder expand.
 */
const authShapeUnchanged = (next: Record<string, RequestDocument>, prev: Record<string, RequestDocument>): boolean => {
  if (next === prev) return true
  const keys = Object.keys(next)
  if (keys.length !== Object.keys(prev).length) return false
  return keys.every(key => prev[key] !== undefined && prev[key].auth === next[key].auth)
}

/**
 * The `environments` **array** and not the collection node, deliberately.
 *
 * `setActiveEnvironment` mints a new collection object around the same array, and the
 * pick is not a credential — comparing the node would send every environment switch to
 * the full signature for nothing.
 *
 * Order-sensitive across the root collections, which is safe in the direction it can
 * fail: nothing reorders roots today, and a reorder that preserved every id and every
 * array would have changed no credential anyway, so the worst case is a false *negative*
 * that falls through to the signature. A future move or reorder feature must not "fix"
 * this into the other direction.
 */
const environmentShapeUnchanged = (next: TreeNode[], prev: TreeNode[]): boolean => {
  if (next === prev) return true
  const a = collectionsIn(next)
  const b = collectionsIn(prev)
  return a.length === b.length && a.every((collection, i) => collection.id === b[i].id && collection.environments === b[i].environments)
}

const credentialsUnchanged = (state: WorkspaceState, prev: WorkspaceState): boolean =>
  authShapeUnchanged(state.documents, prev.documents) && environmentShapeUnchanged(state.tree, prev.tree)

/**
 * The write itself, split out so `flushSecrets` can run it without waiting.
 *
 * Holds the arguments of the pending write rather than reading the store, because the
 * debounce exists to write what was there when it was scheduled — and `flushNow` must not
 * turn a queued deletion into a write of some later state.
 */
let pendingSecrets: (() => void) | null = null

function scheduleSecrets(documents: Record<string, RequestDocument>, tree: TreeNode[]) {
  const signature = secretsSignature(documents, tree)
  if (signature === lastSecrets) return
  lastSecrets = signature

  pendingSecrets = () => {
    const live = secretKeysOf(documents, tree)
    const keep = secretsReadFailed ? [] : [...new Set([...lastKeep, ...live])]
    lastKeep = live
    void WorkspaceService.SaveSecrets([...secretsOf(documents), ...environmentSecretsOf(tree)], keep).then(result => {
      if (result.error) console.warn('[persistence] credential store:', result.error)
      useAppStore.getState().setSecretsAvailable(result.available)
    })
  }

  if (secretsTimer !== undefined) clearTimeout(secretsTimer)
  // Slower than the workspace write: a credential store round trip is far more
  // expensive than a file write, and nothing reads these back until a restart.
  secretsTimer = window.setTimeout(flushSecrets, 1200)
}

/**
 * Runs the pending credential write now, if there is one.
 *
 * Wired into `flushNow`, which used to flush the two file writers and leave this timer
 * alone. That gap is not cosmetic: `SaveSecrets` is also what *deletes*, so quitting
 * within the debounce of deleting a collection left every one of its variables' entries
 * named by nothing — and `go-keyring` cannot enumerate a store, so an id nobody names is
 * an id nobody can delete. The same hole existed for a deleted request's token; it is
 * simply wider now that a collection can carry twenty credentials.
 *
 * Cheap when idle: with nothing queued there is no timer and no call.
 */
function flushSecrets(): void {
  if (secretsTimer !== undefined) clearTimeout(secretsTimer)
  secretsTimer = undefined
  const run = pendingSecrets
  pendingSecrets = null
  run?.()
}

/**
 * The store fields that belong in `workspace.json`, as a pre-filter on the subscriber
 * below: serialising the whole file on every store change would run on every keystroke.
 *
 * The check under it is the point of the list. A field added to `WorkspaceState` and
 * forgotten here would be written by `toWorkspaceFile` and never reach disk, with
 * nothing to notice; this makes forgetting a compile error instead.
 */
const WORKSPACE_KEYS = ['tree', 'documents'] as const satisfies readonly (keyof WorkspaceState)[]
const workspaceKeysAreComplete: [Exclude<keyof WorkspaceState, (typeof WORKSPACE_KEYS)[number]>] extends [never] ? true : never = true
void workspaceKeysAreComplete

/**
 * The same pre-filter for `ui.json`, and it was missing.
 *
 * `toPrefsFile` used to run on *every* store transition — including the three
 * `setSaveState` calls each save cycle re-enters this subscriber with, every response
 * tick, every panel switch and every keystroke — and it calls `collapsedIn`, which walks
 * the whole tree. None of those can change a preference.
 *
 * `tree` is a member for the reason `PrefsSource` includes it: `collapsedNodeIds` is
 * derived from it, so leaving it out would silently stop persisting folder expansion —
 * and the completeness assertion below could not catch that, because it only checks the
 * list against `PrefsSource`.
 */
const PREFS_KEYS = [
  'tree',
  'tabs',
  'activeId',
  'selectedNodeId',
  'activeCollectionId',
  'recentIds',
  'sidebarWidth',
  'sidebarCollapsed',
  'splitOrientation',
  'splitRatio',
  'theme',
  'language',
  'zoom',
  'codeFontSize',
  'defaultBodyLanguage',
  'defaultRedactSecrets',
] as const satisfies readonly (keyof PrefsSource)[]
const prefsKeysAreComplete: [Exclude<keyof PrefsSource, (typeof PREFS_KEYS)[number]>] extends [never] ? true : never = true
void prefsKeysAreComplete

/**
 * Installs the autosave subscriber. Called only on the success path of `hydrate`,
 * which is what stops a failed or slow load from writing an empty workspace over a
 * real one.
 */
function installAutosave(): void {
  // One read, not six: `getState()` is cheap but the four serialisations below are not,
  // and asking repeatedly invited someone to ask a seventh time in a later edit.
  const initial = useAppStore.getState()
  workspaceWriter.seed(JSON.stringify(toWorkspaceFile(initial)))
  prefsWriter.seed(JSON.stringify(toPrefsFile(initial)))
  // Seeded from the just-hydrated state, so the first edit to anything else does
  // not look like a credential change and rewrite the keychain for nothing.
  lastKeep = secretKeysOf(initial.documents, initial.tree)
  lastSecrets = secretsSignature(initial.documents, initial.tree)

  useAppStore.subscribe((state, prev) => {
    if (WORKSPACE_KEYS.some(key => state[key] !== prev[key])) {
      // Destructured rather than closing over `state`: the thunk is held for up to the
      // debounce ceiling, and a whole state snapshot would pin `responses` — every
      // response body in it — alive for that long.
      const { tree, documents } = state
      workspaceWriter.schedule(() => JSON.stringify(toWorkspaceFile({ tree, documents })))
      // `tree` as well as `documents`, because a locked variable's value lives on a
      // collection node. It is inside the `WORKSPACE_KEYS` branch, so a prefs-only change
      // never reaches it, and behind `credentialsUnchanged` so an ordinary keystroke does
      // not pay for the signature before being rejected by it.
      if (!credentialsUnchanged(state, prev)) scheduleSecrets(documents, tree)
    }

    // A sibling `if` and not nested inside the one above: a prefs-only change — a split
    // drag, a zoom step, a tab activated — still has to be written.
    //
    // This thunk does close over the whole `state`, unlike the one above, because
    // `toPrefsFile` reads sixteen fields and destructuring them here would be a second
    // copy of `PREFS_KEYS` to keep in sync. The retention it costs is bounded by the
    // 400 ms debounce and by one superseded snapshot, which is a different order of
    // problem from pinning every response body for the workspace writer's two seconds.
    if (PREFS_KEYS.some(key => state[key] !== prev[key])) prefsWriter.schedule(() => JSON.stringify(toPrefsFile(state)))
  })

  // `run()` calls setSaveState, which re-enters this subscriber. That is safe only
  // because `saveState` is in neither key list, so both guards fail on their first
  // pointer comparison and nothing is scheduled. The same contract carries `dataDir`,
  // which lands in a `setState` of its own after hydration. Adding either to
  // `toPrefsFile` — and so to `PREFS_KEYS` — would turn this into an infinite write loop.
}

/** Writes everything pending immediately. Wired to Ctrl+S and to window teardown. */
export function flushNow(): void {
  workspaceWriter.flush()
  prefsWriter.flush()
  flushSecrets()
}

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))])

/**
 * Every credential the workspace currently holds, as one list.
 *
 * The export's opt-in is the only caller. It lives here rather than in `transfer.ts`
 * because these are the same two functions the autosave path uses, and a second pair
 * would be a second answer to "what counts as a secret".
 */
export const exportSecrets = (documents: Record<string, RequestDocument>, tree: TreeNode[]): Secret[] => [
  ...secretsOf(documents),
  ...environmentSecretsOf(tree),
]

/**
 * Every credential-store key the locked variables in a tree occupy.
 *
 * Built from `environmentSecretKey` rather than by parsing an id back apart, so a
 * document whose id was hand-edited to start with `env:` cannot claim a variable's value.
 */
export const environmentKeysIn = (tree: TreeNode[]): Set<string> => {
  const keys = new Set<string>()
  for (const collection of collectionsIn(tree)) {
    for (const env of collection.environments) {
      for (const variable of env.variables) {
        const key = variable.key.trim()
        if (variable.secret && key) keys.add(environmentSecretKey(collection.id, env.id, key))
      }
    }
  }
  return keys
}

/**
 * Merges credentials back onto a freshly-read workspace, in place.
 *
 * Extracted from `hydrate` because the import path needs exactly this and a second copy
 * would drift with nothing to catch it — the failure mode CLAUDE.md names for
 * `TEXT_FORMATS` against `byteBacked`.
 *
 * `variableKeys` decides which ids are ours, and it is passed in rather than recomputed
 * so both callers use the set they already built.
 */
function applySecrets(loaded: LoadedWorkspace, secrets: readonly Secret[], variableKeys: ReadonlySet<string>): void {
  const values = new Map<string, string>()
  for (const secret of secrets) {
    // Variables first: those ids are ours and a document cannot shadow one.
    if (variableKeys.has(secret.id)) {
      values.set(secret.id, secret.token)
      continue
    }
    const doc = loaded.documents[secret.id]
    if (doc) loaded.documents[secret.id] = { ...doc, auth: { ...doc.auth, token: secret.token, password: secret.password } }
  }
  if (!values.size) return

  // A root-level `map`, not `mapTree`: collections are always roots, and rebuilding every
  // node would leave nothing with a shared identity for `revealPatch` and the autosave
  // guard to compare against.
  loaded.tree = loaded.tree.map(node =>
    node.type !== 'collection'
      ? node
      : {
          ...node,
          environments: node.environments.map(env => ({
            ...env,
            variables: env.variables.map(variable => {
              const stored = variable.secret ? values.get(environmentSecretKey(node.id, env.id, variable.key.trim())) : undefined
              return stored === undefined ? variable : { ...variable, value: stored }
            }),
          })),
        },
  )
}

/**
 * Loads the workspace before the first render.
 *
 * Rendering afterwards is what keeps the first paint from being an empty workspace
 * that then jumps, and it is why the autosave subscriber can never observe a
 * pre-load state: `hydrate` installs it as its last act. The window paints its
 * BackgroundColour (the same colour as the app shell) until this resolves, so the
 * gap is invisible.
 *
 * This never rejects. A browser dev server has no Wails runtime behind the page, so
 * the binding call fails and the session stays in memory rather than refusing to
 * start.
 */
export async function hydrate(): Promise<void> {
  try {
    const [workspace, prefs] = await withTimeout(Promise.all([WorkspaceService.LoadWorkspace(), WorkspaceService.LoadPrefs()]), HYDRATE_TIMEOUT_MS)

    if (workspace.version > WORKSPACE_VERSION) {
      // A file from a newer build. Parsing what we understand and writing the
      // result back would silently truncate the user's data, so do neither: report
      // it and leave autosave uninstalled.
      useAppStore.setState({ persistenceState: 'newer-version', dataDir: await WorkspaceService.DataDir() })
      return
    }

    const collapsed = prefs.found ? readCollapsed(JSON.parse(prefs.payload)) : []
    const savedWorkspace: unknown = workspace.found ? JSON.parse(workspace.payload) : null
    const loaded = workspace.found ? readWorkspace(savedWorkspace, collapsed) : { tree: [], documents: {} }
    const layout = readPrefs(prefs.found ? JSON.parse(prefs.payload) : {}, loaded.documents, loaded.tree)

    // Credentials come back from the OS store, keyed by request id, so a workspace
    // copied to another machine keeps its requests and simply has no tokens.
    const withAuth = Object.values(loaded.documents).filter(doc => doc.auth.type !== 'none')
    const variableKeys = environmentKeysIn(loaded.tree)

    let secretsAvailable = false
    if (withAuth.length || variableKeys.size) {
      const result = await WorkspaceService.LoadSecrets([...withAuth.map(doc => doc.id), ...variableKeys])
      secretsAvailable = result.available
      applySecrets(loaded, result.secrets ?? [], variableKeys)
      if (result.error) {
        // Not just noise: an entry that could not be read loaded empty, and the next
        // save must not delete it for looking that way. See `secretsReadFailed`.
        secretsReadFailed = true
        console.warn('[persistence] credential store:', result.error)
      }
    } else {
      secretsAvailable = true
    }

    // Do not add `environmentSecretsOf`/`secretKeysOf` to this call. It is a one-shot
    // sweep of the *old* key shape (`env:<environment id>:<variable key>`, three
    // segments), and it is safe precisely because neither list below mentions an
    // environment: it can delete nothing that is live. Naming the new four-segment keys in
    // `keep` without also writing them in `entries` would clear every locked variable's
    // credential on the first launch after an upgrade.
    //
    // Transitional, and goes with `legacySecretKeys`: the 0.31.0 environments feature
    // stored one credential per locked variable, nothing names them any more, and a
    // store that cannot be enumerated cannot be swept later. `SaveSecrets` deletes every
    // id in `keep` it was not asked to write — the same pass that clears a deleted
    // request's token — so one round trip finishes it, and only while a workspace file
    // still carries the field. Skipped after a failed read, the rule the debounced save
    // follows for the same reason.
    const orphans = legacySecretKeys(savedWorkspace)
    if (orphans.length && !secretsReadFailed) {
      const swept = await WorkspaceService.SaveSecrets(secretsOf(loaded.documents), [...Object.keys(loaded.documents), ...orphans])
      if (swept.error) console.warn('[persistence] credential store:', swept.error)
    }

    useAppStore.setState({
      documents: loaded.documents,
      // Spread, not seventeen enumerated fields — and that is a correctness measure, not
      // brevity. `setState` takes a `Partial`, so a preference left out of the list was
      // saved correctly and loaded into nothing, with no type error anywhere: the comment
      // this replaces warned about exactly that for `language`, and the code view's two
      // preferences were then added and silently forgotten, resetting it on every
      // launch. `PrefsState` is defined as "everything readPrefs returns is store
      // state", so a new preference now arrives by existing.
      ...layout,
      // `tree` is explicit rather than arriving with the reveal, which now runs after
      // the autosave subscriber is listening — see the end of this function.
      tree: loaded.tree,
      persistenceState: 'ready',
      secretsAvailable,
      quarantinedPath: workspace.quarantined || null,
      dataDir: await WorkspaceService.DataDir(),
    })
  } catch (error) {
    console.warn('[persistence] unavailable, running in memory:', error)
    useAppStore.setState({ persistenceState: 'unavailable' })
    return
  }

  installAutosave()

  /*
   * Reveal the active request, the way every other writer of `activeId` does — and
   * deliberately *after* `installAutosave`.
   *
   * `readPrefs` validates `activeId`, `selectedNodeId` and `activeCollectionId` one at a
   * time, against the tree and the documents. Each is a live id, and the three together
   * can still disagree — so a launch could show the rail on one collection while the active
   * tab belonged to another, with no row selected. Nothing in the app writes that pair any
   * more, now that the tab strip is scoped and `selectCollection` retargets the active tab
   * instead of leaving it behind; a `ui.json` from a build before that does, and so does
   * one edited by hand. This is what makes reading either harmless.
   *
   * Reconciling them inside the hydration `setState` fixed the screen and nothing else.
   * `installAutosave` seeds `lastPrefs` from the state it finds, so a repair folded into
   * the load was already the baseline and the subscriber saw no change: the file kept its
   * contradiction until some unrelated preference happened to trigger a write, and it is
   * why the wrong collection came back on the next launch and not the one after. Here the
   * repair is a transition the subscriber observes, so it reaches disk. Reading the store
   * rather than the local `loaded`/`layout` copies is the other half — there is then one
   * tree and one `activeId` in play, the pair actually committed.
   *
   * Still before `createRoot`, so nothing ever paints the unreconciled state, and a
   * workspace with no restored tab comes back from `revealPatch` unchanged and schedules
   * no write.
   */
  const hydrated = useAppStore.getState()
  useAppStore.setState(revealPatch(hydrated.tree, hydrated.activeId, hydrated.selectedNodeId, hydrated.activeCollectionId))

  // Best effort, not a guarantee: the IPC message is usually delivered before
  // teardown, but nothing promises the reply arrives. The 2s ceiling above is the
  // actual bound on what a hard kill can cost.
  window.addEventListener('beforeunload', flushNow)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow()
  })
}

/**
 * Reads an import through the same validators `hydrate` uses and resolves its
 * credentials, so the result can be committed to the store in one `setState`.
 *
 * Deliberately **not** `hydrate` again: a second call would install a second autosave
 * subscriber, so every later change would be serialised and written twice, and would
 * re-add the `beforeunload` and `visibilitychange` listeners. "Just call hydrate again"
 * is the obvious refactor and it is wrong.
 *
 * `secrets` distinguishes three cases, and the difference is load-bearing:
 *
 * - **`undefined`** — the file was exported without credentials, so every token in it is
 *   the empty string `readDocument` and `readVariables` force. Committing that as-is
 *   would have the next autosave name every imported id in `keep` while writing none of
 *   them, and `SaveSecrets` deletes exactly that set. On a re-import of your own backup
 *   those ids are the *live* ones, and `go-keyring` cannot enumerate a store, so the
 *   tokens would be gone for good. So the store is read back for the incoming ids and
 *   whatever still exists is merged on: restoring your own export becomes idempotent,
 *   and only what genuinely no longer exists is swept.
 * - **`[]`** — credentials were included and there were none. Nothing is read back;
 *   the file is the whole answer.
 * - **a list** — the file is authoritative, for the same reason.
 */
export async function prepareImport(
  workspacePayload: unknown,
  prefsPayload: unknown,
  secrets: readonly Secret[] | undefined,
): Promise<PreparedImport> {
  const collapsed = readCollapsed(prefsPayload)
  const loaded: LoadedWorkspace = readWorkspace(workspacePayload, collapsed)
  const variableKeys = environmentKeysIn(loaded.tree)

  if (secrets) {
    applySecrets(loaded, secrets, variableKeys)
  } else {
    const withAuth = Object.values(loaded.documents).filter(doc => doc.auth.type !== 'none')
    if (withAuth.length || variableKeys.size) {
      const result = await WorkspaceService.LoadSecrets([...withAuth.map(doc => doc.id), ...variableKeys])
      applySecrets(loaded, result.secrets ?? [], variableKeys)
      useAppStore.getState().setSecretsAvailable(result.available)
      if (result.error) {
        // The same rule the load path follows: an entry that could not be read looks
        // empty, and the next save must not delete it for looking that way.
        secretsReadFailed = true
        console.warn('[persistence] credential store:', result.error)
      }
    }
  }

  return {
    tree: loaded.tree,
    documents: loaded.documents,
    // `readPrefs` needs the imported tree and documents, which is why it runs last: it
    // validates `tabs`, `activeId`, `selectedNodeId` and `activeCollectionId` against
    // them and drops whatever no longer resolves.
    layout: readPrefs(prefsPayload, loaded.documents, loaded.tree),
    summary: {
      collections: collectionsIn(loaded.tree).length,
      requests: Object.keys(loaded.documents).length,
      // Whether the **file** brought credentials, not whether the result has any. The
      // recovery branch above fills tokens in from this machine's own store, and telling
      // someone the file carries credentials when it does not would be worse than saying
      // nothing.
      secrets: (secrets?.length ?? 0) > 0,
      stranded: secretsReadFailed,
    },
  }
}
