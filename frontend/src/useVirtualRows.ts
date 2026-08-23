import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/**
 * Windowing for the sidebar tree: render the rows in view and stand in for the rest with
 * padding on the scroller.
 *
 * A tree of a few thousand requests put ~8,900 elements in the sidebar, of which ~6,800
 * were action buttons held at `opacity: 0` — and nine `useSyncExternalStore` subscriptions
 * per row, every one of whose selectors zustand runs on every `set()`. Windowing is what
 * prices all of that by the viewport instead of by the workspace.
 *
 * **Every measurement here is `scrollTop` / `clientHeight` / `offsetTop`, never
 * `getBoundingClientRect`.** The app scales itself with CSS `zoom` on the root element
 * (`zoom.ts`), and a bounding rect comes back post-zoom while `scrollTop` does not — mixing
 * the two would be an arithmetic error that only shows up at 125%. Those three share one
 * coordinate space, so whatever `zoom` does to one it does to all of them, and a *measured*
 * pitch is automatically in the same space as the `scrollTop` it will be divided into.
 * That is the real reason the pitch is measured rather than read off `--h-row-tree`.
 *
 * The hook is deliberately self-disabling: until it has measured a pitch it renders a fixed
 * slice with no padding, which is exactly what the un-windowed tree did. Nothing about a
 * workspace that fits on screen goes through the interesting paths.
 */

/**
 * Rows kept mounted either side of the viewport.
 *
 * Six is what makes a single-step arrow key never take the "scroll it in, then focus"
 * path in `useTreeNavigation` — the next row is already painted, so the browser's own
 * scroll-focused-element-into-view handles the viewport edge with real geometry rather
 * than our estimate.
 */
const OVERSCAN = 6

/**
 * How many rows to render before anything has been measured.
 *
 * Enough to fill any plausible sidebar, and — more to the point — enough of them to
 * measure a pitch from. `attach` runs in the commit phase, before paint, so the corrected
 * window lands in the same frame and this is never seen.
 */
const BOOTSTRAP_ROWS = 48

/** Below this, a difference in the measured pitch is `offsetTop` rounding, not a change. */
const PITCH_EPSILON = 0.25

/** Everything the browser can tell us about the list, in the scroller's own pixel space. */
interface Geometry {
  /** Row height plus its margin: the distance between two consecutive rows' tops. `0` = unmeasured. */
  pitch: number
  /** The `scrollTop` at which row 0 sits flush with the top of the scrollport, i.e. the padding. */
  origin: number
  /** `clientHeight`, which is the scrollport. */
  viewport: number
}

export interface VirtualWindow {
  /** First rendered index, inclusive, and last, exclusive — feed straight to `slice`. */
  start: number
  end: number
  /** Extra scroller padding standing in for the rows that are not rendered, in px. */
  padTop: number
  padBottom: number
  /** Whether `index` is currently in the DOM. Drives the roving tabindex fallback. */
  mounted: (index: number) => boolean
  /** `block: 'nearest'` for a row that may not exist yet. Synchronous — see below. */
  scrollTo: (index: number) => void
  /** Ref callback for the scroller. Stable, so the observers are not rebuilt per render. */
  attach: (el: HTMLDivElement | null) => void
  /**
   * The scroller, for callers that need to query or focus inside it.
   *
   * A getter rather than the ref itself: handing a `RefObject` across a hook boundary is
   * what the lint rules read as "this value may be a ref", and everything derived from it
   * then counts as a ref access during render — including the two plain integers this
   * hook exists to return. A function can only be called, and every caller calls it from
   * an effect or an event handler.
   */
  element: () => HTMLDivElement | null
}

