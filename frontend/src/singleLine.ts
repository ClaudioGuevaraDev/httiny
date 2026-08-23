import { acceptCompletion, autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { history, historyKeymap, standardKeymap } from '@codemirror/commands'
import { Annotation, Compartment, EditorState, EditorView, Facet, Prec, keymap, placeholder } from '@uiw/react-codemirror'
import type { ChangeSpec, Command, Extension, KeyBinding } from '@uiw/react-codemirror'
import { completionChrome, inputTheme } from './editorTheme'
import { flatten } from './template'
import { templateVariables } from './templateEditor'

/**
 * The extensions that make a CodeMirror behave like an `<input>`.
 *
 * A leaf: no React, no store — the tier of `zoom.ts`. Everything is built once at module
 * scope, which is the whole reason `TemplateInput` drives a raw `EditorView` instead of
 * the React wrapper: nothing here ever changes identity, so nothing is ever
 * reconfigured, however many fields are on screen.
 *
 * `basicSetup` is not used at all. Of what it turns on, everything is wrong for one line
 * except `history` and `completionKeymap` — and `closeBrackets` is actively hostile: it
 * would turn `{` into `{}` and make typing `{{` produce `{{}}}}`.
 *
 * One caveat for whoever puts a field somewhere new: a single-line editor inside a
 * `<dialog>` would need its completion tooltip parented to that dialog rather than to
 * the body, because the top layer beats any `z-index` and a menu on `document.body`
 * would paint behind the modal. Nothing does that today — the environments modal's own
 * value column is deliberately a plain input, since resolution is one pass and a
 * variable inside a variable never expands — and changing it means giving
 * `templateEditor.ts`'s `tooltips(...)` a parent option.
 */

/**
 * Marks a document change that came from the store rather than from the user.
 *
 * The field is controlled, so an edit made anywhere else — a param row rewriting the URL
 * through `replaceQuery` — arrives as a dispatch. Without this the update listener would
 * report it back as a user edit and the two surfaces would feed each other.
 */
export const fromStore = Annotation.define<boolean>()

/** Where a field sends its plain Enter, if it sends one anywhere. */
export const submitFacet = Facet.define<{ current: (() => void) | undefined }>()

const acceptOrSubmit: Command = view => {
  // Ordered, not accidental: with a completion open Enter accepts it, and only a closed
  // completion submits. `acceptCompletion` returns false when nothing is open.
  if (acceptCompletion(view)) return true
  view.state.facet(submitFacet)[0]?.current?.()
  return true
}

const singleLineKeys: readonly KeyBinding[] = [
  {
    key: 'Enter',
    shift: acceptOrSubmit,
    run: acceptOrSubmit,
    // `preventDefault` even though the command always returns true: without it the
    // browser inserts a `<br>` into the contenteditable and the DOM observer reads it
    // back as a newline.
    preventDefault: true,
  },
]

/**
 * Everything that is not a keystroke: paste, drop, IME, `execCommand`. A keymap cannot
 * see any of them.
 *
 * Newlines are stripped rather than the transaction rejected, which is what an `<input>`
 * does with a pasted multi-line string — dropping the paste outright would be a silent
 * no-op on a two-line clipboard. No `selection` is supplied, so CodeMirror maps the old
 * one through the rewritten changes.
 */
const singleLineFilter = EditorState.transactionFilter.of(tr => {
  if (!tr.docChanged) return tr
  let dirty = false
  tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    if (inserted.lines > 1) dirty = true
  })
  if (!dirty) return tr
  const changes: ChangeSpec[] = []
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({ from: fromA, to: toA, insert: flatten(inserted.toString()) })
  })
  return { changes, scrollIntoView: true }
})


export const SINGLE_LINE: Extension = [
  inputTheme,
  /* The dropdown, and the `{ dark: true }` that comes with it. Without this the view is
   * stamped light — the ternary behind `themeClasses` has no third state — and the
   * library's own `&light .cm-tooltip` paints a pale plate under the theme's pale text. */
  completionChrome,
  singleLineFilter,
  Prec.highest(keymap.of(singleLineKeys)),
  history(),
  keymap.of(historyKeymap),
  /* `standardKeymap`, never `defaultKeymap`. The latter binds `Mod-Enter` to
   * `insertBlankLine`, `Escape` to `simplifySelection` and `Mod-/` to `toggleComment` —
   * which are the send shortcut, the abort shortcut, and a combo `shortcuts.ts` already
   * records as belonging to the body editor. `standardKeymap` binds none of the three. */
  keymap.of(standardKeymap),
  /* Installed here because there is no `basicSetup` to bring it. This is also what
   * supplies the `Mod-Space` binding and the whole combobox a11y contract —
   * `aria-autocomplete`, `aria-controls` and `aria-activedescendant` on the content,
   * with DOM focus staying in the field. */
  autocompletion(),
  keymap.of(completionKeymap),
  templateVariables,
]

