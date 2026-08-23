import { useEffect, useRef, type ReactNode } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useT } from '../language'
import { findNode, requestIdsIn, useAppStore } from '../store'
import type { ConfirmIntent, TreeNode } from '../types'

/**
 * Everything the dialog draws, resolved from the intent before anything is rendered.
 * `null` is "there is nothing to ask", which is also what keeps the dialog closed.
 */
type Copy = {
  tone: 'accent' | 'danger'
  icon: ReactNode
  title: string
  detail: string
  action: string
}

/**
 * The one confirmation in the app, and the reason it exists: both of these questions
 * used to be `window.confirm`, which a webview draws as the *platform's* dialog —
 * titled "wails.localhost:9245 says", naming the internal asset-server origin, with
 * OK/Cancel supplied by the OS. None of that follows the app's language, theme or zoom,
 * and none of it can be changed from the page. The only fix is to not ask that way.
 *
 * Same shell as the settings and update modals, and for the same four reasons:
 * `<dialog>` with `showModal()` supplies a real focus trap, top-layer rendering, focus
 * restoration on close and native Escape. The body only mounts while open, and closing
 * always goes through `dialog.close()` so the DOM and the store cannot desync.
 *
 * One instance, at the app root, addressed through `store.confirm`. It cannot live in
 * the row that raises it: `TreeRowActions` renders inside a `role="treeitem"`, whose
 * only allowed children are groups and treeitems, and a nested `<dialog>` stays a
 * treeitem descendant in the accessibility tree even while it paints in the top layer.
 * Being at the root is also what lets it stack over the settings modal — top-layer
 * order follows the `showModal()` calls, not the DOM.
 */
export function ConfirmDialog() {
  const intent = useAppStore(s => s.confirm)
  const closeConfirm = useAppStore(s => s.closeConfirm)
  // The store holds an id; the name and the count are what the question is made of.
  // `findNode` hands back the node itself, so its identity is stable and this
  // re-renders only when the tree actually changes.
  const node = useAppStore(s => (intent?.kind === 'deleteNode' ? findNode(s.tree, intent.nodeId) : null))
  const dialogRef = useRef<HTMLDialogElement>(null)
  const copy = useCopy(intent, node)
  const open = copy !== null

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    // No `dialog.focus()` here, unlike `UpdateModal`: that one opens on its own, with no
    // pointer signal to suppress `:focus-visible`, so its first button came up ringed.
    // This dialog always opens from a click, so the default — focus the first control,
    // which is Cancel — is both correct and quiet.
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      // `alertdialog`, not the implicit `dialog`: this interrupts to ask a question with
      // consequences, which is exactly the distinction the role draws.
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-detail"
      onClose={closeConfirm}
      onClick={event => {
        if (event.target === dialogRef.current) dialogRef.current?.close()
      }}
    >
      {copy && <ConfirmBody copy={copy} onCancel={() => dialogRef.current?.close()} />}
    </dialog>
  )
}

/**
 * Where an intent becomes words. A switch rather than a lookup table, because the delete
 * case has to read the node to know which of its four messages applies.
 *
 * `useT` is the only hook here and it runs unconditionally, so the early returns below
 * are just returns.
 */
function useCopy(intent: ConfirmIntent | null, node: TreeNode | null): Copy | null {
  const { t, plural } = useT()
  if (!intent) return null

  switch (intent.kind) {
    case 'deleteNode': {
      // A node that has gone is not a question anyone can answer, so the dialog stays
      // shut rather than opening on an empty name. Nothing in the app removes a node
      // behind an open confirmation; this is what makes that a closed door instead of a
      // blank dialog.
      if (!node) return null
      // Deleting a folder prunes every request beneath it — documents, tabs and stored
      // responses — so the question says how much is going, not just the name.
      const count = requestIdsIn(node).length
      // Whole questions rather than a clause spliced into one. Spanish puts the count
      // inside an agreeing noun phrase — "y las 3 solicitudes que contiene" — which no
      // amount of concatenation can produce. Zero gets its own message because neither
      // language has a CLDR `zero` category to select.
      const title =
        node.type === 'request'
          ? t('tree.confirm.request', { name: node.name })
          : count === 0
            ? t('tree.confirm.empty', { name: node.name })
            : plural('tree.confirm.container', count, { name: node.name })
      return { tone: 'danger', icon: <Trash2 size={18} />, title, detail: t('tree.confirm.detail'), action: t('tree.confirm.action') }
    }
    case 'resetSettings':
      // Accent, not danger: red in this app means something is destroyed and cannot come
      // back, and every value this touches can be set again from the panel behind it —
      // the distinction `.settings-reset` already makes about its own hover colour.
      return {
        tone: 'accent',
        icon: <RotateCcw size={18} />,
        title: t('settings.reset.confirm'),
        detail: t('settings.reset.detail'),
        // The button that opened the dialog says "Restore defaults"; so does the one that
        // carries it out. A second phrasing for the same act would only raise the question
        // of how the two differ.
        action: t('settings.reset.label'),
      }
    default: {
      // Not reachable: the switch above covers ConfirmIntent. This exists so that adding
      // a member without copy fails to compile.
      const exhaustive: never = intent
      return exhaustive
    }
  }
}

function ConfirmBody({ copy, onCancel }: { copy: Copy; onCancel: () => void }) {
  const { t } = useT()
  const runConfirm = useAppStore(s => s.runConfirm)

  return (
    <div className="confirm-shell">
      <div className="confirm-head">
        <span className="confirm-icon" data-tone={copy.tone} aria-hidden="true">
          {copy.icon}
        </span>
        <div>
          <h2 id="confirm-title">{copy.title}</h2>
          <p id="confirm-detail" className="confirm-detail">
            {copy.detail}
          </p>
        </div>
      </div>

      {/* Cancel first, in the markup and on screen: `showModal()` focuses the first
          control, and on a dialog guarding a delete that has to be the way out. The same
          pair the update modal uses, for the reason it gives there — `.send-btn` is sized
          for the request bar and reads oversized beside a secondary button. */}
      <div className="confirm-actions">
        <button type="button" className="placeholder-action action-secondary" onClick={onCancel}>
          {t('confirm.cancel')}
        </button>
        <button
          type="button"
          className={`placeholder-action ${copy.tone === 'danger' ? 'action-danger' : 'action-primary'}`}
          // `runConfirm` clears the intent, which closes the dialog through the effect
          // above — so there is no `onCancel()` to pair with this, and no way for the two
          // to disagree about whether it is still open.
          onClick={runConfirm}
        >
          {copy.action}
        </button>
      </div>
    </div>
  )
}
