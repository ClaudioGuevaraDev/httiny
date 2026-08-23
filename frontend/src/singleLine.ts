import { acceptCompletion, autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { history, historyKeymap, standardKeymap } from '@codemirror/commands'
import { Annotation, EditorState, Facet, Prec, keymap } from '@uiw/react-codemirror'
import type { ChangeSpec, Command, Extension, KeyBinding } from '@uiw/react-codemirror'
import { completionChrome, inputTheme } from './editorTheme'
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

/** The same collapse applied to a document set from outside, where no filter runs. */
export const flatten = (value: string): string => value.replace(/[\r\n]+/g, '')

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
export const contentAttrs = (label: string, inputMode?: string): Record<string, string> => ({
  'aria-label': label,
  'aria-multiline': 'false',
  ...(inputMode ? { inputmode: inputMode } : {}),
})
