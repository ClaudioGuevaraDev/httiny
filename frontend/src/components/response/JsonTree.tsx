import { useCallback, useMemo, useState } from 'react'
import type { CSSProperties, UIEvent } from 'react'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Link2 } from 'lucide-react'
import { useT } from '../../language'
import { containerPaths, flatten, parseJson } from '../../response/json'
import type { JsonRow } from '../../response/json'
import { useCopy } from '../../useCopy'
import { TextBody } from './TextBodyLazy'

/** Published to CSS so the windowing maths and the rule cannot drift apart. */
const ROW_HEIGHT = 22
const OVERSCAN = 10
/** Each level's indent, in pixels. */
const STEP = 14

/**
 * A collapsible view of a JSON document.
 *
 * The thing an indented body cannot do: fold away the parts you are not reading. On a
 * response with a hundred-element `data` array, scrolling past it to reach `meta` is
 * most of the time spent looking at the panel, and collapsing one node removes it.
 *
 * Rendered from a flat row list through the same windowing the hex dump uses. A
 * recursive component tree is the obvious implementation and the wrong one: it lays out
 * every node in the document, including the ones nobody has scrolled to.
 */
export function JsonTree({ source }: { source: string }) {
  const { t } = useT()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [viewportRows, setViewportRows] = useState(40)
  const [firstVisible, setFirstVisible] = useState(0)

  const parsed = useMemo(() => parseJson(source), [source])
  const rows = useMemo(() => (parsed === null ? [] : flatten(parsed, collapsed)), [parsed, collapsed])

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget
    setFirstVisible(Math.floor(element.scrollTop / ROW_HEIGHT))
    setViewportRows(Math.ceil(element.clientHeight / ROW_HEIGHT))
  }, [])

  const toggle = useCallback((path: string) => {
    setCollapsed(current => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }, [])

  // A body that does not parse falls back to the editor rather than to an error. The
  // viewer above already says the JSON is invalid, and the text is what you need to
  // find out why.
  if (parsed === null) return <TextBody text={source} language="json" wrap match={null} />

  const start = Math.max(0, firstVisible - OVERSCAN)
  const end = Math.min(rows.length, firstVisible + viewportRows + OVERSCAN)
  const visible = rows.slice(start, end)

  return (
    <div className="json-tree" style={{ '--json-row-height': `${ROW_HEIGHT}px` } as CSSProperties}>
      <div className="media-toolbar">
        <button type="button" className="icon-btn xs" title={t('response.tree.expandAll')} aria-label={t('response.tree.expandAll')} onClick={() => setCollapsed(new Set())}>
          <ChevronsUpDown size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn xs"
          title={t('response.tree.collapseAll')}
          aria-label={t('response.tree.collapseAll')}
          onClick={() => setCollapsed(new Set(containerPaths(parsed)))}
        >
          <ChevronsDownUp size={13} aria-hidden="true" />
        </button>
        <p className="media-facts">{t('response.tree.nodes', { count: rows.length })}</p>
      </div>
      <div className="json-scroller" onScroll={onScroll} role="tree" aria-label={t('response.tree.aria')}>
        <div className="json-spacer" style={{ height: `${rows.length * ROW_HEIGHT}px` }}>
          <div className="json-rows" style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
            {visible.map(row => (
              <Row key={row.path} row={row} collapsed={collapsed.has(row.path)} onToggle={toggle} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ row, collapsed, onToggle }: { row: JsonRow; collapsed: boolean; onToggle: (path: string) => void }) {
  const { t } = useT()
  const { copy } = useCopy()

  return (
    <div
      className="json-row"
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.container ? !collapsed : undefined}
      style={{ paddingLeft: `${8 + row.depth * STEP}px` }}
    >
      {row.container ? (
        <button type="button" className="json-twisty" onClick={() => onToggle(row.path)} aria-label={collapsed ? t('response.tree.expand') : t('response.tree.collapse')}>
          {collapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
        </button>
      ) : (
        <span className="json-twisty" aria-hidden="true" />
      )}

      {row.label !== '' && <span className="json-label">{row.label}</span>}

      {row.container || row.kind === 'object' || row.kind === 'array' ? (
        <span className="json-summary" data-kind={row.kind}>
          {row.kind === 'array' ? `[${row.size}]` : `{${row.size}}`}
        </span>
      ) : (
        /* The quotes are drawn by CSS rather than baked into the text, so selecting a
           string value copies the value and not its punctuation. */
        <span className="json-value" data-kind={row.kind}>
          {row.value}
        </span>
      )}

      {/* The path in the dialect other tools accept, which is what makes it worth
          copying at all — see childPath in response/json.ts. */}
      <button type="button" className="json-copy-path icon-btn xs" title={t('response.tree.copyPath')} aria-label={t('response.tree.copyPath')} onClick={() => copy(row.path)}>
        <Link2 size={11} aria-hidden="true" />
      </button>
    </div>
  )
}
