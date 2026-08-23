import { FileCode2 } from 'lucide-react'
import { useT } from '../language'
import { shortcutHint } from '../shortcuts'
import { activeEnvironmentOf, useAppStore } from '../store'
import type { CollectionNode } from '../types'
import { Select } from './Select'

/**
 * Which environment this collection's `{{variables}}` resolve against.
 *
 * In the collection's own sidebar panel, directly under its name, and that placement is
 * the whole point. The version of this that shipped in 0.31.0 put one picker at the right
 * end of the tab strip over a workspace-wide pool, and it had to carry a scope label
 * saying which collection it was really acting on — because the tab strip is not scoped
 * and the rail can be showing something else. Here there is nothing to disambiguate: the
 * control is visibly inside the panel of the collection it belongs to.
 *
 * The collection arrives as a prop rather than being selected, because `Sidebar` already
 * holds it — a second subscription would re-render this on every store change.
 *
 * Two controls rather than one. `Select` is a select-only combobox whose options are
 * *values*, so smuggling a "Manage…" row in as an option would break that contract and
 * need a sentinel value threaded through `onChange`.
 *
 * The empty string stands in for "no environment", the idiom the response viewer's format
 * picker already uses for "automatic": ids are UUIDs, so `''` is unclaimable and needs no
 * case of its own on the way out. It has to be an option — turning every variable off at
 * once is how you find out whether a request depends on them, and it is what you want
 * before copying a snippet into a ticket.
 *
 * With no environments the picker is **not** disabled either. `Select`'s rule against
 * hiding a control that stops applying was read one step too far here: greying it out made
 * the row look broken, and there is nothing to protect against — the option list is exactly
 * one entry, "no environment", already selected, so opening it is inert.
 */
export function EnvironmentPicker({ collection }: { collection: CollectionNode }) {
  const { t } = useT()
  const setActiveEnvironment = useAppStore(s => s.setActiveEnvironment)
  const openEnvironments = useAppStore(s => s.openEnvironments)
  const environments = collection.environments

  return (
    <div className="env-picker">
      <Select
        variant="inline"
        // Named after the collection, because that is the scope and there is no room for
        // a second line of chrome to say so.
        ariaLabel={t('env.picker.aria', { name: collection.name })}
        title={t('env.picker.aria', { name: collection.name })}
        // The validated id and not `collection.activeEnvironmentId`: a `Select` whose
        // value names no option renders blank, and a stale id has to read as "none".
        value={activeEnvironmentOf(collection)?.id ?? ''}
        options={[{ value: '', label: t('env.picker.none') }, ...environments.map(env => ({ value: env.id, label: env.name }))]}
        onChange={next => setActiveEnvironment(collection.id, next || null)}
      />
      {/* Labelled, and not an icon on its own. Two rounds of "where is it?" say that a
          bare glyph beside a bordered field does not read as a control however well it is
          boxed — so it takes the shape of a labelled action row, which is what the
          sidebar's own removed search row used.

          The `aria-label` stays even though there is visible text now: it says what the
          button does *and* which collection it acts on, where the label alone says only
          "Variables". "Variables" is contained in it, so the visible label is still part
          of the accessible name. */}
      <button
        type="button"
        className="env-manage"
        aria-label={t('env.manage.aria', { name: collection.name })}
        title={t('env.manage.title', { keys: shortcutHint('environments') })}
        onClick={() => openEnvironments(collection.id)}
      >
        <FileCode2 size={13} aria-hidden="true" />
        {/* Hardcoded, and that is the rule rather than an exception to it: `.env` is a
            filename, the same class of token as `GET` and `JSON` — both of which are
            literals in `methodLabel` and in the format badges — and CLAUDE.md's i18n list
            names technical placeholders among the things that are not translated. The
            earlier mistake here was a *prose* label that happened to read the same in both
            catalogues; this is not that. The meaning still reaches a screen reader, through
            an `aria-label` that is translated and mentions `.env` so the visible label is
            part of the accessible name. */}
        <span>.env</span>
      </button>
    </div>
  )
}
