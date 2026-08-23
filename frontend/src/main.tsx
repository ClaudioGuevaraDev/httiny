import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initCodeFontSize } from './codeFont'
import { initLanguage } from './language'
import { hydrate } from './persistence'
import { installBodyRelease, installOrphanAbort } from './requestRunner'
import { initTheme } from './theme'
import { checkForUpdate } from './updates'
import { initZoom } from './zoom'
// Self-hosted: the app is an offline desktop binary and cannot fetch webfonts at
// runtime. The two `@fontsource-variable` packages used to be imported here as whole
// families; they now come in through `styles/fonts.css`, which declares only the latin
// subsets the app's two locales can reach. Vite resolves the bare specifiers in a
// stylesheet's `url()` just as it does in an import, so nothing about asset hashing
// changes — see that file for why the other eight subsets were dead weight in a binary
// rather than unfetched bytes in a browser.
import './styles.css'

/**
 * Load the workspace before the first render.
 *
 * The store is built synchronously at module scope, but reading the file is an
 * async call into Go. Rendering afterwards is what keeps the first paint from being
 * an empty workspace that then jumps to the real one, and it is why the autosave
 * subscriber can never see the pre-load state and write `[]` over real collections
 * — `hydrate` installs it as its last act.
 *
 * `hydrate()` never rejects, so the app always paints. Until it resolves the window
 * shows its BackgroundColour, which is the same colour as the app shell, so the gap
 * is invisible rather than a white flash.
 */
void hydrate().then(() => {
  // All four between the two for the same reason the render is after the hydration: the
  // theme, the language, the zoom and the code size have to be on the document before
  // anything paints, and none can be known until the stored preferences have been read.
  // The catalogues are static imports, so there is nothing to await for the language.
  initTheme()
  initLanguage()
  initZoom()
  initCodeFontSize()
  // Unlike the four above, this one has nothing to do with the first paint: it is a
  // store subscriber, and it goes here rather than at module scope so that importing
  // `requestRunner` stays free of side effects.
  installBodyRelease()
  installOrphanAbort()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  warmEditor()
  // Deliberately after the render and deliberately not awaited: the check is a
  // network round trip to GitHub, and nothing about the first paint depends on it.
  // It stays silent unless it finds something, so in the common case the user never
  // learns it happened. `checkForUpdate` swallows its own failures.
  void checkForUpdate()
})

/**
 * Pulls the CodeMirror chunk in once the app is idle.
 *
 * Splitting it out took roughly half the startup chunk off the first paint, but the cost
 * of a split is paid at the other end: the first click into the URL bar would wait for
 * ~400 KB to load and parse before a caret appeared. Fetching it during the first idle
 * period keeps the whole saving — nothing here blocks the paint — and means the field is
 * already warm by the time anyone reaches it. The same chunk backs the body editor and
 * the response viewer, so this warms all three.
 *
 * `requestIdleCallback` with a timeout, and a plain timer where it does not exist: not
 * every WebKit build has it, and a warm-up that never runs would be a silent regression
 * rather than a visible one. Tested with `typeof` rather than `in`, because `lib.dom`
 * declares the method unconditionally and `in` would narrow the fallback branch to
 * `never`.
 */
function warmEditor(): void {
  const load = () => void import('./singleLine')
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(load, { timeout: 2000 })
  else window.setTimeout(load, 1000)
}
