import * as BunServices from '@effect/platform-bun/BunServices'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as PlatformError from 'effect/PlatformError'
import * as R from 'effect/Record'
import * as Schema from 'effect/Schema'
import type { Prompt } from 'effect/unstable/cli'
import * as Command from 'effect/unstable/cli/Command'
import type { ChildProcessSpawner } from 'effect/unstable/process'

import type { Envelope } from '../../src/output/envelope'
import { Envelope as EnvelopeSchema } from '../../src/output/envelope'
import { Output } from '../../src/output/service'
import { Auth } from '../../src/services/auth'
import { Config } from '../../src/services/config'
import { Enterprise } from '../../src/services/enterprise'
import { Orgs } from '../../src/services/orgs'
import { Repos } from '../../src/services/repos'
import { Teams } from '../../src/services/teams'
import { Users } from '../../src/services/users'
import { FakeGithub } from './fake-github'
import type { FakeGithubConfig } from './fake-github'
import { FakeSpawner } from './fake-spawner'
import type { SpawnerCapture } from './fake-spawner'

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
  // Optional capture sink for `repos clone`: when present, `git` is run through a
  // FakeSpawner that records each argv here (and returns exit 0) instead of
  // spawning a real process via BunServices.
  readonly spawn?: SpawnerCapture
  // Exit code the FakeSpawner returns for `git` (default 0). A non-zero value
  // lets a test exercise the `repos clone` failure path.
  readonly spawnExit?: number
  // Config-service fixtures for the `config` command group. Seeds an in-memory
  // FileSystem-backed `Config` (so tests never touch the real
  // `~/.config/hubctl/config.json`) and lets a test read back what was written.
  readonly config?: ConfigCapture
}

// In-memory config backing for `config` command tests. `home` controls the
// resolved config path; `env` seeds GITHUB_TOKEN/GITHUB_ORG; `files` pre-seeds
// the on-disk store keyed by absolute path. `store` is the live Map the test can
// inspect after a `set`/`init` write.
export interface ConfigCapture {
  readonly home?: string
  readonly env?: Record<string, string>
  readonly files?: Record<string, string>
  store?: Map<string, string>
}

const TEST_HOME = '/home/test-user'

// Build a `Config` layer over an in-memory FileSystem so config commands run
// without touching the real home directory. The same `store` Map is shared back
// to the caller via `capture.store` so a test can assert on writes.
const fakeConfigLayer = (capture: ConfigCapture): Layer.Layer<Config> => {
  const home = capture.home ?? TEST_HOME
  const store = capture.store ?? new Map<string, string>()
  for (const [path, contents] of R.toEntries(capture.files ?? {})) {
    store.set(path, contents)
  }
  capture.store = store
  const fakeFs = FileSystem.layerNoop({
    exists: (path) => Effect.succeed(store.has(path)),
    readFileString: (path) =>
      store.has(path)
        ? Effect.succeed(store.get(path) ?? '')
        : Effect.fail(
            PlatformError.systemError({
              _tag: 'NotFound',
              module: 'FileSystem',
              method: 'readFileString',
              pathOrDescriptor: path,
            })
          ),
    writeFileString: (path, data) => Effect.sync(() => store.set(path, data)),
    makeDirectory: () => Effect.void,
  })
  const env = ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: home, ...capture.env } }))
  return Config.layer.pipe(Layer.provide([fakeFs, Path.layer, env]))
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
  build: (
    version: string
  ) => Command.Command<
    Name,
    Input,
    ContextInput,
    E,
    | Output
    | Auth
    | Repos
    | Orgs
    | Users
    | Teams
    | Enterprise
    | Config
    | Prompt.Environment
    | ChildProcessSpawner.ChildProcessSpawner
  >,
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
    // When a `spawn` capture is given, overlay the FakeSpawner so `repos clone`
    // records argv instead of running real git; `Layer.provideMerge` keeps the
    // rest of `BunServices` while replacing just the `ChildProcessSpawner`.
    const platform =
      options.spawn === undefined
        ? BunServices.layer
        : Layer.provideMerge(FakeSpawner.layer(options.spawn, options.spawnExit ?? 0), BunServices.layer)
    const testLayer = Layer.mergeAll(
      platform,
      Output.layer({ mode: 'json' }),
      Auth.layer.pipe(Layer.provide(github)),
      Repos.layer.pipe(Layer.provide(github)),
      Orgs.layer.pipe(Layer.provide(github)),
      Users.layer.pipe(Layer.provide(github)),
      Teams.layer.pipe(Layer.provide(github)),
      Enterprise.layer.pipe(Layer.provide(github)),
      fakeConfigLayer(options.config ?? {})
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
