import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { rootCommand } from '../../src/cli/root'
import { runCli } from '../helpers/run-cli'

// A good `GET /user` + `GET /rate_limit` pair so the `version` subcommand can
// report auth status. Routes mirror the Auth service's two reads.
const goodGithub = {
  routes: {
    'GET /user': { login: 'octocat', name: 'The Octocat' },
    'GET /rate_limit': { rate: { limit: 5000, remaining: 4999, reset: 0, used: 1 } },
  },
}

// Decode envelope results through Schema rather than casting — the repo idiom
// (bans `as`), and it doubles as a contract assertion on the emitted shape.
const CommandTree = Schema.Struct({
  commands: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
})
const decodeTree = Schema.decodeUnknownSync(CommandTree)

const VersionResult = Schema.Struct({
  version: Schema.String,
  auth: Schema.NullOr(Schema.Struct({ login: Schema.String, name: Schema.NullOr(Schema.String) })),
})
const decodeVersion = Schema.decodeUnknownSync(VersionResult)

describe('root command', () => {
  it.effect('with no subcommand emits an ok envelope whose result is the command tree', () =>
    Effect.gen(function* () {
      const env = yield* runCli(rootCommand, [])

      expect(env.ok).toBe(true)
      expect(env.command).toBe('root')
      expect(env.error).toBeNull()

      const tree = decodeTree(env.result)
      const names = tree.commands.map((c) => c.name)
      expect(names).toContain('version')
      expect(names).toContain('repos')
      expect(names).toContain('orgs')
      expect(names).toContain('users')
      expect(names).toContain('teams')
      expect(names).toContain('enterprise')
      expect(names).toContain('config')

      const version = tree.commands.find((c) => c.name === 'version')
      expect(version?.description.length).toBeGreaterThan(0)

      const repos = tree.commands.find((c) => c.name === 'repos')
      expect(repos?.description.length).toBeGreaterThan(0)

      const orgs = tree.commands.find((c) => c.name === 'orgs')
      expect(orgs?.description.length).toBeGreaterThan(0)

      const users = tree.commands.find((c) => c.name === 'users')
      expect(users?.description.length).toBeGreaterThan(0)

      const teams = tree.commands.find((c) => c.name === 'teams')
      expect(teams?.description.length).toBeGreaterThan(0)

      const enterprise = tree.commands.find((c) => c.name === 'enterprise')
      expect(enterprise?.description.length).toBeGreaterThan(0)

      const config = tree.commands.find((c) => c.name === 'config')
      expect(config?.description.length).toBeGreaterThan(0)
    })
  )

  it.effect('version subcommand emits version plus auth status', () =>
    Effect.gen(function* () {
      const env = yield* runCli(rootCommand, ['version'], { version: '9.9.9', github: goodGithub })

      expect(env.ok).toBe(true)
      expect(env.command).toBe('version')

      const result = decodeVersion(env.result)
      expect(result.version).toBe('9.9.9')
      expect(result.auth?.login).toBe('octocat')
      expect(result.auth?.name).toBe('The Octocat')
    })
  )

  it.effect('version subcommand tolerates a failing auth check', () =>
    Effect.gen(function* () {
      const env = yield* runCli(rootCommand, ['version'], {
        version: '9.9.9',
        github: { fail: { 'GET /user': 401 } },
      })

      expect(env.ok).toBe(true)
      expect(env.command).toBe('version')

      const result = decodeVersion(env.result)
      expect(result.version).toBe('9.9.9')
      expect(result.auth).toBeNull()
    })
  )
})