/**
 * The attributes CodeMirror does not supply, or supplies wrongly.
 *
 * `contentAttributes` merges *over* CodeMirror's own defaults, so these win. A
 * contenteditable has no `<label>` to borrow a name from and no `type`, which is why
 * both arrive here; `aria-multiline` defaults to `"true"`, which is a lie about a
 * one-line field and makes a screen reader offer line navigation that does nothing.
 *
 * `autoComplete="off"` needs no equivalent: a contenteditable is not a form control, so
 * no password manager offers to fill it. `spellcheck`, `autocorrect`, `autocapitalize`
 * and `writingsuggestions` are already off by CodeMirror's own default.
 */
const contentAttrs = (label: string, inputMode?: string): Record<string, string> => ({
  'aria-label': label,
  'aria-multiline': 'false',
  ...(inputMode ? { inputmode: inputMode } : {}),
})

/** What `TemplateInput` can do to a mounted field. Everything else about it stays in here. */
export interface SingleLineEditor {
  /** Writes a document that came from the store, annotated so the listener ignores it. */
  setValue: (value: string) => void
  /** Re-applies the two things that follow a language change or a relabel. */
  reconfigure: (ariaLabel: string, urlVariant: boolean, hint: string | undefined) => void
  focus: () => void
  destroy: () => void
}

/**
 * Builds the field, and is the whole reason this module can be loaded on demand.
 *
 * `TemplateInput` used to construct the `EditorView` itself, which meant importing
 * `EditorView`, `EditorState`, `Compartment` and `placeholder` as *values* — so the URL
 * bar, which is on screen from the first paint, dragged all of CodeMirror into the startup
 * chunk even though it renders coloured spans and builds nothing until it is focused. Half
 * the chunk was an editor that at that moment did not exist. Everything CodeMirror-shaped
 * now lives behind this function, and the component holds a `SingleLineEditor` it got from
 * a dynamic import.
 *
 * The two compartments are per field and created here rather than in the component, for
 * the same reason: they are CodeMirror values.
 *
 * `change` and `submit` arrive as refs and not as functions. The extensions read them at
 * dispatch time, so a re-render that hands the field a new callback does not have to
 * rebuild anything — which is the property the module-scope `SINGLE_LINE` depends on.
 */
export function mountSingleLine(options: {
  parent: HTMLElement
  doc: string
  ariaLabel: string
  urlVariant: boolean
  hint: string | undefined
  change: { readonly current: (value: string) => void }
  submit: { readonly current: (() => void) | undefined }
  /** Where a pointer landed before the field existed, in client coordinates. */
  at: { x: number; y: number } | null
  /** Whether the field was reached by keyboard, which selects all the way Tab does. */
  selectAll: boolean
}): SingleLineEditor {
  const attrs = new Compartment()
  const hint = new Compartment()

  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      // A newline can only arrive here from a hand-edited workspace.json, but a
      // two-line document in a 31px box is not a state worth rendering. The filter in
      // `SINGLE_LINE` covers every later edit; the initial document is not filtered.
      doc: flatten(options.doc),
      extensions: [
        SINGLE_LINE,
        attrs.of(EditorView.contentAttributes.of(contentAttrs(options.ariaLabel, options.urlVariant ? 'url' : undefined))),
        hint.of(options.hint ? placeholder(options.hint) : []),
        submitFacet.of(options.submit),
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return
          if (update.transactions.some(tr => tr.annotation(fromStore))) return
          options.change.current(update.state.doc.toString())
        }),
      ],
    }),
  })

  view.dispatch({
    selection: options.at
      ? { anchor: view.posAtCoords(options.at) ?? view.state.doc.length }
      : options.selectAll
        ? // Tab into an `<input>` selects its value. Match it.
          { anchor: 0, head: view.state.doc.length }
        : { anchor: view.state.doc.length },
  })
  view.focus()

  return {
    setValue: value => {
      const flat = flatten(value)
      if (flat === view.state.doc.toString()) return
      // Annotated so the update listener can tell "the store changed under me" from "the
      // user typed", which is what stops the params↔URL sync from feeding back.
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: flat }, annotations: fromStore.of(true) })
    },
    reconfigure: (ariaLabel, urlVariant, next) =>
      view.dispatch({
        effects: [
          attrs.reconfigure(EditorView.contentAttributes.of(contentAttrs(ariaLabel, urlVariant ? 'url' : undefined))),
          // `placeholder()` captures its string at construction, and the app changes
          // language without reloading.
          hint.reconfigure(next ? placeholder(next) : []),
        ],
      }),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  }
}
