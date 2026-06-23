import { describe, expect, it } from '@effect/vitest'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as Command from 'effect/unstable/cli/Command'

import { appLayer } from '../../src/cli/app-layer'
import { rootCommand } from '../../src/cli/root'
import { Envelope as EnvelopeSchema } from '../../src/output/envelope'

// The production `appLayer` wires `BunServices` + `Config` + `Github` (lazy,
// token from `Config`) + `Auth` + `Output` together. It must build WITHOUT a
// GitHub token so token-free commands (`version`, root tree) still run — the
// token is only resolved when a command actually hits the Github surface.
//
// This is the unit behind `src/main.ts`; `main.ts` itself is a thin shim that
// runs the root command over this layer (manually smoke-tested with
// `bun run dev -- version`).

const parseJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)
const decodeEnvelope = Schema.decodeUnknownSync(EnvelopeSchema(Schema.Unknown))

const noop = (): undefined => undefined

const captureConsole = (lines: Array<string>): Console.Console => ({
  assert: noop,
  clear: noop,
  count: noop,
  countReset: noop,
  debug: noop,
  dir: noop,
  dirxml: noop,
  error: noop,
  group: noop,
  groupCollapsed: noop,
  groupEnd: noop,
  info: noop,
  log: (...args) => {
    lines.push(args.map(String).join(' '))
  },
  table: noop,
  time: noop,
  timeEnd: noop,
  timeLog: noop,
  trace: noop,
  warn: noop,
})

describe('appLayer', () => {
  it.effect('builds without a GitHub token and runs the version command (json mode)', () =>
    Effect.gen(function* () {
      const lines: Array<string> = []
      const version = '1.2.3'
      const run = Command.runWith(rootCommand(version), { version })

      yield* run(['version']).pipe(
        Effect.orDie,
        // The lazy Github layer never resolves a token at construction, so
        // providing `appLayer` succeeds even with no token in scope; `version`
        // tolerates the eventual auth failure (`auth: null`).
        Effect.provide(appLayer({ version, mode: 'json' })),
        Effect.provideService(Console.Console, captureConsole(lines))
      )

      const env = decodeEnvelope(parseJson(lines.at(-1) ?? ''))
      expect(env.ok).toBe(true)
      expect(env.command).toBe('version')
      expect(env.result).toMatchObject({ version: '1.2.3', auth: null })
    })
  )

  it('exposes a Layer (not an effect)', () => {
    const layer = appLayer({ version: '0.0.0', mode: 'json' })
    expect(Layer.isLayer(layer)).toBe(true)
  })
})
