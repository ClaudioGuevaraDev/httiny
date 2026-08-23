import { useMemo } from 'react'
import { useT } from '../../language'
import { detectDelimiter, parseCsv } from '../../response/csv'
import { TextBody } from './TextBodyLazy'

/** Beyond this the table is truncated: a browser will lay out 200k rows, slowly. */
const MAX_ROWS = 5000

const DELIMITER_LABEL: Record<string, string> = { '\t': 'TAB', ';': ';', ',': ',', '|': '|' }

/**
 * A CSV or TSV response as the table it is.
 *
 * Reading a comma-separated export as text means counting commas to find the fourth
 * column, and quoted fields containing commas make that count wrong. A table does not
 * have that problem, and lining the values up is the entire reason the format exists.
 *
 * The delimiter is detected rather than assumed — `text/csv` is served with semicolons
 * across most of Europe — and it is named in the toolbar, because a wrong guess should
 * be visible rather than mysterious.
 */
export function CsvTable({ source }: { source: string }) {
  const { t, plural } = useT()
  const { table, delimiter } = useMemo(() => {
    const found = detectDelimiter(source)
    return { table: parseCsv(source, found), delimiter: found }
  }, [source])

  // One column and one row is not a table, it is a line of text that happens to have
  // arrived under text/csv. Showing it as a grid would be a worse reading of it.
  if (table.header.length <= 1 && table.rows.length === 0) return <TextBody text={source} language="csv" wrap match={null} />

  const rows = table.rows.slice(0, MAX_ROWS)

  return (
    <div className="csv-table">
      <div className="media-toolbar">
        <p className="media-facts">
          <span>{plural('response.csv.rows', table.rows.length)}</span>
          <span>{plural('response.csv.columns', table.header.length)}</span>
          <span>{t('response.csv.delimiter', { delimiter: DELIMITER_LABEL[delimiter] ?? delimiter })}</span>
        </p>
      </div>
      {table.ragged && <p className="response-notice">{t('response.csv.ragged')}</p>}
      {rows.length < table.rows.length && <p className="response-notice">{t('response.csv.truncated', { shown: rows.length, total: table.rows.length })}</p>}
      <div className="csv-scroller">
        <table className="csv-grid">
          <caption className="sr-only">{t('response.csv.caption')}</caption>
          <thead>
            <tr>
              {/* The row number is a header cell for its column and nothing else; the
                  per-row numbers below are row headers, so a screen reader can say
                  which line a cell came from. */}
              <th scope="col" className="csv-gutter">
                {t('response.csv.line')}
              </th>
              {table.header.map((cell, index) => (
                <th key={index} scope="col">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th scope="row" className="csv-gutter">
                  {rowIndex + 1}
                </th>
                {table.header.map((_, columnIndex) => (
                  <td key={columnIndex}>{row[columnIndex] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
