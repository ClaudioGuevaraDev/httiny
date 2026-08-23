import type { Wire } from './types'

/**
 * Header names whose value is a credential, and the environment variable each is
 * replaced by.
 *
 * A list rather than a heuristic, because a wrong guess in either direction is bad: a
 * missed header leaks a key into a pasted snippet, and an over-eager match redacts an
 * `X-Request-Id` for nothing. These are the names that carry secrets in practice.
 *
 * `authorization` maps to `AUTH_TOKEN` rather than to its own name because that is what
 * the value is — the header is the envelope, `Bearer …` is the credential.
 *
 * The map is keyed lowercase and looked up that way: Go canonicalises header names on
 * the way out (`api-key` comes back as `Api-Key`), so matching the name as typed would
 * miss.
 */
const SECRET_HEADERS: Record<string, string> = {
  authorization: 'AUTH_TOKEN',
  'proxy-authorization': 'PROXY_AUTH_TOKEN',
  cookie: 'COOKIE',
  'api-key': 'API_KEY',
  'x-api-key': 'API_KEY',
  'x-auth-token': 'AUTH_TOKEN',
  'x-access-token': 'ACCESS_TOKEN',
  'x-csrf-token': 'CSRF_TOKEN',
}

/**
 * Replaces credential values with an environment-variable placeholder.
 *
 * A transform over the resolved request rather than an option threaded through every
 * generator: one place decides what a secret is, and no generator can forget to ask.
 *
 * The placeholder is written in shell form (`$API_KEY`) in every target, and it is a
 * *marker*, not a live read — including in the shell targets, where the surrounding single
 * quotes are exactly what stops `$API_KEY` from expanding. That is deliberate: this toggle
 * exists so a snippet can be pasted into a ticket, and a snippet that quietly picks up
 * whatever is in the environment would be a different request from the one on screen.
 * Emitting a real `$env:X` / `process.env.X` / `os.environ[…]` per language would mean a
 * placeholder concept in all thirteen generators, to make a *redacted* snippet runnable —
 * which is not what it is for.
 *
 * A **text part of a form** is masked against the same list, for the reason the list
 * covers `api-key` typed into the headers grid and not only `auth.token`: a credential
 * posted as a form field is the same credential. Names are matched with underscores
 * folded to hyphens, because `api_key` is how the same field is spelled in a form.
 *
 * A file part is not touched. Its value is a path, and a path is not a secret — it is
 * what the request is, and a snippet that redacted it would not run.
 *
 * The textual body used to be untouched entirely, for the reason above: a password can
 * appear in a JSON payload, but finding it would mean guessing at the shape of someone
 * else's schema. `secrets` is what changes that, and only for values we were *told* are
 * secrets — the active environment's locked variables. That is a strictly better rule
 * than the header list wherever it applies, because a variable substituted into
 * `X-Tenant-Key`, a query parameter or a body would otherwise be printed in the clear
 * with the toggle on; the list stays as the fallback for a credential typed straight
 * into the grid, which belongs to no environment.
 *
 * Longest value first, so a variable whose value contains another's is masked as itself
 * rather than being half-rewritten from the inside.
 */
export const redactWire = (wire: Wire, secrets: ReadonlyMap<string, string> = new Map()): Wire => {
  const ordered = [...secrets].filter(([, value]) => value).sort((a, b) => b[1].length - a[1].length)
  const mask = (text: string): string => {
    let out = text
    for (const [name, value] of ordered) out = out.split(value).join(`$${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`)
    return out
  }

  return {
    ...wire,
    url: mask(wire.url),
    target: mask(wire.target),
    headers: wire.headers.map(header => {
      const variable = SECRET_HEADERS[header.key.toLowerCase()]
      return variable ? { ...header, value: `$${variable}` } : { ...header, value: mask(header.value) }
    }),
    body: mask(wire.body),
    parts: wire.parts.map(part => {
      if (part.kind === 'file') return part
      const variable = SECRET_HEADERS[part.name.toLowerCase().split('_').join('-')]
      return variable ? { ...part, value: `$${variable}` } : { ...part, value: mask(part.value) }
    }),
  }
}
