import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { configCommand } from '../../src/cli/config'
import { runCli } from '../helpers/run-cli'

// Command-level tests for the `config` group: drive the real `Command.runWith`
// over the network-free test layer (in-memory Config + captured stdout) and
// assert on the emitted envelope. Mirrors lib/hubctl/config_cli.rb.

const HOME = '/home/test-user'
const CONFIG_PATH = `${HOME}/.config/hubctl/config.json`

const toJson = Schema.encodeSync(Schema.UnknownFromJsonString)
const parseJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)

const GroupTree = Schema.Struct({
  commands: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
})
const decodeGroup = Schema.decodeUnknownSync(GroupTree)

describe('config command', () => {
  it.effect('with no subcommand lists its subcommands', () =>
    Effect.gen(function* () {
      const env = yield* runCli(configCommand, [])
      expect(env.ok).toBe(true)
      expect(env.command).toBe('config')

      const tree = decodeGroup(env.result)
      const names = tree.commands.map((c) => c.name)
      expect(names).toContain('get')
      expect(names).toContain('set')
      expect(names).toContain('list')
      expect(names).toContain('init')
      expect(names).toContain('path')
    })
  )

  describe('get', () => {
    it.effect('emits a config.get envelope with the stored value', () =>
      Effect.gen(function* () {
        const env = yield* runCli(configCommand, ['get', 'default_org'], {
          config: { home: HOME, files: { [CONFIG_PATH]: toJson({ default_org: 'acme' }) } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('config.get')
        expect(env.error).toBeNull()
        expect(env.result).toMatchObject({ key: 'default_org', value: 'acme' })
      })
    )

    it.effect('fails with a not_found error when the key is absent', () =>
      Effect.gen(function* () {
        const env = yield* runCli(configCommand, ['get', 'missing'], { config: { home: HOME } })

        expect(env.ok).toBe(false)
        expect(env.command).toBe('config.get')
        expect(env.result).toBeNull()
        expect(env.error?.code).toBe('config_key_not_found')
      })
    )
  })

  describe('set', () => {
    it.effect('writes the key into the config file and echoes it', () =>
      Effect.gen(function* () {
        const store = new Map<string, string>()
        const env = yield* runCli(configCommand, ['set', 'default_org', 'acme'], { config: { home: HOME, store } })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('config.set')
        expect(env.result).toMatchObject({ key: 'default_org', value: 'acme' })

        const written = store.get(CONFIG_PATH) ?? ''
        expect(parseJson(written)).toEqual({ default_org: 'acme' })
      })
    )
  })

  describe('list', () => {
    it.effect('emits the whole config as the result', () =>
      Effect.gen(function* () {
        const env = yield* runCli(configCommand, ['list'], {
          config: { home: HOME, files: { [CONFIG_PATH]: toJson({ default_org: 'acme', github_token: 'tok' }) } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('config.list')
        expect(env.result).toMatchObject({ default_org: 'acme', github_token: 'tok' })
      })
    )

    it.effect('emits an empty object when no config exists', () =>
      Effect.gen(function* () {
        const env = yield* runCli(configCommand, ['list'], { config: { home: HOME } })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('config.list')
        expect(env.result).toEqual({})
      })
    )
  })

  describe('path', () => {
    it.effect('emits the resolved config file path', () =>
      Effect.gen(function* () {
        const env = yield* runCli(configCommand, ['path'], { config: { home: HOME } })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('config.path')
        expect(env.result).toMatchObject({ path: CONFIG_PATH })
      })
    )
  })

  describe('init', () => {
    it.effect('in json mode writes the --token and --org flags to the config file', () =>
      Effect.gen(function* () {
        const store = new Map<string, string>()
        const env = yield* runCli(configCommand, ['init', '--token', 'ghp_xyz', '--org', 'acme'], {
          config: { home: HOME, store },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('config.init')
        expect(env.result).toMatchObject({ path: CONFIG_PATH })

        const written = store.get(CONFIG_PATH) ?? ''
        expect(parseJson(written)).toEqual({ github_token: 'ghp_xyz', default_org: 'acme' })
      })
    )

    it.effect('in json mode fails when no --token is provided', () =>
      Effect.gen(function* () {
        const env = yield* runCli(configCommand, ['init'], { config: { home: HOME } })

        expect(env.ok).toBe(false)
        expect(env.command).toBe('config.init')
        expect(env.error?.code).toBe('token_required')
        expect(env.fix).not.toBeNull()
      })
    )
  })
})
