/**
 * What a snippet target *is*, separated from the code that generates one.
 *
 * The two used to be one table, with each row carrying its own `generate`. That made the
 * barrel — and so the eleven generators, and so the nine `@codemirror/legacy-modes`
 * grammars `highlight.ts` pulls in behind them — reachable from `store.ts`, which needs
 * nothing from here but a default id and a union of strings. Roughly 125 KB of the startup
 * chunk was the code view's, loaded whether or not the code view was ever opened.
 *
 * The invariant the single table protected — a target cannot exist without a generator —
 * survives, enforced from the other side: `GENERATORS` in `index.ts` is typed
 * `Record<SnippetTarget, …>`, so a target added here without one, or a generator with no
 * target, is a compile error.
 */

/**
 * The languages a snippet can be highlighted as. Every one is a stream grammar that
 * `@codemirror/legacy-modes` already ships — the same single dependency the response
 * viewer's highlighting rests on, which is why fourteen targets add none.
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
  { id: 'raw', label: 'Raw HTTP', mode: 'http' },
  { id: 'curl', label: 'curl', mode: 'shell' },
  { id: 'curl-powershell', label: 'curl (PowerShell)', mode: 'powershell' },
  { id: 'httpie', label: 'HTTPie', mode: 'shell' },
  { id: 'wget', label: 'wget', mode: 'shell' },
  { id: 'fetch', label: 'JavaScript · fetch', mode: 'javascript' },
  { id: 'axios', label: 'JavaScript · axios', mode: 'javascript' },
  { id: 'requests', label: 'Python · requests', mode: 'python' },
  { id: 'httpx', label: 'Python · httpx', mode: 'python' },
  { id: 'go', label: 'Go · net/http', mode: 'go' },
  { id: 'java', label: 'Java · HttpClient', mode: 'java' },
  { id: 'csharp', label: 'C# · HttpClient', mode: 'csharp' },
  { id: 'ruby', label: 'Ruby · net/http', mode: 'ruby' },
  { id: 'rust', label: 'Rust · reqwest', mode: 'rust' },
] as const satisfies readonly { id: string; label: string; mode: SnippetMode }[]

/** Derived from the table rather than declared beside it. */
export type SnippetTarget = (typeof SNIPPET_TARGETS)[number]['id']

export const DEFAULT_SNIPPET_TARGET: SnippetTarget = 'curl'

/**
 * `?? SNIPPET_TARGETS[0]` rather than a `!`: it is a tuple, index 0 exists, and nothing
 * has to be asserted to say so. Same construction as `SettingsModal`'s section lookup.
 */
export const targetFor = (id: SnippetTarget) => SNIPPET_TARGETS.find(target => target.id === id) ?? SNIPPET_TARGETS[0]
