import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { EditorView, type Extension } from '@uiw/react-codemirror'

/**
 * Replaces the `oneDark` theme, which had its own palette and so made the body
 * editor and the response viewer disagree about what a JSON string looks like.
 *
 * Every colour is a `var()` reference rather than a literal, so the CSS tokens stay
 * the single source of truth. This is exactly why `theme.css` uses `@theme static`:
 * Tailwind's default lazy emission only keeps variables it can see being used, and
 * it cannot see these ones inside JS strings.
 *
 * `EditorView` is imported from `@uiw/react-codemirror` rather than
 * `@codemirror/view` so there is one module instance and no duplicate-package
 * hazard.
 */
const chrome = EditorView.theme(
  {
    /*
     * The background is a variable with a fallback, not a fixed token, because the same
     * theme is used on two different plates: the request and response panes, which *are*
     * `--color-surface-1`, and the code view's modal, which is `--color-surface-2` and
     * where a surface-1 editor read as a darker rectangle pasted into the dialog.
     *
     * A custom property set on an ancestor is what makes that overridable at all.
     * CodeMirror injects its own rules through StyleModule at runtime, unlayered, and
     * unlayered CSS beats every `@layer` whatever the specificity — so a plain
     * `.code-body .cm-editor { background: … }` in `@layer components` would silently do
     * nothing. See the comment at the top of `styles/codemirror.css`.
     */
    '&': {
      color: 'var(--color-text)',
      backgroundColor: 'var(--editor-surface, var(--color-surface-1))',
      fontSize: 'var(--text-code)',
    },
    '&.cm-editor': { height: '100%' },
    '&.cm-editor.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: 'var(--text-code--line-height)',
    },
    '.cm-content': {
      padding: '12px 0',
      caretColor: 'var(--color-accent)',
    },
    '.cm-line': { padding: '0 16px' },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--color-accent)',
      borderLeftWidth: '2px',
    },
    '.cm-activeLine': { backgroundColor: 'var(--color-surface-code-active)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--color-selection)',
    },
    '.cm-selectionMatch': { backgroundColor: 'var(--color-selection-match)' },
    '.cm-gutters': {
      backgroundColor: 'var(--editor-surface, var(--color-surface-1))',
      color: 'var(--color-text-faint)',
      border: 'none',
      borderRight: '1px solid var(--color-border-subtle)',
    },
    '.cm-lineNumbers .cm-gutterElement': { minWidth: '36px', padding: '0 8px 0 12px' },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--color-surface-code-active)',
      color: 'var(--color-text-muted)',
    },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--color-bracket-match)',
      outline: '1px solid var(--color-border-control)',
    },
    '.cm-nonmatchingBracket': { color: 'var(--color-danger)' },
    '.cm-placeholder': { color: 'var(--color-text-faint)' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--color-surface-4)',
      border: 'none',
      color: 'var(--color-text-muted)',
    },
    '.cm-panels': { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-text)' },
  },
  { dark: true },
)

/**
 * The completion dropdown, shared by both kinds of editor.
 *
 * Its own theme rather than part of `chrome`, because the single-line field cannot take
 * `chrome` — that one sets `font-size: var(--text-code)`, which the Settings slider
 * drives — but does need the menu. One definition of the dropdown for both surfaces.
 *
 * **`{ dark: true }` is half the point and is not decoration.** It is the only thing that
 * makes `themeClasses` pick `baseDarkID`, and that ternary has no third state: a view
 * without it is stamped light, and the library's own `&light .cm-tooltip` then paints a
 * `#f5f5f5` plate *without setting a colour*, so a dark theme's pale text lands on it.
 * That was the bug. The rules below are the other half — with the flag but without them
 * the menu would be the stock `#333338` plate and `#347` selection band.
 *
 * Three of the library's rules are unscoped and therefore live in every editor whatever
 * the theme, which is why they are overridden here rather than left alone:
 * `.cm-completionMatchedText` ships `text-decoration: underline` (in a monospace list
 * that reads as a link), `.cm-completionDetail` ships `font-style: italic` and a
 * `margin-left`, and `.cm-completionIcon` ships `opacity: 0.6`.
 */
