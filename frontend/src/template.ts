import { splitUrl } from './store'
import type { EnvironmentVariable, KeyValueRow } from './types'

/**
 * `{{variable}}` substitution.
 *
 * A pure leaf: no store, no React, no bindings — the same tier as `fuzzyScore` in
 * `commands.ts` and `interpolate` in `i18n/index.ts`. `environments.ts` is what binds
 * it to the active environment, so this file can be reasoned about on its own.
 *
 * Everything here happens in TypeScript, before the DTO crosses the binding. Go never
 * learns that variables exist: `buildRequest` reads every string verbatim, so one pass
 * over the DTO covers the whole surface, and the code view — which is built from the
 * same DTO — shows the resolved request for free.
 */

/**
 * The placeholder. Whitespace tolerant, because `{{ base }}` is what someone pasting
 * from another tool's docs will write and refusing it produces a silent no-op rather
 * than an error.
 *
 * The name charset is wider than i18n's `SLOT` on purpose. That one is matched
 * conservatively because it runs over strings the app itself authors; these are the
 * user's, and `api.base-url`, `AUTH_TOKEN` and `tenant.id` are all names people type.
 * `\w+` would exclude `.` and `-` and fail to match half of them without saying so.
 *
 * **Module-level with `/g`, so never call `.test()` on it.** `replace` and `matchAll`
 * reset `lastIndex`; `test` does not, and would then answer alternately true and false
 * for the same string. The fast path below is `includes('{{')` for exactly that reason.
 */
export const VARIABLE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g

export type Resolve = (value: string) => string

/** What every field passes through when no environment is active. */
export const IDENTITY: Resolve = value => value

/**
 * Folds an environment's rows into the map `resolverFor` wants.
 *
 * The filter is the one every other grid applies — `toPairs`, `toBodyDTO` and
 * `replaceQuery` all drop a row that is unticked or has no key — because the enable
 * checkbox and the blank trailing row are an editor model and neither belongs on the
 * wire. Unticking a row therefore makes `{{x}}` unknown, which leaves it standing,
 * which is exactly what you want when you untick a row to find out what depends on it.
 *
 * Two rows with the same key: the last one wins. Decided here and nowhere else, so
 * `environmentSecretsOf` in `persistence.ts` can agree with it by construction.
 */
export const variableMap = (variables: readonly EnvironmentVariable[]): Map<string, string> => {
  const out = new Map<string, string>()
  for (const variable of variables) {
    if (usable(variable)) out.set(variable.key.trim(), variable.value)
  }
  return out
}

/**
 * The row filter `variableMap` applies, exported so a caller that needs the whole row —
 * the completion source, which needs `secret` — agrees with it by construction rather
 * than by re-typing it. The `TEXT_FORMATS`/`byteBacked` hazard, in miniature.
 */
export const usable = (variable: EnvironmentVariable): boolean => variable.enabled && variable.key.trim() !== ''

/**
 * A fresh matcher over the same source.
 *
 * `MatchDecorator` keeps the regex it is handed and drives `lastIndex` itself, so
 * handing it `VARIABLE` would be exactly the shared-`lastIndex` bug the comment on that
 * constant warns about. Built from `VARIABLE.source` rather than copied, so a
 * decoration and the resolver can never disagree about what a placeholder *is* — a
 * token painted as a variable that `resolverFor` would not substitute is a colour that
 * lies.
 */
export const variablePattern = (): RegExp => new RegExp(VARIABLE.source, 'g')

/** The class names the chip is drawn with. Consumed by a `Decoration.mark` *and* by
 *  plain `<span>`s outside any editor, which is why they carry no `cm-` prefix and why
 *  the rules live in `styles/codemirror.css` rather than in an `EditorView.theme`. */
export const VAR_CLASS = 'template-var'
export const VAR_UNKNOWN_CLASS = 'template-var-unknown'

export interface TemplateSpan {
  from: number
  to: number
  name: string
  known: boolean
}

/**
 * Every placeholder in `value`, and whether the environment defines it.
 *
 * One classifier for the static render and for the editor decoration. If they diverged,
 * a mounted cell and an unmounted one would mark the same variable differently, side by
 * side in the same grid.
 *
 * `known` is true when the map is *empty*, which is "no environment active" — a state
 * the picker offers on purpose, and one where marking every token as missing would say
 * something false. It means "there is an environment and it does not define this".
 */
export const templateSpans = (value: string, known: ReadonlyMap<string, string>): TemplateSpan[] => {
  if (!value.includes('{{')) return []
  const out: TemplateSpan[] = []
  for (const match of value.matchAll(VARIABLE)) {
    if (match.index === undefined) continue
    out.push({ from: match.index, to: match.index + match[0].length, name: match[1], known: known.size === 0 || known.has(match[1]) })
  }
  return out
}

/**
 * One pass, no nesting, no escaping.
 *
 * A value that itself contains `{{other}}` is left alone. Recursion buys
 * `{{host}} = {{scheme}}://{{domain}}` and costs a cycle guard, a depth limit, a rule
 * about what a depth-exceeded value renders as, and a bug class that would hang the
 * *code view*, which re-resolves on every keystroke. One pass is a rule that fits in a
 * sentence of empty-state copy.
 *
 * An unknown name is left standing rather than blanked — the choice `interpolate`
 * makes, for the same reason: `{{name}}` on screen says what is missing. In a URL it
 * reaches `parseTarget` and comes back as `INVALID_URL`, which the response pane and
 * the code view both already render with prose. Blanking would give `/users`, the same
 * error with the evidence deleted.
 */
