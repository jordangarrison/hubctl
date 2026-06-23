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
      expect(names).toContain('invite')
      expect(names).toContain('remove')
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

  describe('invite', () => {
    const invitation = { id: 7 }

    it.effect('invites by email and emits an orgs.invite envelope', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['invite', 'person@example.com', '--org', 'acme'], {
          github: {
            routes: {
              'POST /orgs/{org}/invitations': (params: Record<string, unknown>) =>
                params.email === 'person@example.com' ? invitation : { id: -1 },
            },
          },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('orgs.invite')
        expect(env.result).toMatchObject({ id: 7, invited: 'person@example.com' })
      })
    )

    it.effect('invites by username via the user-id lookup', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['invite', 'newbie', '--org', 'acme'], {
          github: {
            routes: {
              'GET /users/{username}': { id: 99 },
              'POST /orgs/{org}/invitations': (params: Record<string, unknown>) =>
                params.invitee_id === 99 ? invitation : { id: -1 },
            },
          },
        })

        expect(env.ok).toBe(true)
        expect(env.result).toMatchObject({ id: 7, invited: 'newbie' })
      })
    )
  })

  describe('remove', () => {
    it.effect('in json mode without --yes fails with a re-run fix and does NOT call the API', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['remove', 'octocat', '--org', 'acme'], {
          // No DELETE route registered: if the handler hit the API it would die on
          // the missing fixture, so reaching an ok:false envelope proves it gated.
          github: {},
        })

        expect(env.ok).toBe(false)
        expect(env.command).toBe('orgs.remove')
        expect(env.result).toBeNull()
        expect(env.fix).toContain('--yes')
      })
    )

    it.effect('in json mode with --yes removes the member', () =>
      Effect.gen(function* () {
        const env = yield* runCli(orgsCommand, ['remove', 'octocat', '--org', 'acme', '--yes'], {
          github: { routes: { 'DELETE /orgs/{org}/members/{username}': {} } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('orgs.remove')
        expect(env.result).toMatchObject({ org: 'acme', user: 'octocat', removed: true })
      })
    )
  })
})