export const completionChrome: Extension = EditorView.theme(
  {
    /* The plate. Shared with the search panel's own tooltips, which is why it is not
     * folded into the autocomplete selector below. */
    '.cm-tooltip': {
      backgroundColor: 'var(--color-surface-4)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 'var(--radius-md)',
      color: 'var(--color-text)',
    },
    /*
     * The dropdown's *innards*. The rule above supplies the plate, the edge and the text
     * colour; without what follows, the library paints the rest itself. That is the same
     * gap `TextBody` records for `.cm-panels`, which only ever had its container styled.
     *
     * The recipe is `.select-popover` and `.select-option` from `components.css`,
     * deliberately: the completion menu and the app's own menus should be one object,
     * down to the 2px × 16px accent rail that marks the row in question in the tree, in
     * the settings nav and in every `Select`.
     *
     * Two of the library's classes are left alone on purpose — `> completion-section`
     * and `.cm-completionInfo` — because nothing here declares a `CompletionSection` or
     * an `info`. Whoever adds either owes this block the same treatment; that omission
     * is exactly how the `.cm-panels` gap happened.
     */
    '.cm-tooltip.cm-tooltip-autocomplete': {
      padding: '4px',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-menu)',
    },
    '.cm-tooltip-autocomplete > ul': {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      maxHeight: '18em',
      // Scrolling past the end of the list must not start scrolling the editor behind
      // it — `.select-popover`'s rule, for the same reason.
      overscrollBehavior: 'contain',
    },
    '.cm-tooltip-autocomplete > ul > li': {
      minHeight: 'var(--h-control-sm)',
      padding: '0 8px',
      display: 'flex',
      alignItems: 'center',
      gap: '9px',
      // For the rail below.
      position: 'relative',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--color-text-muted)',
    },
    // Not `--color-surface-hover`, which sits *below* `--color-surface-4` on the dark
    // ladder and would read as a dent rather than a selection.
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--color-surface-accent)',
      color: 'var(--color-text-strong)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]::before': {
      content: '""',
      position: 'absolute',
      left: '2px',
      top: '50%',
      translate: '0 -50%',
      width: '2px',
      height: '16px',
      borderRadius: 'var(--radius-full)',
      backgroundColor: 'var(--color-accent)',
    },
    // A list that is filtering to nothing must not keep claiming the accent plate.
    '.cm-tooltip-autocomplete-disabled > ul > li[aria-selected]': {
      backgroundColor: 'var(--color-surface-hover)',
    },
    '.cm-completionLabel': { flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis' },
    // `.palette-title mark` exactly. The library's own rule is unscoped and ships
    // `text-decoration: underline`, which in a monospace list reads as a link.
    '.cm-completionMatchedText': {
      textDecoration: 'none',
      color: 'var(--color-accent)',
      fontWeight: 'var(--font-weight-semibold)',
    },
    // `.palette-subtitle`: pushed right, truncating, and neither italic nor
    // `margin-left`-ed, which are the library's unscoped defaults. This slot carries a
    // variable's value, or the word standing in for one that must never be printed.
    '.cm-completionDetail': {
      marginLeft: 'auto',
      paddingLeft: '12px',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      fontStyle: 'normal',
      fontSize: 'var(--text-2xs)',
      color: 'var(--color-text-subtle)',
    },
    // The library ships `opacity: 0.6`, also unscoped.
    '.cm-completionIcon': {
      width: 'var(--size-icon-sm)',
      paddingRight: 0,
      opacity: 1,
      color: 'var(--color-text-subtle)',
    },
  },
  { dark: true },
)

/**
 * `@lezer/json` tags exactly five things — String, Number, True/False, PropertyName
 * and Null — and leaves braces, brackets, colons and commas untagged. That is the
 * same token model the response viewer's highlighter uses, which is why pointing
 * both at these four variables makes them match exactly.
 *
 * The punctuation and comment entries are inert for JSON but correct for any
 * language added later.
 */
const highlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--color-syntax-key)' },
  { tag: [tags.string, tags.special(tags.string), tags.docString], color: 'var(--color-syntax-string)' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--color-syntax-number)' },
  { tag: [tags.bool, tags.null, tags.atom, tags.keyword], color: 'var(--color-syntax-literal)' },
  {
    tag: [tags.punctuation, tags.separator, tags.brace, tags.bracket, tags.squareBracket, tags.paren],
    color: 'var(--color-syntax-punctuation)',
  },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--color-syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--color-syntax-key)', textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--color-danger)' },
])

