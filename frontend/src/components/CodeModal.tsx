import { lazy, Suspense, useEffect, useRef } from 'react'
import { useAppStore } from '../store'

/**
 * The code view: what the app is about to send, and how to say the same thing elsewhere.
 *
 * Same shell as `SettingsModal` and the command palette, for the same four reasons —
 * `<dialog>` with `showModal()` supplies a real focus trap, top-layer rendering, focus
 * restoration on close and native Escape. The body only mounts while open, which is what
 * keeps `useWire` from resolving requests nobody is looking at, and closing always goes
 * through `dialog.close()` so the DOM and the store cannot desync.
 *
 * The body is also the only thing in the app that pulls in the eleven snippet generators
 * and the nine `@codemirror/legacy-modes` grammars that highlight them, so it is loaded on
 * demand rather than at startup. `fallback={null}` because the chunk comes off the
 * embedded filesystem: there is no network, and a spinner for one frame would be worse
 * than an empty dialog for one frame.
 */
const CodeBody = lazy(() => import('./CodeBody'))

export function CodeModal() {
  const open = useAppStore(s => s.codeOpen)
  const closeCode = useAppStore(s => s.closeCode)
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
      className="code-dialog"
      aria-modal="true"
      aria-labelledby="code-title"
      onClose={closeCode}
      onClick={event => {
        if (event.target === dialogRef.current) dialogRef.current?.close()
      }}
    >
      {open && (
        <Suspense fallback={null}>
          <CodeBody onDismiss={() => dialogRef.current?.close()} />
        </Suspense>
      )}
    </dialog>
  )
}
