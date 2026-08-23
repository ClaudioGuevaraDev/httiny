import { useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { Check, Code2, Copy, Eye, EyeOff, X } from 'lucide-react'
import { httinyTheme } from '../editorTheme'
import { errorCopy } from '../errors'
import { useT } from '../language'
import { SNIPPET_TARGETS, snippetFor, targetFor } from '../snippets'
import { extensionsFor } from '../snippets/highlight'
import { environmentFor, secretsIn } from '../environments'
import { useAppStore } from '../store'
import { useCopy } from '../useCopy'
import { useWire } from '../useWire'
import { Placeholder } from './Placeholder'
import { Select } from './Select'

/**
 * The code view proper, in its own module so `React.lazy` has something to split on.
 *
 * A default export because that is what `lazy` takes; everything else in this directory
 * is a named export, and this is the one place the difference is forced.
 */
export default function CodeBody({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useT()
  const request = useAppStore(s => (s.activeId ? s.documents[s.activeId] : undefined))
  const target = useAppStore(s => s.codeTarget)
  const setCodeTarget = useAppStore(s => s.setCodeTarget)
  // Local, and seeded from the preference rather than read live: this body only mounts
  // while the dialog is open, so every opening starts from what Settings says and the
  // switch reaches no further than the visit. Persisting the switch itself is what the
  // preference exists to replace — a control that rewrites a credential should only stay
  // on because someone said so in Settings, where they can find it again.
  const defaultRedact = useAppStore(s => s.defaultRedactSecrets)
  const [redact, setRedact] = useState(defaultRedact)
  const { status: copyStatus, copy } = useCopy()
  const wire = useWire(request)

  // Regenerating is cheap, but it happens on every keystroke in the URL bar *and* on every
  // unrelated store update the modal subscribes to. Memoising keeps CodeMirror from being
  // handed a new document when nothing about the request changed.
  // The locked values of the environment applying to **this request**, so a secret
  // substituted into a header the `SECRET_HEADERS` list has never heard of is still masked
  // when the switch is on.
  //
  // Keyed by the request and not by "active", even though `CodeBody` only ever shows the
  // active one: `useWire` resolves this snippet through `resolveFor(request.id)`, and the
  // masks have to come from the environment that substituted the values. Keying them
  // differently would make the agreement a coincidence maintained by two unrelated lines,
  // and the failure mode when it broke would be a snippet with redaction on printing a
  // token in full.
  //
  // A subscription rather than a `getState()` read, so editing a variable while this is
  // open moves the masks with the snippet. `useMemo` on the found object's identity is
  // sound: `setEnvironmentVariables` maps the edited environment to a new object, so
  // identity moves exactly when the values do.
  const environment = useAppStore(s => environmentFor(s, request?.id))
  const secrets = useMemo(() => secretsIn(environment), [environment])

  const code = useMemo(() => (wire.state === 'ready' ? snippetFor(target, wire.wire, redact, secrets) : ''), [wire, target, redact, secrets])
  const mode = targetFor(target).mode

  return (
    <div className="code-shell">
      <div className="code-toolbar">
        <h2 id="code-title" className="code-title">
          <Code2 size={14} aria-hidden="true" />
          {t('code.title')}
        </h2>
        <Select
          variant="inline"
          ariaLabel={t('code.target')}
          title={t('code.target')}
          value={target}
          options={SNIPPET_TARGETS.map(entry => ({ value: entry.id, label: entry.label }))}
          onChange={setCodeTarget}
        />
        {/* A `<button role="switch">` with an `.on` class, the construction the settings
            rows use — but labelled by *state* rather than by action, and carrying an icon
            that changes with it.

            It used to read "Hide secrets" in both positions, which left the accent colour
            as the only difference between showing a live token and showing a placeholder.
            The footer's rule applies here more than anywhere: colour reinforces, it never
            carries the meaning alone. The eye is the absolute indicator; `aria-checked`
            says the same thing to a screen reader. */}
        <button
          type="button"
          className={`code-redact ${redact ? 'on' : ''}`}
          role="switch"
          aria-checked={redact}
          title={t('code.redact.desc')}
          onClick={() => setRedact(!redact)}
        >
          {redact ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
          {t(redact ? 'code.redact.on' : 'code.redact.off')}
        </button>
        <button
          type="button"
          className="icon-btn xs"
          disabled={!code}
          aria-label={copyStatus === 'copied' ? t('code.copied.aria') : t('code.copy.aria')}
          title={t('code.copy.title')}
          onClick={() => copy(code)}
        >
          {copyStatus === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        </button>
        <button type="button" className="icon-btn code-close" aria-label={t('code.close')} onClick={onDismiss}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      {/* The clipboard write is acknowledged out loud for the reason `ResponseViewer`
          spells out: a denied permission is otherwise indistinguishable from success. */}
      <p className="sr-only" role="status" aria-live="polite">
        {copyStatus === 'copied' ? t('code.copied.live') : copyStatus === 'failed' ? t('code.copyFailed.live') : ''}
      </p>

      <div className="code-body">
        {wire.state === 'ready' ? (
          <CodeMirror
            value={code}
            theme={httinyTheme}
            extensions={extensionsFor(mode)}
            editable={false}
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, searchKeymap: false }}
          />
        ) : (
          <WireProblem
            state={wire.state}
            code={wire.state === 'failed' ? wire.code : 'BACKEND_UNAVAILABLE'}
            detail={wire.state === 'failed' ? wire.detail : ''}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Why there is no snippet. Both cases resolve their copy from a code through
 * `errorCopy`, so an invalid URL reads the same here as it does in the response pane —
 * and retranslates with the language, rather than being frozen at render time.
 */
function WireProblem({ state, code, detail }: { state: 'loading' | 'failed' | 'unavailable'; code: string; detail: string }) {
  const { t } = useT()
  if (state === 'loading') return null
  const copy = errorCopy(t, code, detail)
  return <Placeholder icon={<Code2 size={20} />} title={copy.title} description={copy.detail} />
}
