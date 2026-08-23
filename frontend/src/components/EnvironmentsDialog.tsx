import { lazy, Suspense, useEffect, useRef } from 'react'
import { useAppStore } from '../store'

/**
 * The environments manager, addressed by a collection **id** rather than a boolean.
 *
 * That is the whole reason the store field is `environmentsFor` and not `environmentsOpen`:
 * the rail can move under an open dialog — a send finishing, a shortcut, a request opened
 * elsewhere — and a dialog that followed would silently retarget every edit made in it.
 *
 * Same shell as the settings modal, and loaded the same way: on demand, since most sessions
 * never open it. `fallback={null}` because the chunk comes off the embedded filesystem.
 */
const EnvironmentsBody = lazy(() => import('./EnvironmentsBody'))

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
      {open && (
        <Suspense fallback={null}>
          <EnvironmentsBody collection={collection} onDismiss={() => dialogRef.current?.close()} />
        </Suspense>
      )}
    </dialog>
  )
}
