import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { usersCommand } from '../../src/cli/users'
import { runCli } from '../helpers/run-cli'

// Command-level tests: drive the real `Command.runWith` over the network-free
// test layer (FakeGithub + captured stdout) and assert on the emitted envelope.

const GroupTree = Schema.Struct({
  commands: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
})
const decodeGroup = Schema.decodeUnknownSync(GroupTree)

describe('users command', () => {
  it.effect('with no subcommand lists its subcommands', () =>
    Effect.gen(function* () {
      const env = yield* runCli(usersCommand, [])
      expect(env.ok).toBe(true)
      expect(env.command).toBe('users')

      const tree = decodeGroup(env.result)
      const names = tree.commands.map((c) => c.name)
      expect(names).toContain('show')
      expect(names).toContain('whoami')
    })
  )

  describe('show', () => {
    const userPayload = {
      login: 'octocat',
      name: 'The Octocat',
      email: 'octo@github.com',
      bio: 'A cat that codes',
      company: 'GitHub',
      location: 'San Francisco',
      blog: 'https://github.blog',
      public_repos: 8,
      public_gists: 2,
      followers: 100,
      following: 5,
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2021-01-01T00:00:00Z',
      html_url: 'https://github.com/octocat',
    }

    it.effect('emits a users.show envelope with the detail shape and next_actions', () =>
      Effect.gen(function* () {
        const env = yield* runCli(usersCommand, ['show', 'octocat'], {
          github: { routes: { 'GET /users/{username}': userPayload } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('users.show')
        expect(env.result).toMatchObject({ login: 'octocat', name: 'The Octocat', url: 'https://github.com/octocat' })
        expect(env.next_actions).toContain('hubctl users whoami')
      })
    )

    it.effect('fails with NotFoundError when the user 404s', () =>
      Effect.gen(function* () {
        const env = yield* runCli(usersCommand, ['show', 'ghost'], {
          github: { fail: { 'GET /users/{username}': 404 } },
        })

        expect(env.ok).toBe(false)
        expect(env.command).toBe('users.show')
        expect(env.error?.code).toBe('NotFoundError')
      })
    )
  })

  describe('whoami', () => {
    const currentUserPayload = {
      login: 'octocat',
      name: 'The Octocat',
      email: 'octo@github.com',
      company: 'GitHub',
      plan: { name: 'pro' },
      owned_private_repos: 3,
      collaborators: 4,
      disk_usage: 256,
    }

    it.effect('emits a users.whoami envelope with the current-user info', () =>
      Effect.gen(function* () {
        const env = yield* runCli(usersCommand, ['whoami'], {
          github: { routes: { 'GET /user': currentUserPayload } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('users.whoami')
        expect(env.result).toMatchObject({ login: 'octocat', plan: 'pro', private_repos: 3, disk_usage: '256 KB' })
      })
    )
  })

  describe('list', () => {
    const memberPayload = {
      login: 'octocat',
      id: 1,
      type: 'User',
      site_admin: false,
      html_url: 'https://github.com/octocat',
    }

    // `GET /orgs/{org}/members` route that echoes which org was passed in the
    // path params, so org-resolution tests can assert the resolved value.
    const memberFor = (org: string) => ({
      'GET /orgs/{org}/members': (params: Record<string, unknown>) =>
        params.org === org ? [memberPayload] : [{ ...memberPayload, login: 'WRONG' }],
    })

    const CONFIG_PATH = '/home/test-user/.config/hubctl/config.json'

    it.effect('emits a users.list envelope with shaped member rows', () =>
      Effect.gen(function* () {
        const env = yield* runCli(usersCommand, ['list', '--org', 'acme'], {
          github: { routes: { 'GET /orgs/{org}/members': [memberPayload] } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('users.list')
        expect(env.result).toMatchObject([{ login: 'octocat', id: 1, type: 'User', site_admin: false }])
      })
    )

    it.effect('explicit --org wins over GITHUB_ORG env and default_org config', () =>
      Effect.gen(function* () {
        const env = yield* runCli(usersCommand, ['list', '--org', 'flagorg'], {
          github: { routes: memberFor('flagorg') },
          config: { env: { GITHUB_ORG: 'envorg' }, files: { [CONFIG_PATH]: '{"default_org":"fileorg"}' } },
        })

        expect(env.ok).toBe(true)
        expect(env.result).toMatchObject([{ login: 'octocat' }])
      })
    )

    it.effect('falls back to GITHUB_ORG env when --org is omitted', () =>
      Effect.gen(function* () {
        const env = yield* runCli(usersCommand, ['list'], {
          github: { routes: memberFor('envorg') },
          config: { env: { GITHUB_ORG: 'envorg' }, files: { [CONFIG_PATH]: '{"default_org":"fileorg"}' } },
        })

        expect(env.ok).toBe(true)
        expect(env.result).toMatchObject([{ login: 'octocat' }])
      })
    )

    it.effect('falls back to default_org config when --org and env are absent', () =>
      Effect.gen(function* () {
        const env = yield* runCli(usersCommand, ['list'], {
          github: { routes: memberFor('fileorg') },
          config: { files: { [CONFIG_PATH]: '{"default_org":"fileorg"}' } },
        })

        expect(env.ok).toBe(true)
        expect(env.result).toMatchObject([{ login: 'octocat' }])
      })
    )

    it.effect('fails with a helpful envelope when org cannot be resolved', () =>
      Effect.gen(function* () {
        const env = yield* runCli(usersCommand, ['list'], { github: {}, config: {} })

        expect(env.ok).toBe(false)
        expect(env.command).toBe('users.list')
        expect(env.error?.code).toBe('ValidationError')
        expect(env.error?.message).toContain('Organization is required')
        expect(env.fix).toContain('--org')
        expect(env.fix).toContain('GITHUB_ORG')
        expect(env.fix).toContain('default_org')
      })
    )
  })

  describe('invite', () => {
    it.effect('invites by email and emits the invitation id', () =>
      Effect.gen(function* () {
        const env = yield* runCli(usersCommand, ['invite', 'new@person.com', '--org', 'acme'], {
          github: {
            routes: {
              'POST /orgs/{org}/invitations': (params: Record<string, unknown>) =>
                params.email === 'new@person.com'
                  ? { id: 99, role: 'direct_member', inviter: { login: 'admin-octo' } }
                  : { id: 0 },
            },
          },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('users.invite')
        expect(env.result).toMatchObject({
          id: 99,
          invited: 'new@person.com',
          role: 'direct_member',
          inviter: 'admin-octo',
        })
      })
    )
  })

  describe('remove', () => {
    it.effect('in json mode without --yes fails with a re-run fix and does NOT call the API', () =>
      Effect.gen(function* () {
        const env = yield* runCli(usersCommand, ['remove', 'octocat', '--org', 'acme'], {
          github: {},
        })

        expect(env.ok).toBe(false)
        expect(env.command).toBe('users.remove')
        expect(env.result).toBeNull()
        expect(env.fix).toContain('--yes')
      })
    )

    it.effect('in json mode with --yes removes the member', () =>
      Effect.gen(function* () {
        const env = yield* runCli(usersCommand, ['remove', 'octocat', '--org', 'acme', '--yes'], {
          github: { routes: { 'DELETE /orgs/{org}/members/{username}': {} } },
        })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('users.remove')
        expect(env.result).toMatchObject({ org: 'acme', user: 'octocat', removed: true })
      })
    )
  })
})
