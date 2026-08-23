import { lazy, Suspense } from 'react'
import { FileX2 } from 'lucide-react'
import { formatBytes } from '../../format'
import { useLocale, useT } from '../../language'
import type { Match } from '../../response/search'
import type { BodyLanguage, BodyMode, SuccessResponse } from '../../types'
import { Placeholder } from '../Placeholder'
import { HtmlPreview } from './HtmlPreview'
import { ImageBody } from './ImageBody'
import { JsonTree } from './JsonTree'
import { MediaBody } from './MediaBody'
import { SvgBody } from './SvgBody'
import { TextBody } from './TextBody'

/**
 * The viewers for formats an ordinary session never meets, split out of the startup chunk.
 *
 * The line is drawn at "would the first response you send need this?". JSON, text, images
 * and the HTML/SVG previews stay eager, because delaying the common path by a frame to
 * save parse time nobody notices is the wrong trade. A CSV table, a Markdown preview, an
 * event-stream reader, a hex dump, a PDF, a font specimen and an archive listing are each
 * one endpoint in a hundred, and each drags its own hand-rolled parser in behind it.
 *
 * `.then(m => ({ default: … }))` because everything in this directory is a named export
 * and `lazy` takes a default; adding a default export to seven files to satisfy the API
 * would be the tail wagging the dog.
 *
 * `fallback={null}` throughout: the chunk comes off the embedded filesystem, so the wait
 * is a frame, and a spinner that flashes for one frame reads worse than nothing.
 */
const ArchiveBody = lazy(() => import('./ArchiveBody').then(m => ({ default: m.ArchiveBody })))
const CsvTable = lazy(() => import('./CsvTable').then(m => ({ default: m.CsvTable })))
const FontBody = lazy(() => import('./FontBody').then(m => ({ default: m.FontBody })))
const HexBody = lazy(() => import('./HexBody').then(m => ({ default: m.HexBody })))
const MarkdownPreview = lazy(() => import('./MarkdownPreview').then(m => ({ default: m.MarkdownPreview })))
const PdfBody = lazy(() => import('./PdfBody').then(m => ({ default: m.PdfBody })))
const SseBody = lazy(() => import('./SseBody').then(m => ({ default: m.SseBody })))

/** Mirrors maxTextBytes in internal/httpexec — only ever used to word the notice. */
const BODY_LIMIT = 5 * 1024 * 1024

/**
 * Picks the viewer for a response and hands it what it needs.
 *
 * Two axes, resolved in order. The *format* decides the family — a picture, a media
 * element, a document, an editor — and within the textual family the *mode* decides how
 * far from the raw bytes to go. Only that second decision is the user's; the first is
 * what the response actually is.
 */
export function BodyPanel({
  response,
  language,
  mode,
  text,
  formatFailed,
  hex,
  wrap,
  match,
}: {
  response: SuccessResponse
  language: BodyLanguage
  mode: BodyMode
  text: string
  formatFailed: boolean
  hex: boolean
  wrap: boolean
  /** The search match to reveal in the editor, or null. Only the text view can show one. */
  match: Match | null
}) {
  const { t } = useT()

  // A byte-backed response has no `body`; a textual one has no `bodyUrl`. Neither
  // means the server answered with nothing, which is its own state and not a failure.
  if (!response.body && !response.bodyUrl) {
    return (
      <Placeholder
        icon={<FileX2 size={20} />}
        title={response.status === 204 ? t('response.noContent.title') : t('response.emptyBody.title')}
        description={response.status === 204 ? t('response.noContent.desc') : t('response.emptyBody.desc')}
      />
    )
  }

  return (
    <>
      <Notices response={response} formatFailed={formatFailed} />
      {/* One boundary for both switches below, since only the rare branches suspend. */}
      <Suspense fallback={null}>
        {hex ? <HexBody response={response} /> : <Viewer response={response} language={language} mode={mode} text={text} wrap={wrap} match={match} />}
      </Suspense>
    </>
  )
}

