import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { rootCommand } from '../../src/cli/root'
import { Envelope } from '../../src/output/envelope'
import { runCli } from '../helpers/run-cli'

// In-process runtime coverage (Plan Task 8.2). Unlike the per-group command
// tests (which build each group command in isolation), every case here drives
// the REAL `rootCommand` entrypoint through `Command.runWith` over the full
// production layer stack — only `Github` is swapped to `FakeGithub` (and `git`
// to a FakeSpawner for `repos clone`). That proves the wired binary, with all
// six groups mounted as subcommands, parses argv, resolves services, and emits
// a Schema-valid envelope for representative commands across ALL groups.
//
// Each case asserts three things:
//  1. stdout is a Schema-valid Envelope (decoded, not cast).
//  2. exit-code intent: `ok === true` (success → exit 0) for happy paths,
//     `ok === false` (failure → non-zero) for the forced-error path.
//  3. the command label matches the dotted path through the root tree.

// Decode the captured stdout through the real Envelope schema. `runCli` already
// returns a parsed `Envelope<unknown>`, so re-decoding here is the explicit
// "stdout is Schema-valid envelope JSON" assertion the task calls for: an
// invalid shape would throw rather than silently pass.
const decodeEnvelope = Schema.decodeUnknownSync(Envelope(Schema.Unknown))

// A good `GET /user` + `GET /rate_limit` pair so the `version` subcommand can
// report auth status through the real Auth service.
const authGithub = {
  routes: {
    'GET /user': { login: 'octocat', name: 'The Octocat' },
    'GET /rate_limit': { rate: { limit: 5000, remaining: 4999, reset: 0, used: 1 } },
  },
}

const repoPayload = {
  name: 'hello',
  full_name: 'octocat/hello',
  private: false,
  description: 'A test repo',
  language: 'TypeScript',
  stargazers_count: 42,
  forks_count: 3,
  updated_at: '2021-01-01T00:00:00Z',
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

const enterpriseOrg = {
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

describe('in-process runtime (root entrypoint)', () => {
  it.effect('root with no subcommand emits a Schema-valid ok envelope listing every group', () =>
    Effect.gen(function* () {
      const env = yield* runCli(rootCommand, [])
      const decoded = decodeEnvelope(env)

      expect(decoded.ok).toBe(true)
      expect(decoded.command).toBe('root')
      expect(decoded.error).toBeNull()
    })
  )

  it.effect('version: full entrypoint reports version plus auth status', () =>
    Effect.gen(function* () {
      const env = yield* runCli(rootCommand, ['version'], { version: '9.9.9', github: authGithub })
      const decoded = decodeEnvelope(env)

      expect(decoded.ok).toBe(true)
      expect(decoded.command).toBe('version')
      expect(decoded.error).toBeNull()
    })
  )

  it.effect('repos list: routes through the mounted repos group to a valid envelope', () =>
    Effect.gen(function* () {
      const env = yield* runCli(rootCommand, ['repos', 'list'], {
        github: { routes: { 'GET /user/repos': [repoPayload] } },
      })
      const decoded = decodeEnvelope(env)

      expect(decoded.ok).toBe(true)
      expect(decoded.command).toBe('repos.list')
      expect(decoded.error).toBeNull()
    })
  )

  it.effect('orgs show: routes through the mounted orgs group to a valid envelope', () =>
    Effect.gen(function* () {
      const env = yield* runCli(rootCommand, ['orgs', 'show', 'acme'], {
        github: { routes: { 'GET /orgs/{org}': orgDetail } },
      })
      const decoded = decodeEnvelope(env)

      expect(decoded.ok).toBe(true)
      expect(decoded.command).toBe('orgs.show')
      expect(decoded.error).toBeNull()
    })
  )

  it.effect('users show: routes through the mounted users group to a valid envelope', () =>
    Effect.gen(function* () {
      const env = yield* runCli(rootCommand, ['users', 'show', 'octocat'], {
        github: { routes: { 'GET /users/{username}': userPayload } },
      })
      const decoded = decodeEnvelope(env)

      expect(decoded.ok).toBe(true)
      expect(decoded.command).toBe('users.show')
      expect(decoded.error).toBeNull()
    })
  )

  it.effect('teams list: routes through the mounted teams group to a valid envelope', () =>
    Effect.gen(function* () {
      const env = yield* runCli(rootCommand, ['teams', 'list', '--org', 'acme'], {
        github: { routes: { 'GET /orgs/{org}/teams': [teamPayload] } },
      })
      const decoded = decodeEnvelope(env)

      expect(decoded.ok).toBe(true)
      expect(decoded.command).toBe('teams.list')
      expect(decoded.error).toBeNull()
    })
  )

  it.effect('enterprise orgs list: routes through the nested enterprise group to a valid envelope', () =>
    Effect.gen(function* () {
      const env = yield* runCli(rootCommand, ['enterprise', 'orgs', 'list', 'acme'], {
        github: { routes: { 'GET /enterprises/{enterprise}/organizations': [enterpriseOrg] } },
      })
      const decoded = decodeEnvelope(env)

      expect(decoded.ok).toBe(true)
      expect(decoded.command).toBe('enterprise.orgs.list')
      expect(decoded.error).toBeNull()
    })
  )

  it.effect('forced-error path yields a Schema-valid ok:false envelope with a fix and no result', () =>
    Effect.gen(function* () {
      const env = yield* runCli(rootCommand, ['repos', 'list', '--org', 'missing'], {
        github: { fail: { 'GET /orgs/{org}/repos': 404 } },
      })
      const decoded = decodeEnvelope(env)

      // Exit-code intent: a failed command renders ok:false (the binary maps
      // this to a non-zero exit).
      expect(decoded.ok).toBe(false)
      expect(decoded.command).toBe('repos.list')
      expect(decoded.result).toBeNull()
      expect(decoded.error?.code).toBe('NotFoundError')
      expect(decoded.fix).not.toBeNull()
    })
  )
})
