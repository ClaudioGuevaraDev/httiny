import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export type SelectVariant = 'field' | 'inline' | 'method'

export type SelectOption<T extends string> = {
  value: T
  /** The accessible name and the type-ahead key. Always a string, even when `glyph` draws it. */
  label: string
  /**
   * Drawn *instead of* the label, in the list and in the trigger alike. The label still
   * names the option. A `valueGlyph` used to sit beside this so the chosen value could be
   * drawn differently from the row it came from; the method picker was its only caller and
   * no longer wants the distinction, so the two surfaces share one node and part company in
   * CSS — see `.select-trigger[data-variant='method']`.
   */
  glyph?: ReactNode
}

type SelectProps<T extends string> = {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  variant?: SelectVariant
  id?: string
  ariaLabel?: string
  labelledBy?: string
  describedBy?: string
  title?: string
  /**
   * Greys the trigger out and stops it opening, rather than the caller unmounting it.
   * A control that vanishes when it stops applying reads as a bug — the same rule the
   * segmented pickers beside this one already follow.
   */
  disabled?: boolean
}

/** Gap between the trigger and the menu, and the margin the menu keeps off a viewport edge. */
const GAP = 4
const MARGIN = 8
/** Below this much room the menu flips above the trigger rather than squeezing into it. */
const MIN_ROOM = 160
/** How long a type-ahead buffer survives before the next keystroke starts a new search. */
const TYPE_AHEAD_RESET = 500