function Viewer({
  response,
  language,
  mode,
  text,
  wrap,
  match,
}: {
  response: SuccessResponse
  language: BodyLanguage
  mode: BodyMode
  text: string
  wrap: boolean
  match: Match | null
}) {
  const { format, bodyUrl, contentType } = response

  switch (format) {
    case 'image':
      return <ImageBody url={bodyUrl} contentType={contentType} />
    case 'audio':
      return <MediaBody kind="audio" url={bodyUrl} contentType={contentType} />
    case 'video':
      return <MediaBody kind="video" url={bodyUrl} contentType={contentType} />
    case 'pdf':
      return <PdfBody url={bodyUrl} sizeBytes={response.sizeBytes} />
    case 'font':
      return <FontBody url={bodyUrl} contentType={contentType} />
    case 'archive':
      return <ArchiveBody response={response} />
    // Nothing else claims these bytes, so show them. This is the coverage's floor and
    // the reason an unrecognised media type is no longer a dead end.
    case 'binary':
      return <HexBody response={response} />
    case 'json':
    case 'ndjson':
    case 'xml':
    case 'html':
    case 'svg':
    case 'csv':
    case 'markdown':
    case 'yaml':
    case 'javascript':
    case 'css':
    case 'sse':
    case 'text':
      // Resolved on the *language* rather than the format, so a body the user has
      // reinterpreted — a JSON payload served as text/html, which is most of why the
      // picker exists — gets the viewer they asked for and not the one the header
      // claimed. `resolveMode` has already ruled out `rich` for anything without one.
      return mode === 'rich' ? <RichBody language={language} source={response.body} text={text} /> : <TextBody text={text} language={language} wrap={wrap} match={match} />
    default: {
      // Not reachable: the switch above covers ResponseFormat. This exists so that
      // adding a member without a branch fails to compile.
      const exhaustive: never = format
      return exhaustive
    }
  }
}

/**
 * The format's own viewer, for the languages that have one.
 *
 * `source` is the body as it arrived and `text` is the formatted version. The tree
 * parses, so it wants the raw string; the previews render markup, so they want it too.
 * Only the editor wants the formatted one.
 */
function RichBody({ language, source, text }: { language: BodyLanguage; source: string; text: string }) {
  switch (language) {
    case 'json':
      return <JsonTree source={source} />
    case 'ndjson':
      // Each line is its own document, so there is no single tree to build. The
      // formatter has already indented every record; showing that is the rich view.
      return <TextBody text={text} language="ndjson" wrap={false} match={null} />
    case 'html':
      return <HtmlPreview source={source} />
    case 'markdown':
      return <MarkdownPreview source={source} />
    case 'svg':
      return <SvgBody source={source} />
    case 'csv':
      return <CsvTable source={source} />
    case 'sse':
      return <SseBody source={source} />
    default:
      // `resolveMode` never returns `rich` for a language absent from RICH_LABEL, so
      // this is unreachable — but it is a runtime fallback rather than a `never`,
      // because the two tables live in different files and a mismatch should degrade
      // to the editor rather than blank the panel.
      return <TextBody text={text} language={language} wrap match={null} />
  }
}

/**
 * Everything the viewer needs to say about how the body got here, above the body.
 *
 * Each of these was previously either silent or a lie. A transcoded charset used to be
 * reported as a binary payload; an unsupported compression as the same; and truncation
 * still needs saying because `sizeBytes` and what is on screen deliberately disagree.
 */
function Notices({ response, formatFailed }: { response: SuccessResponse; formatFailed: boolean }) {
  const { t } = useT()
  const locale = useLocale()
  const compressed = response.contentEncoding !== ''
  const readable = response.body !== ''

  return (
    <>
      {response.truncated && (
        <p className="response-notice">{t('response.truncated', { limit: formatBytes(BODY_LIMIT, locale), size: formatBytes(response.sizeBytes, locale) })}</p>
      )}
      {/* Silent when the body was truncated: a cut-off body cannot parse by
          construction, and the notice above already says why. */}
      {formatFailed && !response.truncated && <p className="response-notice">{t('response.invalidJson')}</p>}
      {compressed && readable && <p className="response-notice">{t('response.encoding.decompressed', { encoding: response.contentEncoding })}</p>}
      {compressed && !readable && <p className="response-notice">{t('response.encoding.unsupported', { encoding: response.contentEncoding })}</p>}
      {response.encoding !== '' && <p className="response-notice">{t('response.encoding.transcoded', { charset: response.encoding })}</p>}
    </>
  )
}
