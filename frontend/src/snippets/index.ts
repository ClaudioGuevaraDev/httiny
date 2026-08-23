import { csharp } from './csharp'
import { goHTTP } from './go'
import { java } from './java'
import { axios, fetchSnippet } from './javascript'
import { httpx, requests } from './python'
import { raw } from './raw'
import { redactWire } from './redact'
import { ruby } from './ruby'
import { rust } from './rust'
import { curl, curlPowerShell, httpie, wget } from './shell'
import { targetFor, type SnippetTarget } from './targets'
import type { Wire } from './types'

// Re-exported so callers outside this directory need one import path, and so `types.ts`
// stays the private detail it is — `fromResult` normalising Go's `T[] | null` is not
// something the store or the modal should have to know about.
//
// Two exceptions, and they are the point of `targets.ts`: `store.ts` and `wire.ts` import
// from the leaves directly. Reaching them through here would put the eleven generators
// below — and the grammars behind `highlight.ts` — back in the startup chunk, which is
// exactly what splitting the table apart was for.
export { fromResult } from './types'
export type { Wire } from './types'
export { DEFAULT_SNIPPET_TARGET, SNIPPET_TARGETS, targetFor } from './targets'
export type { SnippetMode, SnippetTarget } from './targets'

/**
 * The generator for each target.
 *
 * `Record<SnippetTarget, …>` is what carries the invariant the old single table had in its
 * shape: a target declared in `targets.ts` with nothing here, or an entry here naming no
 * target, does not compile.
 */
const GENERATORS: Record<SnippetTarget, (wire: Wire) => string> = {
  raw,
  curl,
  'curl-powershell': curlPowerShell,
  httpie,
  wget,
  fetch: fetchSnippet,
  axios,
  requests,
  httpx,
  go: goHTTP,
  java,
  csharp,
  ruby,
  rust,
}

/**
 * The one entry point. Redaction happens here rather than inside each generator, so a
 * generator cannot forget to ask and there is exactly one definition of what a secret is.
 */
export const snippetFor = (id: SnippetTarget, wire: Wire, redact: boolean, secrets?: ReadonlyMap<string, string>): string =>
  GENERATORS[targetFor(id).id](redact ? redactWire(wire, secrets) : wire)
