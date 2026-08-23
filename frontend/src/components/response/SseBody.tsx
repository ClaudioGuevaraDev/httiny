import { useMemo } from 'react'
import { useT } from '../../language'
import { parseSse } from '../../response/sse'
import { TextBody } from './TextBodyLazy'

/**
 * A `text/event-stream` transcript, split into the events it encodes.
 *
 * Raw, an SSE body is a wall of `data:` prefixes with blank lines between them, and a
 * multi-line event is spread across several of them with the prefix repeated. Rejoining
 * those and pretty-printing the JSON inside is the difference between a readable
 * transcript and a haystack.
 *
 * What this is not is a live stream. HTTiny reads a response to completion, so what is
 * shown is whatever the server emitted before the connection closed — which for an
 * endpoint that never closes means whatever arrived before the timeout. The count in
 * the toolbar says how many that was, and the last event is often a partial one, which
 * is deliberately kept rather than discarded.
 */
export function SseBody({ source }: { source: string }) {
  const { t, plural } = useT()
  const events = useMemo(() => parseSse(source), [source])

  if (events.length === 0) return <TextBody text={source} language="sse" wrap match={null} />

  return (
    <div className="sse-body">
      <div className="media-toolbar">
        <p className="media-facts">{plural('response.sse.events', events.length)}</p>
      </div>
      <ol className="sse-list">
        {events.map(event => (
          <li key={event.index} className="sse-event">
            <div className="sse-meta">
              <span className="sse-index">#{event.index + 1}</span>
              {/* The type is shown for every event including the default, so a stream
                  that mixes named and unnamed ones does not look ragged. */}
              <span className="sse-type">{event.event}</span>
              {event.id && <span className="sse-id">{t('response.sse.id', { id: event.id })}</span>}
              {event.retry && <span className="sse-retry">{t('response.sse.retry', { ms: event.retry })}</span>}
            </div>
            <pre className="sse-data">{event.json ?? event.data}</pre>
          </li>
        ))}
      </ol>
    </div>
  )
}