export const resolverFor =
  (variables: ReadonlyMap<string, string>): Resolve =>
  value => {
    if (!value.includes('{{')) return value
    return value.replace(VARIABLE, (whole, name: string) => variables.get(name) ?? whole)
  }

/**
 * Percent-decodes one half of a query pair, or reports that it could not.
 *
 * `decodeURIComponent` throws on a lone `%`, and a URL half-typed in the bar transits
 * through states like `?a=100%` constantly — with `useWire` re-resolving on every
 * keystroke. A pair that cannot be decoded is emitted byte for byte instead.
 */
const decoded = (part: string): string | null => {
  try {
    return decodeURIComponent(part)
  } catch {
    return null
  }
}

/**
 * The URL, which cannot be resolved with a plain `replace`.
 *
 * `replaceQuery` builds the query with `encodeURIComponent`, so `{{token}}` typed into
 * the **Params grid** lands in the document as `%7B%7Btoken%7D%7D` — while the grid
 * still shows `{{token}}`, because `parseParams` reads it back through
 * `URLSearchParams`. The only broken artefact would be the URL actually sent, and
 * nothing on screen would say so.
 *
 * So the query is walked structurally: each pair is decoded, and only if a half
 * actually holds a placeholder is it substituted and re-encoded. That makes this
 * agnostic about how the braces arrived — `%7B%7B` from the grid and a raw `{{` from
 * the URL bar take the same path — and it re-encodes *after* substituting, which is
 * what keeps a value containing `&`, `=` or a space from splitting the query. It also
 * needs no migration: a URL already on disk with `%7B%7B` in it starts working.
 *
 * A pair that holds no placeholder is emitted verbatim, so a request with no variables
 * produces a byte-identical URL to before this existed. A malformed pair — `?a`, `?=b`,
 * a stray `&&` — takes the same verbatim branch, explicitly rather than by falling
 * through: normalising someone's hand-tuned query would be a change nobody asked for.
 */
export const resolveUrl = (url: string, resolve: Resolve): string => {
  const { base, query, hash } = splitUrl(url)
  const resolvedBase = resolve(base)
  const resolvedHash = resolve(hash)
  if (!query) return `${resolvedBase}${resolvedHash}`

  const pairs = query.split('&').map(pair => {
    const separator = pair.indexOf('=')
    if (separator < 0) return pair
    const rawKey = pair.slice(0, separator)
    const rawValue = pair.slice(separator + 1)
    const key = decoded(rawKey)
    const value = decoded(rawValue)
    if (key === null || value === null) return pair
    if (!key.includes('{{') && !value.includes('{{')) return pair
    return `${encodeURIComponent(resolve(key))}=${encodeURIComponent(resolve(value))}`
  })

  return `${resolvedBase}?${pairs.join('&')}${resolvedHash}`
}

/**
 * `encodeURIComponent`, except that a `{{name}}` placeholder is left standing.
 *
 * Only the text `VARIABLE` matches is exempt; everything around it keeps exactly the
 * encoding it had before this existed, so a query holding a literal `{` — a JSON filter,
 * say — is byte-identical to what it used to be.
 *
 * Safe only because `resolveUrl` exists. It decodes each half of a pair before
 * substituting and re-encodes after, so how the braces arrived stopped mattering; before
 * that resolver, leaving them raw would have shipped a broken URL.
 */
const encodeTemplate = (part: string): string => {
  if (!part.includes('{{')) return encodeURIComponent(part)
  let out = ''
  let cursor = 0
  for (const match of part.matchAll(VARIABLE)) {
    if (match.index === undefined) continue
    out += encodeURIComponent(part.slice(cursor, match.index)) + match[0]
    cursor = match.index + match[0].length
  }
  return out + encodeURIComponent(part.slice(cursor))
}

/**
 * The params grid written back into the URL.
 *
 * Here rather than in `store.ts` for two reasons that point the same way. `template.ts`
 * imports `splitUrl` from the store, so the store cannot import `VARIABLE` back without
 * closing a cycle — and the encoder belongs beside `resolveUrl`, the decoder it has to
 * agree with, which is the argument `splitUrl`'s own comment makes about the two
 * directions of this sync.
 *
 * A placeholder survives the round trip un-escaped, so the URL bar shows `{{token}}`
 * rather than `%7B%7Btoken%7D%7D`. `parseParams` needs no change for that:
 * `new URLSearchParams('q={{term}}').get('q')` is `'{{term}}'`, because braces are not
 * delimiters in `application/x-www-form-urlencoded`. And nothing reaches Go differently:
 * `resolveUrl` re-encodes whatever it substitutes, and an unresolved name goes out
 * percent-encoded exactly as it always did.
 */
export const replaceQuery = (url: string, rows: KeyValueRow[]): string => {
  const { base, hash } = splitUrl(url)
  const query = rows
    .filter(r => r.enabled && r.key.trim())
    .map(r => `${encodeTemplate(r.key)}=${encodeTemplate(r.value)}`)
    .join('&')
  return `${base}${query ? `?${query}` : ''}${hash}`
}

/**
 * A value collapsed to one line.
 *
 * Lives here rather than beside `singleLine.ts`'s transaction filter, which is its other
 * caller, because `TemplateInput` needs it on the path where the editor does *not* exist:
 * the effect that syncs a store change into a field runs whether or not CodeMirror has
 * been loaded, and this file is the pure leaf that both sides can reach without it.
 *
 * A newline can only arrive from a hand-edited `workspace.json` or a pasted multi-line
 * string. The filter in `SINGLE_LINE` covers every edit made in the field; this covers a
 * document set from outside, where no filter runs.
 */
export const flatten = (value: string): string => value.replace(/[\r\n]+/g, '')