/**
 * A listbox, reimplemented — which the `.settings-select` comment this replaces argued
 * against, so it owes an answer.
 *
 * That comment said the OS draws the popup and it already follows the app's theme because
 * `color-scheme` is declared per theme. On WebKitGTK that holds. On Windows it does not:
 * WebView2 draws the popup from the *system* theme, so a dark app gets a white list with a
 * grey hover, and neither `color-scheme` nor the `option { background }` belt-and-braces
 * that used to sit under `.settings-select` and `.body-language` can reach it. Three more
 * things fall out of owning the popup: an `<option>` cannot carry a glyph — the reason the
 * method picker was a transparent select painted over a chip, and the reason `THEMES` has
 * a note saying it has no icons — the chosen value can be marked apart from the row the
 * cursor is on, which an `<option>` conflates, and `.body-language` and `.auth-editor
 * select` get the focus ring their `outline: 0` had been eating.
 *
 * What it costs is keyboard behaviour and type-ahead, which the platform used to supply.
 * Both are below, and they are the bulk of this file.
 *
 * The floating layer itself is *not* hand-rolled. `popover="auto"` supplies top-layer
 * rendering (so the three menus in Settings draw over a modal `<dialog>` instead of
 * fighting it), light dismiss, and Escape — the same trade `CommandPalette` makes with
 * `<dialog>` + `showModal()`, and the reason none of what `TreeRowActions` lists as the
 * cost of being a popup ("outside-pointerdown dismissal, an open state threaded through
 * the row") appears here.
 *
 * Focus stays on the trigger for the whole interaction and the highlight travels by
 * `aria-activedescendant` — the WAI-ARIA select-only combobox pattern, and the same
 * contract the command palette already uses.
 *
 * Generic in `T` so `onChange` hands back the narrowed union. That is what removes the
 * `find` over the option list every one of these call sites used to need to avoid
 * asserting `event.target.value`.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  variant = 'field',
  id,
  ariaLabel,
  labelledBy,
  describedBy,
  title,
  disabled = false,
}: SelectProps<T>) {
  const base = useId()
  const triggerId = id ?? `${base}-trigger`
  const popoverId = `${base}-popover`
  const listId = `${base}-list`
  const optionId = (index: number) => `${base}-option-${index}`

  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typed = useRef({ buffer: '', at: 0 })

  const [open, setOpen] = useState(false)
  const selectedIndex = options.findIndex(option => option.value === value)
  const [active, setActive] = useState(0)

  /**
   * `:root` carries `zoom: var(--zoom)`, so the menu — a descendant of it even while in the
   * top layer — has the `left`/`top` written below multiplied by the zoom before it lands,
   * while the trigger's rect is already in client pixels. They have to be divided by the
   * zoom to cancel, the same compensation the two dialogs make with
   * `calc(12vh / var(--zoom, 1))`.
   *
   * The factor is measured rather than read, because whether a client rect includes the
   * zoom is exactly the thing that varies between engine versions. `offsetWidth` never
   * includes it and `getBoundingClientRect` may, so their ratio says which world this is:
   * it comes out at the declared zoom where rects are scaled, and at 1 where they are not
   * — and 1 is precisely the divisor that leaves the coordinates alone in that case.
   */
  const place = useCallback(() => {
    const trigger = triggerRef.current
    const popover = popoverRef.current
    if (!trigger || !popover) return

    const rect = trigger.getBoundingClientRect()
    const declared = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1
    const measured = trigger.offsetWidth > 0 ? rect.width / trigger.offsetWidth : 1
    // Snapped to the declared value rather than used raw: `offsetWidth` is a rounded
    // integer, so the ratio is close but not exact, and an inexact divisor drifts.
    const zoom = Math.abs(measured - declared) < Math.abs(measured - 1) ? declared : 1

    const below = window.innerHeight - rect.bottom - GAP - MARGIN
    const above = rect.top - GAP - MARGIN
    const flip = below < MIN_ROOM && above > below

    popover.style.left = `${rect.left / zoom}px`
    popover.style.minWidth = `${rect.width / zoom}px`
    popover.style.maxHeight = `${Math.max(MIN_ROOM, flip ? above : below) / zoom}px`
    if (flip) {
      popover.style.top = 'auto'
      popover.style.bottom = `${(window.innerHeight - rect.top + GAP) / zoom}px`
    } else {
      popover.style.bottom = 'auto'
      popover.style.top = `${(rect.bottom + GAP) / zoom}px`
    }
  }, [])

  /**
   * The horizontal correction has to wait until the menu is actually showing: `place` runs
   * on `beforetoggle`, where the element is still `display: none` and measures as zero, and
   * the menu can be wider than the trigger it was sized from.
   */
  const clampRight = useCallback(() => {
    const popover = popoverRef.current
    if (!popover) return
    const rect = popover.getBoundingClientRect()
    const overflow = rect.right - (window.innerWidth - MARGIN)
    if (overflow <= 0) return
    // Same measurement as in `place`, off the menu itself now that it is laid out.
    const declared = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1
    const measured = popover.offsetWidth > 0 ? rect.width / popover.offsetWidth : 1
    const zoom = Math.abs(measured - declared) < Math.abs(measured - 1) ? declared : 1
    popover.style.left = `${Math.max(MARGIN, rect.left - overflow) / zoom}px`
  }, [])

  useEffect(() => {
    const popover = popoverRef.current
    if (!popover) return

    // Read through a guard rather than `instanceof ToggleEvent`: this only needs the one
    // field, and nothing here depends on the constructor existing as a global.
    const stateOf = (event: Event) => ('newState' in event && typeof event.newState === 'string' ? event.newState : '')

    const onBeforeToggle = (event: Event) => {
      if (stateOf(event) === 'open') place()
    }
    const onToggle = (event: Event) => {
      const showing = stateOf(event) === 'open'
      setOpen(showing)
      if (showing) clampRight()
      // Light dismiss can leave focus on the body. The invoker relationship restores it in
      // newer engines; this covers the ones where it does not.
      else if (document.activeElement === document.body) triggerRef.current?.focus()
    }

    popover.addEventListener('beforetoggle', onBeforeToggle)
    popover.addEventListener('toggle', onToggle)
    return () => {
      popover.removeEventListener('beforetoggle', onBeforeToggle)
      popover.removeEventListener('toggle', onToggle)
    }
  }, [place, clampRight])

  useEffect(() => {
    if (!open) return
    const onResize = () => place()
    // Anything that scrolls under an open menu moves the trigger out from under it. Native
    // selects close too; repositioning on every scroll frame would be the fussier answer.
    //
    // Capture, because scroll does not bubble and the thing that moved is usually a panel
    // rather than the window — which is also why the menu's *own* scrolling arrives here.
    // That has to be let through: a menu long enough to scroll is exactly the one you need
    // to scroll to read, and closing it on the first wheel notch makes its lower half
    // unreachable. It closed on `scrollIntoView` too, so opening the picker on a response
    // whose language sat below the fold dismissed it before the user touched anything.
    const onScroll = (event: Event) => {
      const popover = popoverRef.current
      if (!popover?.matches(':popover-open')) return
      const target = event.target
      if (target instanceof Node && popover.contains(target)) return
      popover.hidePopover()
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  // `showPopover`/`hidePopover` throw when the popover is already in the state asked for,
  // and both are reachable from more than one path here.
  function openPopover(index: number) {
    setActive(index)
    const popover = popoverRef.current
    if (popover && !popover.matches(':popover-open')) popover.showPopover()
  }

  function closePopover() {
    const popover = popoverRef.current
    if (popover?.matches(':popover-open')) popover.hidePopover()
  }

  const commit = (option: SelectOption<T> | undefined) => {
    closePopover()
    if (option && option.value !== value) onChange(option.value)
  }

  const move = (delta: number) => setActive(index => (index + delta + options.length) % options.length)

  const isPrintable = (event: ReactKeyboardEvent) => event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey

  /**
   * Prefix search over the labels, with a buffer that expires — what the native select gave
   * for free. A repeated single letter cycles through the options starting with it, which is
   * why a one-character buffer starts its scan *after* the current option.
   */
  const typeAhead = (key: string, from: number) => {
    const now = Date.now()
    const buffer = now - typed.current.at > TYPE_AHEAD_RESET ? key : typed.current.buffer + key
    typed.current = { buffer, at: now }

    const needle = buffer.toLowerCase()
    const start = buffer.length === 1 ? from + 1 : from
    for (let step = 0; step < options.length; step += 1) {
      const index = (start + step + options.length) % options.length
      if (options[index].label.toLowerCase().startsWith(needle)) return index
    }
    return -1
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const from = selectedIndex < 0 ? 0 : selectedIndex

    if (!open) {
      switch (event.key) {
        case 'Enter':
        case ' ':
        case 'ArrowDown':
        case 'ArrowUp':
          event.preventDefault()
          openPopover(from)
          return
        case 'Home':
          event.preventDefault()
          openPopover(0)
          return
        case 'End':
          event.preventDefault()
          openPopover(options.length - 1)
          return
        default:
          if (!isPrintable(event)) return
          event.preventDefault()
          openPopover(Math.max(0, typeAhead(event.key, from)))
          return
      }
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      case 'PageDown':
        event.preventDefault()
        setActive(index => Math.min(options.length - 1, index + 8))
        break
      case 'PageUp':
        event.preventDefault()
        setActive(index => Math.max(0, index - 8))
        break
      case 'Home':
        event.preventDefault()
        setActive(0)
        break
      case 'End':
        event.preventDefault()
        setActive(options.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        commit(options[active])
        break
      case 'Tab':
        // Commits and lets focus move on, the way a native select does. No `preventDefault`.
        commit(options[active])
        break
      case 'Escape':
        // All three matter, and the first one is not optional. Escape is a *close request*:
        // the engine services it after this handler returns, and by then `closePopover` has
        // already hidden the menu — so it walks up and closes the next thing in the top
        // layer instead, which in Settings is the whole dialog. Cancelling the default and
        // doing the closing here is what keeps it to one level.
        //
        // `stopPropagation` covers the other end: `useGlobalShortcuts` aborts the in-flight
        // request on a bare Escape and only stands down for a modal, so without it,
        // dismissing this menu over the request bar would cancel a running send.
        event.preventDefault()
        event.stopPropagation()
        closePopover()
        break
      default:
        if (!isPrintable(event)) break
        event.preventDefault()
        setActive(index => {
          const next = typeAhead(event.key, index)
          return next < 0 ? index : next
        })
        break
    }
  }

  const selected = selectedIndex < 0 ? undefined : options[selectedIndex]

  return (
    <div className="select">
      <button
        type="button"
        ref={triggerRef}
        id={triggerId}
        className="select-trigger"
        data-variant={variant}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        title={title}
        disabled={disabled}
        /* Declarative rather than an `onClick` of our own: light dismiss fires on
           pointerdown outside the menu — the trigger counts as outside — so a handler would
           reopen what the dismissal had just closed. The invoker relationship also gives
           focus somewhere to return to.
           Dropped while disabled: a disabled button fires no click, but the invoker
           relationship is declarative and the keyboard path below has to be stopped too. */
        popoverTarget={disabled ? undefined : popoverId}
        popoverTargetAction="toggle"
        /* Seeds the highlight, and opens nothing — so the rule above still holds.
           `openPopover` is the only thing that seeds `active`, and all four of its callers
           are in `onKeyDown`; a pointer open goes straight through `popoverTarget` and never
           reaches it, so `active` stayed at its initial 0 and every menu opened with the
           *first* row highlighted instead of the selected one.
           Not in the popover's `beforetoggle` handler, which looks like the natural home:
           that event is dispatched synchronously inside `showPopover()`, so its `setActive`
           would queue after the one `openPopover` had just made and clobber the seeding
           Home, End and type-ahead depend on. A click cannot collide with them — the
           keyboard path calls `preventDefault()` on Enter and Space, so no click follows. */
        onClick={disabled ? undefined : () => setActive(selectedIndex < 0 ? 0 : selectedIndex)}
        onKeyDown={disabled ? undefined : onKeyDown}
      >
        <span className="select-value">{selected?.glyph ?? selected?.label}</span>
        <ChevronDown size={12} aria-hidden="true" className="select-caret" />
      </button>

      <div ref={popoverRef} id={popoverId} popover="auto" className="select-popover" data-variant={variant}>
        <div ref={listRef} role="listbox" id={listId} aria-labelledby={triggerId} className="select-list">
          {options.map((option, index) => (
            <div
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              // The glyph carries the label visually but not to the accessibility tree — the
              // method chip is `decorative`, so without this the row would announce as blank.
              aria-label={option.glyph ? option.label : undefined}
              data-active={index === active}
              className="select-option"
              // `pointermove`, not `mouseenter`: opening the menu under a stationary cursor
              // must not steal the highlight from the keyboard. Same reason as the palette.
              onPointerMove={() => setActive(index)}
              onClick={() => commit(option)}
            >
              <span className="select-option-value">{option.glyph ?? option.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
