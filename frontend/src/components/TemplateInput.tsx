import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useVariables } from '../environments'
import type { SingleLineEditor } from '../singleLine'
import { VAR_CLASS, VAR_UNKNOWN_CLASS, templateSpans } from '../template'

export type TemplateVariant = 'url' | 'cell'

/**
 * A one-line text field that paints `{{variable}}` and completes its names.
 *
 * An `<input>` cannot colour part of its own value, so this is a CodeMirror — but a raw
 * `EditorView` in a ref rather than the `@uiw/react-codemirror` wrapper the two full
 * editors use, and that divergence is the point. The wrapper lists `onChange` in the
 * dependencies of its reconfigure effect, and every call site passes an inline arrow, so
 * it dispatches a `StateEffect.reconfigure` on **every React render** — invisible for one
 * body editor, N reconfigures per character in a grid where each keystroke re-renders
 * every row. It also defers an external `value` change behind a 200 ms typing latch,
 * which a field another surface can rewrite must not have, and injects an unlayered
 * `!important` height we could not undo. `TextBody` is already the precedent for holding
 * an `EditorView` in a ref; this extends it.
 *
 * **At rest a field is not an editor.** It renders as a div of coloured spans, and the
 * view is constructed on first focus. Always-mounting instead would put a
 * `MutationObserver`, two `ResizeObserver`s, three `IntersectionObserver`s, a pair of
 * window listeners and a `scroll` listener on `.request-panel` behind *every cell* of
 * every grid — forty of each in a twenty-row Params tab, all hanging off the one element
 * the user scrolls. The static path costs one `String.includes` per render instead, which
 * is cheap by construction rather than by measurement.
 *
 * Once constructed the view is kept for as long as the component lives. Destroying it on
 * blur would free the observers but reset the undo history on every visit and pay a fresh
 * `EditorView` per focus change, so the live count is "cells the user actually touched" —
 * and switching request tabs unmounts the grid and takes them all with it.
 *
 * **The module is deferred too, not just the view.** Everything above was true while
 * `@uiw/react-codemirror` was still a static import here, which meant the URL bar — on
 * screen from the first paint, rendering spans — put the entire editor stack in the
 * startup chunk. Focus now triggers a dynamic `import('../singleLine')` and the view is
 * built by `mountSingleLine` once it lands; this file holds a `SingleLineEditor` handle
 * and no CodeMirror value at all. The two refs that already existed for the gap between
 * the click and the view — where the pointer landed, and whether Tab brought us here —
 * are what make the longer gap free: they were solving this exact problem one frame at a
 * time, and now solve it across a chunk load.
 */
