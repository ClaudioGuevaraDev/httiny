import { Check, Plus, Trash2 } from 'lucide-react'
import type { MessageKey, PlainMessageKey } from '../i18n'
import { useT } from '../language'
import { freshRow } from '../store'
import type { KeyValueRow } from '../types'
import { TemplateInput } from './TemplateInput'

type Field = 'key' | 'value' | 'description'

const FIELD_LABEL = {
  key: 'editor.kv.key',
  value: 'editor.kv.value',
  description: 'editor.kv.description',
} as const satisfies Record<Field, MessageKey>

/**
 * Deliberately generic rather than worked examples. The example-pattern rule is for
 * single-purpose fields whose format is not obvious — the URL and the bearer token get
 * one. In a repeating grid any example is arbitrary, and it repeats down every empty
 * row, where two greyed "page…" cells read as duplicated data rather than as a hint.
 */
const PLACEHOLDER = {
  key: 'editor.kv.keyPlaceholder',
  value: 'editor.kv.valuePlaceholder',
  description: 'editor.kv.descriptionPlaceholder',
} as const satisfies Record<Field, MessageKey>

/**
 * The key/value grid, over rows and a setter rather than over a document and a field
 * name.
 *
 * It used to take `field: 'params' | 'headers'` and call `setRows(id, field, …)`
 * itself, which is exactly one member short of what it is now asked to do: the
 * URL-encoded body is a third grid with the same three columns and a different home in
 * the document. Owning neither the rows nor where they live is what makes it serve all
 * three, and the caller keeps the one thing that genuinely differs — what a commit
 * means. For Params that is also rewriting the URL.
 *
 * `name` prefixes the inputs' form names, which is the only reason the grid needs to
 * know which one it is.
 */
export function KeyValueGrid({
  rows,
  onChange,
  addLabel,
  name,
}: {
  rows: KeyValueRow[]
  onChange: (rows: KeyValueRow[]) => void
  addLabel: PlainMessageKey
  /** Prefixes the description column's form name. It used to prefix all three; the other
   *  two are contenteditables now and have nowhere to put one. */
  name: string
}) {
  const { t } = useT()
  return (
    <div className="kv-wrap">
      <div className="kv-header">
        <span />
        {/* Sentence case in the catalogue; `.kv-header` does the uppercasing, so a
            Spanish accent is never lost to a hand-typed capital. */}
        <span>{t('editor.kv.key')}</span>
        <span>{t('editor.kv.value')}</span>
        <span>{t('editor.kv.description')}</span>
        <span />
      </div>
      {rows.map(row => (
        <div className="kv-row" key={row.id}>
          <button
            type="button"
            className={`row-check ${row.enabled ? 'on' : ''}`}
            role="switch"
            aria-checked={row.enabled}
            aria-label={row.key ? t('editor.kv.enableNamed', { name: row.key }) : t('editor.kv.enableRow')}
            onClick={() => onChange(rows.map(r => (r.id === row.id ? { ...r, enabled: !r.enabled } : r)))}
          >
            {row.enabled && <Check size={11} aria-hidden="true" />}
          </button>
          {(['key', 'value', 'description'] as const).map(field =>
            /* Key and value are resolved on the way to the wire — `requestDTO.ts` runs
               the environment's resolver over both, for params and headers and for the
               urlencoded body — so a `{{variable}}` in either one means something and is
               worth marking. `description` is resolved by nothing and never reaches the
               wire at all: it is prose, which is what the `spellCheck` line below has
               always said, and it is the one field where a spellchecker, dictation and
               autocorrect actually matter. A contenteditable with `spellcheck` hard-wired
               off by CodeMirror would take all three away, so that column keeps its
               `<input>` — and with it the `name` this component's `name` prop prefixes. */
            field === 'description' ? (
              <input
                key={field}
                className="technical-input"
                value={row.description}
                name={`${name}-description`}
                aria-label={t(FIELD_LABEL.description)}
                placeholder={t(PLACEHOLDER.description)}
                autoComplete="off"
                spellCheck
                onChange={e => onChange(rows.map(r => (r.id === row.id ? { ...r, description: e.target.value } : r)))}
              />
            ) : (
              <TemplateInput
                key={field}
                variant="cell"
                value={row[field]}
                ariaLabel={t(FIELD_LABEL[field])}
                placeholder={t(PLACEHOLDER[field])}
                onChange={next => onChange(rows.map(r => (r.id === row.id ? { ...r, [field]: next } : r)))}
              />
            ),
          )}
          <button
            type="button"
            className="icon-btn xs row-delete"
            aria-label={t('editor.kv.deleteRow')}
            onClick={() => onChange(rows.filter(r => r.id !== row.id))}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" className="add-row" onClick={() => onChange([...rows, freshRow()])}>
        <Plus size={13} aria-hidden="true" />
        {/* One whole message per caller rather than "Add" plus a noun: the article and
            the gender travel with the noun in Spanish. */}
        {t(addLabel)}
      </button>
    </div>
  )
}
