import { Check, FilePlus2, Plus, Trash2 } from 'lucide-react'
import { PICK_TITLE, pickFiles, useAttachments } from '../../attachments'
import type { PlainMessageKey } from '../../i18n'
import { useT } from '../../language'
import { useAppStore } from '../../store'
import { PART_KINDS, type FormRow, type PartKind, type RequestDocument } from '../../types'
import { Select } from '../Select'
import { TemplateInput } from '../TemplateInput'
import { FileChip } from './FileChip'

const freshFormRow = (kind: PartKind, path = ''): FormRow => ({
  id: crypto.randomUUID(),
  enabled: true,
  kind,
  key: '',
  value: '',
  path,
  contentType: '',
})

/**
 * Walked out of `PART_KINDS` rather than written as two `<option>`s — the same
 * construction `AUTH_TYPES` uses in the Auth panel, and what lets `Select`'s generic
 * hand `onChange` back a narrowed `PartKind` with nothing asserted.
 */
const KIND_LABEL = {
  text: 'editor.body.form.field',
  file: 'editor.body.form.file',
} as const satisfies Record<PartKind, PlainMessageKey>

/**
 * The multipart/form-data grid.
 *
 * Six columns rather than the key/value grid's five, and it is a different set: the
 * last column is the part's `Content-Type`, not a description. That is the trade this
 * grid makes on purpose — a description is documentation, whereas an API that rejects
 * an upload for being `application/octet-stream` when it wanted `image/png` cannot be
 * argued with from any other field. Empty means "work it out from the extension", which
 * Go does with `mime.TypeByExtension`.
 *
 * A row keeps both its typed value and its chosen path across a change of kind, so
 * flipping Text → File → Text returns what was there rather than punishing a misclick.
 * `requestDTO.toBodyDTO` clears whichever of the two the wire does not want.
 */
export function FormGrid({ request }: { request: RequestDocument }) {
  const { t } = useT()
  const setBody = useAppStore(s => s.setBody)
  const rows = request.body.form
  const commit = (next: FormRow[]) => setBody(request.id, { form: next })

  // Only the file rows are stat'd, and the list is derived rather than stored: two rows
  // pointing at the same file cost one lookup.
  const attachments = useAttachments(rows.filter(row => row.kind === 'file' && row.path).map(row => row.path))

  const addFiles = () => {
    void pickFiles(t(PICK_TITLE.many), true).then(paths => {
      if (!paths.length) return
      // One row per file: choosing three attachments and then having to add two more
      // rows by hand would make the multi-select pointless.
      commit([...rows, ...paths.map(path => freshFormRow('file', path))])
    })
  }

  return (
    <div className="kv-wrap form-grid">
      <div className="kv-header">
        <span />
        <span>{t('editor.body.form.type')}</span>
        <span>{t('editor.kv.key')}</span>
        <span>{t('editor.kv.value')}</span>
        <span>{t('editor.body.form.contentType')}</span>
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
            onClick={() => commit(rows.map(r => (r.id === row.id ? { ...r, enabled: !r.enabled } : r)))}
          >
            {row.enabled && <Check size={11} aria-hidden="true" />}
          </button>
          {/* A picker rather than a two-state toggle. A toggle is fewer clicks and says
              nothing: a cell reading "Text" gives no reason to believe it could read
              anything else, and the one thing this column has to communicate is that
              there is a choice here at all. The caret is what says so. */}
          <Select
            variant="inline"
            ariaLabel={row.key ? t('editor.body.form.rowKind', { name: row.key }) : t('editor.body.form.rowKindRow')}
            value={row.kind}
            options={PART_KINDS.map(kind => ({ value: kind, label: t(KIND_LABEL[kind]) }))}
            onChange={kind => commit(rows.map(r => (r.id === row.id ? { ...r, kind } : r)))}
          />
          {/* Both the part name and a text part's value are resolved on the way to the
              wire, so both mark their variables. The content type below is not — an
              empty one already means "derive it", which no substitution can express —
              and a file row's path is a path rather than a template, for the reasons
              `requestDTO.ts` gives beside each. */}
          <TemplateInput
            variant="cell"
            value={row.key}
            ariaLabel={t('editor.kv.key')}
            placeholder={t('editor.kv.keyPlaceholder')}
            onChange={next => commit(rows.map(r => (r.id === row.id ? { ...r, key: next } : r)))}
          />
          {row.kind === 'file' ? (
            <FileChip path={row.path} attachment={attachments[row.path]} onPick={path => commit(rows.map(r => (r.id === row.id ? { ...r, path } : r)))} />
          ) : (
            <TemplateInput
              variant="cell"
              value={row.value}
              ariaLabel={t('editor.kv.value')}
              placeholder={t('editor.kv.valuePlaceholder')}
              onChange={next => commit(rows.map(r => (r.id === row.id ? { ...r, value: next } : r)))}
            />
          )}
          <input
            className="technical-input"
            value={row.contentType}
            name="form-content-type"
            aria-label={t('editor.body.form.contentType')}
            // The placeholder says what happens when it is left alone, which is the
            // only thing worth saying about an optional override.
            placeholder={t('editor.body.form.contentTypeAuto')}
            autoComplete="off"
            spellCheck={false}
            onChange={e => commit(rows.map(r => (r.id === row.id ? { ...r, contentType: e.target.value } : r)))}
          />
          <button
            type="button"
            className="icon-btn xs row-delete"
            aria-label={t('editor.kv.deleteRow')}
            onClick={() => commit(rows.filter(r => r.id !== row.id))}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      ))}
      <div className="add-row-group">
        <button type="button" className="add-row" onClick={() => commit([...rows, freshFormRow('text')])}>
          <Plus size={13} aria-hidden="true" />
          {t('editor.body.form.addField')}
        </button>
        <button type="button" className="add-row" onClick={addFiles}>
          <FilePlus2 size={13} aria-hidden="true" />
          {t('editor.body.form.addFile')}
        </button>
      </div>
    </div>
  )
}
