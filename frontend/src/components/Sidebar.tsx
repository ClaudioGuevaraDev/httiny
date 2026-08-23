import { memo, useMemo, useState, type CSSProperties } from 'react'
import { ArrowUp, Boxes, ChevronDown, ChevronRight, Folder } from 'lucide-react'
import type { Translate } from '../i18n'
import { useT } from '../language'
import { collectionsIn, treeActions, useAppStore } from '../store'
import type { CollectionNode, TreeNode } from '../types'
import { useTreeNavigation } from '../useTreeNavigation'
import { shortcuts } from '../shortcuts'
import { COLLECTION_PANEL_ID, collectionTabId } from '../collections'
import { startImport } from '../transfer'
import { EnvironmentPicker } from './EnvironmentPicker'
import { CollectionRail } from './CollectionRail'
import { MethodChip } from './MethodChip'
import { Placeholder, PlaceholderAction } from './Placeholder'
import { TreeRowActions } from './TreeRowActions'

/**
 * The footer used to read "Mock responses", which was true and is not any more.
 * It now carries the one fact the user cannot otherwise check: whether their work
 * is actually on disk. The failure states are the point — a silent autosave that
 * has stopped working is worse than no autosave at all.
 */
function SaveStatus() {
  const { t } = useT()
  const persistenceState = useAppStore(s => s.persistenceState)
  const saveState = useAppStore(s => s.saveState)
  const secretsAvailable = useAppStore(s => s.secretsAvailable)
  const dataDir = useAppStore(s => s.dataDir)

  const [tone, label] =
    persistenceState === 'unavailable'
      ? (['warn', 'sidebar.save.browser'] as const)
      : persistenceState === 'newer-version'
        ? (['error', 'sidebar.save.newer'] as const)
        : saveState === 'error'
          ? (['error', 'sidebar.save.failed'] as const)
          : saveState === 'saving' || saveState === 'pending'
            ? (['pending', 'sidebar.save.saving'] as const)
            : !secretsAvailable
              ? (['warn', 'sidebar.save.noKeychain'] as const)
              : (['ok', 'sidebar.save.saved'] as const)

  return (
    <footer className="sidebar-footer" data-tone={tone} title={dataDir || undefined}>
      <span className="status-dot" aria-hidden="true" />
      {t(label)}
      <UpdateBadge />
    </footer>
  )
}

/**
 * The version, and the one place a postponed update stays visible.
 *
 * Closing the modal hides it but does not forget it, so this corner turns into the way
 * back — otherwise an update declined once would need a restart to be offered again.
 * The number that changes is the signal, not the colour: the footer's rule is that
 * colour reinforces and never carries the meaning alone, and the full sentence is in
 * the label a screen reader and a hover both get.
 */
function UpdateBadge() {
  const { t } = useT()
  const update = useAppStore(s => s.update)
  const dismissed = useAppStore(s => s.updateDismissed)
  const reopenUpdate = useAppStore(s => s.reopenUpdate)

  // Only while the modal is away. During a download it cannot be closed at all, so
  // there is nothing to offer and the installed version stays put.
  const pending = dismissed && 'version' in update ? update.version : ''
  if (!pending) return <span className="ml-auto">{__APP_VERSION__}</span>

  return (
    <button type="button" className="sidebar-update ml-auto" onClick={reopenUpdate} title={t('sidebar.update', { version: pending })}>
      <ArrowUp size={11} aria-hidden="true" />
      {pending}
    </button>
  )
}

/**
 * The one part of a row that has to watch `documents`, in a component of its own.
 *
 * Read from the document rather than the node, for the reason `RequestNode.method` stopped
 * existing: it was a denormalised copy that nothing kept in sync, so changing the method in
 * the editor left the tree showing the old one.
 *
 * It stays a per-row subscription rather than being lifted, because `Sidebar` would then
 * have to subscribe to `documents` — whose identity changes on every keystroke in any open
 * request — and the whole sidebar would re-render per character, which is the failure the
 * `collections` memo below already documents. Kept down here, a keystroke re-renders a
 * `<span>`; and after windowing the number of these subscriptions is priced by the
 * viewport rather than by the workspace.
 */
