import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { enterpriseCommand } from '../../src/cli/enterprise'
import { runCli } from '../helpers/run-cli'

// Command-level tests: drive the real `Command.runWith` over the network-free
// test layer (FakeGithub + captured stdout) and assert on the emitted envelope.

const GroupTree = Schema.Struct({
  commands: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
})
const decodeGroup = Schema.decodeUnknownSync(GroupTree)

describe('enterprise command', () => {
  it.effect('with no subcommand lists its subcommands', () =>
    Effect.gen(function* () {
      const env = yield* runCli(enterpriseCommand, [])
      expect(env.ok).toBe(true)
      expect(env.command).toBe('enterprise')
      const tree = decodeGroup(env.result)
      const names = tree.commands.map((c) => c.name)
      expect(names).toContain('orgs')
    })
  )

  describe('orgs', () => {
    const orgPayload = {
      login: 'acme-eng',
      id: 7,
      description: 'Engineering',
      public_repos: 12,
      private_repos: 30,
      plan: { name: 'enterprise' },
      billing_email: 'eng@acme.test',
      members_count: 50,
      teams_count: 6,
      created_at: '2020-01-01T00:00:00Z',
      html_url: 'https://github.com/acme-eng',
    }

    it.effect('list emits a shaped row list', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['orgs', 'list', 'acme'], {
          github: { routes: { 'GET /enterprises/{enterprise}/organizations': [orgPayload] } },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.orgs.list')
        expect(env.result).toMatchObject([{ login: 'acme-eng', plan: 'enterprise' }])
      })
    )

    it.effect('create posts the org', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['orgs', 'create', 'acme', 'newco', '--yes'], {
          github: {
            routes: {
              'POST /enterprises/{enterprise}/organizations': { id: 99, login: 'newco', html_url: 'u' },
            },
          },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.orgs.create')
        expect(env.result).toMatchObject({ id: 99, login: 'newco' })
      })
    )

    it.effect('create in json mode without --yes gates with a re-run fix', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['orgs', 'create', 'acme', 'newco'], { github: {} })
        expect(env.ok).toBe(false)
        expect(env.command).toBe('enterprise.orgs.create')
        expect(env.fix).toContain('--yes')
      })
    )

    it.effect('transfer in json mode with --yes moves the org', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['orgs', 'transfer', 'acme', 'movingco', '--yes'], {
          github: { routes: { 'POST /enterprises/{enterprise}/organizations': { ok: true } } },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.orgs.transfer')
        expect(env.result).toMatchObject({ organization: 'movingco', transferred: true })
      })
    )

    it.effect('remove in json mode without --yes gates with a re-run fix', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['orgs', 'remove', 'acme', 'oldco'], { github: {} })
        expect(env.ok).toBe(false)
        expect(env.command).toBe('enterprise.orgs.remove')
        expect(env.fix).toContain('--yes')
      })
    )

    it.effect('remove with --yes deletes the org', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['orgs', 'remove', 'acme', 'oldco', '--yes'], {
          github: { routes: { 'DELETE /enterprises/{enterprise}/organizations/{org}': {} } },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.orgs.remove')
        expect(env.result).toMatchObject({ organization: 'oldco', removed: true })
      })
    )
  })
})
