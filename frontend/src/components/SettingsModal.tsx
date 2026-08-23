import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Copy, Download, HardDrive, Minus, Palette, PanelsTopLeft, Plus, RotateCcw, Settings2, Upload, X } from 'lucide-react'
import type { MessageKey, PlainMessageKey } from '../i18n'
import { useT } from '../language'
import { BODY_LANGUAGES, bodyLanguageLabel } from '../responseBody'
import { useSystemTheme } from '../theme'
import type { ImportRejection, Locale, ThemePreference } from '../types'
import { shortcuts } from '../shortcuts'
import { CODE_FONT_SIZE, SIDEBAR_WIDTH, SPLIT_RATIO, ZOOM, useAppStore } from '../store'
import { exportWorkspace, startImport } from '../transfer'
import { useCopy } from '../useCopy'
import { useRovingFocus } from '../useRovingFocus'
import { useSave } from '../useSave'
import { Shortcut } from './Placeholder'
import { Select } from './Select'

/**
 * The tablist is the table of contents, so the split is by what a row *is* and every
 * panel stays short enough not to scroll. Everything used to live under General, which
 * had grown four headings deep and overflowed while this list sat at two entries with one
 * of them empty — the navigation dividing a panel between one.
 *
 * Appearance and Layout are apart even though both are "how it looks": one is what the app
 * *looks* like (colour, type sizes) and the other is its *geometry*. Together they would
 * be six rows and the scrollbar would be back.
 *
 * The panel is a field here rather than a branch at the render site. It used to be a
 * ternary, where a new section fell into the `else` and silently came out as the storage
 * placeholder.
 */
const SECTIONS = [
  { id: 'general', label: 'settings.section.general', icon: Settings2, Panel: GeneralSection },
  { id: 'appearance', label: 'settings.section.appearance', icon: Palette, Panel: AppearanceSection },
  { id: 'layout', label: 'settings.section.layout', icon: PanelsTopLeft, Panel: LayoutSection },
  { id: 'storage', label: 'settings.section.storage', icon: HardDrive, Panel: StorageSection },
] as const satisfies readonly { id: string; label: MessageKey; icon: typeof Settings2; Panel: () => ReactNode }[]

/** Derived from the table rather than declared beside it: a section cannot exist without a panel. */
type Section = (typeof SECTIONS)[number]['id']

/**
 * Still no icons, but no longer because it is impossible — `Select` draws its own menu
 * and every option can carry a glyph, which is what the method picker uses. Nothing is
 * lost that the words were not already carrying: "System" / "Light" / "Dark" name the
 * choice without leaning on one.
 */
const THEMES = [
  { id: 'system', label: 'settings.theme.system' },
  { id: 'light', label: 'settings.theme.light' },
  { id: 'dark', label: 'settings.theme.dark' },
] as const satisfies readonly { id: ThemePreference; label: MessageKey }[]

/**
 * The in-sentence forms, which are not the button labels: Spanish lower-cases a theme
 * name mid-sentence, and the previous version spliced the raw `'light'` / `'dark'`
 * token into the copy, which would have read "Siempre dark".
 */
const THEME_INLINE = {
  light: 'settings.theme.inline.light',
  dark: 'settings.theme.inline.dark',
} as const satisfies Record<'light' | 'dark', MessageKey>

/**
 * Endonyms, and the one set of labels in the app that is deliberately identical in
 * every locale: someone who cannot read the current interface has to be able to find
 * their own language in this list. No flags either — a flag is a country, and Español
 * is not Spain.
 */
const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
] as const satisfies readonly { id: Locale; label: string }[]

const panelId = (section: Section) => `settings-panel-${section}`
const tabId = (section: Section) => `settings-tab-${section}`

/**
 * Same shell as the command palette, and for the same four reasons: `<dialog>` with
 * `showModal()` supplies a real focus trap, top-layer rendering, focus restoration on
 * close and native Escape. The body only mounts while open, and closing always goes
 * through `dialog.close()` so the DOM and the store cannot desync.
 */
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
      {open && <SettingsBody onDismiss={() => dialogRef.current?.close()} />}
    </dialog>
  )
}

