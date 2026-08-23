import { insertCompletionText } from '@codemirror/autocomplete'
import type { Completion, CompletionSource } from '@codemirror/autocomplete'
import { Decoration, EditorState, EditorView, MatchDecorator, StateEffect, StateField, ViewPlugin, tooltips } from '@uiw/react-codemirror'
import type { DecorationSet, Extension, ViewUpdate } from '@uiw/react-codemirror'
import { activeEnvironment, activeVariables, subscribeEnvironment } from './environments'
import { translate } from './i18n'
import { VAR_CLASS, VAR_UNKNOWN_CLASS, usable, variablePattern } from './template'
import type { EnvironmentVariable } from './types'

/**
 * `{{variable}}` support inside an editor: the chip that marks a placeholder, and the
 * completion source that offers the names.
 *
 * The tier above `template.ts`, which is a pure leaf holding the tokeniser, and beside
 * `environments.ts`, which is the one module that knows which environment is active.
 * This file is the only one that knows both plus CodeMirror.
 *
 * Every value below is built once at module scope, for the reason `response/syntax.ts`
 * states: "A fresh `extensions` array on each render makes CodeMirror reconfigure itself
 * for nothing." That is what lets `BodyEditor` and `TemplateInput` drop `templateVariables`
 * in as a constant and wire nothing.
 *
 * Deliberately **not** added to the response viewer or the code view. The viewer is
 * read-only and a chip's background would fight `--color-selection-match`, which is the
 * find bar's only highlight; the code view shows the *resolved* request, where a `{{` is
 * the user's own data in a shell or Jinja snippet. Do not complete the set.
 */

// ── Which names are known ──────────────────────────────────────────────────────

const setVariables = StateEffect.define<ReadonlyMap<string, string>>()

/**
 * A value holder, not a decoration set.
 *
 * The decoration set has to be viewport-bounded and a state field cannot know the
 * viewport — it would have to produce the set for the whole document, which on a
 * minified body means re-tokenising megabytes per keystroke. This carries only the
 * answer to "is this name defined", so `decorate` reads the editor instead of the store
 * and `update` gets a one-identity test for "did the environment change".
 */
const knownVariables = StateField.define<ReadonlyMap<string, string>>({
  create: activeVariables,
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(setVariables)) return effect.value
    return value
  },
})

// ── The chip ───────────────────────────────────────────────────────────────────

/* Two hoisted marks rather than one class plus the name in a data attribute: two
 * constants mean the decorator allocates nothing per match. The classes carry no `cm-`
 * prefix and their rules live in `styles/codemirror.css`, because an unfocused
 * `TemplateInput` cell paints the same chip with plain spans, outside any editor. */
const KNOWN = Decoration.mark({ class: VAR_CLASS })
const UNKNOWN = Decoration.mark({ class: `${VAR_CLASS} ${VAR_UNKNOWN_CLASS}` })

const matcher = new MatchDecorator({
  regexp: variablePattern(),
  decorate: (add, from, to, match, view) => {
    const known = view.state.field(knownVariables)
    const head = view.state.selection.main.head
    /* Three cases collapse into the neutral chip.
     *
     * `known.size === 0` is "no environment active", which the picker offers on purpose
     * — every token marked missing at once is a red wall that says something false.
     *
     * `inside` is the caret rule, and it exists because of `closeBrackets`: typing `{{`
     * yields `{{}}`, so `{{b}}`, `{{ba}}` and `{{bas}}` are all *complete* matches on
     * the way to `{{baseUrl}}`. Marking them unknown would flash the danger chip on
     * every keystroke of a name that is about to be right. The token you are inside is
     * not yet wrong. */
    const inside = head >= from && head <= to
    add(from, to, known.size === 0 || inside || known.has(match[1]) ? KNOWN : UNKNOWN)
  },
})

