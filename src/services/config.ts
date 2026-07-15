import * as Config_ from 'effect/Config'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as P from 'effect/Predicate'
import * as R from 'effect/Record'
import * as Schema from 'effect/Schema'

import { AuthError } from '../github/errors'
import { decode } from '../schema/decode'
import type { DecodeError } from '../schema/decode'

// Resolution of GitHub credentials/settings for hubctl. Precedence mirrors the
// Ruby `Hubctl::Config`: environment first, then the on-disk JSON config file at
// `~/.config/hubctl/config.json`. `get`/`set`/`list` read and mutate that file.
//
// Env is read through Effect's `Config`/`ConfigProvider` (the language-service
// `processEnvInEffect` rule forbids raw `process.env`); the file is read/written
// via the platform `FileSystem` + `Path` services so tests can inject a fake FS.

export interface ConfigShape {
  // GITHUB_TOKEN env, else config file `github_token`, else AuthError.
  readonly githubToken: Effect.Effect<string, AuthError>
  // GITHUB_ORG env, else config file `default_org`, else None.
  readonly defaultOrg: Effect.Effect<O.Option<string>>
  // Read a single key from the config file. `DecodeError` surfaces when the file
  // exists but isn't valid JSON (a clean envelope, not a crash).
  readonly get: (key: string) => Effect.Effect<O.Option<string>, PlatformError | DecodeError>
  // Write a single key into the config file (creating it if needed). Reads the
  // existing file first, so a corrupt file surfaces a `DecodeError`.
  readonly set: (key: string, value: string) => Effect.Effect<void, PlatformError | DecodeError>
  // Read the whole config file as a record.
  readonly list: Effect.Effect<Record<string, unknown>, PlatformError | DecodeError>
  // Absolute path to the on-disk config file (~/.config/hubctl/config.json).
  readonly configPath: string
}

// A corrupt config file is user-editable external input, so parse it through the
// effectful `decode` helper: a malformed JSON file fails with a typed
// `DecodeError` (rendered as a clean `ok:false` envelope) instead of throwing an
// uncaught defect. Encoding back out stays synchronous — we serialize a string
// record we built ourselves, which is always JSON-safe.
const parseJson = decode(Schema.UnknownFromJsonString, 'config file')
const encodeJson = Schema.encodeSync(Schema.UnknownFromJsonString)

// Read an optional env var without throwing when absent.
const envOption = (name: string): Effect.Effect<O.Option<string>> =>
  Config_.option(Config_.string(name)).pipe(Effect.orElseSucceed(() => O.none()))

const emptyRecord: Record<string, unknown> = {}

// Coerce a parsed JSON value into a string record; non-objects become {}.
const asRecord = (value: unknown): Record<string, unknown> => (P.isReadonlyObject(value) ? { ...value } : emptyRecord)

const stringField = (record: Record<string, unknown>, key: string): O.Option<string> =>
  O.filter(R.get(record, key), P.isString)

export class Config extends Context.Service<Config, ConfigShape>()('Config') {
  static readonly layer: Layer.Layer<Config, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
    Config,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      // Environment is read eagerly at layer construction so the resolved values
      // are captured regardless of where the shape's effects are later run (the
      // ConfigProvider override is only in scope while this layer is built).
      const home = yield* envOption('HOME')
      const tokenEnv = yield* envOption('GITHUB_TOKEN')
      const orgEnv = yield* envOption('GITHUB_ORG')

      // ~/.config/hubctl/config.json, with HOME resolved from the environment.
      const configDir = path.join(
        O.getOrElse(home, () => '.'),
        '.config',
        'hubctl'
      )
      const configPath = path.join(configDir, 'config.json')

      const readFile = Effect.fn('Config.readFile')(function* () {
        const exists = yield* fs.exists(configPath)
        if (!exists) {
          return emptyRecord
        }
        const contents = yield* fs.readFileString(configPath)
        const parsed = yield* parseJson(contents)
        return asRecord(parsed)
      })

      const writeFile = Effect.fn('Config.writeFile')(function* (record: Record<string, unknown>) {
        yield* fs.makeDirectory(configDir, { recursive: true })
        yield* fs.writeFileString(configPath, encodeJson(record))
      })

      const get: ConfigShape['get'] = (key) => Effect.map(readFile(), (record) => stringField(record, key))

      const set: ConfigShape['set'] = (key, value) =>
        Effect.flatMap(readFile(), (record) => writeFile({ ...record, [key]: value }))

      const list: ConfigShape['list'] = readFile()

      const missingTokenError = new AuthError({
        message: 'No GitHub token configured',
        fix: 'Set GITHUB_TOKEN or run hubctl config init',
      })

      const githubToken: ConfigShape['githubToken'] = O.isSome(tokenEnv)
        ? Effect.succeed(tokenEnv.value)
        : get('github_token').pipe(
            Effect.orElseSucceed(() => O.none<string>()),
            Effect.flatMap(O.match({ onNone: () => Effect.fail(missingTokenError), onSome: Effect.succeed }))
          )

      const defaultOrg: ConfigShape['defaultOrg'] = O.isSome(orgEnv)
        ? Effect.succeed(orgEnv)
        : get('default_org').pipe(Effect.orElseSucceed(() => O.none<string>()))

      return { githubToken, defaultOrg, get, set, list, configPath }
    })
  )
}
