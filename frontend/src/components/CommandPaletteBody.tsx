import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Boxes, CornerDownLeft, Search, Zap } from 'lucide-react'
import { filterCommands, groupResults, type Command, type CommandGroup } from '../commands'
import { useLocale, useT } from '../language'
import { useCommands } from '../useCommands'
import { useAppStore } from '../store'
import { MethodChip } from './MethodChip'
import { Shortcut } from './Placeholder'

const LIST_ID = 'command-palette-list'
const optionId = (index: number) => `command-option-${index}`


export default function CommandPaletteBody({ onDismiss }: { onDismiss: () => void }) {
  const { t, plural } = useT()
  const locale = useLocale()
  const seed = useAppStore(s => s.paletteSeed)
  // Query and highlight live in one state object so that typing resets the
  // highlight in the same update. Keeping them separate meant an effect that reset
  // the index whenever the query changed, which is a cascading render.
  const [{ query, active }, setSearch] = useState({ query: seed, active: 0 })
  const setQuery = (next: string) => setSearch({ query: next, active: 0 })
  const setActive = (next: number | ((current: number) => number)) =>
    setSearch(current => ({ query: current.query, active: typeof next === 'function' ? next(current.active) : next }))
  const listRef = useRef<HTMLDivElement>(null)
  const commands = useCommands(true)
  const results = useMemo(() => filterCommands(commands, query, locale), [commands, query, locale])
  const groups = useMemo(() => groupResults(results, t), [results, t])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (command: Command | undefined) => {
    if (!command) return
    onDismiss()
    command.run()
  }

  const move = (delta: number) =>
    setActive(index => {
      if (results.length === 0) return 0
      return (index + delta + results.length) % results.length
    })

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      case 'PageDown':
        event.preventDefault()
        setActive(index => Math.min(results.length - 1, index + 8))
        break
      case 'PageUp':
        event.preventDefault()
        setActive(index => Math.max(0, index - 8))
        break
      case 'Home':
        event.preventDefault()
        setActive(0)
        break
      case 'End':
        event.preventDefault()
        setActive(Math.max(0, results.length - 1))
        break
      case 'Enter':
        event.preventDefault()
        run(results[active])
        break
      case 'Tab':
        // The dialog is a single-purpose surface; Tab would only move focus off the
        // input and break type-ahead.
        event.preventDefault()
        break
      default:
        break
    }
  }

  return (
    <div className="palette-shell" onKeyDown={onKeyDown}>
      <div className="palette-field">
        <Search size={15} aria-hidden="true" />
        {/*
          DOM focus stays on the input for the whole interaction, because the user
          types continuously while the highlight moves. That is why this uses
          aria-activedescendant rather than roving tabindex — moving real focus onto
          the options would take the caret out of the field.
        */}
        <input
          autoFocus
          type="text"
          role="combobox"
          className="palette-input"
          aria-expanded="true"
          aria-controls={LIST_ID}
          aria-autocomplete="list"
          aria-activedescendant={results.length ? optionId(active) : undefined}
          aria-label={t('palette.input.aria')}
          placeholder={t('palette.input.placeholder')}
          value={query}
          spellCheck={false}
          onChange={event => setQuery(event.target.value)}
        />
        <Shortcut keys={['Esc']} />
      </div>

      <div className="palette-results" ref={listRef} role="listbox" id={LIST_ID} aria-label={t('palette.results')}>
        {groups.map(group => (
          <div key={group.id} role="group" aria-label={group.label} className="palette-group">
            <p className="palette-group-label" aria-hidden="true">
              {group.label}
            </p>
            {group.items.map(({ item, index }) => (
              <div
                key={item.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                data-active={index === active}
                className="palette-option"
                onPointerMove={() => setActive(index)}
                onClick={() => run(item)}
              >
                {item.method ? <MethodChip method={item.method} variant="compact" decorative /> : <CommandGlyph group={item.group} />}
                <span className="palette-title">{highlight(item.title, item.ranges)}</span>
                {item.subtitle && <span className="palette-subtitle">{item.subtitle}</span>}
                {item.shortcut && <Shortcut keys={item.shortcut} />}
              </div>
            ))}
          </div>
        ))}
        {results.length === 0 && <p className="palette-void">{t('palette.empty', { query })}</p>}
      </div>

      <footer className="palette-footer" aria-hidden="true">
        <span>
          <Shortcut keys={['↑', '↓']} /> {t('palette.footer.navigate')}
        </span>
        <span>
          <Shortcut keys={['↵']} /> {t('palette.footer.run')}
        </span>
        <span>
          <Shortcut keys={['>']} /> {t('palette.footer.commands')}
        </span>
      </footer>
      <p className="sr-only" role="status" aria-live="polite">
        {plural('palette.count', results.length)}
      </p>
    </div>
  )
}

function CommandGlyph({ group }: { group: CommandGroup }) {
  if (group === 'action') return <Zap size={13} aria-hidden="true" />
  if (group === 'request') return <Boxes size={13} aria-hidden="true" />
  return <CornerDownLeft size={13} aria-hidden="true" />
}

function highlight(text: string, ranges: readonly [number, number][]) {
  if (!ranges.length) return text
  const parts: (string | React.JSX.Element)[] = []
  let cursor = 0
  ranges.forEach(([start, end], index) => {
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(<mark key={index}>{text.slice(start, end)}</mark>)
    cursor = end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}