function SettingsBody({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useT()
  // Opens on Storage when an import was just refused elsewhere, so the reason is on
  // screen rather than a tab away. A lazy initialiser rather than an effect: the correct
  // tab is the one the first paint shows.
  const [section, setSection] = useState<Section>(() => (useAppStore.getState().importRejection ? 'storage' : 'general'))
  // Vertical, unlike every other tablist in the app: the sections are a column, and
  // the ARIA pattern says the arrow keys have to follow the layout, not the role.
  const onNavKeyDown = useRovingFocus('[role="tab"]', 'vertical')
  // `?? SECTIONS[0]` rather than a `!`: it is a tuple, index 0 exists, and nothing has to
  // be asserted to say so.
  const { Panel: ActivePanel } = SECTIONS.find(entry => entry.id === section) ?? SECTIONS[0]
  // Only the question; `ConfirmDialog` words it and `runConfirm` carries it out. This used
  // to be a `window.confirm`, which a webview draws as the platform's own dialog — with
  // the asset server's origin in the title bar and OK/Cancel from the OS.
  const askConfirm = useAppStore(s => s.askConfirm)

  return (
    <div className="settings-shell">
      {/* The heading sits beside the tablist, not inside it: a tablist's children are
          tabs, and a screen reader walking one should not find a heading in there. */}
      <div className="settings-nav">
        <h2 id="settings-title" className="settings-title">
          {t('settings.title')}
        </h2>
        <div className="settings-sections" role="tablist" aria-orientation="vertical" aria-label={t('settings.sections')} onKeyDown={onNavKeyDown}>
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              role="tab"
              id={tabId(id)}
              aria-selected={section === id}
              aria-controls={panelId(id)}
              tabIndex={section === id ? 0 : -1}
              className={section === id ? 'active' : ''}
              onClick={() => setSection(id)}
            >
              <Icon size={14} aria-hidden="true" />
              {t(label)}
            </button>
          ))}
        </div>
        {/* Outside `.settings-sections` on purpose: a tablist's children are tabs, and this
            is not a section — it acts on all of them, which is also why it belongs to the
            navigation column rather than to any one panel. */}
        <button type="button" className="settings-reset" onClick={() => askConfirm({ kind: 'resetSettings' })}>
          <RotateCcw size={14} aria-hidden="true" />
          {t('settings.reset.label')}
        </button>
      </div>

      <div className="settings-panel" role="tabpanel" id={panelId(section)} aria-labelledby={tabId(section)} tabIndex={-1}>
        <ActivePanel />
      </div>

      {/* The dialog can already be dismissed with Escape and by clicking outside, but
          neither is visible, and this is the only control in the modal that is not a
          setting. */}
      <button type="button" className="icon-btn settings-close" aria-label={t('settings.close')} onClick={onDismiss}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * What is left once appearance and geometry have their own tabs: the app-level defaults.
 * The language leads because this is the tab the modal opens on, and someone who cannot
 * read the interface has to find it without hunting.
 *
 * No headings in any of these panels — the tab name is the heading, and printing it again
 * at the top of its own panel is noise.
 */
function GeneralSection() {
  return (
    <>
      <LanguageRow />
      <BodyLanguageRow />
      <RedactSecretsRow />
    </>
  )
}

function AppearanceSection() {
  return (
    <>
      <ThemeRow />
      <ZoomRow />
      <CodeFontRow />
    </>
  )
}

function LayoutSection() {
  return (
    <>
      {/* First on purpose: the orientation decides *what* the split slider divides, and
          that row's description reads "height" or "width" off it. */}
      <SplitOrientationRow />
      <SidebarWidthRow />
      <SplitRatioRow />
    </>
  )
}