export const httinyTheme: Extension = [chrome, completionChrome, syntaxHighlighting(highlight)]

/**
 * The single-line field, for `TemplateInput`.
 *
 * Deliberately **not** composed with `chrome`: that theme sets
 * `font-size: var(--text-code)` and `line-height: var(--text-code--line-height)`, which
 * `codeFont.ts` drives from the Settings slider. A grid cell has to stay 12px beside an
 * 11px `.kv-header` whatever that slider says, so the size is read from the static
 * `--text-xs`/`--text-sm` tokens by `.template-input` in `components.css` and this theme
 * never mentions it.
 *
 * Everything here is something CodeMirror's own base theme declares, which is why it has
 * to be undone from a theme rather than from `@layer components`: CodeMirror injects
 * unlayered and unlayered beats every layer. Everything the base theme does *not*
 * declare — height, border, radius, background, padding, font size, the focus ring —
 * lives in `components.css` on `.template-input`, beside the `.technical-input` rules it
 * has to agree with. `--ti-line` is the one value that crosses the boundary.
 */
export const inputTheme: Extension = EditorView.theme({
  '&.cm-editor': { height: '100%', width: '100%' },
  // The base theme paints a 1px dotted ring on the content box. The ring belongs on
  // `.template-input`, which is the box the user sees.
  '&.cm-editor.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    /*
     * The *text's* line box, which is not the field's height. It used to be the height,
     * on the reasoning that a line box filling the content box centres the glyph exactly
     * where a UA centres a one-line `<input>`'s — true, but it also made the native
     * selection band exactly as tall as the field, so selecting anything painted a slab
     * flush against the border. A native `::selection` takes no padding, no radius and
     * no inset, so the only way to inset the band is to shrink the line box.
     *
     * `--ti-line` is now 1.5 × the font size, which is what the `<input>` in the next
     * column along inherits from Tailwind's preflight — so the two neighbouring cells
     * finally agree about how tall a selection is. The height comes back as
     * `.cm-content` padding below rather than as centring on this element, because
     * `align-items: center` here would collapse `min-height: 100%` and leave a strip at
     * the top and bottom of the cell where clicking does nothing.
     */
    lineHeight: 'var(--ti-line)',
    // An `<input>` scrolls its text with no scrollbar, and `base.css` styles a 9px one
    // globally — inside a 31px cell that would be a visible artefact.
    scrollbarWidth: 'none',
  },
  '.cm-scroller::-webkit-scrollbar': { display: 'none' },
  /*
   * The vertical half of the centring, and the reason the whole cell stays clickable:
   * with `min-height: 100%` from the base theme, padding plus one line box comes to the
   * full field height. `--ti-pad` is derived from `--ti-box` and `--ti-line` in
   * `components.css`, and the static render is padded from the same two properties, so
   * the two cannot drift apart and the text does not jump on the first click.
   *
   * Horizontal padding stays on `.template-input`, in exactly one place, for the same
   * reason.
   */
  '.cm-content': { padding: 'var(--ti-pad) 0', caretColor: 'var(--color-accent)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)', borderLeftWidth: '2px' },
  /*
   * No selection rule at all, deliberately.
   *
   * There is no `::selection` anywhere else in this app: ordinary UI text, and the
   * description `<input>` sitting in the same grid row, both use the system highlight. A
   * one-line field reads as an input rather than as a code editor, so it should match its
   * neighbours — and the rule that used to be here painted `--color-selection`, the
   * editors' green, over a band as tall as the cell.
   *
   * `chrome` keeps its own copy, and that is not an inconsistency: the body editor and
   * the response viewer run `drawSelection` through `basicSetup`, so there
   * `--color-selection` fills a real element that CodeMirror draws and the measured
   * ratios in `theme.css` describe what they say they do. These fields have no such
   * layer — the band was always the browser's.
   */
  '.cm-placeholder': { color: 'var(--color-text-faint)' },
})