export function useVirtualRows(count: number): VirtualWindow {
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const [geometry, setGeometry] = useState<Geometry>({ pitch: 0, origin: 0, viewport: 0 })
  const [first, setFirst] = useState(0)
  // Mirrors, read only from listeners and event handlers — never during render, which is
  // what `react-hooks/refs` forbids and what would make the render impure anyway.
  const geometryRef = useRef(geometry)
  const firstRef = useRef(0)

  /**
   * Commits a measurement, but only when it moved.
   *
   * The epsilon is what stops a measure -> render -> measure loop: a pitch that comes back
   * a hundredth of a pixel different every time would otherwise re-render forever.
   */
  const commit = useCallback((next: Geometry) => {
    const prev = geometryRef.current
    if (Math.abs(next.pitch - prev.pitch) < PITCH_EPSILON && next.viewport === prev.viewport && next.origin === prev.origin) return
    geometryRef.current = next
    setGeometry(next)
  }, [])

  /**
   * Measures the pitch across the **whole rendered span**, never from one row.
   *
   * `offsetTop` and `offsetHeight` are integers. At 125% zoom the true pitch is 37.5px, so
   * a single-row read gives 38 — half a pixel per row, which is ~15px of visible drift
   * across a window and ~500px of wrong scrollbar per 1,000 rows. Dividing a span of N
   * rows folds the rounding of two reads across N intervals instead, so the error is
   * ~1/N of a pixel and normal-flow rows stay viable.
   *
   * `origin` is only knowable when there is no top padding in the way, which is every
   * render at the top of the list — including the first one.
   */
  const measure = useCallback(
    (el: HTMLDivElement) => {
      const rows = el.querySelectorAll<HTMLElement>('[data-node-id]')
      const prev = geometryRef.current
      if (rows.length < 2) {
        commit({ ...prev, viewport: el.clientHeight })
        return
      }
      const span = rows[rows.length - 1].offsetTop - rows[0].offsetTop
      const pitch = span / (rows.length - 1)
      if (pitch <= 0) {
        commit({ ...prev, viewport: el.clientHeight })
        return
      }
      commit({ pitch, origin: firstRef.current === 0 ? rows[0].offsetTop : prev.origin, viewport: el.clientHeight })
    },
    [commit],
  )

  /**
   * Recomputes the first visible index from the DOM, and re-renders only if it moved.
   *
   * Compared against a ref rather than returned from a functional `setFirst` updater:
   * React's bail-out may still render the component once to discover the value did not
   * change, and at sixty scroll events a second — twenty-nine of every thirty of which
   * change nothing — that is twenty-nine pointless sidebar renders a second.
   */
  const sync = useCallback((el: HTMLDivElement) => {
    const { pitch, origin } = geometryRef.current
    if (pitch <= 0) return
    const next = Math.max(0, Math.floor((el.scrollTop - origin) / pitch))
    if (next === firstRef.current) return
    firstRef.current = next
    setFirst(next)
  }, [])

  /**
   * Wires the scroller and takes the first measurement.
   *
   * A ref callback and not an effect: it runs in the commit phase with the DOM already in
   * place, so the bootstrap rows exist and `offsetTop` is readable, and `setGeometry` here
   * is neither "in render" nor "in an effect" — which is what the lint config requires and
   * what gets the corrected window into the same commit, before paint.
   *
   * Its identity must never change. React re-invokes a ref callback, cleanup and all,
   * whenever the identity does, and this one owns a `ResizeObserver` and a scroll listener.
   */
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      nodeRef.current = el
      if (!el) return
      const onScroll = () => sync(el)
      el.addEventListener('scroll', onScroll, { passive: true })
      // Covers the window resizing, the sidebar split being dragged, and the zoom changing:
      // `zoom` rescales the panel, so the scroller's own `clientHeight` moves and this
      // fires. No separate subscription to the zoom preference is needed.
      const observer = new ResizeObserver(() => measure(el))
      observer.observe(el)
      measure(el)
      return () => {
        el.removeEventListener('scroll', onScroll)
        observer.disconnect()
        nodeRef.current = null
      }
    },
    [sync, measure],
  )

  /**
   * The one case nothing else can catch: the list grows past the viewport without the
   * scroller resizing.
   *
   * With fewer than two rows at mount there is no pitch, so there is no padding, so there
   * is no scroll extent and no scroll event can ever fire — importing a three-thousand
   * request workspace over an almost-empty one would leave the bootstrap slice and a dead
   * scrollbar. This re-measures exactly then. It can fire at most once per mount, because
   * the `pitch === 0` guard is false forever after, and `commit` will not re-render unless
   * the numbers actually moved.
   */
  useLayoutEffect(() => {
    const el = nodeRef.current
    if (!el || geometryRef.current.pitch > 0) return
    if (el.querySelectorAll('[data-node-id]').length < 2) return
    measure(el)
  })

  // Clamped here rather than where it is stored: collapsing a folder can shrink the list
  // under a `first` that still names a row past the new end, and the browser's own
  // `scrollTop` clamp does not arrive until the next scroll event. Deriving from the raw
  // value would blank the tree for a frame; the clamped one lands on the last rows, which
  // is where the clamped scroll lands too.
  const anchor = Math.min(first, Math.max(0, count - 1))
  const visible = geometry.pitch > 0 ? Math.ceil(geometry.viewport / geometry.pitch) + 1 : BOOTSTRAP_ROWS
  const start = Math.max(0, anchor - OVERSCAN)
  const end = Math.min(count, anchor + visible + OVERSCAN)

  const scrollTo = useCallback(
    (index: number) => {
      const el = nodeRef.current
      const { pitch, origin } = geometryRef.current
      if (!el || pitch <= 0) return
      const top = origin + index * pitch
      const wanted = top < el.scrollTop ? top : top + pitch > el.scrollTop + el.clientHeight ? top + pitch - el.clientHeight : el.scrollTop
      if (wanted === el.scrollTop) return
      // Written to the DOM *and* folded into React state here, rather than left for the
      // scroll listener. A `scroll` event never fires synchronously, so waiting for it
      // would paint one frame with the scroller at row 3,000 and the slice still
      // describing row 0 — an empty tree, then a jump. Batched with the caller's own
      // `setState` in the same handler, the corrected slice is in the first commit.
      el.scrollTop = wanted
      // Read back, because the browser clamps to the real extent.
      sync(el)
    },
    [sync],
  )

  const mounted = useCallback((index: number) => index >= start && index < end, [start, end])

  return {
    start,
    end,
    padTop: start * geometry.pitch,
    padBottom: Math.max(0, (count - end) * geometry.pitch),
    mounted,
    scrollTo,
    attach,
    element: useCallback(() => nodeRef.current, []),
  }
}
