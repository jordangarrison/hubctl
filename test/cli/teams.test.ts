import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { teamsCommand } from '../../src/cli/teams'
import { runCli } from '../helpers/run-cli'

// Command-level tests: drive the real `Command.runWith` over the network-free
// test layer (FakeGithub + captured stdout) and assert on the emitted envelope.

const teamPayload = {
  id: 7,
  name: 'Core',
  slug: 'core',
  description: 'Core maintainers',
  privacy: 'closed',
  permission: 'push',
  members_count: 4,
  repos_count: 12,
}

const TeamListItem = Schema.Struct({
  id: Schema.Finite,
  name: Schema.String,
  slug: Schema.String,
  description: Schema.String,
  privacy: Schema.String,
  permission: Schema.String,
  members_count: Schema.Finite,
  repos_count: Schema.Finite,
})
const decodeList = Schema.decodeUnknownSync(Schema.Array(TeamListItem))

const GroupTree = Schema.Struct({
  commands: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
})
const decodeGroup = Schema.decodeUnknownSync(GroupTree)

describe('teams command', () => {
  it.effect('with no subcommand lists its subcommands', () =>
    Effect.gen(function* () {
      const env = yield* runCli(teamsCommand, [])
      expect(env.ok).toBe(true)
      expect(env.command).toBe('teams')

      const tree = decodeGroup(env.result)
      const names = tree.commands.map((c) => c.name)
      expect(names).toContain('list')
      expect(names).toContain('create')
    })
  )

  describe('list', () => {
    it.effect('emits a teams.list envelope with shaped rows and next_actions', () =>
      Effect.gen(function* () {
        const env = yield* runCli(teamsCommand, ['list', '--org', 'acme'], {
          github: { routes: { 'GET /orgs/{org}/teams': [teamPayload] } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('teams.list')
        expect(env.error).toBeNull()

        const rows = decodeList(env.result)
        expect(rows).toHaveLength(1)
        expect(rows[0]?.slug).toBe('core')
        expect(rows[0]?.members_count).toBe(4)

        expect(env.next_actions).toContain('hubctl teams members <team> --org <org>')
      })
    )

    it.effect('surfaces an ok:false envelope with a fix when the org 404s', () =>
      Effect.gen(function* () {
        const env = yield* runCli(teamsCommand, ['list', '--org', 'missing'], {
          github: { fail: { 'GET /orgs/{org}/teams': 404 } },
        })

        expect(env.ok).toBe(false)
        expect(env.command).toBe('teams.list')
        expect(env.result).toBeNull()
        expect(env.error?.code).toBe('NotFoundError')
        expect(env.fix).not.toBeNull()
      })
    )
  })

  describe('create', () => {
    const created = { id: 99, name: 'Squad', slug: 'squad', privacy: 'closed', permission: 'pull' }

    it.effect('emits a teams.create envelope with the created summary', () =>
      Effect.gen(function* () {
        const env = yield* runCli(teamsCommand, ['create', 'Squad', '--org', 'acme'], {
          github: { routes: { 'POST /orgs/{org}/teams': created } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('teams.create')
        expect(env.result).toMatchObject({ id: 99, slug: 'squad' })
        expect(env.next_actions).toContain('hubctl teams members <team> --org <org>')
      })
    )

    it.effect('defaults privacy=closed and permission=pull and forwards them', () =>
      Effect.gen(function* () {
        const env = yield* runCli(teamsCommand, ['create', 'Squad', '--org', 'acme'], {
          github: {
            routes: {
              'POST /orgs/{org}/teams': (params: Record<string, unknown>) =>
                params.name === 'Squad' && params.privacy === 'closed' && params.permission === 'pull'
                  ? created
                  : { ...created, slug: 'WRONG' },
            },
          },
        })

        expect(env.ok).toBe(true)
        expect(env.result).toMatchObject({ slug: 'squad' })
      })
    )
  })
})
