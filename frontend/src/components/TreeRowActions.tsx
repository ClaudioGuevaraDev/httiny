import { memo, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { FilePlus2, FolderPlus, PenLine, Trash2 } from 'lucide-react'
import type { Translate } from '../i18n'
import { treeActions } from '../store'
import type { TreeNode } from '../types'

/**
 * The per-row actions, laid out in the row itself rather than behind a `⋯` popup.
 *
 * Every action used to cost two clicks — open the menu, pick the item — for a set of
 * four that always fits on a 28px row. Dropping the popup also drops everything it
 * needed to be a popup: outside-pointerdown dismissal, `role="menu"`, an open state
 * threaded through the row, and an entrance animation.
 *
 * What it keeps is the focus contract, because that was never about the menu. The delete
 * confirmation has moved out to `ConfirmDialog`, which is at the app root rather than in
 * here: a `<dialog>` nested in a `role="treeitem"` stays a treeitem descendant in the
 * accessibility tree, and a treeitem may only contain groups and treeitems.
 *
 * `tabbable` is the difference between the two places this renders. Inside a `treeitem`
 * the buttons must not be tab stops — the tree pattern allows exactly one for the whole
 * tree — so they are reached with Shift+F10 or the ContextMenu key, the same entry point
 * the menu had, and then with ← / →. In the panel heading there is no such rule and no
 * such entry point, so there they are ordinary tab stops.
 *
 * `memo`ised, and worth it even though `TreeRow` is too: `active` flips on every arrow key
 * and `selected` on every click, so the row re-renders constantly with `node` and `t`
 * unchanged. Skipping this subtree is nine `t()` interpolations and four button trees each
 * time. That is also why `t` arrives as a prop and the two actions come from `treeActions`:
 * `useT()` plus two store selectors was four external-store subscriptions per row, none of
 * which could ever produce a different value.
 */
export const TreeRowActions = memo(function TreeRowActions({
  node,
  t,
  tabbable = false,
  onRename,
  onReturnFocus,
}: {
  node: TreeNode
  t: Translate
  tabbable?: boolean
  /** Both take the id, so one stable callback serves every row — which is what memo needs. */
  onRename: (id: string) => void
  onReturnFocus: (id: string) => void
}) {
  const groupRef = useRef<HTMLDivElement>(null)

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['Escape', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    // The group renders *inside* the treeitem it belongs to, so every one of these keys
    // also means something to the tree's own handler. Without this the arrow keys would
    // move between buttons and then immediately move tree focus out from under them.
    event.stopPropagation()
    event.preventDefault()

    if (event.key === 'Escape') {
      onReturnFocus(node.id)
      return
    }
    const buttons = [...(groupRef.current?.querySelectorAll<HTMLElement>('button') ?? [])]
    const current = buttons.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Home' || event.key === 'End') buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus()
    else buttons[(current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
  }

  // The row's own click opens the request or folds the branch, which is not what
  // pressing one of its buttons means.
  const run = (action: () => void) => (event: ReactMouseEvent) => {
    event.stopPropagation()
    onReturnFocus(node.id)
    action()
  }

  return (
    <div ref={groupRef} className="tree-actions" role="group" aria-label={t('tree.actions', { name: node.name })} onKeyDown={onKeyDown}>
      {/* Four icons with no text on the same row: each label has to say what it acts on,
          or "New folder" reads as "new folder somewhere". */}
      {node.type !== 'request' && (
        <>
          <button
            type="button"
            className="icon-btn xs"
            tabIndex={tabbable ? undefined : -1}
            aria-label={t('tree.newRequestIn.aria', { name: node.name })}
            title={t('tree.newRequestIn.title', { name: node.name })}
            onClick={run(() => treeActions.addNode('request', node.id))}
          >
            <FilePlus2 size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn xs"
            tabIndex={tabbable ? undefined : -1}
            aria-label={t('tree.newFolderIn.aria', { name: node.name })}
            title={t('tree.newFolderIn.title', { name: node.name })}
            onClick={run(() => treeActions.addNode('folder', node.id))}
          >
            <FolderPlus size={13} aria-hidden="true" />
          </button>
        </>
      )}
      {/* Rename is the one action that does not hand focus back to the row: it swaps the
          row's label for an input that focuses itself, and returning focus first would
          race that. */}
      <button
        type="button"
        className="icon-btn xs"
        tabIndex={tabbable ? undefined : -1}
        aria-label={t('tree.rename.aria', { name: node.name })}
        title={t('tree.rename.title', { name: node.name })}
        onClick={event => {
          event.stopPropagation()
          onRename(node.id)
        }}
      >
        <PenLine size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="icon-btn xs danger"
        tabIndex={tabbable ? undefined : -1}
        aria-label={t('tree.delete.aria', { name: node.name })}
        title={t('tree.delete.title', { name: node.name })}
        onClick={run(() => treeActions.askConfirm({ kind: 'deleteNode', nodeId: node.id }))}
      >
        <Trash2 size={13} aria-hidden="true" />
      </button>
    </div>
  )
})
