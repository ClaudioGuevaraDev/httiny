import { lazy, Suspense, useEffect, useRef } from 'react'
import { useAppStore } from '../store'

/**
 * Built on the native `<dialog>` with `showModal()`, which supplies four things for
 * free: a real focus trap, top-layer rendering above everything, focus restoration on
 * close, and Escape. The body only mounts while open, so the command list — and the
 * whole-tree walk behind it — costs nothing when closed. Closing always goes through
 * `dialog.close()` rather than the store, so the DOM and the store cannot desync.
 *
 * The body is loaded on demand as well, so the fuzzy matcher and the command list are
 * not part of the first paint. `fallback={null}` because the chunk comes off the
 * embedded filesystem.
 */
const CommandPaletteBody = lazy(() => import('./CommandPaletteBody'))

export function CommandPalette() {
  const open = useAppStore(s => s.paletteOpen)
  const closePalette = useAppStore(s => s.closePalette)
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
      className="palette-dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClose={closePalette}
      onClick={event => {
        if (event.target === dialogRef.current) dialogRef.current?.close()
      }}
    >
      {open && (
        <Suspense fallback={null}>
          <CommandPaletteBody onDismiss={() => dialogRef.current?.close()} />
        </Suspense>
      )}
    </dialog>
  )
}
