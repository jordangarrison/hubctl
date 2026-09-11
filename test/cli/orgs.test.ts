import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { orgsCommand } from '../../src/cli/orgs'
import { runCli } from '../helpers/run-cli'

// Command-level tests: drive the real `Command.runWith` over the network-free
// test layer (FakeGithub + captured stdout) and assert on the emitted envelope.

const orgSummary = {
  login: 'acme',
  id: 42,
  description: 'Acme Corp',
  public_repos: 10,
  public_gists: 2,
  followers: 100,
  following: 5,
  html_url: 'https://github.com/acme',
}

const orgDetail = {
  login: 'acme',
  id: 42,
  name: 'Acme Corporation',
  company: 'Acme',
  blog: 'https://acme.example',
  location: 'Springfield',
  email: 'hi@acme.example',
  bio: 'We make everything',
  description: 'Acme Corp',
  public_repos: 10,
  public_gists: 2,
  followers: 100,
  following: 5,
  collaborators: 3,
  billing_email: 'billing@acme.example',
  plan: { name: 'enterprise' },
  private_gists: 1,
  total_private_repos: 7,
  owned_private_repos: 6,
  disk_usage: 2048,
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2021-01-01T00:00:00Z',
  html_url: 'https://github.com/acme',
}

const memberPayload = {
  login: 'octocat',
  id: 1,
  type: 'User',
  site_admin: false,
  html_url: 'https://github.com/octocat',
}

const repoPayload = {
  name: 'widget',
  private: false,
  description: 'A widget',
  language: 'Ruby',
  stargazers_count: 12,
  forks_count: 3,
  updated_at: '2021-06-01T00:00:00Z',
}

const teamPayload = {
  name: 'Core',
  slug: 'core',
  description: 'Core team',
  privacy: 'closed',
  members_count: 8,
  repos_count: 4,
}

const currentUser = {
  login: 'octocat',
  name: 'The Octocat',
  plan: { name: 'pro' },
}

const OrgListItem = Schema.Struct({
  login: Schema.String,
  id: Schema.Finite,
  description: Schema.String,
  public_repos: Schema.Finite,
  public_gists: Schema.Finite,
  followers: Schema.Finite,
  following: Schema.Finite,
  url: Schema.String,
})
const decodeList = Schema.decodeUnknownSync(Schema.Array(OrgListItem))

const GroupTree = Schema.Struct({
  commands: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
})
const decodeGroup = Schema.decodeUnknownSync(GroupTree)

