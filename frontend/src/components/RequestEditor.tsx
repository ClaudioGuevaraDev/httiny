import { lazy, Suspense, useMemo } from 'react'
import { Code2, Send, Square, Upload } from 'lucide-react'
import type { MessageKey } from '../i18n'
import { useT } from '../language'
import { toggleRequest } from '../requestRunner'
import { shortcutHint, shortcuts } from '../shortcuts'
import { DEFAULT_REQUEST_PANEL, freshRow, methodOptions, splitUrl, useAppStore } from '../store'
import { replaceQuery } from '../template'
import { startImport } from '../transfer'
import type { KeyValueRow, RequestDocument } from '../types'
import { requestTabId, requestUrlFieldId } from '../domIds'
import { useRovingFocus } from '../useRovingFocus'
import { KeyValueGrid } from './KeyValueGrid'
import { MethodChip } from './MethodChip'
import { Placeholder, PlaceholderAction } from './Placeholder'
import { Select } from './Select'
import { TemplateInput } from './TemplateInput'
/**
 * The body editor is a full CodeMirror, and the default panel is Params (`store.ts`), so
 * it is never mounted at launch — but a static import put the whole editor stack in the
 * startup chunk anyway. `fallback={null}`: the chunk comes off the embedded filesystem.
 */
const BodyEditor = lazy(() => import('./request/BodyEditor').then(module => ({ default: module.BodyEditor })))

type AuthType = RequestDocument['auth']['type']

/**
 * Walked out of a table rather than written as three `<option>`s, the same way `THEMES`
 * and `LANGUAGES` feed the pickers in Settings: the order and the labels live in one
 * place, and `Select` is generic over the union so `onChange` hands back an `AuthType`
 * with nothing asserted.
 */
const AUTH_TYPES = ['none', 'bearer', 'basic'] as const satisfies readonly AuthType[]

const AUTH_TYPE_LABEL = {
  none: 'editor.auth.none',
  bearer: 'editor.auth.bearer',
  basic: 'editor.auth.basic',
} as const satisfies Record<AuthType, MessageKey>

type Panel = 'params' | 'headers' | 'body' | 'auth'

/**
 * The visible labels used to be derived as `panel[0].toUpperCase() + panel.slice(1)`,
 * which tied them to the persisted union. A real map lets the token and the label
 * diverge, which they must: `auth` stays `Auth` in Spanish because the strip is four
 * tabs wide and that is the word the ecosystem uses.
 */
const PANEL_LABEL = {
  params: 'editor.panel.params',
  headers: 'editor.panel.headers',
  body: 'editor.panel.body',
  auth: 'editor.panel.auth',
} as const satisfies Record<Panel, MessageKey>

/** Two roots, not one: the count renders under Params (m.) and Headers (f.), and Spanish agrees. */
const PANEL_COUNT = { params: 'editor.panel.paramsEnabled', headers: 'editor.panel.headersEnabled' } as const

/** The strip's order. Out here so the array is not re-allocated on every keystroke. */
const PANELS = ['params', 'headers', 'body', 'auth'] as const satisfies readonly Panel[]

/**
 * The method picker's options, built once.
 *
 * Nothing here depends on props, state or the locale — HTTP methods are on the list of
 * things this app does not translate — but it used to be rebuilt inside the render body,
 * so every keystroke in the URL bar minted seven objects and seven `MethodChip` elements.
 * `Select` renders its whole option list into an always-mounted popover whether or not it
 * is open, so those were reconciled every time too.
 */
const METHOD_OPTIONS = methodOptions.map(method => ({
  value: method,
  label: method,
  glyph: <MethodChip method={method} variant="ghost" decorative />,
}))

/**
 * Params and Headers, over the shared grid.
 *
 * The one thing these two do that the URL-encoded body does not is keep the URL in step:
 * editing a param row rewrites the query string through `replaceQuery`. That is why the
 * grid takes a commit callback rather than a field name — the callback is where the
 * difference lives.
 */
function RequestRows({ request, field }: { request: RequestDocument; field: 'params' | 'headers' }) {
  const updateDocument = useAppStore(s => s.updateDocument)
  return (
    <KeyValueGrid
      rows={request[field]}
      name={field}
      addLabel={field === 'params' ? 'editor.kv.addParam' : 'editor.kv.addHeader'}
      // One patch and therefore one `set()`, where this was two. Both halves already read
      // the pre-update document out of the render closure, so folding them changes
      // nothing about what is written — but every `set()` is a full pass over every store
      // listener *and* a full run of the autosave subscriber, and this fires per keystroke.
      onChange={next =>
        updateDocument(request.id, field === 'params' ? { params: next, url: replaceQuery(request.url, next) } : { headers: next })
      }
    />
  )
}

