import { describe, expect, it } from '@effect/vitest'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { Envelope } from '../../src/output/envelope'
import { Output } from '../../src/output/service'

const parseJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)
const decodeEnvelope = Schema.decodeUnknownSync(Envelope(Schema.Unknown))
const decodeTruncated = Schema.decodeUnknownSync(
  Schema.Struct({
    // eslint-disable-next-line effect/require-is-prefix-for-boolean-schema-field
    truncated: Schema.Boolean,
    count: Schema.Finite,
    items: Schema.Array(Schema.Unknown),
  })
)

// Builds a Console whose `log` appends each rendered chunk to `lines`, so a test
// can assert exactly what the Output service wrote to stdout.
const captureConsole = (lines: Array<string>): Console.Console => ({
  assert: () => {},
  clear: () => {},
  count: () => {},
  countReset: () => {},
  debug: () => {},
  dir: () => {},
  dirxml: () => {},
  error: () => {},
  group: () => {},
  groupCollapsed: () => {},
  groupEnd: () => {},
  info: () => {},
  log: (...args) => {
    lines.push(args.map(String).join(' '))
  },
  table: () => {},
  time: () => {},
  timeEnd: () => {},
  timeLog: () => {},
  trace: () => {},
  warn: () => {},
})

describe('Output service', () => {
  it.effect('json mode prints exactly one compact JSON line that round-trips through Envelope', () =>
    Effect.gen(function* () {
      const lines: Array<string> = []
      const output = yield* Output
      yield* Effect.provideService(output.ok('repos.list', [{ name: 'x' }]), Console.Console, captureConsole(lines))

      expect(lines.length).toBe(1)
      const line = lines[0] ?? ''
      expect(line.includes('\n')).toBe(false)

      const env = decodeEnvelope(parseJson(line))
      expect(env.ok).toBe(true)
      expect(env.command).toBe('repos.list')
      expect(env.result).toEqual([{ name: 'x' }])
    }).pipe(Effect.provide(Output.layer({ mode: 'json' })))
  )

  it.effect('pretty mode prints a table-ish string with a header token and row value, not starting with {', () =>
    Effect.gen(function* () {
      const lines: Array<string> = []
      const output = yield* Output
      yield* Effect.provideService(
        output.ok('repos.list', [{ name: 'alpha' }, { name: 'beta' }]),
        Console.Console,
        captureConsole(lines)
      )

      const text = lines.join('\n')
      expect(text.startsWith('{')).toBe(false)
      expect(text.includes('name')).toBe(true)
      expect(text.includes('alpha')).toBe(true)
    }).pipe(Effect.provide(Output.layer({ mode: 'pretty' })))
  )

  it.effect('json mode truncates a result list longer than 50 to 50 items with truncated:true and full count', () =>
    Effect.gen(function* () {
      const lines: Array<string> = []
      const output = yield* Output
      const big = Array.from({ length: 60 }, (_, i) => ({ name: `repo-${i}` }))
      yield* Effect.provideService(output.ok('repos.list', big), Console.Console, captureConsole(lines))

      const env = decodeEnvelope(parseJson(lines[0] ?? ''))
      const result = decodeTruncated(env.result)
      expect(result.truncated).toBe(true)
      expect(result.count).toBe(60)
      expect(result.items.length).toBe(50)
      expect(result.items[0]).toEqual({ name: 'repo-0' })
      expect(result.items[49]).toEqual({ name: 'repo-49' })
    }).pipe(Effect.provide(Output.layer({ mode: 'json' })))
  )

  it.effect('fail prints an ok:false envelope whose error and fix derive from the tagged error', () =>
    Effect.gen(function* () {
      const lines: Array<string> = []
      const output = yield* Output
      const taggedError = { _tag: 'NotFound', message: 'repo missing', fix: 'Check the repo name' }
      yield* Effect.provideService(output.fail('repos.show', taggedError), Console.Console, captureConsole(lines))

      const env = decodeEnvelope(parseJson(lines[0] ?? ''))
      expect(env.ok).toBe(false)
      expect(env.error?.code).toBe('NotFound')
      expect(env.error?.message).toBe('repo missing')
      expect(env.fix).toBe('Check the repo name')
    }).pipe(Effect.provide(Output.layer({ mode: 'json' })))
  )
})
