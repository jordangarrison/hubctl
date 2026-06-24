import { describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as O from 'effect/Option'
import * as Schema from 'effect/Schema'

import { DecodeError, decode } from '../../src/schema/decode'

// The shared decode helper turns a Schema mismatch into a typed `DecodeError` in
// the `E` channel (never a thrown defect), so the output layer can render a clean
// `ok:false` envelope instead of dumping a stack trace.

const Row = Schema.Struct({ login: Schema.String, id: Schema.Finite })

describe('decode', () => {
  it.effect('decodes a matching payload in the success channel', () =>
    Effect.gen(function* () {
      const value = yield* decode(Row, 'row')({ login: 'octocat', id: 1 })
      expect(value).toEqual({ login: 'octocat', id: 1 })
    })
  )

  it.effect('ignores unknown/excess fields (additive API changes are safe)', () =>
    Effect.gen(function* () {
      const value = yield* decode(Row, 'row')({ login: 'octocat', id: 1, extra: true })
      expect(value).toEqual({ login: 'octocat', id: 1 })
    })
  )

  it.effect('a mismatch FAILS in the typed E channel as DecodeError (never throws)', () =>
    Effect.gen(function* () {
      // `id` is null where Finite is required — a realistic "type drift" mismatch.
      const exit = yield* Effect.exit(decode(Row, 'org row')({ login: 'octocat', id: null }))
      expect(Exit.isFailure(exit)).toBe(true)
      const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
      expect(error).toBeInstanceOf(DecodeError)
      expect(error?.code).toBe('decode_error')
      expect(error?.message).toContain('org row')
      expect(error?.fix).toContain('report')
    })
  )
})
