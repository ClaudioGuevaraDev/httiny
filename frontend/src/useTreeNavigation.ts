import { useCallback, useLayoutEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { collectionsIn, flattenVisible, treeActions, useAppStore } from './store'
import { useVirtualRows } from './useVirtualRows'

/**
 * Keyboard operation for the sidebar tree, per the WAI-ARIA tree pattern.
 *
 * The rows used to be `<div onClick>` with no role, no tabindex and no key handler:
 * the entire collection hierarchy — the app's primary navigation — was unreachable
 * without a mouse, a straight WCAG 2.1.1 failure.
 *
 * The tree is one tab stop. `focusedId` is the roving tabindex: exactly one row carries
 * `tabIndex={0}` and the rest `-1`, so Tab enters the tree once and the arrow keys move
 * within it.
 *
 * It also owns the windowing (`useVirtualRows`) rather than exposing it, so `Sidebar` makes
 * one hook call and nothing has to thread the same scroller ref through two of them. The
 * geometry lives in its own file because this one is about the ARIA pattern; what the two
 * share is `rows`, and everything below that virtualisation made harder.
 */
export function useTreeNavigation() {
  const tree = useAppStore(s => s.tree)
  const activeCollectionId = useAppStore(s => s.activeCollectionId)
  const selectedNodeId = useAppStore(s => s.selectedNodeId)

  // Scoped to the active collection's children, which is the whole of the rail's
  // effect on the tree: depth, `aria-level`, posinset/setsize, the roving stop and
  // the empty state all recompute from this one substitution. The collection itself
  // is not a row — its name is the panel heading, the way Discord does not list the
  // server among its channels.
  //
  // The index map comes out of the same memo. Three separate O(n) scans used to run on
  // every render to answer "where is the roving row" and "where is the row this key
  // moves to"; at three thousand rows those are the scans, not the render.
  const { rows, indexOf } = useMemo(() => {
    const collections = collectionsIn(tree)
    const active = collections.find(c => c.id === activeCollectionId) ?? collections[0]
    const visible = flattenVisible(active?.children ?? [])
    return { rows: visible, indexOf: new Map(visible.map((row, index) => [row.node.id, index])) }
  }, [tree, activeCollectionId])

  const [focusedId, setFocusedId] = useState<string | null>(null)
  // Destructured at the call site rather than kept as one object, because `moveTo` depends
  // on two of these and a fresh carrier object every render would give `moveTo` — and so
  // the `onFocusRow` prop of every memoised row — a new identity every render. `element`
  // and `scrollTo` are `useCallback`-stable; `mounted`, `start` and `end` are not, and are
  // deliberately not dependencies of anything a row receives.
  //
  // The scroller itself lives in `useVirtualRows`, which owns the observers on it. This
  // hook only queries and focuses inside it, and only from effects and event handlers.
  const { attach, element, scrollTo, mounted, start, end, padTop, padBottom } = useVirtualRows(rows.length)

  // The roving stop defaults to the selected row, then to the first row. Reading it
  // during render rather than syncing it into state keeps the two from disagreeing when
  // the focused node is deleted out from under us.
  const active = (focusedId !== null && indexOf.has(focusedId) ? focusedId : null) ?? (selectedNodeId !== null && indexOf.has(selectedNodeId) ? selectedNodeId : null) ?? rows[0]?.node.id ?? null
  const activeIndex = active !== null ? (indexOf.get(active) ?? -1) : -1
  const activeMounted = activeIndex >= 0 && mounted(activeIndex)

  /**
   * A focus move whose target was not in the DOM, waiting for the row to arrive.
   *
   * A ref and not state, and deliberately keyed on nothing: this is a one-shot *intent*.
   * The effect that satisfies it below reads it, clears it unconditionally, and does
   * nothing on any render that did not come from such a move — which is what keeps it
   * from being the bug the old version of this comment warned about, an effect keyed on
   * `focusedId` that re-steals focus on unrelated commits.
   */
  const pendingFocus = useRef<string | null>(null)
  /** Whether focus was inside the tree, maintained from focus events. See the parking effect. */
  const hadFocus = useRef(false)
  /** Set while we are the ones moving focus to the container, so the trampoline stands down. */
  const parked = useRef(false)

  /**
   * Focus moves synchronously when it can.
   *
   * Every click, every left/right, and every single-step up/down lands on a row that is
   * already in the DOM — `OVERSCAN` guarantees the neighbour is painted — so this stays
   * the plain `.focus()` it always was, and the browser's own scroll-into-view keeps
   * handling the viewport edge with real geometry rather than our estimated pitch.
   *
   * `Home`, `End`, and stepping to a parent that has scrolled away are the cases
   * virtualisation created: the target is not rendered, so the window is moved first and
   * the focus is left as an intent for the commit that mounts it.
   *
   * `index` is a second, optional argument rather than something looked up from `rows`,
   * and that is load-bearing: closing over `rows` would put it in the dependency list,
   * this callback would change identity on every tree change, and it is a prop of the
   * memoised rows — every memo in the tree would stop biting. Callers inside a row never
   * need to pass it, because a row that can call this is mounted by definition.
   */
  const moveTo = useCallback(
    (id: string | undefined, index?: number) => {
      if (!id) return
      setFocusedId(id)
      const el = element()?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)
      if (el) {
        el.focus()
        return
      }
      if (index === undefined) return
      pendingFocus.current = id
      scrollTo(index)
    },
    [element, scrollTo],
  )

  // Satisfies a pending move, and must run before the parking effect below: a move that
  // has just been satisfied would otherwise look, for one frame, like a row that vanished.
  // `preventScroll`, because `scrollTo` has already put the row where it belongs and a
  // pitch that is a pixel out would otherwise have the browser scroll by that pixel, fire
  // a scroll event, and re-render the slice for nothing.
  useLayoutEffect(() => {
    const id = pendingFocus.current
    if (!id) return
    // Cleared unconditionally, the row having arrived or not: a target deleted between the
    // keypress and the commit must not leave an intent to fire on some later render.
    pendingFocus.current = null
    element()?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true })
  })

  /**
   * Parks focus on the container when the focused row is scrolled out from under it.
   *
   * Removing the focused element from the DOM fires **no** `blur` and no `focusout`; focus
   * silently becomes `<body>`, which resets the tab order to the top of the document and
   * stops the container's `onKeyDown` receiving anything. A layout effect runs after
   * React's mutations and before paint, so `activeElement === body` here is a precise
   * reading of "the row we were on has just been removed".
   *
   * `preventScroll` because the user is mid-wheel and this must not argue with them about
   * where the scroller should be.
   */
  useLayoutEffect(() => {
    if (!hadFocus.current) return
    if (document.activeElement !== document.body) return
    parked.current = true
    element()?.focus({ preventScroll: true })
  })

  /**
   * The tree's tab stop, when the roving row is not rendered.
   *
   * React's `onFocus` is `focusin` and bubbles, hence the target check — a row or one of
   * its action buttons receiving focus must not bounce it anywhere.
   */
  const onContainerFocus = useCallback(
    (event: ReactFocusEvent<HTMLElement>) => {
      hadFocus.current = true
      if (event.target !== event.currentTarget) return
      if (parked.current) {
        parked.current = false
        return
      }
      moveTo(active ?? undefined, activeIndex === -1 ? undefined : activeIndex)
    },
    [moveTo, active, activeIndex],
  )

  const onContainerBlur = useCallback(() => {
    hadFocus.current = false
  }, [])

  /**
   * Which row is being renamed, and the text typed into it so far.
   *
   * Hoisted out of the row for correctness, not for speed. The rename input is
   * uncontrolled and commits on blur — but removing a focused element fires no blur, so
   * once rows can be unmounted by a scroll, a rename in progress would be discarded in
   * silence. The id survives up here, the draft survives in a ref (so typing still costs
   * no render), and the effect below commits it if the row goes away.
   */
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const draft = useRef('')

  const startRename = useCallback((id: string) => {
    draft.current = ''
    setRenamingId(id)
  }, [])

  const editRename = useCallback((text: string) => {
    draft.current = text
  }, [])

  const endRename = useCallback((id: string, name: string) => {
    draft.current = ''
    setRenamingId(current => (current === id ? null : current))
    if (name) treeActions.renameNode(id, name)
  }, [])

  const renamingIndex = renamingId !== null ? (indexOf.get(renamingId) ?? -1) : -1
  const renamingMounted = renamingIndex >= 0 && mounted(renamingIndex)
  useLayoutEffect(() => {
    if (renamingId === null || renamingMounted) return
    // The row left the window mid-rename. Commit what was typed rather than dropping it;
    // an empty draft means nothing was typed, and `endRename` leaves the name alone.
    endRename(renamingId, draft.current.trim())
  }, [renamingId, renamingMounted, endRename])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      // The rename input and the row's action buttons both want keys the tree also claims —
      // Enter on a button would fire the button *and* open/toggle the row. They stop
      // propagation themselves; this is the belt to that braces, so a new in-row control
      // cannot silently hand Enter to the tree.
      if (event.target instanceof HTMLElement && event.target.closest('input, .tree-actions')) return

      const index = activeIndex
      if (index === -1) return
      const { node, parentId } = rows[index]
      const branch = node.type !== 'request' ? node : null

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          moveTo(rows[index + 1]?.node.id, index + 1)
          break
        case 'ArrowUp':
          event.preventDefault()
          moveTo(rows[index - 1]?.node.id, index - 1)
          break
        case 'ArrowRight':
          event.preventDefault()
          // Collapsed branch: open it. Already open: step onto the first child, which
          // is the next visible row by construction.
          if (branch && !branch.expanded) treeActions.toggleNode(branch.id)
          else if (branch?.children.length) moveTo(rows[index + 1]?.node.id, index + 1)
          break
        case 'ArrowLeft':
          event.preventDefault()
          if (branch?.expanded) treeActions.toggleNode(branch.id)
          else if (parentId) moveTo(parentId, indexOf.get(parentId))
          break
        case 'Home':
          event.preventDefault()
          moveTo(rows[0]?.node.id, 0)
          break
        case 'End':
          event.preventDefault()
          moveTo(rows[rows.length - 1]?.node.id, rows.length - 1)
          break
        case 'Enter':
        case ' ':
          event.preventDefault()
          if (node.type === 'request') treeActions.openRequest(node.requestId)
          else treeActions.toggleNode(node.id)
          break
        default:
          break
      }
    },
    [rows, indexOf, activeIndex, moveTo],
  )

  // Flattened rather than handed back as the `virtual` object it came from. Once a ref
  // callback and a pair of plain integers travel together, the lint rules read every
  // property of the carrier as a ref access during render — including the integers, whose
  // whole job is to be read during render.
  return {
    rows,
    selectedNodeId,
    activeId: active,
    activeMounted,
    attachTree: attach,
    windowStart: start,
    windowEnd: end,
    padTop,
    padBottom,
    onKeyDown,
    onContainerFocus,
    onContainerBlur,
    focusRow: moveTo,
    renamingId,
    startRename,
    editRename,
    endRename,
  }
}

export type TreeNavigation = ReturnType<typeof useTreeNavigation>
