import * as Arr from 'effect/Array'
import * as P from 'effect/Predicate'
import * as R from 'effect/Record'
import * as Schema from 'effect/Schema'

import type { Envelope } from './envelope'
import type { Mode } from './mode'

// Pure renderers for an envelope. `render` is the single entry point; it picks a
// representation from the resolved `Mode`. No Effect, no I/O here.

export interface RenderOptions {
  // When true, no ANSI escapes are emitted. Honors NO_COLOR / --no-color.
  readonly noColor: boolean
}

const encodeJson = Schema.encodeSync(Schema.UnknownFromJsonString)

// Result lists longer than this are capped; the rendered output carries
// `truncated: true` and a `count` equal to the full original length.
const TRUNCATE_LIMIT = 50

interface TruncatedResult {
  readonly truncated: true
  readonly count: number
  readonly items: ReadonlyArray<unknown>
}

// When the envelope `result` is a list longer than the limit, replace it with a
// truncation wrapper: the first `TRUNCATE_LIMIT` items plus `truncated`/`count`
// metadata. Other shapes pass through unchanged.
const truncateEnvelope = <A>(envelope: Envelope<A>): Envelope<A | TruncatedResult> => {
  const { result } = envelope
  if (Array.isArray(result) && result.length > TRUNCATE_LIMIT) {
    return {
      ...envelope,
      result: { truncated: true, count: result.length, items: result.slice(0, TRUNCATE_LIMIT) },
    }
  }
  return envelope
}

// Compact, single-line JSON. Round-trips through the Envelope schema.
export const renderJson = <A>(envelope: Envelope<A>): string => encodeJson(envelope)

// Stringifies a single cell value; objects/arrays are JSON-encoded.
const formatCell = (value: unknown): string => {
  if (value === null || value === undefined) {
    return ''
  }
  if (P.isString(value)) {
    return value
  }
  if (P.isNumber(value) || P.isBoolean(value)) {
    return String(value)
  }
  return encodeJson(value)
}

// Renders an array of row objects as a simple table: a header line of the union
// of keys, then one line per row. Falls back to key/value lines for other shapes.
const renderPretty = <A>(envelope: Envelope<A>, _options: RenderOptions): string => {
  if (envelope.error !== null) {
    const fixLine = envelope.fix === null ? '' : `\nfix: ${envelope.fix}`
    return `error [${envelope.error.code}]: ${envelope.error.message}${fixLine}`
  }

  const { result } = envelope
  if (Array.isArray(result) && result.length > 0 && result.every(P.isReadonlyObject)) {
    const rows: ReadonlyArray<R.ReadonlyRecord<string, unknown>> = result
    const headers = Arr.dedupe(rows.flatMap((row) => R.keys(row)))
    const headerLine = headers.join('\t')
    const bodyLines = rows.map((row) => headers.map((key) => formatCell(row[key])).join('\t'))
    return [headerLine, ...bodyLines].join('\n')
  }

  if (P.isReadonlyObject(result)) {
    return R.toEntries(result)
      .map(([key, value]) => `${key}: ${formatCell(value)}`)
      .join('\n')
  }

  return formatCell(result)
}

export const render = <A>(mode: Mode, envelope: Envelope<A>, options: RenderOptions): string => {
  const truncated = truncateEnvelope(envelope)
  return mode === 'json' ? renderJson(truncated) : renderPretty(truncated, options)
}