const paint = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    private readonly stop: () => void

    constructor(view: EditorView) {
      this.decorations = matcher.createDeco(view)
      /* The plugin *pulls* the environment when it paints; this is what tells it to
       * paint again. Nothing else would: a store change is not a transaction, so
       * without this a token would keep the colour it had until the next keystroke —
       * the bug `useWire` documents from the other side. Subscribing here rather than
       * in React is what keeps the extension array a module constant and costs every
       * consumer zero wiring, and a `ViewPlugin` is exactly the kind of object that
       * should own a subscription: it has a `destroy`. `subscribeEnvironment` holds the
       * equality guard, so `setBody` — which fires on every keystroke — never reaches
       * this and never dispatches into a view that is mid-update. */
      this.stop = subscribeEnvironment(() => view.dispatch({ effects: setVariables.of(activeVariables()) }))
    }

    update(update: ViewUpdate) {
      /* `createDeco` on all four triggers rather than the incremental `updateDeco`.
       * That one requires the set it is handed to be the one *this* decorator produced
       * for the pre-update state, and the caret rule above means a selection-only
       * change reclassifies a range no document change touched — an invariant not worth
       * maintaining for a scan the viewport already bounds. */
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.startState.field(knownVariables) !== update.state.field(knownVariables)
      ) {
        this.decorations = matcher.createDeco(update.view)
      }
    }

    destroy() {
      this.stop()
    }
  },
  { decorations: plugin => plugin.decorations },
)

// ── The completions ────────────────────────────────────────────────────────────

/* No `g` flag on any of these three: they are `exec`ed, and the warning on `VARIABLE`
 * is about exactly that. `matchBefore` anchors with `$` itself, looks back at most 250
 * characters and never past the start of the line, so none of them can span a newline. */