/**
 * The panel that was a placeholder.
 *
 * Four rows, and the last two are not new features so much as answers finally being said
 * out loud: `dataDir` reached the interface only as the sidebar footer's `title`
 * attribute, and `quarantinedPath` was written by `hydrate` and read by nothing at all —
 * so a workspace file that could not be parsed was moved aside in silence and the user
 * was shown an empty workspace with a healthy-looking footer.
 */
function StorageSection() {
  const { t } = useT()
  const persistenceState = useAppStore(s => s.persistenceState)
  const dataDir = useAppStore(s => s.dataDir)
  const quarantinedPath = useAppStore(s => s.quarantinedPath)
  // Not store state and not a preference. The switch lasts this visit, which is the line
  // `RedactSecretsRow` draws for the code view: a control that decides whether a
  // credential leaves in plain text must not be able to stay on behind your back.
  const [includeSecrets, setIncludeSecrets] = useState(false)
  // In the store, not here: a refusal raised from the sidebar or the palette has to be
  // able to reach this panel, which is the only surface with room to print it.
  const rejection = useAppStore(s => s.importRejection)
  const { status: exportStatus, save } = useSave()

  // Both directions need a Wails runtime, and an import additionally needs the autosave
  // subscriber — which `hydrate` installs only on its success path, so under
  // `newer-version` a "successful" import would live in memory and be lost on quit.
  // Export is disabled there too: that state loads no tree, so it would cheerfully write
  // a valid-looking empty file over somebody's only backup.
  const blocked = persistenceState === 'ready' ? null : persistenceState === 'newer-version' ? 'newer' : 'browser'

  return (
    <>
      {blocked && (
        <p className="settings-note">
          <AlertTriangle size={14} aria-hidden="true" />
          {t(blocked === 'newer' ? 'settings.storage.unavailable.newer' : 'settings.storage.unavailable.browser')}
        </p>
      )}

      <div className="settings-row">
        <div className="settings-label">
          <span id="settings-export-label">{t('settings.storage.export.label')}</span>
          <p id="settings-export-desc">{t('settings.storage.export.desc')}</p>
        </div>
        <button
          type="button"
          className="settings-action"
          aria-labelledby="settings-export-label"
          aria-describedby="settings-export-desc"
          disabled={blocked !== null}
          onClick={() => save(() => exportWorkspace(t('transfer.export.dialog'), includeSecrets))}
        >
          {exportStatus === 'saved' ? <Check size={14} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
          {exportStatus === 'saved'
            ? t('settings.storage.export.saved')
            : exportStatus === 'failed'
              ? t('settings.storage.export.failed')
              : t('settings.storage.export.action')}
        </button>
      </div>

      {/* Under the row it modifies rather than beside it: it changes what that button
          writes, and its description is the whole of the warning. */}
      <SwitchRow
        id="settings-include-secrets"
        label="settings.storage.secrets.label"
        description={t(includeSecrets ? 'settings.storage.secrets.desc.on' : 'settings.storage.secrets.desc.off')}
        checked={includeSecrets}
        onChange={setIncludeSecrets}
      />

      <div className="settings-row">
        <div className="settings-label">
          <span id="settings-import-label">{t('settings.storage.import.label')}</span>
          <p id="settings-import-desc">{t('settings.storage.import.desc')}</p>
          {rejection && <p className="settings-error">{t(REJECTION_COPY[rejection])}</p>}
        </div>
        <button
          type="button"
          className="settings-action"
          aria-labelledby="settings-import-label"
          aria-describedby="settings-import-desc"
          disabled={blocked !== null}
          onClick={() => void startImport(t('transfer.import.dialog'))}
        >
          <Upload size={14} aria-hidden="true" />
          {t('settings.storage.import.action')}
        </button>
      </div>

      {dataDir && <DataDirRow dataDir={dataDir} />}
      {quarantinedPath && (
        <div className="settings-row">
          <div className="settings-label">
            <span>{t('settings.storage.quarantine.label')}</span>
            <p>{t('settings.storage.quarantine.desc')}</p>
            <code className="settings-path">{quarantinedPath}</code>
          </div>
        </div>
      )}
    </>
  )
}

/** A table rather than a ternary chain, so a rejection added without copy fails to compile. */
const REJECTION_COPY = {
  malformed: 'transfer.reject.malformed',
  'newer-app': 'transfer.reject.newerApp',
  'newer-workspace': 'transfer.reject.newerWorkspace',
  unreadable: 'transfer.reject.unreadable',
} as const satisfies Record<ImportRejection, PlainMessageKey>

/** Split out only so the copy acknowledgement is not a hook behind a condition. */
function DataDirRow({ dataDir }: { dataDir: string }) {
  const { t } = useT()
  const { status, copy } = useCopy()

  return (
    <div className="settings-row">
      <div className="settings-label">
        <span id="settings-data-dir-label">{t('settings.storage.location.label')}</span>
        <p id="settings-data-dir-desc">{t('settings.storage.location.desc')}</p>
        <code className="settings-path">{dataDir}</code>
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label={t('settings.storage.location.copy')}
        title={t('settings.storage.location.copy')}
        onClick={() => copy(dataDir)}
      >
        {status === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </div>
  )
}

function ThemeRow() {
  const { t } = useT()
  const theme = useAppStore(s => s.theme)
  const setTheme = useAppStore(s => s.setTheme)
  const system = useSystemTheme()

  return (
    <div className="settings-row">
      <div className="settings-label">
        {/* A span, not a label. This was a label for a while — the comment here used to
            celebrate that, now that there was a single control to point at — but the
            control is a <button role="combobox"> again and `htmlFor` only binds to
            labelable elements. `labelledBy` keeps the accessible name; what it cannot
            keep is clicking the text to focus the control. */}
        <span id="settings-theme-label">{t('settings.theme.label')}</span>
        {/* "System" on its own says nothing about what is on screen. */}
        <p id="settings-theme-desc">
          {theme === 'system'
            ? t('settings.theme.desc.system', { theme: t(THEME_INLINE[system]) })
            : t('settings.theme.desc.always', { theme: t(THEME_INLINE[theme]) })}
        </p>
      </div>
      {/* The `find` over the source of truth is gone along with the native select:
          `Select` is generic over its options, so `next` is already a `ThemePreference`
          and there is still nothing to assert. */}
      <Select
        id="settings-theme"
        labelledBy="settings-theme-label"
        describedBy="settings-theme-desc"
        value={theme}
        options={THEMES.map(({ id, label }) => ({ value: id, label: t(label) }))}
        onChange={setTheme}
      />
    </div>
  )
}

/**
 * A stepper rather than a select or a slider: zoom is the one preference people already
 * know as a pair of buttons and a percentage, and the three shortcuts map onto its three
 * controls one for one.
 */
function ZoomRow() {
  const { t } = useT()
  const zoom = useAppStore(s => s.zoom)
  const zoomIn = useAppStore(s => s.zoomIn)
  const zoomOut = useAppStore(s => s.zoomOut)
  const resetZoom = useAppStore(s => s.resetZoom)

  return (
    <div className="settings-row">
      <div className="settings-label">
        {/* A `<span>`, not a `<label htmlFor>`: the control is a group of three buttons,
            and a group can only be named through `aria-labelledby` — the same reason the
            theme row used one back when it was a radiogroup. */}
        <span id="settings-zoom-label">{t('settings.zoom.label')}</span>
        <p id="settings-zoom-desc">{t('settings.zoom.desc')}</p>
        {/* The keys in the same order as the buttons they stand for. `Shortcut` is
            `aria-hidden`, so this repeats nothing the buttons' labels already say. */}
        <div className="settings-shortcuts">
          <Shortcut keys={shortcuts.zoomOut} />
          <Shortcut keys={shortcuts.zoomReset} />
          <Shortcut keys={shortcuts.zoomIn} />
        </div>
      </div>
      <div className="settings-stepper" role="group" aria-labelledby="settings-zoom-label" aria-describedby="settings-zoom-desc">
        <button type="button" className="icon-btn" aria-label={t('settings.zoom.out')} disabled={zoom <= ZOOM.min} onClick={zoomOut}>
          <Minus size={14} aria-hidden="true" />
        </button>
        {/* The readout is the reset button, the way a browser's zoom indicator is: it
            gives the third shortcut somewhere to live besides the keyboard. */}
        <button type="button" className="settings-stepper-value" aria-label={t('settings.zoom.reset')} onClick={resetZoom}>
          {t('settings.zoom.value', { zoom })}
        </button>
        <button type="button" className="icon-btn" aria-label={t('settings.zoom.in')} disabled={zoom >= ZOOM.max} onClick={zoomIn}>
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/**
 * The knob the zoom cannot be. Zoom scales everything at once, which is right when the
 * whole window is too small; this leaves the chrome compact and moves only the two
 * editors, for when the payload is what needs to be readable. They multiply rather than
 * fight — 16px of code at 125% paints at 20.
 *
 * Same stepper as the zoom row, minus the keys: this has no shortcut, so there is nothing
 * to print.
 */
function CodeFontRow() {
  const { t } = useT()
  const size = useAppStore(s => s.codeFontSize)
  const setCodeFontSize = useAppStore(s => s.setCodeFontSize)

  return (
    <div className="settings-row">
      <div className="settings-label">
        <span id="settings-code-font-label">{t('settings.codeFont.label')}</span>
        <p id="settings-code-font-desc">{t('settings.codeFont.desc')}</p>
      </div>
      <div className="settings-stepper" role="group" aria-labelledby="settings-code-font-label" aria-describedby="settings-code-font-desc">
        <button
          type="button"
          className="icon-btn"
          aria-label={t('settings.codeFont.out')}
          disabled={size <= CODE_FONT_SIZE.min}
          onClick={() => setCodeFontSize(size - 1)}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="settings-stepper-value"
          aria-label={t('settings.codeFont.reset')}
          onClick={() => setCodeFontSize(CODE_FONT_SIZE.default)}
        >
          {t('settings.codeFont.value', { size })}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('settings.codeFont.in')}
          disabled={size >= CODE_FONT_SIZE.max}
          onClick={() => setCodeFontSize(size + 1)}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/**
 * A `role="switch"` on a `<button>` carrying an `.on` class — the same construction the
 * param rows already use for their enable toggle (`RequestEditor`'s `.row-check`), so
 * this is not a new pattern, only a new skin over it.
 *
 * A `<button>` is a labelable element, which is what lets it keep the `<label htmlFor>`
 * of the other rows and stay clickable by its text. `.row-check` needs an `aria-label`
 * only because it has no visible label to point at.
 */
function SwitchRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string
  label: PlainMessageKey
  description: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  const { t } = useT()

  return (
    <div className="settings-row">
      <div className="settings-label">
        <label htmlFor={id}>{t(label)}</label>
        <p id={`${id}-desc`}>{description}</p>
      </div>
      <button
        type="button"
        id={id}
        className={`settings-switch ${checked ? 'on' : ''}`}
        role="switch"
        aria-checked={checked}
        aria-describedby={`${id}-desc`}
        onClick={() => onChange(!checked)}
      />
    </div>
  )
}

function SplitOrientationRow() {
  const { t } = useT()
  const orientation = useAppStore(s => s.splitOrientation)
  const setSplitOrientation = useAppStore(s => s.setSplitOrientation)

  return (
    <SwitchRow
      id="settings-split-orientation"
      label="settings.layout.sideBySide.label"
      description={t('settings.layout.sideBySide.desc')}
      checked={orientation === 'columns'}
      // `setSplitOrientation`, not `toggleSplitOrientation`: a switch states an absolute
      // position. The toggle belongs to the workspace button and `Ctrl+\`, which are
      // relative gestures.
      onChange={next => setSplitOrientation(next ? 'columns' : 'rows')}
    />
  )
}

/**
 * The shared shape behind both layout rows.
 *
 * Native rather than reimplemented — which is what the selects above used to say too,
 * before WebView2 was caught drawing their popups from the system theme. A range has no
 * popup to get wrong: the platform draws a slider that already follows the theme through
 * `accent-color`, and it supplies the arrow keys, Home/End and Page keys for nothing.
 * That trade still holds here, and `Select.tsx` explains where it stopped holding.
 * `SplitHandle` had to hand-roll all of that because a resizer is a `role="separator"`
 * on a 4px track, which has no native equivalent.
 *
 * The description and the readout arrive already translated, which is what lets `label`
 * be a `PlainMessageKey` — a key carried as a value would otherwise widen to the whole
 * union and make `t()` demand every param any message might want.
 */
function RangeRow({
  id,
  label,
  description,
  valueText,
  value,
  min,
  max,
  onChange,
}: {
  id: string
  label: PlainMessageKey
  description: string
  valueText: string
  value: number
  min: number
  max: number
  onChange: (next: number) => void
}) {
  const { t } = useT()

  return (
    <div className="settings-row">
      <div className="settings-label">
        <label htmlFor={id}>{t(label)}</label>
        <p id={`${id}-desc`}>{description}</p>
      </div>
      <div className="settings-range">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          // Deliberately not the `step={16}` / `step={4}` the drag handles use for their
          // keyboard increments: a range input snaps its value to the nearest multiple of
          // `step`, so a coarse step would move the thumb off the value actually in the
          // store — 330 is not `268 + 16n`. Step 1 keeps the thumb honest and gives the
          // fine adjustment the handles cannot.
          step={1}
          value={value}
          aria-describedby={`${id}-desc`}
          // Without this a screen reader announces a bare "52", which says neither the
          // unit nor which pane gets it.
          aria-valuetext={valueText}
          // `valueAsNumber`, not `Number(event.target.value)`: a range always yields a
          // finite number, which sidesteps the `NaN` hole in `setSidebarWidth` /
          // `setSplitRatio` — they clamp with `Math.min`/`Math.max`, which propagate it.
          onChange={event => onChange(event.target.valueAsNumber)}
        />
        <output htmlFor={id} className="settings-range-value">
          {valueText}
        </output>
      </div>
    </div>
  )
}

function SidebarWidthRow() {
  const { t } = useT()
  const width = useAppStore(s => s.sidebarWidth)
  const collapsed = useAppStore(s => s.sidebarCollapsed)
  const setSidebarWidth = useAppStore(s => s.setSidebarWidth)

  return (
    <RangeRow
      id="settings-sidebar-width"
      label="settings.layout.sidebar.label"
      description={collapsed ? t('settings.layout.sidebar.desc.collapsed') : t('settings.layout.sidebar.desc')}
      valueText={t('settings.layout.sidebar.value', { width: Math.round(width) })}
      value={width}
      min={SIDEBAR_WIDTH.min}
      max={SIDEBAR_WIDTH.max}
      onChange={setSidebarWidth}
    />
  )
}

function SplitRatioRow() {
  const { t } = useT()
  const orientation = useAppStore(s => s.splitOrientation)
  const splitRatio = useAppStore(s => s.splitRatio)
  const setSplitRatio = useAppStore(s => s.setSplitRatio)
  // A drag leaves the ratio fractional (`delta / extent * 100`), and "47.31 / 52.69" is
  // not a readout. Presentation only: the stored value is left alone until this slider
  // is the thing that moves.
  const request = Math.round(splitRatio)

  return (
    <RangeRow
      id="settings-split-ratio"
      label="settings.layout.split.label"
      // Dotted keys are flat, so the orientation can be spliced in and still typecheck.
      description={t(`settings.layout.split.desc.${orientation}`)}
      valueText={t('settings.layout.split.value', { request, response: 100 - request })}
      value={splitRatio}
      min={SPLIT_RATIO.min}
      max={SPLIT_RATIO.max}
      onChange={setSplitRatio}
    />
  )
}

/**
 * The default the response viewer falls back to. Only a default: a format picked in the
 * viewer is stored against that request and outranks this, which is why the row promises
 * as much rather than letting someone discover it.
 *
 * The options are walked out of `BODY_LANGUAGES` and named from `BODY_LANGUAGE_LABEL`
 * rather than listed here, so this menu and the viewer's cannot come to offer different
 * formats — including the day a fifth one is added.
 */
function BodyLanguageRow() {
  const { t } = useT()
  const defaultBodyLanguage = useAppStore(s => s.defaultBodyLanguage)
  const setDefaultBodyLanguage = useAppStore(s => s.setDefaultBodyLanguage)

  return (
    <div className="settings-row">
      <div className="settings-label">
        {/* A span rather than a label, for the reason spelled out in `ThemeRow`. */}
        <span id="settings-body-language-label">{t('settings.response.format.label')}</span>
        <p id="settings-body-language-desc">{t('settings.response.format.desc')}</p>
      </div>
      <Select
        id="settings-body-language"
        labelledBy="settings-body-language-label"
        describedBy="settings-body-language-desc"
        // The empty string stands in for "automatic": no format can be named that, so it
        // needs no case of its own on the way out either — anything that is not a format
        // is `null`.
        value={defaultBodyLanguage ?? ''}
        options={[
          { value: '', label: t('settings.response.format.auto') },
          ...BODY_LANGUAGES.map(option => ({ value: option, label: bodyLanguageLabel(t, option) })),
        ]}
        onChange={next => setDefaultBodyLanguage(next === '' ? null : next)}
      />
    </div>
  )
}

/**
 * The other half of the code view's switch, and the only half that is remembered.
 *
 * That switch used to persist itself, so one click quietly changed what every later session
 * showed — which is no way for a control that rewrites a credential to behave. It is now
 * per visit, and this is where the durable answer is given: deliberately, in the one place
 * you can go back and look at it.
 *
 * Labelled by what turning it *on* does, like `SplitOrientationRow`, and on means hidden —
 * the same direction as the modal's own switch, so the two can never read as opposites.
 */
function RedactSecretsRow() {
  const { t } = useT()
  const redact = useAppStore(s => s.defaultRedactSecrets)
  const setDefaultRedactSecrets = useAppStore(s => s.setDefaultRedactSecrets)

  return (
    <SwitchRow
      id="settings-redact-secrets"
      label="settings.code.redact.label"
      description={t('settings.code.redact.desc')}
      checked={redact}
      onChange={setDefaultRedactSecrets}
    />
  )
}

/**
 * No `System` option, unlike the theme.
 *
 * `prefers-color-scheme` is published by the OS and can flip under a running window, so
 * following it is a live behaviour worth offering. A webview's `navigator.language`
 * only changes on restart, and picking an interface language is a deliberate act — so
 * the app opens in English and remembers whatever is chosen here.
 */
function LanguageRow() {
  const { t } = useT()
  const language = useAppStore(s => s.language)
  const setLanguage = useAppStore(s => s.setLanguage)

  return (
    <div className="settings-row">
      <div className="settings-label">
        {/* A span rather than a label, for the reason spelled out in `ThemeRow`. */}
        <span id="settings-language-label">{t('settings.language.label')}</span>
        <p id="settings-language-desc">{t('settings.language.desc')}</p>
      </div>
      <Select
        id="settings-language"
        labelledBy="settings-language-label"
        describedBy="settings-language-desc"
        value={language}
        options={LANGUAGES.map(({ id, label }) => ({ value: id, label }))}
        onChange={setLanguage}
      />
    </div>
  )
}
