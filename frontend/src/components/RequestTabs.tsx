import { useMemo } from 'react'
import { X } from 'lucide-react'
import { requestTabId } from '../domIds'
import { useT } from '../language'
import { cancelRequest } from '../requestRunner'
import { shownCollection, tabsIn, useAppStore } from '../store'
import { useRovingFocus } from '../useRovingFocus'
import { MethodChip } from './MethodChip'

/**
 * One collection's open requests, and never another's.
 *
 * The strip used to iterate `tabs` whole, so it could hold requests from four collections
 * at once while the panel below it showed one — the editor then held a request that was in
 * neither the tree beside it nor the collection whose environments would resolve its
 * `{{variables}}`. Nothing is stored per collection to fix that: `tabs` is still one flat
 * list and `tabsIn` filters it, which is why leaving a collection and coming back finds its
 * tabs exactly as they were.
 *
 * The three primitives are selected and the list derived in a `useMemo`, not selected as a
 * list: zustand needs a stable snapshot, and a selector building a fresh array on every
 * store read would loop. Same shape as `Sidebar`, which derives `collections` the same way.
 *
 * `shownCollection` rather than `activeCollectionId` straight, for the reason its doc
 * comment gives — the rail, the panel and `useTreeNavigation` all fall back to
 * `collections[0]`, and the strip has to answer the question the way they do or it would
 * empty itself while a collection is plainly on screen.
 */
export function RequestTabs() {
  const { t } = useT()
  const tree = useAppStore(s => s.tree)
  const tabs = useAppStore(s => s.tabs)
  const activeCollectionId = useAppStore(s => s.activeCollectionId)
  const activeId = useAppStore(s => s.activeId)
  const documents = useAppStore(s => s.documents)
  const setActive = useAppStore(s => s.setActive)
  const closeRequest = useAppStore(s => s.closeRequest)
  const onKeyDown = useRovingFocus('[role="tab"]')

  const visible = useMemo(() => tabsIn({ tree, tabs }, shownCollection({ tree, activeCollectionId })?.id ?? null), [tree, tabs, activeCollectionId])

  // Which tab owns the strip's single tab stop, and it is not always the active one: a
  // `ui.json` whose `activeId` no longer resolves restores tabs with none of them active,
  // and keying `tabIndex` straight off `activeId` would then set every tab to -1 and drop
  // the strip out of the tab order entirely. `CollectionRail` has the same fallback for the
  // same reason. `aria-selected` and the active style stay keyed to the real `activeId` —
  // this makes a tab reachable, it does not claim one is selected.
  const stop = activeId && visible.includes(activeId) ? activeId : visible[0]

  return (
    <div className="request-tabs" role="tablist" aria-label={t('tabs.list')} onKeyDown={onKeyDown}>
      {visible.map(id => {
        const doc = documents[id]
        if (!doc) return null
        // No confirmation: edits are already on disk, and closing a tab has never
        // deleted anything — the request stays in the tree and reopens with its
        // content intact.
        const close = () => {
          cancelRequest(id)
          closeRequest(id)
        }
        return (
          /*
            This was one <button> containing a nested <span role="button"> for the
            close control: invalid HTML, and assistive tech announced the pair as a
            single control. It is now a plain container with two real sibling
            buttons, so each is separately reachable and labelled.

            The container is `presentation` because a tablist may only contain tabs, and
            the close button is not one. Arrow keys move between tabs; the active tab is
            the strip's only tab stop, and activation is manual (Enter or Space) so
            arrowing past a request does not load it.
          */
          <div key={id} role="presentation" className={`request-tab ${id === activeId ? 'active' : ''}`}>
            <button
              type="button"
              role="tab"
              id={requestTabId(id)}
              aria-selected={id === activeId}
              aria-controls="request-editor-panel"
              tabIndex={id === stop ? 0 : -1}
              className="tab-main"
              onClick={() => setActive(id)}
            >
              <MethodChip method={doc.method} variant="compact" decorative />
              <span className="truncate">{doc.name}</span>
            </button>
            <button type="button" className="tab-close" aria-label={t('tabs.close', { name: doc.name })} onClick={close}>
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        )
      })}
      <div role="presentation" className="tabs-spacer" />
    </div>
  )
}