export function TemplateInput({
  value,
  onChange,
  variant,
  ariaLabel,
  placeholder,
  id,
  onSubmit,
}: {
  value: string
  onChange: (value: string) => void
  variant: TemplateVariant
  /** Required: a contenteditable has no `<label>` to borrow an accessible name from. */
  ariaLabel: string
  placeholder?: string
  id?: string
  /**
   * What plain Enter does. Absent means Enter is swallowed, which is what a grid cell
   * wants — adding a row belongs to whoever owns the rows, not to the field. Present
   * means Enter submits, the way an `<input>` in a form does. An open completion is
   * accepted first either way.
   */
  onSubmit?: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<SingleLineEditor | null>(null)
  /** Focus has asked for an editor. The module may not have arrived yet. */
  const [live, setLive] = useState(false)
  /** `mountSingleLine`, once the chunk is in. `null` until then, and once per app not per field. */
  const [mount, setMount] = useState<typeof import('../singleLine').mountSingleLine | null>(null)

  // Stable holders, so nothing the module-scope extensions read ever changes identity
  // and there is never anything to reconfigure. Written in an effect rather than during
  // render, which is both what the compiler's rules require and the documented shape of
  // the latest-ref pattern; the initial values come from `useRef`'s argument, so a
  // callback fired before the first effect still sees the right one.
  const change = useRef(onChange)
  const submit = useRef(onSubmit)
  useEffect(() => {
    change.current = onChange
    submit.current = onSubmit
  })

  /** Where a pointer landed before the view existed, in client coordinates. */
  const point = useRef<{ x: number; y: number } | null>(null)
  /** Whether the field was reached by keyboard, which selects all the way Tab does. */
  const byKeyboard = useRef(false)

  const known = useVariables()
  const spans = useMemo(() => templateSpans(value, known), [value, known])

  // Fetches the editor the first time a field is focused, and never again: the resolved
  // module is cached by the bundler, so every later field gets it from memory. `setMount`
  // is in a promise callback rather than in the effect body, which is the shape the
  // compiler's rules ask for and the reason this is not a layout effect.
  useEffect(() => {
    if (!live || mount) return
    let wanted = true
    void import('../singleLine').then(module => {
      if (wanted) setMount(() => module.mountSingleLine)
    })
    return () => {
      wanted = false
    }
  }, [live, mount])

  useLayoutEffect(() => {
    if (!mount || !host.current) return
    const at = point.current
    point.current = null
    const created = mount({
      parent: host.current,
      doc: value,
      ariaLabel,
      urlVariant: variant === 'url',
      hint: placeholder,
      change,
      submit,
      at,
      selectAll: byKeyboard.current,
    })
    editor.current = created
    return () => {
      created.destroy()
      editor.current = null
    }
    // `value` and the callbacks are deliberately absent: the document is synced by the
    // effect below and the callbacks are read through refs, so neither may rebuild the
    // view. StrictMode runs this mount→unmount→mount in dev, which `destroy()` removing
    // the view's DOM makes idempotent — hence the pending click point being a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mount, variant])

  useEffect(() => {
    editor.current?.setValue(value)
  }, [value])

  useEffect(() => {
    editor.current?.reconfigure(ariaLabel, variant === 'url', placeholder)
  }, [ariaLabel, placeholder, variant])

  // Everything the markup below switches on is "is there an editor in here", not "has one
  // been asked for". Between the two sits a chunk load, and during it the field has to go
  // on being a focusable textbox with a name — otherwise a click would drop the tab stop
  // and the role for as long as the import took.
  const mounted = mount !== null

  return (
    <div
      ref={host}
      id={id}
      className={`template-input ${variant}`}
      /* Focusable only while static, but `-1` still answers a programmatic `.focus()` —
         which is what keeps the INVALID_URL placeholder's "fix the URL" button working
         once this is a CodeMirror. */
      tabIndex={mounted ? -1 : 0}
      /* The static div announces as the editable field it is about to be: focus is
         precisely the moment it becomes one, and the element that then takes focus
         carries the same role and the same name. A focusable div with no role would
         announce as "group" and say nothing at all. */
      role={mounted ? undefined : 'textbox'}
      aria-label={mounted ? undefined : ariaLabel}
      aria-multiline={mounted ? undefined : 'false'}
      onPointerDown={event => {
        if (mounted) return
        point.current = { x: event.clientX, y: event.clientY }
        setLive(true)
      }}
      onFocus={event => {
        // Ignore focus bubbling up out of `.cm-content`.
        if (event.target !== event.currentTarget) return
        if (mounted) editor.current?.focus()
        else {
          byKeyboard.current = point.current === null
          setLive(true)
        }
      }}
    >
      {/* One element, so the flex parent has exactly one item and there are no anonymous
          flex items splitting the chips from the text runs between them. It also carries
          the line height the mounted editor uses, so the text does not shift vertically
          on the first click. */}
      {!mounted && (
        <span className="template-line">{spans.length ? renderSpans(value, spans) : value || <span className="template-hint">{placeholder}</span>}</span>
      )}
    </div>
  )
}

/**
 * Marks the same class on the same ranges the editor's decoration would, which is why
 * both go through `templateSpans` — a static cell and a live one disagreeing about which
 * variable is missing, side by side in a column, is the bug this shape prevents.
 *
 * Modelled on the command palette's match splitter: walk a cursor, emit the plain runs as
 * text and the matched runs as elements, so nothing is ever handed to `innerHTML`.
 */
function renderSpans(value: string, spans: ReturnType<typeof templateSpans>): ReactNode[] {
  const out: ReactNode[] = []
  let cursor = 0
  spans.forEach((span, index) => {
    if (span.from > cursor) out.push(value.slice(cursor, span.from))
    out.push(
      <span key={index} className={span.known ? VAR_CLASS : `${VAR_CLASS} ${VAR_UNKNOWN_CLASS}`}>
        {value.slice(span.from, span.to)}
      </span>,
    )
    cursor = span.to
  })
  if (cursor < value.length) out.push(value.slice(cursor))
  return out
}
