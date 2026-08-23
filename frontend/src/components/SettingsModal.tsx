import { lazy, Suspense, useEffect, useRef } from 'react'
import { useAppStore } from '../store'

/**
 * Same shell as the command palette, and for the same four reasons: `<dialog>` with
 * `showModal()` supplies a real focus trap, top-layer rendering, focus restoration on
 * close and native Escape. The body only mounts while open, and closing always goes
 * through `dialog.close()` so the DOM and the store cannot desync.
 *
 * It is also the largest surface in the app that most sessions never open, so it is
 * loaded on demand. `fallback={null}` because the chunk comes off the embedded
 * filesystem — there is no network, and a spinner for one frame would read worse than
 * an empty dialog for one frame.
 */
const SettingsBody = lazy(() => import('./SettingsBody'))

export function SettingsModal() {
  const open = useAppStore(s => s.settingsOpen)
  const closeSettings = useAppStore(s => s.closeSettings)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClose={closeSettings}
      onClick={event => {
        if (event.target === dialogRef.current) dialogRef.current?.close()
      }}
    >
      {open && (
        <Suspense fallback={null}>
          <SettingsBody onDismiss={() => dialogRef.current?.close()} />
        </Suspense>
      )}
    </dialog>
  )
}