const RequestMethodChip = memo(function RequestMethodChip({ requestId }: { requestId: string }) {
  const method = useAppStore(s => s.documents[requestId]?.method)
  return method ? <MethodChip method={method} variant="chip" /> : null
})

/**
 * One row of the tree.
 *
 * `memo`ised, with `node` and three integers rather than the `VisibleRow` it used to take:
 * `flattenVisible` mints a fresh row object per node on every tree change, so a `row` prop
 * could never compare equal. `node` can, now that tree updates copy only the spine.
 *
 * Everything else it needs arrives as a prop or through `treeActions`, so the row holds no
 * store subscription of its own. Five of the six it had were selectors over action
 * identities that are fixed for the life of the store — listeners that could never fire but
 * whose selectors zustand ran on every `set()` — and the sixth, `selectedNodeId`, is one
 * subscription in the hook instead of one per row.
 */
const TreeRow = memo(function TreeRow({
  node,
  depth,
  position,
  siblings,
  selected,
  active,
  renaming,
  t,
  onFocusRow,
  onStartRename,
  onEditRename,
  onEndRename,
}: {
  node: TreeNode
  depth: number
  position: number
  siblings: number
  selected: boolean
  active: boolean
  renaming: boolean
  t: Translate
  onFocusRow: (id: string) => void
  onStartRename: (id: string) => void
  onEditRename: (text: string) => void
  onEndRename: (id: string, name: string) => void
}) {
  const select = () => (node.type === 'request' ? treeActions.openRequest(node.requestId) : treeActions.toggleNode(node.id))

  return (
    <div
      className={`tree-row group ${selected ? 'selected' : ''}`}
      role="treeitem"
      data-node-id={node.id}
      tabIndex={active ? 0 : -1}
      aria-level={depth + 1}
      aria-posinset={position}
      aria-setsize={siblings}
      aria-selected={selected}
      aria-expanded={node.type !== 'request' ? node.expanded : undefined}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => {
        onFocusRow(node.id)
        select()
      }}
      // Shift+F10 and the ContextMenu key are the standard way to reach a row's actions
      // from the keyboard, since the buttons themselves are deliberately not tab stops.
      // There is no popup any more, so they move focus onto the first one — which is
      // also what reveals the group, through `:focus-within`.
      onKeyDown={event => {
        if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
          event.preventDefault()
          event.currentTarget.querySelector<HTMLElement>('.tree-actions button')?.focus()
        }
      }}
    >
      {/* Requests get no twisty slot at all. Reserving one lined their labels up with
          branch labels, but it also left 18px of nothing down the left of every leaf
          row, so a request sitting beside a folder read as indented under it — most
          obviously for requests directly in a collection, with no folder to belong
          to. Indentation now comes only from depth, which is the thing that actually
          means nesting. */}
      {node.type !== 'request' &&
        (node.expanded ? (
          <ChevronDown size={13} className="tree-twisty" aria-hidden="true" />
        ) : (
          <ChevronRight size={13} className="tree-twisty" aria-hidden="true" />
        ))}
      {node.type === 'collection' && <Boxes size={14} className="tree-icon" aria-hidden="true" />}
      {node.type === 'folder' && <Folder size={14} className="tree-icon" aria-hidden="true" />}
      {node.type === 'request' && <RequestMethodChip requestId={node.requestId} />}
      {renaming ? (
        /* `autoFocus` is justified here — a single input that appears on demand, on
           desktop, in direct response to choosing Rename. */
        <input
          autoFocus
          className="tree-rename"
          aria-label={t('sidebar.renameInput', { name: node.name })}
          defaultValue={node.name}
          autoComplete="off"
          spellCheck={false}
          onClick={e => e.stopPropagation()}
          // Mirrored into the hook on every keystroke — into a ref, so it costs no render.
          // The row can be unmounted by a scroll, and removing a focused element fires no
          // blur, so without this the typed name would be lost in silence.
          onChange={e => onEditRename(e.target.value)}
          onBlur={e => {
            onEndRename(node.id, e.target.value.trim())
            onFocusRow(node.id)
          }}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              onEndRename(node.id, '')
              onFocusRow(node.id)
            }
          }}
        />
      ) : (
        <span className="truncate flex-1">{node.name}</span>
      )}
      {/* Not while renaming: the group floats over the right edge of the row, so it
          would cover the tail of the input the user is typing into — and it is showing
          exactly then, since the focused input satisfies `:focus-within`. */}
      {!renaming && <TreeRowActions node={node} t={t} onRename={onStartRename} onReturnFocus={onFocusRow} />}
    </div>
  )
})

