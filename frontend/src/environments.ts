import { useSyncExternalStore } from 'react'
import { activeEnvironmentOf, collectionInPlay, collectionOf, useAppStore } from './store'
import type { ResolutionState } from './store'
import { IDENTITY, resolverFor, variableMap } from './template'
import type { Resolve } from './template'
import type { Environment } from './types'

/**
 * The bridge between the store and `template.ts`, the way `language.ts` bridges the store
 * and `i18n/`. `template.ts` stays a pure leaf and this is the one module that knows which
 * environment applies where.
 *
 * The tree-side questions — which collection a request belongs to, and which environment
 * that collection has picked — are answered in `store.ts`, because a store action has to
 * ask them too and this module already imports the store, so the answers cannot live here
 * without closing a cycle. Everything here turns them into a resolver.
 *
 * `environmentSecretKey` is **not** here either: it lives in `workspaceFile.ts`, beside the
 * shapes that decide what is not written to disk, which keeps `persistence.ts` off this
 * module entirely.
 */

// ── Which environment applies ──────────────────────────────────────────────────

/**
 * The environment a **specific** request resolves against, and the send path's only
 * question.
 *
 * No fallback when the request belongs to no collection — the opposite of
 * `collectionInPlay`, and deliberately so. This is the one asymmetry in the design: the
 * interface question falls back to the rail, the send question does not. An unresolved
 * `{{baseUrl}}` is a request that plainly fails and says which name is missing; borrowing
 * whatever the rail happens to be showing would point a send at another server's
 * credentials, which is the same reason `deleteEnvironment` falls to none rather than
 * promoting a survivor.
 */
export const environmentFor = (state: ResolutionState, requestId: string | undefined): Environment | undefined =>
  activeEnvironmentOf(requestId ? collectionOf(state, requestId) : null)

/** The environment the *interface* is pointed at — the active request's collection, else the rail's. */
export const environmentInPlay = (state: ResolutionState): Environment | undefined => activeEnvironmentOf(collectionInPlay(state))

/**
 * The resolver for one request, read at call time.
 *
 * `getState()` rather than a captured snapshot, the rule `runRequest` and `Command.run`
 * already state: the send happens after whatever the user did between opening the editor
 * and pressing Enter.
 */
export const resolveFor = (requestId: string): Resolve => {
  const environment = environmentFor(useAppStore.getState(), requestId)
  return environment ? resolverFor(variableMap(environment.variables)) : IDENTITY
}

/**
 * Fires when the *resolution* changes — a different environment picked for the collection
 * in play, the active tab moved to a request in another collection, a row retyped — and
 * never for anything else in the store.
 *
 * Two clauses, where the workspace-global design needed three, and dropping one is what
 * node-owned environments buy.
 *
 * The **identity** clause is load-bearing: without it `setBody`, which fires on every
 * keystroke in the body, would reach the listener, and the listener dispatches into the
 * very view that is mid-update. Every field the resolution reads is named here, which is
 * what `ResolutionState` is for: this list and that type disagreeing is the bug to watch
 * for.
 *
 * The **derived** clause compares the resolved `Environment` object, and that single
 * comparison covers three cases at once: a retyped row (`setEnvironmentVariables` rebuilds
 * the object), a switched pick, and a tab that moved to another collection. It rejects a
 * folder expand for free, because `updateNode` copies a collection node as `{ ...node }` and
 * the `Environment` inside it is the same object — the invariant `CollectionNode`'s doc
 * comment states, and the reason an `updateNode` callback must never rebuild one from its
 * parts. A pool with an identity of its own needed a third clause for the first case and
 * could not use `tree` for the last.
 *
 * `previous` is asked before `state` so the tree cache behind `collectionOf` is left warm
 * on the current tree, which is what every later listener in the same notification pass —
 * and `readVariables` on the render after it — is about to ask for.
 */
export const subscribeEnvironment = (onChange: () => void): (() => void) =>
  useAppStore.subscribe((state, previous) => {
    if (state.tree === previous.tree && state.activeId === previous.activeId && state.activeCollectionId === previous.activeCollectionId) return
    if (environmentInPlay(previous) === environmentInPlay(state)) return
    onChange()
  })

/**
 * The known-name map as a React value, for the static half of `TemplateInput`.
 *
 * `useSyncExternalStore` over the same subscription the editor plugin uses, rather than
 * store selectors and a `useMemo`: the map is derived, so a selector would hand back a
 * fresh object on every render and defeat the memo it was feeding. This one has to return
 * the *same* reference while nothing has changed, or every field re-renders on every store
 * update.
 *
 * Recomputed on read and cached, rather than recomputed in the subscription callback. That
 * ordering matters: hydration replaces the store before `createRoot` runs, so a snapshot
 * computed at module load would already be stale by the first render — and the subscription
 * is not installed until that render, so nothing would ever correct it.
 *
 * The key is the resolved environment object, which is a *total* key: "no environment" is
 * `undefined` and always maps to the empty map. That is what keeps a folder expand from
 * handing every mounted field a fresh map, and it needs no compound key at all now that
 * the pool has no identity of its own.
 */
let cachedEnvironment: Environment | undefined
let cachedHit = false
let cached: ReadonlyMap<string, string> = new Map()

const readVariables = (): ReadonlyMap<string, string> => {
  const environment = environmentInPlay(useAppStore.getState())
  if (!cachedHit || cachedEnvironment !== environment) {
    cachedHit = true
    cachedEnvironment = environment
    cached = variableMap(environment?.variables ?? [])
  }
  return cached
}

export const useVariables = (): ReadonlyMap<string, string> => useSyncExternalStore(subscribeEnvironment, readVariables)

/**
 * The same two answers for a non-React caller, read at call time.
 *
 * `templateEditor.ts` needs both: the CodeMirror `StateField` seeds itself from
 * `activeVariables` and is pushed a fresh one by `subscribeEnvironment`, and the completion
 * source calls `activeEnvironment` once per query. A pull read is the *correct* shape
 * there, not a shortcut — there is no snapshot to go stale, which is the rule `resolveFor`
 * states.
 *
 * `activeVariables` goes through the same cache `useVariables` reads, so the map handed to
 * an editor and the map handed to a static field are one object.
 */
export const activeEnvironment = (): Environment | undefined => environmentInPlay(useAppStore.getState())
export const activeVariables = (): ReadonlyMap<string, string> => readVariables()

/**
 * An environment's secret values, keyed by variable name.
 *
 * What `redactWire` masks with. Only locked variables that actually have a value: an empty
 * one would match everywhere and blank the whole snippet. It filters on `enabled` where
 * `environmentSecretsOf` in `persistence.ts` deliberately does not — a mask for a value
 * that is not being substituted would blank a snippet for nothing, while unticking a row
 * is not the same as deleting the credential behind it.
 *
 * Pure and taking the environment, so a component can memoise it on the environment it
 * selected rather than on a call that reads the store behind the linter's back.
 */
export const secretsIn = (environment: Environment | undefined): Map<string, string> => {
  const out = new Map<string, string>()
  for (const variable of environment?.variables ?? []) {
    const key = variable.key.trim()
    if (variable.enabled && variable.secret && key && variable.value) out.set(key, variable.value)
  }
  return out
}
