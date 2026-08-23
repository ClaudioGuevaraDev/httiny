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
import type { Wire } from './types'

// Re-exported so callers outside this directory need one import path, and so `types.ts`
// stays the private detail it is — `fromResult` normalising Go's `T[] | null` is not
// something the store or the modal should have to know about.
export { fromResult } from './types'
export type { Wire } from './types'

/**
 * The languages a snippet can be highlighted as. Every one is a stream grammar that
 * `@codemirror/legacy-modes` already ships — the same single dependency the response
 * viewer's highlighting rests on, which is why thirteen targets add none.
 */
export type SnippetMode = 'http' | 'shell' | 'powershell' | 'javascript' | 'python' | 'go' | 'java' | 'csharp' | 'ruby' | 'rust'

/**
 * Every target, in the order the picker offers them.
 *
 * `label` is deliberately **not** a message key. These are product and library names —
 * curl, reqwest, `net/http` — and they belong with the HTTP methods and the format badges
 * on the list of things this app does not translate.
 *
 * Raw HTTP leads because it is not a snippet: it is the request, and it is the answer to
 * "what is actually being sent". curl follows because it is the one everybody pastes.
 */
export const SNIPPET_TARGETS = [
  { id: 'raw', label: 'Raw HTTP', mode: 'http', generate: raw },
  { id: 'curl', label: 'curl', mode: 'shell', generate: curl },
  { id: 'curl-powershell', label: 'curl (PowerShell)', mode: 'powershell', generate: curlPowerShell },
  { id: 'httpie', label: 'HTTPie', mode: 'shell', generate: httpie },
  { id: 'wget', label: 'wget', mode: 'shell', generate: wget },
  { id: 'fetch', label: 'JavaScript · fetch', mode: 'javascript', generate: fetchSnippet },
  { id: 'axios', label: 'JavaScript · axios', mode: 'javascript', generate: axios },
  { id: 'requests', label: 'Python · requests', mode: 'python', generate: requests },
  { id: 'httpx', label: 'Python · httpx', mode: 'python', generate: httpx },
  { id: 'go', label: 'Go · net/http', mode: 'go', generate: goHTTP },
  { id: 'java', label: 'Java · HttpClient', mode: 'java', generate: java },
  { id: 'csharp', label: 'C# · HttpClient', mode: 'csharp', generate: csharp },
  { id: 'ruby', label: 'Ruby · net/http', mode: 'ruby', generate: ruby },
  { id: 'rust', label: 'Rust · reqwest', mode: 'rust', generate: rust },
] as const satisfies readonly { id: string; label: string; mode: SnippetMode; generate: (wire: Wire) => string }[]

/** Derived from the table rather than declared beside it: a target cannot exist without a generator. */
export type SnippetTarget = (typeof SNIPPET_TARGETS)[number]['id']

export const SNIPPET_TARGET_IDS = SNIPPET_TARGETS.map(target => target.id)

export const DEFAULT_SNIPPET_TARGET: SnippetTarget = 'curl'

/**
 * `?? SNIPPET_TARGETS[0]` rather than a `!`: it is a tuple, index 0 exists, and nothing
 * has to be asserted to say so. Same construction as `SettingsModal`'s section lookup.
 */
export const targetFor = (id: SnippetTarget) => SNIPPET_TARGETS.find(target => target.id === id) ?? SNIPPET_TARGETS[0]

/**
 * The one entry point. Redaction happens here rather than inside each generator, so a
 * generator cannot forget to ask and there is exactly one definition of what a secret is.
 */
export const snippetFor = (id: SnippetTarget, wire: Wire, redact: boolean, secrets?: ReadonlyMap<string, string>): string =>
  targetFor(id).generate(redact ? redactWire(wire, secrets) : wire)
