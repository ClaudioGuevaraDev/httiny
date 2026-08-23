import { HTTPService } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/httpexec'
import type { WireResult } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/httpexec'
import { resolveFor } from './environments'
import { toRequestDTO } from './requestDTO'
import { fromResult } from './snippets/types'
import type { SnippetTarget } from './snippets/targets'
import type { RequestDocument } from './types'

/**
 * Asks Go what it would send.
 *
 * The one bridge to `HTTPService.Wire`, so the row-model-to-DTO translation exists once.
 * It is the same translation `goExecutor` performs for a send, and deliberately so: if the
 * two disagreed, the code view would describe a request nobody makes.
 *
 * Lives outside React because two callers need it and only one of them is a component —
 * the palette's "Copy as curl" runs from a command, with nowhere to hang a hook.
 */
export const wireFor = (request: RequestDocument): Promise<WireResult> => HTTPService.Wire(toRequestDTO(request, resolveFor(request.id)))

/**
 * Puts one target's snippet on the clipboard without opening the code view.
 *
 * Best effort, like `goExecutor.release`: this runs from a command palette entry that has
 * already closed by the time the answer arrives, so there is nowhere to report to. A
 * failure leaves the clipboard alone rather than throwing into a promise nobody awaits.
 *
 * Secrets are **not** redacted here. The point of the shortcut is a snippet that runs when
 * pasted, and the toggle that hides them is a deliberate act taken in the modal.
 */
export const copySnippet = async (request: RequestDocument, target: SnippetTarget): Promise<void> => {
  try {
    // Imported here rather than at the top of the file, and that is the last edge holding
    // the snippet generators in the startup chunk: `useCommands` imports this module for
    // the palette's "Copy as curl", so a static import made all eleven of them — and the
    // nine grammars `highlight.ts` pulls in — part of the first paint for everyone who
    // never opens the code view. This function was already async, so it costs nothing.
    const [{ snippetFor }, answer] = await Promise.all([import('./snippets'), wireFor(request)])
    if (!answer.ok) return
    await navigator.clipboard.writeText(snippetFor(target, fromResult(answer), false))
  } catch (error) {
    console.warn('Could not copy the request as a snippet', error)
  }
}
