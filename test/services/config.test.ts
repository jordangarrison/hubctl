import { assert, describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'
import * as Path from 'effect/Path'
import * as PlatformError from 'effect/PlatformError'
import * as R from 'effect/Record'
import * as Schema from 'effect/Schema'

import { AuthError } from '../../src/github/errors'
import { DecodeError } from '../../src/schema/decode'
import { Config } from '../../src/services/config'

// Serialize a config object to JSON the way the on-disk file would store it,
// using the Schema codec (the effect lint bans raw `JSON.stringify`).
const toJson = Schema.encodeSync(Schema.UnknownFromJsonString)

// In-memory FileSystem fake: only the surface `Config` touches is implemented
// (exists / readFileString / writeFileString / makeDirectory). `layerNoop`
// fills the rest with failing stubs so an accidental dependency is caught.
const fakeFs = (files: Record<string, string>): Layer.Layer<FileSystem.FileSystem> => {
  const store = new Map<string, string>(R.toEntries(files))
  return FileSystem.layerNoop({
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
}

const envLayer = (env: Record<string, string>): Layer.Layer<never> =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env }))

// Build the full dependency stack for a Config test: env + fake FS + Path,
// then the Config layer on top. `Path.layer` provides the platform-agnostic
// POSIX path implementation.
const testLayer = (env: Record<string, string>, files: Record<string, string> = {}) =>
  Config.layer.pipe(Layer.provide([fakeFs(files), Path.layer, envLayer(env)]))

const HOME = '/home/tester'
const CONFIG_PATH = `${HOME}/.config/hubctl/config.json`

describe('Config service', () => {
  it.effect('githubToken resolves GITHUB_TOKEN env first (env wins over file)', () =>
    Effect.gen(function* () {
      const config = yield* Config
      const token = yield* config.githubToken
      expect(token).toBe('env-token')
    }).pipe(
      Effect.provide(
        testLayer({ HOME, GITHUB_TOKEN: 'env-token' }, { [CONFIG_PATH]: toJson({ github_token: 'file-token' }) })
      )
    )
  )

  it.effect('githubToken falls back to config file github_token when env is absent', () =>
    Effect.gen(function* () {
      const config = yield* Config
      const token = yield* config.githubToken
      expect(token).toBe('file-token')
    }).pipe(Effect.provide(testLayer({ HOME }, { [CONFIG_PATH]: toJson({ github_token: 'file-token' }) })))
  )

  it.effect('githubToken fails with AuthError + config init fix when neither env nor file has a token', () =>
    Effect.gen(function* () {
      const config = yield* Config
      const error = yield* Effect.flip(config.githubToken)
      expect(error).toBeInstanceOf(AuthError)
      expect(error.fix).toBe('Set GITHUB_TOKEN or run hubctl config init')
    }).pipe(Effect.provide(testLayer({ HOME })))
  )

  it.effect('defaultOrg resolves GITHUB_ORG env first', () =>
    Effect.gen(function* () {
      const config = yield* Config
      const org = yield* config.defaultOrg
      expect(org).toStrictEqual(O.some('env-org'))
    }).pipe(
      Effect.provide(testLayer({ HOME, GITHUB_ORG: 'env-org' }, { [CONFIG_PATH]: toJson({ default_org: 'file-org' }) }))
    )
  )

  it.effect('defaultOrg falls back to config file default_org', () =>
    Effect.gen(function* () {
      const config = yield* Config
      const org = yield* config.defaultOrg
      expect(org).toStrictEqual(O.some('file-org'))
    }).pipe(Effect.provide(testLayer({ HOME }, { [CONFIG_PATH]: toJson({ default_org: 'file-org' }) })))
  )

  it.effect('defaultOrg is None when absent from both env and file', () =>
    Effect.gen(function* () {
      const config = yield* Config
      const org = yield* config.defaultOrg
      expect(org).toStrictEqual(O.none())
    }).pipe(Effect.provide(testLayer({ HOME })))
  )

  it.effect('get returns the file value for a key, None when missing', () =>
    Effect.gen(function* () {
      const config = yield* Config
      expect(yield* config.get('github_token')).toStrictEqual(O.some('file-token'))
      expect(yield* config.get('missing')).toStrictEqual(O.none())
    }).pipe(Effect.provide(testLayer({ HOME }, { [CONFIG_PATH]: toJson({ github_token: 'file-token' }) })))
  )

  it.effect('set writes a key into the config file, readable via get/list', () =>
    Effect.gen(function* () {
      const config = yield* Config
      yield* config.set('default_org', 'acme')
      expect(yield* config.get('default_org')).toStrictEqual(O.some('acme'))
      const all = yield* config.list
      expect(all).toEqual({ default_org: 'acme' })
    }).pipe(Effect.provide(testLayer({ HOME })))
  )

  it.effect('list returns the whole config object, empty when no file', () =>
    Effect.gen(function* () {
      const config = yield* Config
      expect(yield* config.list).toEqual({})
    }).pipe(Effect.provide(testLayer({ HOME })))
  )

  it.effect('list fails with a DecodeError (not a thrown defect) when the config file is corrupt JSON', () =>
    Effect.gen(function* () {
      const config = yield* Config
      const exit = yield* Effect.exit(config.list)
      expect(Exit.isFailure(exit)).toBe(true)
      const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
      assert(error instanceof DecodeError)
      expect(error.code).toBe('decode_error')
    }).pipe(Effect.provide(testLayer({ HOME }, { [CONFIG_PATH]: 'not valid json {{{' })))
  )

  it.effect('configPath reports the resolved ~/.config/hubctl/config.json path', () =>
    Effect.gen(function* () {
      const config = yield* Config
      expect(config.configPath).toBe(CONFIG_PATH)
    }).pipe(Effect.provide(testLayer({ HOME })))
  )
})
