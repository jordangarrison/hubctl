import { describe, expect, it } from '@effect/vitest'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { Envelope } from '../../src/output/envelope'
import { Output } from '../../src/output/service'

const parseJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)
const decodeEnvelope = Schema.decodeUnknownSync(Envelope(Schema.Unknown))
const decodeEvent = Schema.decodeUnknownSync(Schema.Struct({ type: Schema.String }))

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

describe('Output.stream', () => {
  it.effect('writes one compact JSON line per event with a type discriminator, then a terminal envelope', () =>
    Effect.gen(function* () {
      const lines: Array<string> = []
      const output = yield* Output
      const events = Stream.fromArray([
        { type: 'progress', message: 'fetching page 1' },
        { type: 'result', entry: { action: 'org.update' } },
        { type: 'result', entry: { action: 'repo.create' } },
      ])
      yield* Effect.provideService(
        output.stream('enterprise.audit-log', events),
        Console.Console,
        captureConsole(lines)
      )

      // 3 event lines + 1 terminal envelope line.
      expect(lines.length).toBe(4)

      // Every line is a single compact JSON object (no embedded newlines).
      for (const line of lines) {
        expect(line.includes('\n')).toBe(false)
      }

      // The first three lines are events, each carrying its `type` discriminator.
      const e0 = decodeEvent(parseJson(lines[0] ?? ''))
      const e1 = decodeEvent(parseJson(lines[1] ?? ''))
      const e2 = decodeEvent(parseJson(lines[2] ?? ''))
      expect(e0.type).toBe('progress')
      expect(e1.type).toBe('result')
      expect(e2.type).toBe('result')
    }).pipe(Effect.provide(Output.layer({ mode: 'json' })))
  )

  it.effect('terminal line is a Schema-valid ok envelope whose result is the collected events', () =>
    Effect.gen(function* () {
      const lines: Array<string> = []
      const output = yield* Output
      const events = Stream.fromArray([
        { type: 'result', entry: { action: 'org.update' } },
        { type: 'result', entry: { action: 'repo.create' } },
      ])
      yield* Effect.provideService(
        output.stream('enterprise.audit-log', events),
        Console.Console,
        captureConsole(lines)
      )

      const terminal = lines.at(-1) ?? ''
      const env = decodeEnvelope(parseJson(terminal))
      expect(env.ok).toBe(true)
      expect(env.command).toBe('enterprise.audit-log')
      expect(env.result).toEqual([
        { type: 'result', entry: { action: 'org.update' } },
        { type: 'result', entry: { action: 'repo.create' } },
      ])
    }).pipe(Effect.provide(Output.layer({ mode: 'json' })))
  )

  it.effect('an empty event stream still emits exactly one terminal envelope line', () =>
    Effect.gen(function* () {
      const lines: Array<string> = []
      const output = yield* Output
      const events = Stream.fromArray<{ readonly type: string }>([])
      yield* Effect.provideService(
        output.stream('enterprise.audit-log', events),
        Console.Console,
        captureConsole(lines)
      )

      expect(lines.length).toBe(1)
      const env = decodeEnvelope(parseJson(lines[0] ?? ''))
      expect(env.ok).toBe(true)
      expect(env.result).toEqual([])
    }).pipe(Effect.provide(Output.layer({ mode: 'json' })))
  )
})
