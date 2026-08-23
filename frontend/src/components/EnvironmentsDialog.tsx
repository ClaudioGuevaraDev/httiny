import { useEffect, useRef, useState } from 'react'
import { Braces, Check, Copy, KeyRound, Plus, Trash2, X } from 'lucide-react'
import { useT } from '../language'
import { freshVariable, useAppStore } from '../store'
import type { CollectionNode, Environment, EnvironmentVariable } from '../types'
import { useRovingFocus } from '../useRovingFocus'
import { Placeholder, PlaceholderAction } from './Placeholder'

const tabId = (id: string) => `env-tab-${id}`
const panelId = (id: string) => `env-panel-${id}`

/**
 * One collection's environments editor.
 *
 * Same shell as Settings and the command palette, and for the same four reasons:
 * `<dialog>` with `showModal()` supplies a real focus trap, top-layer rendering, focus
 * restoration on close and native Escape. The body only mounts while open, and closing
 * always goes through `dialog.close()` so the DOM and the store cannot desync.
 *
 * A modal rather than a Settings section, which is where it nearly went: everything in
 * `SECTIONS` is an app preference written to `ui.json` and covered by that column's
 * "Restore defaults" button, while environments are workspace *data*. Putting them one
 * roving-focus step away from a control that resets their neighbours is how variables
 * would go missing.
 *
 * Addressed by `environmentsFor` — a collection id, not a boolean — so the collection it
 * acts on is fixed when it opens. The rail moves under it whenever a palette jump reveals
 * a request elsewhere, and a dialog that followed would silently retarget every edit made
 * in it.
 */
export function EnvironmentsDialog() {
  const collection = useAppStore(s => (s.environmentsFor ? (s.tree.find(node => node.id === s.environmentsFor) ?? null) : null))
  const closeEnvironments = useAppStore(s => s.closeEnvironments)
  const dialogRef = useRef<HTMLDialogElement>(null)
  // A collection deleted from under an open dialog leaves nothing to edit, so the id
  // failing to resolve is also the close signal.
  const open = collection?.type === 'collection'

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="env-dialog"
      aria-modal="true"
      aria-labelledby="environments-title"
      onClose={closeEnvironments}
      onClick={event => {
        if (event.target === dialogRef.current) dialogRef.current?.close()
      }}
    >
      {open && <EnvironmentsBody collection={collection} onDismiss={() => dialogRef.current?.close()} />}
    </dialog>
  )
}

