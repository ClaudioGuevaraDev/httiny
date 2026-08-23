import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Compartment, EditorState, EditorView, placeholder as placeholderExt } from '@uiw/react-codemirror'
import { useVariables } from '../environments'
import { SINGLE_LINE, contentAttrs, flatten, fromStore, submitFacet } from '../singleLine'
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
  const view = useRef<EditorView | null>(null)
  const [live, setLive] = useState(false)

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

  // Per instance, created once. Compartments so a change of language reconfigures two
  // small facets rather than rebuilding the field. `useState` with an initialiser rather
  // than `useRef(new Compartment())`, which would both allocate on every render and read
  // a ref during one.
  const [attrs] = useState(() => new Compartment())
  const [hint] = useState(() => new Compartment())

  useLayoutEffect(() => {
    if (!live || !host.current) return
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        // A newline can only arrive here from a hand-edited workspace.json, but a
        // two-line document in a 31px box is not a state worth rendering. The filter in
        // `SINGLE_LINE` covers every later edit; the initial document is not filtered.
        doc: flatten(value),
        extensions: [
          SINGLE_LINE,
          attrs.of(EditorView.contentAttributes.of(contentAttrs(ariaLabel, variant === 'url' ? 'url' : undefined))),
          hint.of(placeholder ? placeholderExt(placeholder) : []),
          submitFacet.of(submit),
          EditorView.updateListener.of(update => {
            if (!update.docChanged) return
            if (update.transactions.some(tr => tr.annotation(fromStore))) return
            change.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = created
    const at = point.current
    point.current = null
    created.dispatch({
      selection: at
        ? { anchor: created.posAtCoords(at) ?? created.state.doc.length }
        : byKeyboard.current
          ? // Tab into an `<input>` selects its value. Match it.
            { anchor: 0, head: created.state.doc.length }
          : { anchor: created.state.doc.length },
    })
    created.focus()
    return () => {
      created.destroy()
      view.current = null
    }
    // `value` and the callbacks are deliberately absent: the document is synced by the
    // effect below and the callbacks are read through refs, so neither may rebuild the
    // view. StrictMode runs this mount→unmount→mount in dev, which `destroy()` removing
    // `view.dom` makes idempotent — hence the pending click point being a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, variant, attrs, hint])

  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const flat = flatten(value)
    if (flat === editor.state.doc.toString()) return
    // Annotated so the update listener can tell "the store changed under me" from "the
    // user typed", which is what stops the params↔URL sync from feeding back.
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: flat }, annotations: fromStore.of(true) })
  }, [value])

  useEffect(() => {
    view.current?.dispatch({
      effects: [
        attrs.reconfigure(EditorView.contentAttributes.of(contentAttrs(ariaLabel, variant === 'url' ? 'url' : undefined))),
        // `placeholder()` captures its string at construction, and the app changes
        // language without reloading.
        hint.reconfigure(placeholder ? placeholderExt(placeholder) : []),
      ],
    })
  }, [ariaLabel, placeholder, variant, attrs, hint])

  return (
    <div
      ref={host}
      id={id}
      className={`template-input ${variant}`}
      /* Focusable only while static, but `-1` still answers a programmatic `.focus()` —
         which is what keeps the INVALID_URL placeholder's "fix the URL" button working
         once this is a CodeMirror. */
      tabIndex={live ? -1 : 0}
      /* The static div announces as the editable field it is about to be: focus is
         precisely the moment it becomes one, and the element that then takes focus
         carries the same role and the same name. A focusable div with no role would
         announce as "group" and say nothing at all. */
      role={live ? undefined : 'textbox'}
      aria-label={live ? undefined : ariaLabel}
      aria-multiline={live ? undefined : 'false'}
      onPointerDown={event => {
        if (live) return
        point.current = { x: event.clientX, y: event.clientY }
        setLive(true)
      }}
      onFocus={event => {
        // Ignore focus bubbling up out of `.cm-content`.
        if (event.target !== event.currentTarget) return
        if (live) view.current?.focus()
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
      {!live && (
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
