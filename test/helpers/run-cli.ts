import * as BunServices from '@effect/platform-bun/BunServices'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as Command from 'effect/unstable/cli/Command'

import type { Envelope } from '../../src/output/envelope'
import { Envelope as EnvelopeSchema } from '../../src/output/envelope'
import { Output } from '../../src/output/service'
import { Auth } from '../../src/services/auth'
import { Repos } from '../../src/services/repos'
import { FakeGithub } from './fake-github'
import type { FakeGithubConfig } from './fake-github'

// Reusable harness for command-level tests. Runs a real `Command.runWith` over a
// network-free test layer and captures the emitted envelope WITHOUT writing real
// stdout, returning the parsed `Envelope`. Every later command test reuses this:
// give it the command, the argv, and the canned Github fixtures, then assert on
// the structured envelope.
//
// The layer stack mirrors the production `AppLayer` (Phase 4.3) but swaps the
// live Github for `FakeGithub`, forces `Output` into `json` mode (so the
// envelope is machine-parseable), provides `Auth` over the fake, supplies the
// CLI `Environment` via `BunServices.layer`, and overrides the `Console`
// service with a capturing implementation so nothing reaches the terminal.

const parseJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)
const decodeEnvelope = Schema.decodeUnknownSync(EnvelopeSchema(Schema.Unknown))

export interface RunCliOptions {
  // Canned Github fixtures the command's services resolve against (e.g. the
  // `GET /user` payload that `version`/`auth` read). Omit for commands that
  // never touch Github.
  readonly github?: FakeGithubConfig
  // Version string threaded into BOTH `Command.runWith` (the built-in
  // `--version` flag) AND the command builder, so a handler that emits the
  // version agrees with the flag. Defaults to a test stub.
  readonly version?: string
}

// Inert sink for every non-`log` Console method (an expression body, so it
// reads as a no-op without an empty block that `no-empty-function` rejects for
// helpers outside the `*.test.ts` glob).
const noop = (): undefined => undefined

// Captures every `Console.log` chunk into `lines` so the harness can read back
// exactly what the command wrote. All other Console methods are inert.
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

const DEFAULT_VERSION = '0.0.0-test'

// Run a command with `argv` over the test layer and return the parsed envelope
// emitted on the final stdout line. `build` receives the resolved version so a
// handler that emits the version stays in lockstep with `Command.runWith`'s
// `--version` flag (both get the same string). The command's required services
// (`Output`, `Auth`, `Github`, and the CLI `Environment`) are all provided here.
// The command may declare any input/context shape; only its service
// dependencies (`Output | Auth`) are constrained, since those are what the test
// layer supplies.
export const runCli = <const Name extends string, Input, E, ContextInput>(
  build: (version: string) => Command.Command<Name, Input, ContextInput, E, Output | Auth | Repos>,
  argv: ReadonlyArray<string>,
  options: RunCliOptions = {}
): Effect.Effect<Envelope<unknown>> =>
  Effect.gen(function* () {
    const lines: Array<string> = []
    const version = options.version ?? DEFAULT_VERSION
    const run = Command.runWith(build(version), { version })

    // One merged layer (not a chain of provides, which can break service
    // lifecycle): the CLI `Environment`, the JSON `Output`, and the domain
    // services (`Auth`, `Repos`) over a single canned `FakeGithub`. Console is
    // overridden separately (a service, not a layer) so stdout is captured
    // rather than written.
    const github = FakeGithub.layer(options.github ?? {})
    const testLayer = Layer.mergeAll(
      BunServices.layer,
      Output.layer({ mode: 'json' }),
      Auth.layer.pipe(Layer.provide(github)),
      Repos.layer.pipe(Layer.provide(github))
    )

    // CLI parse failures (`DuplicateOption`, `MissingArgument`, …) mean the test
    // passed a bad argv — surface them as defects so they fail loudly rather
    // than landing in the typed `E` channel.
    yield* run(argv).pipe(
      Effect.orDie,
      Effect.provide(testLayer),
      Effect.provideService(Console.Console, captureConsole(lines))
    )

    const last = lines.at(-1) ?? ''
    return decodeEnvelope(parseJson(last))
  })