describe('orgs command', () => {
  it.effect('with no subcommand lists its subcommands', () =>
    Effect.gen(function* () {
      const env = yield* runCli(orgsCommand, [])
      expect(env.ok).toBe(true)
      expect(env.command).toBe('orgs')

      const tree = decodeGroup(env.result)
      const names = tree.commands.map((c) => c.name)
      expect(names).toContain('list')
      expect(names).toContain('show')
      expect(names).toContain('members')
      expect(names).toContain('repos')
      expect(names).toContain('teams')
      expect(names).toContain('info')
      // `orgs invite` is an org-scoped alias delegating to the same `Users.invite`
      // service; `remove` still lives only in `users`.
      expect(names).toContain('invite')
      expect(names).not.toContain('remove')
    })
  )

  describe('list', () => {
    it.effect('emits an orgs.list envelope with shaped rows and next_actions', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['list'], { github: { routes: { 'GET /user/orgs': [orgSummary] } } })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('orgs.list')
        expect(env.error).toBeNull()

        const rows = decodeList(env.result)
        expect(rows).toHaveLength(1)
        expect(rows[0]?.login).toBe('acme')
        expect(rows[0]?.public_repos).toBe(10)

        expect(env.next_actions).toContain('hubctl orgs show <org>')
      })
    )
  })

  describe('show', () => {
    it.effect('emits an orgs.show envelope with the detail shape', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['show', 'acme'], {
          github: { routes: { 'GET /orgs/{org}': orgDetail } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('orgs.show')
        expect(env.result).toMatchObject({ login: 'acme', plan: 'enterprise', disk_usage: '2048 KB' })
        expect(env.next_actions).toContain('hubctl orgs members <org>')
      })
    )

    it.effect('fails with NotFoundError when the org 404s', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['show', 'missing'], {
          github: { fail: { 'GET /orgs/{org}': 404 } },
        })

        expect(env.ok).toBe(false)
        expect(env.command).toBe('orgs.show')
        expect(env.error?.code).toBe('NotFoundError')
      })
    )
  })

  describe('members', () => {
    it.effect('emits an orgs.members envelope with shaped rows', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['members', 'acme'], {
          github: { routes: { 'GET /orgs/{org}/members': [memberPayload] } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('orgs.members')
        expect(env.result).toMatchObject([{ login: 'octocat', type: 'User', site_admin: false }])
      })
    )

    it.effect('--role admin forwards the role param', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['members', 'acme', '--role', 'admin'], {
          github: {
            routes: {
              'GET /orgs/{org}/members': (params: Record<string, unknown>) =>
                params.role === 'admin' ? [memberPayload] : [{ ...memberPayload, login: 'WRONG' }],
            },
          },
        })

        expect(env.ok).toBe(true)
        expect(env.result).toMatchObject([{ login: 'octocat' }])
      })
    )

    it.effect('--2fa-disabled forwards filter=2fa_disabled', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['members', 'acme', '--2fa-disabled'], {
          github: {
            routes: {
              'GET /orgs/{org}/members': (params: Record<string, unknown>) =>
                params.filter === '2fa_disabled' ? [memberPayload] : [{ ...memberPayload, login: 'WRONG' }],
            },
          },
        })

        expect(env.ok).toBe(true)
        expect(env.result).toMatchObject([{ login: 'octocat' }])
      })
    )
  })

  describe('repos', () => {
    it.effect('emits an orgs.repos envelope with shaped rows', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['repos', 'acme'], {
          github: { routes: { 'GET /orgs/{org}/repos': [repoPayload] } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('orgs.repos')
        expect(env.result).toMatchObject([{ name: 'widget', stars: 12, forks: 3 }])
      })
    )

    it.effect('--type private forwards the type param', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['repos', 'acme', '--type', 'private'], {
          github: {
            routes: {
              'GET /orgs/{org}/repos': (params: Record<string, unknown>) =>
                params.type === 'private' ? [repoPayload] : [{ ...repoPayload, name: 'WRONG' }],
            },
          },
        })

        expect(env.ok).toBe(true)
        expect(env.result).toMatchObject([{ name: 'widget' }])
      })
    )

    it.effect('default --type all omits the type param and uses sort=updated', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['repos', 'acme'], {
          github: {
            routes: {
              'GET /orgs/{org}/repos': (params: Record<string, unknown>) =>
                params.type === undefined && params.sort === 'updated'
                  ? [repoPayload]
                  : [{ ...repoPayload, name: 'WRONG' }],
            },
          },
        })

        expect(env.ok).toBe(true)
        expect(env.result).toMatchObject([{ name: 'widget' }])
      })
    )
  })

  describe('teams', () => {
    it.effect('emits an orgs.teams envelope with shaped rows', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['teams', 'acme'], {
          github: { routes: { 'GET /orgs/{org}/teams': [teamPayload] } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('orgs.teams')
        expect(env.result).toMatchObject([{ name: 'Core', slug: 'core', members_count: 8, repos_count: 4 }])
      })
    )
  })

  describe('info', () => {
    it.effect('emits an orgs.info envelope combining the user and memberships', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['info'], {
          github: { routes: { 'GET /user': currentUser, 'GET /user/orgs': [orgSummary] } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('orgs.info')
        expect(env.result).toMatchObject({
          login: 'octocat',
          name: 'The Octocat',
          plan: 'pro',
          organizations: [{ index: 1, login: 'acme', description: 'Acme Corp' }],
        })
      })
    )
  })

  // `orgs invite` delegates to the same `Users.invite` service as `users invite`;
  // these assert the org-scoped positional wiring and the delegation, not the
  // (already-tested) service internals.
  describe('invite', () => {
    it.effect('resolves a username to an invitee id and emits an orgs.invite envelope', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['invite', 'acme', 'octocat', '--team', '13703365'], {
          github: {
            routes: {
              'GET /users/{username}': (params: Record<string, unknown>) =>
                params.username === 'octocat' ? { id: 583_231 } : { id: 0 },
              // Return the good invitation only when the resolved invitee_id and
              // team_ids were forwarded; a sentinel id otherwise makes the assert
              // below fail without throwing inside the effect.
              'POST /orgs/{org}/invitations': (params: Record<string, unknown>) =>
                params.org === 'acme' &&
                params.invitee_id === 583_231 &&
                Array.isArray(params.team_ids) &&
                params.team_ids[0] === 13_703_365
                  ? { id: 77, role: 'direct_member', inviter: { login: 'admin-octo' } }
                  : { id: 0 },
            },
          },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('orgs.invite')
        expect(env.result).toMatchObject({ id: 77, invited: 'octocat', role: 'direct_member', inviter: 'admin-octo' })
        expect(env.next_actions).toContain('hubctl orgs members <org>')
      })
    )

    it.effect('invites by email without a user lookup', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['invite', 'acme', 'new@person.com'], {
          github: {
            routes: {
              'POST /orgs/{org}/invitations': (params: Record<string, unknown>) =>
                params.email === 'new@person.com' ? { id: 88, role: 'direct_member' } : { id: 0 },
            },
          },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('orgs.invite')
        expect(env.result).toMatchObject({ id: 88, invited: 'new@person.com' })
      })
    )
  })
})
