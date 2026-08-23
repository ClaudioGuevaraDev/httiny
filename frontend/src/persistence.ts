import { Service as WorkspaceService } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/workspace'
import { collectionsIn, revealPatch, useAppStore } from './store'
import type { RequestDocument, TreeNode } from './types'
import type { WorkspaceState } from './workspaceFile'
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

type Writer = { schedule: (payload: string) => void; flush: () => void }

function createWriter(write: (payload: string) => Promise<void>, debounceMs: number, maxWaitMs: number): Writer {
  let timer: number | undefined
  let firstDirtyAt = 0
  let pending: string | null = null

  const run = () => {
    timer = undefined
    firstDirtyAt = 0
    const payload = pending
    if (payload === null) return
    pending = null
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
    schedule(payload) {
      pending = payload
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
  }
}

const workspaceWriter = createWriter(payload => WorkspaceService.SaveWorkspace(payload, WORKSPACE_VERSION), WORKSPACE_DEBOUNCE_MS, WORKSPACE_MAX_WAIT_MS)
const prefsWriter = createWriter(payload => WorkspaceService.SavePrefs(payload, PREFS_VERSION), PREFS_DEBOUNCE_MS, 0)

/** Requests whose credentials belong in the OS credential store. */
const secretsOf = (documents: Record<string, RequestDocument>) =>
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
const environmentSecretsOf = (tree: TreeNode[]) => {
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
 * Installs the autosave subscriber. Called only on the success path of `hydrate`,
 * which is what stops a failed or slow load from writing an empty workspace over a
 * real one.
 */
function installAutosave(): void {
  let lastWorkspace = JSON.stringify(toWorkspaceFile(useAppStore.getState()))
  let lastPrefs = JSON.stringify(toPrefsFile(useAppStore.getState()))
  // Seeded from the just-hydrated state, so the first edit to anything else does
  // not look like a credential change and rewrite the keychain for nothing.
  lastSecrets = secretsSignature(useAppStore.getState().documents, useAppStore.getState().tree)
  lastKeep = secretKeysOf(useAppStore.getState().documents, useAppStore.getState().tree)

  useAppStore.subscribe((state, prev) => {
    if (WORKSPACE_KEYS.some(key => state[key] !== prev[key])) {
      const next = JSON.stringify(toWorkspaceFile(state))
      // Serialise and compare rather than trusting reference inequality:
      // `toggleNode` rebuilds `tree` but only changes `expanded`, which is a prefs
      // field, so expanding a folder must not rewrite the file holding your
      // collections. It also makes edit-then-undo a no-op.
      if (next !== lastWorkspace) {
        lastWorkspace = next
        workspaceWriter.schedule(next)
      }
      // `tree` as well as `documents`, because a locked variable's value lives on a
      // collection node. It is inside the `WORKSPACE_KEYS` branch, so a prefs-only change
      // never reaches it.
      if (state.documents !== prev.documents || state.tree !== prev.tree) scheduleSecrets(state.documents, state.tree)
    }

    const nextPrefs = JSON.stringify(toPrefsFile(state))
    if (nextPrefs !== lastPrefs) {
      lastPrefs = nextPrefs
      prefsWriter.schedule(nextPrefs)
    }
  })

  // `run()` calls setSaveState, which re-enters this subscriber. That is safe only
  // because `saveState` is not part of either DTO, so both comparisons come back
  // equal and nothing is scheduled. Adding it to `toPrefsFile` would turn this into
  // an infinite write loop.
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

    // Locked variables ride along in the same call — one round trip on the startup path,
    // which is why `LoadSecrets` takes a list at all. The key set is built from
    // `environmentSecretKey` rather than by parsing an id back apart, so a document whose
    // id was hand-edited to start with `env:` cannot claim a variable's value.
    const variableKeys = new Set<string>()
    for (const collection of collectionsIn(loaded.tree)) {
      for (const env of collection.environments) {
        for (const variable of env.variables) {
          const key = variable.key.trim()
          if (variable.secret && key) variableKeys.add(environmentSecretKey(collection.id, env.id, key))
        }
      }
    }

    let secretsAvailable = false
    if (withAuth.length || variableKeys.size) {
      const result = await WorkspaceService.LoadSecrets([...withAuth.map(doc => doc.id), ...variableKeys])
      secretsAvailable = result.available
      const values = new Map<string, string>()
      for (const secret of result.secrets ?? []) {
        // Variables first: those ids are ours and a document cannot shadow one.
        if (variableKeys.has(secret.id)) {
          values.set(secret.id, secret.token)
          continue
        }
        const doc = loaded.documents[secret.id]
        if (doc) loaded.documents[secret.id] = { ...doc, auth: { ...doc.auth, token: secret.token, password: secret.password } }
      }
      if (values.size) {
        // A root-level `map`, not `mapTree`: collections are always roots, and rebuilding
        // every node would leave nothing with a shared identity for `revealPatch` and the
        // autosave guard to compare against.
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
