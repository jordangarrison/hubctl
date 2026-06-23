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
})