function AuthEditor({ request }: { request: RequestDocument }) {
  const { t } = useT()
  const updateDocument = useAppStore(s => s.updateDocument)
  const setAuth = (patch: Partial<RequestDocument['auth']>) => updateDocument(request.id, { auth: { ...request.auth, ...patch } })
  return (
    <div className="auth-editor">
      {/* A <span>, not a <label>: the picker's trigger is a <button role="combobox">, and
          only labelable elements answer to `htmlFor`. `labelledBy` carries the accessible
          name across intact; what it does not carry is click-the-text-to-focus. */}
      <div className="auth-row">
        <span id="auth-type-label">{t('editor.auth.type')}</span>
        <Select
          labelledBy="auth-type-label"
          value={request.auth.type}
          options={AUTH_TYPES.map(type => ({ value: type, label: t(AUTH_TYPE_LABEL[type]) }))}
          onChange={type => setAuth({ type })}
        />
      </div>
      {request.auth.type === 'none' && <p>{t('editor.auth.noneNote')}</p>}
      {/*
        These are credentials for the *target API*, not for HTTiny, so every one of them
        opts out of autofill: a password manager offering to save them would file another
        site's secret under this app. `spellCheck` is off for the same reason it is off on
        header names — none of this is prose.

        All three are `<input>`s and not `TemplateInput`s, and a `{{variable}}` in any of
        them still resolves — `toRequestDTO` runs the environment's resolver over the whole
        `auth` object, and it *has* to, because `applyAuth` base64s the basic pair and a
        placeholder that reached Go would come back as unrecoverable base64. What they do
        not get is the chip and the completion menu, which is a deliberate line rather than
        an oversight: this is a form, not a grid. A contenteditable cannot mask a password,
        so that field would stay an `<input>` whatever happened to the other two; each of
        these sits inside a `<label>`, which associates with a labelable control and not
        with a wrapper div; and matching `.auth-editor input`'s box would need a third
        `TemplateInput` geometry beside `cell` and `url`. Three constructions in one small
        panel is worse than none.
      */}
      {request.auth.type === 'bearer' && (
        <label>
          {t('editor.auth.token')}
          <input
            className="technical-input"
            name="api-token"
            value={request.auth.token}
            onChange={e => setAuth({ token: e.target.value })}
            placeholder="eyJhbGciOiJIUzI1NiJ9…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      )}
      {request.auth.type === 'basic' && (
        <div className="auth-grid">
          <label>
            {t('editor.auth.username')}
            <input
              className="technical-input"
              name="api-username"
              value={request.auth.username}
              onChange={e => setAuth({ username: e.target.value })}
              placeholder="api-user…"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            {t('editor.auth.password')}
            <input
              className="technical-input"
              type="password"
              name="api-password"
              value={request.auth.password}
              onChange={e => setAuth({ password: e.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>
      )}
    </div>
  )
}

/**
 * Re-derives the param rows from the URL's query string, on every keystroke.
 *
 * There is one row per query entry, in the URL's own order. Emptying the query used
 * to keep the rows and blank their contents instead, which left four empty rows
 * behind after deleting four parameters.
 *
 * Parsed with `URLSearchParams` over `splitUrl`, not with `new URL`: the latter
 * throws on anything without a scheme, so `api.example.com/users?a=1` — or a URL
 * halfway through being typed — never synced at all.
 *
 * Disabled rows are kept and appended. `replaceQuery` leaves them out of the URL by
 * design, so deriving purely from the URL would delete a row the moment it was
 * unticked. They land after the derived rows rather than back in place: their old
 * position and the URL's order can contradict each other.
 *
 * Keyless rows are not kept — one parameter is one row, and a blank row alongside
 * four real ones is the same complaint as four blank ones. The grid keeps a blank row
 * only when the query is empty, so there is always somewhere to start typing.
 *
 * Derived rows are matched to previous ones **by key**, so a row keeps its id and
 * description when the query is edited around it. Matching by position — which is
 * what this used to do — meant deleting `a=1` from `?a=1&b=2` left `b` wearing `a`'s
 * description. Each previous row is claimed at most once, because a repeated key
 * (`?a=1&a=2` is legal) would otherwise hand the same id to two rows and collide as a
 * React key. Unmatched entries fall back to the first row left over, which is what
 * keeps a row still when its key is being typed one character at a time.
 */
const parseParams = (url: string, existing: KeyValueRow[]): KeyValueRow[] => {
  const entries = [...new URLSearchParams(splitUrl(url).query).entries()]
  const keyed = existing.filter(row => row.key.trim())
  const pool = keyed.filter(row => row.enabled)
  const kept = keyed.filter(row => !row.enabled)

  const claim = (key: string): KeyValueRow | undefined => {
    const byKey = pool.findIndex(row => row.key === key)
    return pool.splice(byKey >= 0 ? byKey : 0, 1)[0]
  }

  const derived = entries.map(([key, value]) => {
    const prior = claim(key)
    return { id: prior?.id ?? crypto.randomUUID(), enabled: true, key, value, description: prior?.description ?? '' }
  })

  // Never a bare header. The previous blank row is reused rather than replaced, so its
  // id — and anything already typed into it — survives every keystroke that leaves the
  // query empty, instead of remounting the row's cells each time.
  //
  // That was a nicety while the cells were `<input>`s. Two of the three are
  // `TemplateInput`s now, so an unstable React key would destroy and rebuild an
  // `EditorView` on every keystroke.
  const next = [...derived, ...kept]
  return next.length ? next : [existing.find(row => !row.key.trim()) ?? freshRow()]
}

export function RequestEditor() {
  const { t, plural } = useT()
  const activeId = useAppStore(s => s.activeId)
  const request = useAppStore(s => (s.activeId ? s.documents[s.activeId] : undefined))
  // Per request, so opening a tab you have never touched lands on Params rather than on
  // whatever the tab before it was showing. A string, not a derived object, so the
  // selector still compares equal between renders.
  const requestPanel = useAppStore(s => (s.activeId ? s.requestPanels[s.activeId] : undefined) ?? DEFAULT_REQUEST_PANEL)
  const setRequestPanel = useAppStore(s => s.setRequestPanel)
  const updateDocument = useAppStore(s => s.updateDocument)
  const addNode = useAppStore(s => s.addNode)
  const openCode = useAppStore(s => s.openCode)
  const sending = useAppStore(s => (s.activeId ? s.responses[s.activeId]?.state === 'loading' : false))
  const onPanelKeyDown = useRovingFocus('[role="tab"]')

  // The two badge counts, memoised: the panel strip re-renders on every keystroke and
  // these were two full passes over the row arrays, allocating two arrays each time. Keyed
  // on the row arrays rather than on the document, so typing in the URL or the body does
  // not recount. Above the early return below, as hooks must be.
  const paramCount = useMemo(() => (request?.params ?? []).filter(row => row.enabled && row.key).length, [request?.params])
  const headerCount = useMemo(() => (request?.headers ?? []).filter(row => row.enabled && row.key).length, [request?.headers])

  if (!request || !activeId)
    return (
      <div className="request-editor">
        <Placeholder
          icon={
            <div className="brand-mark large">
              H<span>T</span>
            </div>
          }
          title={t('editor.empty.title')}
          description={t('editor.empty.desc')}
        >
          <PlaceholderAction shortcut={shortcuts.newRequest} onClick={() => addNode('request')}>
            {t('editor.empty.newRequest')}
          </PlaceholderAction>
          {/* Not "Search requests" any more. This placeholder shows when nothing is open,
              which for a fresh install means there is nothing to search — and the palette
              is already a keystroke away and named in the tab strip. Bringing a workspace
              in is the thing you cannot do from anywhere else on this screen. */}
          <PlaceholderAction variant="secondary" onClick={() => void startImport(t('transfer.import.dialog'))}>
            <Upload size={13} aria-hidden="true" /> {t('editor.empty.import')}
          </PlaceholderAction>
        </Placeholder>
      </div>
    )

  return (
    /* The editor is the panel the tab strip in `workspace-top` controls: switching tabs
       swaps which request is shown here, which is exactly the tab/tabpanel relationship. */
    <section className="request-editor" id="request-editor-panel" role="tabpanel" aria-labelledby={requestTabId(activeId)}>
      <div className="request-bar">
        {/*
          One `ghost` chip for both surfaces. A filled pill can either match its neighbours'
          width or fit its word, never both, and equal width left GET as three letters adrift
          in a colour band — so the menu never had a fill. The bar has now dropped its own:
          the method is the word in its colour, and the control's border is what says there
          is a control there. `.select-trigger[data-variant='method']` sizes the bar's copy
          up to 13px, which is the only thing separating the two.

          Hence no `valueGlyph` — it existed to make the bar differ from the menu, and it
          no longer does. `Select` falls back to `glyph` for the value.

          `decorative` because the option row already names the method; without it the method
          would be announced twice.
        */}
        <Select
          variant="method"
          ariaLabel={t('editor.method')}
          value={request.method}
          options={METHOD_OPTIONS}
          onChange={method => updateDocument(activeId, { method })}
        />
        {/* A stable id, so the INVALID_URL placeholder can focus this field without
            reaching for a class selector the way Ctrl+Enter used to. It is `domIds`'
            constant rather than a literal here and a literal there, the rule
            `requestBodyEditorId` already sets for the other cross-component focus — and it
            matters more now that the field is a CodeMirror and the id lands on a wrapper
            that forwards `.focus()` to the contenteditable inside.

            `inputMode` but deliberately not `type="url"`: the URL is validated once, in
            Go, and native URL validation would be a second, disagreeing validator besides
            — one that rejects the `localhost:8069` a person actually types, and one that
            would reject the `{{baseUrl}}/users` this field now accepts. It rides on
            `EditorView.contentAttributes`, since a contenteditable has no `type`. `name` is
            gone with the `<input>`: there is no `<form>` in this app and the attribute was
            inert. */}
        <TemplateInput
          id={requestUrlFieldId}
          variant="url"
          ariaLabel={t('editor.url')}
          value={request.url}
          // Re-derives the rows as you type rather than on blur, which is what
          // made a pasted query string only show up in the Params tab once
          // something else stole the focus. There is no feedback loop: the other
          // direction (editing a row rewrites the URL through `replaceQuery`)
          // updates the store programmatically, and `TemplateInput` annotates that
          // dispatch so it never comes back through here.
          //
          // Both fields in one patch, so a character typed here is one `set()` rather than
          // two. It used to be an `updateDocument` followed by a `setRows`, which meant
          // every listener in the app ran twice and the autosave subscriber serialised the
          // whole workspace twice, for one keystroke.
          onChange={url => updateDocument(activeId, { url, params: parseParams(url, request.params) })}
          // Enter sends, the way it does in a browser's address bar and in every other
          // client. Ctrl+Enter is the global one and works from anywhere; this is the one
          // that is in the finger memory of whoever just finished typing a URL. An open
          // completion is accepted first — `singleLine.ts` owns that ordering.
          onSubmit={() => void toggleRequest(activeId)}
          placeholder="https://api.example.com/users…"
        />
        {/* Send sits against the field it acts on — it is that field's Enter key — and the
            code view follows as the secondary control. DOM order is tab order, so this is
            also the order the keyboard walks them in.

            There used to be a Save button in this row, on the grounds that "did that save?"
            is a real question and a button that answers it is worth one icon. It did not
            answer it — the sidebar footer does, with Saving / Saved / Failed — and the only
            thing it did that autosave does not is write inside the 600 ms debounce instead
            of at the end of it. `Ctrl+S` and the command palette still do that, invisibly,
            for the reflex to press it. */}
        <button
          type="button"
          className={`send-btn ${sending ? 'cancel' : ''}`}
          title={sending ? t('editor.cancel.title', { keys: shortcutHint('cancel') }) : t('editor.send.title', { keys: shortcutHint('send') })}
          onClick={() => toggleRequest(activeId)}
        >
          {sending ? <Square size={13} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />} {sending ? t('editor.cancel') : t('editor.send')}
        </button>
        <button
          type="button"
          className="icon-btn bar-btn"
          aria-label={t('editor.code.title', { keys: shortcutHint('code') })}
          title={t('editor.code.title', { keys: shortcutHint('code') })}
          onClick={openCode}
        >
          <Code2 size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="panel-tabs" role="tablist" aria-label={t('editor.sections')} onKeyDown={onPanelKeyDown}>
        {PANELS.map(panel => {
          const count = panel === 'params' ? paramCount : panel === 'headers' ? headerCount : null
          return (
            <button
              type="button"
              key={panel}
              role="tab"
              id={`request-panel-tab-${panel}`}
              aria-selected={requestPanel === panel}
              aria-controls="request-panel"
              tabIndex={requestPanel === panel ? 0 : -1}
              className={requestPanel === panel ? 'active' : ''}
              onClick={() => setRequestPanel(activeId, panel)}
            >
              {t(PANEL_LABEL[panel])}
              {count !== null && (
                <>
                  <span aria-hidden="true">{count}</span>
                  <span className="sr-only">{plural(PANEL_COUNT[panel === 'params' ? 'params' : 'headers'], count)}</span>
                </>
              )}
            </button>
          )
        })}
      </div>
      <div className="request-panel" id="request-panel" role="tabpanel" aria-labelledby={`request-panel-tab-${requestPanel}`} tabIndex={-1}>
        {requestPanel === 'params' && <RequestRows request={request} field="params" />}
        {requestPanel === 'headers' && <RequestRows request={request} field="headers" />}
        {requestPanel === 'body' && (
          <Suspense fallback={null}>
            <BodyEditor request={request} />
          </Suspense>
        )}
        {requestPanel === 'auth' && <AuthEditor request={request} />}
      </div>
    </section>
  )
}