function EnvironmentsBody({ collection, onDismiss }: { collection: CollectionNode; onDismiss: () => void }) {
  const { t, plural } = useT()
  const addEnvironment = useAppStore(s => s.addEnvironment)
  const duplicateEnvironment = useAppStore(s => s.duplicateEnvironment)
  const askConfirm = useAppStore(s => s.askConfirm)
  const environments = collection.environments
  const active = collection.activeEnvironmentId

  // Which one is being *edited*, which is not which one is applied to requests. Local, and
  // seeded from the active one because the body only mounts while the dialog is open — the
  // rule the code view's redaction switch already follows. Collapsing the two would mean
  // clicking a tab to look at production silently changed what the next Ctrl+Enter sends.
  const [editingId, setEditingId] = useState<string | null>(active ?? environments[0]?.id ?? null)
  const onNavKeyDown = useRovingFocus('[role="tab"]', 'vertical')
  // Falls back rather than blanking the panel: a deleted environment leaves `editingId`
  // naming nothing, and the neighbour is what you were about to look at anyway.
  const editing = environments.find(env => env.id === editingId) ?? environments[0]

  const create = () => {
    const id = crypto.randomUUID()
    addEnvironment(collection.id, id)
    setEditingId(id)
  }

  const duplicate = (env: Environment) => {
    const id = crypto.randomUUID()
    duplicateEnvironment(collection.id, env.id, id)
    setEditingId(id)
  }

  if (!environments.length) {
    return (
      <div className="env-shell env-shell-empty">
        <h2 id="environments-title" className="sr-only">
          {t('env.title', { name: collection.name })}
        </h2>
        <Placeholder
          icon={<Braces size={20} />}
          title={t('env.empty.title', { name: collection.name })}
          // The one-pass rule is stated here rather than in a tooltip: this is the screen
          // someone reads before they type their first variable.
          description={t('env.empty.desc', { example: '{{baseUrl}}' })}
        >
          <PlaceholderAction onClick={create}>{t('env.empty.new')}</PlaceholderAction>
        </Placeholder>
        <button type="button" className="icon-btn env-close" aria-label={t('env.close')} onClick={onDismiss}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div className="env-shell">
      {/* The heading is not drawn — the column is short and the plate is already
          unambiguous — but it stays in the DOM, because `aria-labelledby` on the `<dialog>`
          points at it and removing it would leave the modal with no accessible name. The
          empty-state branch above does the same thing, so the two agree. It is outside the
          tablist either way: a tablist's children are tabs, and a screen reader walking one
          should not find a heading in there. */}
      <div className="env-nav">
        <h2 id="environments-title" className="sr-only">
          {t('env.title', { name: collection.name })}
        </h2>
        {/* Above the list rather than under it. Outside the tablist either way: its children
            are tabs and this is not one. */}
        <button type="button" className="env-add" onClick={create}>
          <Plus size={14} aria-hidden="true" />
          {t('env.new')}
        </button>
        <div className="env-list" role="tablist" aria-orientation="vertical" aria-label={t('env.list')} onKeyDown={onNavKeyDown}>
          {environments.map(env => (
            <button
              type="button"
              key={env.id}
              role="tab"
              id={tabId(env.id)}
              aria-selected={env.id === editing?.id}
              aria-controls={panelId(env.id)}
              tabIndex={env.id === editing?.id ? 0 : -1}
              className={env.id === editing?.id ? 'active' : ''}
              onClick={() => setEditingId(env.id)}
            >
              <span className="env-tab-name truncate">{env.name}</span>
              <span className="env-tab-count">{plural('env.count', env.variables.filter(v => v.key.trim()).length)}</span>
              {env.id === active && (
                <span className="env-tab-mark" title={t('env.active')}>
                  <Check size={12} aria-hidden="true" />
                  <span className="sr-only">{t('env.active')}</span>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {editing && (
        <div className="env-panel" role="tabpanel" id={panelId(editing.id)} aria-labelledby={tabId(editing.id)} tabIndex={-1}>
          <EnvironmentHeader
            collection={collection}
            environment={editing}
            onDuplicate={() => duplicate(editing)}
            onDelete={() => askConfirm({ kind: 'deleteEnvironment', collectionId: collection.id, environmentId: editing.id })}
          />
          <VariableGrid collection={collection} environment={editing} />
        </div>
      )}

      <button type="button" className="icon-btn env-close" aria-label={t('env.close')} onClick={onDismiss}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  )
}

function EnvironmentHeader({
  collection,
  environment,
  onDuplicate,
  onDelete,
}: {
  collection: CollectionNode
  environment: Environment
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { t } = useT()
  const renameEnvironment = useAppStore(s => s.renameEnvironment)
  const setActiveEnvironment = useAppStore(s => s.setActiveEnvironment)
  const isActive = collection.activeEnvironmentId === environment.id

  return (
    <div className="env-header">
      {/* Commits on every change rather than on a rename gesture: nothing in this app has
          a dirty state, so a field that had to be confirmed would be describing a save
          that already happened. */}
      <input
        className="technical-input env-name"
        value={environment.name}
        aria-label={t('env.name')}
        placeholder={t('env.namePlaceholder')}
        autoComplete="off"
        onChange={e => renameEnvironment(collection.id, environment.id, e.target.value)}
      />
      {/* Activating is separate from selecting a tab, so reading production does not send
          to it. Disabled once active rather than hidden, so the row does not reflow when
          you switch tabs. */}
      <button type="button" className="env-activate" disabled={isActive} onClick={() => setActiveEnvironment(collection.id, environment.id)}>
        <Check size={13} aria-hidden="true" />
        {t(isActive ? 'env.active' : 'env.activate')}
      </button>
      <button type="button" className="icon-btn" aria-label={t('env.duplicate')} title={t('env.duplicate')} onClick={onDuplicate}>
        <Copy size={14} aria-hidden="true" />
      </button>
      <button type="button" className="icon-btn danger" aria-label={t('env.delete')} title={t('env.delete')} onClick={onDelete}>
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * A sibling of `KeyValueGrid`, not a use of it — the situation `FormGrid` already
 * resolved. `KeyValueGrid.onChange` hands back `KeyValueRow[]`, and narrowing that to
 * `EnvironmentVariable[]` would take an `as`; making the grid generic over its row type is
 * the accretion its own comment resists. So the classes are shared and the columns are
 * not: no description, and a lock where it would have been.
 *
 * The value cell is a plain `<input>` and not a `TemplateInput`, which is not an
 * oversight: resolution is one pass, so a `{{name}}` inside a variable's value is never
 * expanded and colouring it would promise otherwise. It also sidesteps parenting a
 * completion tooltip inside a `<dialog>`, where the top layer beats any `z-index`.
 */
function VariableGrid({ collection, environment }: { collection: CollectionNode; environment: Environment }) {
  const { t } = useT()
  const setEnvironmentVariables = useAppStore(s => s.setEnvironmentVariables)
  const secretsAvailable = useAppStore(s => s.secretsAvailable)
  const rows = environment.variables
  const onChange = (next: EnvironmentVariable[]) => setEnvironmentVariables(collection.id, environment.id, next)
  const patch = (id: string, fields: Partial<EnvironmentVariable>) => onChange(rows.map(row => (row.id === id ? { ...row, ...fields } : row)))

  return (
    <div className="kv-wrap var-grid">
      <div className="kv-header">
        <span />
        {/* Sentence case in the catalogue; `.kv-header` does the uppercasing. */}
        <span>{t('editor.kv.key')}</span>
        <span>{t('editor.kv.value')}</span>
        <span />
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
            onClick={() => patch(row.id, { enabled: !row.enabled })}
          >
            {row.enabled && <Check size={11} aria-hidden="true" />}
          </button>
          <input
            className="technical-input"
            value={row.key}
            name="variable-key"
            aria-label={t('editor.kv.key')}
            placeholder={t('editor.kv.keyPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            onChange={e => patch(row.id, { key: e.target.value })}
          />
          <input
            className="technical-input"
            // Still editable, just not readable over a shoulder — the auth panel's password
            // field. These are credentials for the target API, not for HTTiny, so a
            // password manager offering to fill them is noise.
            type={row.secret ? 'password' : 'text'}
            value={row.value}
            name="variable-value"
            aria-label={t('editor.kv.value')}
            placeholder={t('editor.kv.valuePlaceholder')}
            autoComplete="off"
            spellCheck={false}
            onChange={e => patch(row.id, { value: e.target.value })}
          />
          {/* A second `role="switch"`, drawn differently or it reads as a duplicate of the
              first. On means the value goes to the OS credential store and never to
              `workspace.json`. */}
          <button
            type="button"
            className={`icon-btn xs row-secret ${row.secret ? 'on' : ''}`}
            role="switch"
            aria-checked={row.secret}
            aria-label={row.key ? t('env.var.secretNamed', { name: row.key }) : t('env.var.secret')}
            title={t('env.var.secret')}
            onClick={() => patch(row.id, { secret: !row.secret })}
          >
            <KeyRound size={12} aria-hidden="true" />
          </button>
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
      <button type="button" className="add-row" onClick={() => onChange([...rows, freshVariable()])}>
        <Plus size={13} aria-hidden="true" />
        {t('env.var.add')}
      </button>
      {/* The same thing the sidebar footer says, repeated where a lock is actually being
          switched on — and it is a warning, not a note: with no credential store a locked
          value is lost on restart rather than merely unsaved. */}
      {!secretsAvailable && rows.some(row => row.secret) && <p className="env-session-note">{t('env.var.sessionOnly')}</p>}
    </div>
  )
}
