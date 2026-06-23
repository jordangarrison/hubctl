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

const memberPayload = {
  login: 'octocat',
  id: 1,
  type: 'User',
  site_admin: false,
  html_url: 'https://github.com/octocat',
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

const TeamDetail = Schema.Struct({
  id: Schema.Finite,
  name: Schema.String,
  slug: Schema.String,
  description: Schema.NullOr(Schema.String),
  privacy: Schema.String,
  permission: Schema.String,
  members_count: Schema.Finite,
  repos_count: Schema.Finite,
  created_at: Schema.String,
  updated_at: Schema.String,
  url: Schema.String,
})
const decodeDetail = Schema.decodeUnknownSync(TeamDetail)

const TeamMember = Schema.Struct({
  login: Schema.String,
  id: Schema.Finite,
  type: Schema.String,
  // `site_admin` is GitHub's wire field name; the is*-prefix idiom doesn't apply.
  // eslint-disable-next-line effect/require-is-prefix-for-boolean-schema-field
  site_admin: Schema.Boolean,
  url: Schema.String,
})
const decodeMembers = Schema.decodeUnknownSync(Schema.Array(TeamMember))

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
      expect(names).toContain('show')
      expect(names).toContain('create')
      expect(names).toContain('members')
      expect(names).toContain('add')
      expect(names).toContain('remove')
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

    it.effect('decodes list rows that OMIT members_count/repos_count and renders "-"', () =>
      Effect.gen(function* () {
        const env = yield* runCli(teamsCommand, ['list', '--org', 'acme'], {
          github: {
            routes: {
              'GET /orgs/{org}/teams': [
                {
                  id: 7,
                  name: 'Core',
                  slug: 'core',
                  description: 'Core maintainers',
                  privacy: 'closed',
                  permission: 'push',
                },
              ],
            },
          },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('teams.list')
        expect(env.result).toMatchObject([{ slug: 'core', members_count: '-', repos_count: '-' }])
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

  describe('show', () => {
    const detailPayload = {
      id: 7,
      name: 'Core',
      slug: 'core',
      description: 'Core maintainers',
      privacy: 'closed',
      permission: 'push',
      members_count: 4,
      repos_count: 12,
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2021-02-02T00:00:00Z',
      html_url: 'https://github.com/orgs/acme/teams/core',
    }

    it.effect('emits a teams.show envelope with the team detail', () =>
      Effect.gen(function* () {
        const env = yield* runCli(teamsCommand, ['show', 'core', '--org', 'acme'], {
          github: { routes: { 'GET /orgs/{org}/teams/{team_slug}': detailPayload } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('teams.show')
        expect(env.error).toBeNull()

        const detail = decodeDetail(env.result)
        expect(detail.slug).toBe('core')
        expect(detail.members_count).toBe(4)
        expect(detail.url).toBe('https://github.com/orgs/acme/teams/core')
        expect(env.next_actions).toContain('hubctl teams members <team> --org <org>')
      })
    )

    it.effect('surfaces an ok:false envelope with a fix when the team 404s', () =>
      Effect.gen(function* () {
        const env = yield* runCli(teamsCommand, ['show', 'missing', '--org', 'acme'], {
          github: { fail: { 'GET /orgs/{org}/teams/{team_slug}': 404 } },
        })

        expect(env.ok).toBe(false)
        expect(env.command).toBe('teams.show')
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

  describe('members', () => {
    it.effect('emits a teams.members envelope with shaped rows', () =>
      Effect.gen(function* () {
        const env = yield* runCli(teamsCommand, ['members', 'core', '--org', 'acme'], {
          github: { routes: { 'GET /orgs/{org}/teams/{team_slug}/members': [memberPayload] } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('teams.members')

        const rows = decodeMembers(env.result)
        expect(rows[0]?.login).toBe('octocat')
        expect(env.next_actions).toContain('hubctl teams add <team> <user> --org <org>')
      })
    )
  })

  describe('add', () => {
    it.effect('adds a user via the org-based membership endpoint with the role', () =>
      Effect.gen(function* () {
        const env = yield* runCli(teamsCommand, ['add', 'core', 'octocat', '--org', 'acme', '--role', 'maintainer'], {
          github: {
            routes: {
              'PUT /orgs/{org}/teams/{team_slug}/memberships/{username}': (params: Record<string, unknown>) =>
                params.org === 'acme' &&
                params.team_slug === 'core' &&
                params.username === 'octocat' &&
                params.role === 'maintainer'
                  ? { state: 'active', role: 'maintainer' }
                  : { state: 'WRONG', role: 'WRONG' },
            },
          },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('teams.add')
        expect(env.result).toMatchObject({ team: 'core', user: 'octocat', role: 'maintainer', state: 'active' })
      })
    )

    it.effect('defaults the role to member', () =>
      Effect.gen(function* () {
        const env = yield* runCli(teamsCommand, ['add', 'core', 'octocat', '--org', 'acme'], {
          github: {
            routes: {
              'PUT /orgs/{org}/teams/{team_slug}/memberships/{username}': (params: Record<string, unknown>) =>
                params.role === 'member' ? { state: 'active', role: 'member' } : { state: 'WRONG', role: 'WRONG' },
            },
          },
        })

        expect(env.ok).toBe(true)
        expect(env.result).toMatchObject({ role: 'member' })
      })
    )
  })

  describe('remove', () => {
    it.effect('in json mode without --yes fails with a re-run fix and does NOT call the API', () =>
      Effect.gen(function* () {
        const env = yield* runCli(teamsCommand, ['remove', 'core', 'octocat', '--org', 'acme'], {
          // No DELETE route registered: if the handler hit the API it would die on
          // the missing fixture, so reaching an ok:false envelope proves it gated.
          github: {},
        })

        expect(env.ok).toBe(false)
        expect(env.command).toBe('teams.remove')
        expect(env.result).toBeNull()
        expect(env.fix).toContain('--yes')
      })
    )

    it.effect('in json mode with --yes removes the user', () =>
      Effect.gen(function* () {
        const env = yield* runCli(teamsCommand, ['remove', 'core', 'octocat', '--org', 'acme', '--yes'], {
          github: { routes: { 'DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}': {} } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('teams.remove')
        expect(env.result).toMatchObject({ team: 'core', user: 'octocat', removed: true })
      })
    )
  })
})
