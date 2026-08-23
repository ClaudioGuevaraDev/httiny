/**
 * One definition per shortcut, so the key handler, the tooltips, the command
 * palette rows and the empty-state hints cannot drift apart. Ctrl+Enter used to be
 * wired as `document.querySelector('.send-btn')?.click()`, which meant renaming a
 * CSS class silently broke the shortcut.
 */
export const shortcuts = {
  save: ['Ctrl', 'S'],
  send: ['Ctrl', '↵'],
  close: ['Ctrl', 'W'],
  palette: ['Ctrl', 'K'],
  find: ['Ctrl', 'F'],
  newRequest: ['Ctrl', 'N'],
  toggleSidebar: ['Ctrl', 'B'],
  toggleSplit: ['Ctrl', '\\'],
  settings: ['Ctrl', ','],
  // Free against CodeMirror's default keymap and against WebView2, which has no address
  // bar for Ctrl+E to open. It acts on the collection the sidebar is showing, which is
  // the only collection whose environments are on screen to begin with.
  environments: ['Ctrl', 'E'],
  // Not Ctrl+/ and not Ctrl+Shift+C, which both look more mnemonic and are both taken:
  // the first is `toggleComment` in CodeMirror's default keymap, so it belongs to the body
  // editor, and the second opens the webview's element inspector.
  code: ['Ctrl', "'"],
  // `+` rather than `=`, because that is the key the user is aiming for even though the
  // event arrives as `=` unshifted. `useGlobalShortcuts` accepts both.
  zoomIn: ['Ctrl', '+'],
  zoomOut: ['Ctrl', '-'],
  zoomReset: ['Ctrl', '0'],
  cancel: ['Esc'],
} as const

export type ShortcutName = keyof typeof shortcuts

const isApple = (): boolean => /mac|iphone|ipad/i.test(navigator.userAgent)

export const formatShortcut = (keys: readonly string[]): string[] => (isApple() ? keys.map(key => (key === 'Ctrl' ? '⌘' : key)) : [...keys])

export const shortcutHint = (name: ShortcutName): string => formatShortcut(shortcuts[name]).join(' ')

/**
 * `combo` is written as `mod+k`, where `mod` is Ctrl on Windows/Linux and Cmd on
 * macOS. Modifier state is matched exactly so `Ctrl+Shift+K` never satisfies
 * `mod+k`.
 */
export function matchesCombo(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  const wantMod = parts.includes('mod')
  const wantShift = parts.includes('shift')
  const wantAlt = parts.includes('alt')

  const hasMod = event.ctrlKey || event.metaKey
  if (hasMod !== wantMod) return false
  if (event.shiftKey !== wantShift) return false
  if (event.altKey !== wantAlt) return false

  if (key === 'enter') return event.key === 'Enter'
  if (key === 'escape') return event.key === 'Escape'
  return event.key.toLowerCase() === key
}