/**
 * The active collection's name, doubling as the tree's accessible name and as the
 * home for the collection's own actions.
 *
 * Those actions need a home because the collection is no longer a row in the tree —
 * the rail replaced it — so `TreeRowActions` is reused here against the collection
 * node. It already offers exactly New Request / New Folder / Rename / Delete for
 * branch nodes, and the inline rename mirrors what `TreeRow` does. The heading used
 * to hand-roll two of those four buttons beside a menu that repeated them.
 */
/** Module-level so the memoised actions group sees a stable prop. The heading is not a row. */
const noReturnFocus = () => undefined

type PadStyle = CSSProperties & Record<'--vrow-pad-top' | '--vrow-pad-bottom', string>

function CollectionHeading({ collection }: { collection: CollectionNode }) {
  const { t } = useT()
  const renameNode = useAppStore(s => s.renameNode)
  const [renaming, setRenaming] = useState(false)
  const openRename = () => setRenaming(true)

  return (
    <div className="sidebar-section-title">
      {renaming ? (
        <input
          autoFocus
          className="tree-rename"
          aria-label={t('sidebar.renameInput', { name: collection.name })}
          defaultValue={collection.name}
          autoComplete="off"
          spellCheck={false}
          onBlur={e => {
            renameNode(collection.id, e.target.value.trim() || collection.name)
            setRenaming(false)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <span id="collections-label" className="truncate">
          {collection.name}
        </span>
      )}
      {!renaming && <TreeRowActions node={collection} t={t} tabbable onRename={openRename} onReturnFocus={noReturnFocus} />}
    </div>
  )
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useT()
  const addNode = useAppStore(s => s.addNode)
  const tree = useAppStore(s => s.tree)
  const activeCollectionId = useAppStore(s => s.activeCollectionId)
  const {
    rows,
    selectedNodeId,
    activeId,
    activeMounted,
    attachTree,
    windowStart,
    windowEnd,
    padTop,
    padBottom,
    onKeyDown,
    onContainerFocus,
    onContainerBlur,
    focusRow,
    renamingId,
    startRename,
    editRename,
    endRename,
  } = useTreeNavigation()

  // Derived from `tree` rather than selected as `s => collectionsIn(s.tree)`: that
  // selector would build a new array on every store change, and zustand compares
  // with Object.is, so the whole sidebar would re-render on every keystroke.
  const collections = useMemo(() => collectionsIn(tree), [tree])
  const collection = collections.find(c => c.id === activeCollectionId) ?? collections[0]

  // Two custom properties rather than `paddingTop`/`paddingBottom`, so the base 1px and
  // 8px stay declared once in `components.css` and the placeholder scrollers keep them
  // through the `0px` fallback. Typed rather than cast: `CSSProperties` has no index
  // signature for custom properties, and this project does not use `as`.
  const padStyle: PadStyle = { '--vrow-pad-top': `${padTop}px`, '--vrow-pad-bottom': `${padBottom}px` }

  return (
    /* One `<nav>` holding both the rail and the panel, so the landmark, the id and
       the `aria-controls` on the workspace toggle all keep pointing at a live
       element whether or not the panel is showing. */
    <nav className="sidebar" id="sidebar" aria-label={t('sidebar.nav')}>
      <h1 className="sr-only">HTTiny</h1>
      <CollectionRail collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && (
        <div
          className="sidebar-panel"
          id={COLLECTION_PANEL_ID}
          role={collection ? 'tabpanel' : undefined}
          aria-labelledby={collection ? collectionTabId(collection.id) : undefined}
        >
          {collection && <CollectionHeading collection={collection} />}
          {/* Under the collection's name rather than in the tab strip, which is where the
              workspace-global version of this lived and had to carry a label saying which
              collection it really acted on. Here the panel is the scope, and the control is
              visibly inside the collection it belongs to. (The strip is scoped to one
              collection too now, but that only removes the old symptom — it does not make a
              workspace-wide picker over per-collection pools mean anything.) */}
          {collection && <EnvironmentPicker collection={collection} />}
          {/* Two empty states, not one: with the tree scoped to a collection, "no
              rows" no longer means "nothing exists" — it usually means this
              collection is empty, which needs a different way out. */}
          {!collection ? (
            <div className="tree-scroll">
              <Placeholder icon={<Boxes size={20} />} title={t('sidebar.noCollections.title')} description={t('sidebar.noCollections.desc')}>
                <PlaceholderAction onClick={() => addNode('collection')}>{t('sidebar.noCollections.action')}</PlaceholderAction>
                {/* The second way out of an empty app, and the one Settings would hide.
                    Somebody who already has a workspace somewhere is looking at this
                    screen precisely because they do not want to start from nothing.
                    It opens the same flow the Storage panel does, confirmation and all —
                    there is nothing to replace here, but the question still names what
                    arrives. */}
                <PlaceholderAction variant="secondary" onClick={() => void startImport(t('transfer.import.dialog'))}>
                  {t('sidebar.noCollections.import')}
                </PlaceholderAction>
              </Placeholder>
            </div>
          ) : rows.length === 0 ? (
            <div className="tree-scroll">
              <Placeholder icon={<Boxes size={20} />} title={t('sidebar.empty.title')} description={t('sidebar.empty.desc', { name: collection.name })}>
                <PlaceholderAction shortcut={shortcuts.newRequest} onClick={() => addNode('request')}>
                  {t('sidebar.empty.newRequest')}
                </PlaceholderAction>
                <PlaceholderAction variant="secondary" onClick={() => addNode('folder')}>
                  {t('sidebar.empty.newFolder')}
                </PlaceholderAction>
              </Placeholder>
            </div>
          ) : (
            <div
              className="tree-scroll"
              ref={attachTree}
              role="tree"
              aria-labelledby="collections-label"
              /* The tree is one tab stop, and this only moves it. When the roving row is
                 outside the rendered window there is no element to carry `tabIndex={0}`,
                 and without this the whole tree would drop out of the tab order — the
                 WCAG 2.1.1 regression `useTreeNavigation` exists to prevent. `-1` the rest
                 of the time keeps the container programmatically focusable, which is what
                 the parking effect needs, without adding a second stop. */
              tabIndex={activeMounted ? -1 : 0}
              onFocus={onContainerFocus}
              onBlur={onContainerBlur}
              onKeyDown={onKeyDown}
              style={padStyle}
            >
              {rows.slice(windowStart, windowEnd).map(row => (
                <TreeRow
                  key={row.node.id}
                  node={row.node}
                  depth={row.depth}
                  position={row.position}
                  siblings={row.siblings}
                  selected={row.node.id === selectedNodeId}
                  active={row.node.id === activeId}
                  renaming={row.node.id === renamingId}
                  t={t}
                  onFocusRow={focusRow}
                  onStartRename={startRename}
                  onEditRename={editRename}
                  onEndRename={endRename}
                />
              ))}
            </div>
          )}
          <SaveStatus />
        </div>
      )}
    </nav>
  )
}