const TRIGGER = /\{\{[ \t]*[A-Za-z0-9_.-]*/
const NAME = /[A-Za-z0-9_.-]*$/
const OPEN_BEFORE = /\{\{[ \t]*$/
const CLOSE_AFTER = /^[ \t]*\}\}/
const PREVIEW = 42

/** A bearer token is one 900-character word and would set the dropdown's width. */
const preview = (value: string): string => {
  const flat = value.replace(/\s+/g, ' ').trim()
  if (!flat) return translate('env.complete.empty')
  return flat.length > PREVIEW ? `${flat.slice(0, PREVIEW - 1)}…` : flat
}

const applyVariable = (name: string) => (view: EditorView, _completion: Completion, from: number, to: number) => {
  const line = view.state.doc.lineAt(from)
  /* The braces around the name are part of what gets replaced, which is what makes
   * this uniform across the four ways a name is typed: `{{|}}` (closeBrackets did
   * it), `{{ba|}}`, `{{ba` left unclosed, and a bare caret on an explicit
   * Ctrl+Space. Always exactly one `{{` and one `}}`, so there is no branch here and
   * no `}}}}`, and the caret lands after the closing braces so the next keystroke
   * continues the string rather than falling back inside the token.
   *
   * `\{\{` and not `\{{1,2}`: a lone `{` is never swallowed, because in a JSON body
   * `{ ` is an object opener and eating it would break the document. `\}\}` for the
   * mirror reason — a single stray `}` is left standing rather than guessed at. */
  const open = OPEN_BEFORE.exec(line.text.slice(0, from - line.from))
  const close = CLOSE_AFTER.exec(line.text.slice(to - line.from))
  const start = open ? from - open[0].length : from
  const end = close ? to + close[0].length : to
  /* `insertCompletionText` rather than a hand-built transaction: it carries the
   * `pickedCompletion` annotation and the `input.complete` user event, and it maps the
   * range across every selection rather than only the main one. */
  view.dispatch(insertCompletionText(view.state, `{{${name}}}`, start, end))
}

/**
 * The variable names in the environment applying to the active request's collection.
 *
 * `useAppStore.getState()` inside a `CompletionSource` — through `activeEnvironment` — is
 * the *correct* shape and not a shortcut: this runs once per query, so there is no
 * snapshot to go stale, which is the rule `resolveFor` states. The decoration needs a
 * subscription because it paints continuously; this one is pull, so it just reads.
 *
 * "Active" is exact rather than approximate here: every `TemplateInput` and the body
 * editor live inside `RequestEditor`, which renders `documents[activeId]` and returns
 * early when there is none, so there is never a mounted template editor whose request is
 * not the active one.
 *
 * Only that one environment. Offering names from the others would contradict the chip
 * beside them — the decoration marks a name this collection's environment does not define
 * as *unknown*, because that is what `resolverFor` will do with it — and a name defined in
 * three environments would appear three times, each showing a value that will not be
 * substituted. Switching is one click away in the picker.
 */
const variableCompletions: CompletionSource = context => {
  const token = context.matchBefore(TRIGGER)
  if (!token && !context.explicit) return null

  const environment = activeEnvironment()
  if (!environment) return null

  /* Keyed by name so a duplicate key offers one row, and through `usable` rather than a
   * re-typed filter so this and `variableMap` cannot disagree about which rows count. A
   * Map keeps the first position with the last value, which is `variableMap`'s
   * last-one-wins at the position the grid shows. */
  const rows = new Map<string, EnvironmentVariable>()
  for (const variable of environment.variables) if (usable(variable)) rows.set(variable.key.trim(), variable)
  if (rows.size === 0) return null

  const name = token ? (NAME.exec(token.text)?.[0] ?? '') : ''
  const from = token ? token.to - name.length : context.pos

  let index = 0
  const options: Completion[] = []
  for (const [key, variable] of rows) {
    options.push({
      label: key,
      /* A secret's value never appears here. The `secret` flag rather than `secretsIn`,
       * which additionally requires a non-empty value — a locked variable with nothing
       * in it yet must not fall through to the value branch and print an empty string
       * as though nothing were being hidden. */
      detail: variable.secret ? translate('env.complete.secret') : preview(variable.value),
      type: 'variable',
      /* The tiebreak, and it restores the grid's order for the query the dropdown
       * actually opens with — right after `{{`, where every option scores equally and
       * the default comparator would sort them alphabetically. The row order is the
       * user's, which is the argument `types.ts` makes for `Environment.variables`
       * being an array. No `boost`: that ranks across *sources* and there is one. */
      sortText: String(index++).padStart(4, '0'),
      apply: applyVariable(key),
    })
  }

  /* Only when there is a token: while the name is being typed the list is reused
   * synchronously instead of re-querying per keystroke, and a `}` or a `"` fails it,
   * which re-queries, which returns null, which closes the dropdown — exactly right. On
   * an explicit invoke `from` is a bare caret and there is nothing to stay valid for. */
  return { from, options, validFor: token ? /^[A-Za-z0-9_.-]*$/ : undefined }
}

/**
 * Registered through `languageData` rather than `autocompletion({ override })`.
 *
 * A `text` body has no language at all, and `EditorState.languageData` is the facet that
 * works without one — while *composing* with a language's own sources instead of
 * replacing them, which `override` would not. `autocompletion()` itself is already
 * installed by `basicSetup` in the body editor and must not be added twice; the
 * single-line editor, which uses no `basicSetup`, adds it itself.
 */
const completions = EditorState.languageData.of(() => [{ autocomplete: variableCompletions }])

/**
 * Where the dropdown is rendered, and why it cannot be rendered in place.
 *
 * `position: 'absolute'` is load-bearing rather than tidy: only in absolute mode does
 * CodeMirror measure `parent.getBoundingClientRect().width / parent.offsetWidth` and
 * divide its coordinates by it. That is exactly the compensation `Select.place` writes
 * by hand, and for the reason it records — `:root` carries a CSS `zoom`, and whether a
 * client rect includes it varies by engine. In the default fixed mode CodeMirror skips
 * the division and the menu drifts by the zoom factor.
 *
 * `document.body` as the parent, and it has to be an element with real size: the scale
 * branch is guarded on the parent having a non-zero rect, so a wrapper of our own whose
 * only child is absolutely positioned would measure 0/0 and silently fall back to no
 * scaling. Body also puts the menu outside two things that would otherwise trap it —
 * `.cm-theme`'s `overflow: auto`, and `.kv-wrap`'s `container-type: inline-size`, which
 * implies `contain: layout` and so makes it the containing block for any `position:
 * fixed` descendant. A CodeMirror tooltip has no top-layer option, so `parent` is the
 * only way out of a grid cell.
 *
 * `tooltipSpace` is overridden because CodeMirror's default reads
 * `documentElement.clientWidth/Height` — *layout* pixels — and compares them against
 * client-pixel rects. At 125% that clamps a dropdown near the right edge too far left.
 * `window.innerWidth/innerHeight` are in the same space as the rects.
 */
const MARGIN = 8
const viewportSpace = () => ({
  top: MARGIN,
  left: MARGIN,
  bottom: window.innerHeight - MARGIN,
  right: window.innerWidth - MARGIN,
})

export const templateVariables: Extension[] = [
  knownVariables,
  paint,
  completions,
  tooltips({ position: 'absolute', parent: document.body, tooltipSpace: viewportSpace }),
]
