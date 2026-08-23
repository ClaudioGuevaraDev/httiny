import { useRef } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { CommandPalette } from './components/CommandPalette'
import { CodeModal } from './components/CodeModal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { EnvironmentsDialog } from './components/EnvironmentsDialog'
import { SettingsModal } from './components/SettingsModal'
import { UpdateModal } from './components/UpdateModal'
import { RequestEditor } from './components/RequestEditor'
import { RequestTabs } from './components/RequestTabs'
import { ResponseViewer } from './components/ResponseViewer'
import { Sidebar } from './components/Sidebar'
import { SplitHandle } from './components/SplitHandle'
import { WorkspaceActions } from './components/WorkspaceActions'
import { useGlobalShortcuts } from './useGlobalShortcuts'
import { useT } from './language'
import { SIDEBAR_WIDTH, SPLIT_RATIO, useAppStore } from './store'

/** Matches `--sidebar-collapsed`; the collapsed sidebar is exactly the rail. */
const RAIL_WIDTH = 48
/** Mirrors `--resizer-track`. */
const RESIZER_WIDTH = 4

export function App() {
  const { t } = useT()
  const sidebarWidth = useAppStore(s => s.sidebarWidth)
  const setSidebarWidth = useAppStore(s => s.setSidebarWidth)
  const collapsed = useAppStore(s => s.sidebarCollapsed)
  const toggleSidebar = useAppStore(s => s.toggleSidebar)
  const splitOrientation = useAppStore(s => s.splitOrientation)
  const splitRatio = useAppStore(s => s.splitRatio)
  // Only the sidebar handle needs it: its value is a length, and a length gets scaled.
  const zoom = useAppStore(s => s.zoom)
  const setSplitRatio = useAppStore(s => s.setSplitRatio)
  const splitRef = useRef<HTMLDivElement>(null)

  useGlobalShortcuts()

  const columns = splitOrientation === 'columns'
  // At 1440×900 the workspace is 1154px wide, so a 52/48 split gives 596/553px —
  // both clear of the 360/320 minimums. Column mode is viable without a media query.
  const splitStyle = columns
    ? { gridTemplateColumns: `minmax(360px, ${splitRatio}fr) 5px minmax(320px, ${100 - splitRatio}fr)`, gridTemplateRows: 'minmax(0, 1fr)' }
    : { gridTemplateRows: `minmax(210px, ${splitRatio}fr) 5px minmax(190px, ${100 - splitRatio}fr)`, gridTemplateColumns: 'minmax(0, 1fr)' }

  return (
    /* The shell was `<main>` with the sidebar `<aside>` nested inside it, which put the
       navigation *inside* the main landmark and left the app with no main region of its
       own. The grid is now a plain div, the sidebar is `<nav>` and the workspace is
       `<main>` — three sibling landmarks, which is what the skip link jumps between.

       Collapsed, the sidebar track narrows to exactly the collection rail, so the
       rail stays reachable while the panel goes away.

       Two whole templates rather than one with a zero-width middle track, because the
       resize handle below is only rendered when expanded and nothing here assigns an
       explicit `grid-column`. Auto-placement fills tracks in order and leaves no gaps,
       so a track list longer than the child list pushes `<main>` into the wrong
       column — a `0px` one is not a safe place to park an unused track. */
    <div
      className="app-shell"
      style={{
        gridTemplateColumns: collapsed ? `${RAIL_WIDTH}px minmax(0, 1fr)` : `${sidebarWidth}px ${RESIZER_WIDTH}px minmax(0, 1fr)`,
      }}
    >
      <a className="skip-link" href="#workspace">
        {t('app.skipLink')}
      </a>
      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      {/* Hidden while collapsed: with only the rail showing there is nothing to
          resize, and a separator with no adjacent panel is a stray tab stop. */}
      {!collapsed && (
        <SplitHandle
          label={t('app.resizeSidebar')}
          axis="x"
          unit="px"
          value={sidebarWidth}
          min={SIDEBAR_WIDTH.min}
          max={SIDEBAR_WIDTH.max}
          step={16}
          defaultValue={SIDEBAR_WIDTH.default}
          onChange={setSidebarWidth}
          scale={zoom / 100}
        />
      )}
      <main className="workspace" id="workspace">
        <div className="workspace-top">
          <button
            className="icon-btn panel-toggle"
            aria-label={collapsed ? t('app.showSidebar') : t('app.hideSidebar')}
            aria-expanded={!collapsed}
            aria-controls="sidebar"
            title={collapsed ? t('app.showSidebar') : t('app.hideSidebar')}
            onClick={toggleSidebar}
          >
            {collapsed ? <PanelLeftOpen size={15} aria-hidden="true" /> : <PanelLeftClose size={15} aria-hidden="true" />}
          </button>
          <RequestTabs />
          <WorkspaceActions />
        </div>
        <div className="editor-split" ref={splitRef} data-orientation={splitOrientation} style={splitStyle}>
          <RequestEditor />
          <SplitHandle
            label={columns ? t('app.resizeColumns') : t('app.resizeRows')}
            axis={columns ? 'x' : 'y'}
            unit="percent"
            value={splitRatio}
            min={SPLIT_RATIO.min}
            max={SPLIT_RATIO.max}
            step={4}
            defaultValue={SPLIT_RATIO.default}
            onChange={setSplitRatio}
            containerRef={splitRef}
          />
          <ResponseViewer />
        </div>
      </main>
      <CommandPalette />
      <SettingsModal />
      <EnvironmentsDialog />
      <CodeModal />
      <UpdateModal />
      {/* Last, though the order is only tidiness: a modal's stacking follows its
          `showModal()` call, which is what lets this one open over the settings dialog. */}
      <ConfirmDialog />
    </div>
  )
}
