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
// runtime. Imported here rather than through a CSS @import so Vite resolves the
// bare specifiers and rewrites the .woff2 asset URLs deterministically. Both must
// come before styles.css so the cascade order stays predictable.
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource-variable/jetbrains-mono'
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
  // Deliberately after the render and deliberately not awaited: the check is a
  // network round trip to GitHub, and nothing about the first paint depends on it.
  // It stays silent unless it finds something, so in the common case the user never
  // learns it happened. `checkForUpdate` swallows its own failures.
  void checkForUpdate()
})
