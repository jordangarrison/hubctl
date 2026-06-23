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

  describe('members', () => {
    const users = [
      {
        github_com_login: 'alice',
        github_com_enterprise_roles: ['Owner'],
        github_com_verified_domain_emails: ['alice@acme.test'],
        github_com_two_factor_auth: true,
        github_com_saml_name_id: 'alice@acme.test',
      },
      {
        github_com_login: 'bob',
        github_com_enterprise_roles: ['Member'],
        github_com_verified_domain_emails: [],
        github_com_two_factor_auth: false,
        github_com_saml_name_id: null,
      },
    ]
    const consumedRoutes = { routes: { 'GET /enterprises/{enterprise}/consumed-licenses': { users } } }

    it.effect('lists all members', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['members', 'acme'], { github: consumedRoutes })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.members')
        expect(env.result).toMatchObject([
          { login: 'alice', role: 'admin' },
          { login: 'bob', role: 'member' },
        ])
      })
    )

    it.effect('filters by --role member', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['members', 'acme', '--role', 'member'], {
          github: consumedRoutes,
        })
        expect(env.ok).toBe(true)
        expect(env.result).toMatchObject([{ login: 'bob' }])
      })
    )

    it.effect('filters by --2fa-disabled', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['members', 'acme', '--2fa-disabled'], { github: consumedRoutes })
        expect(env.ok).toBe(true)
        expect(env.result).toMatchObject([{ login: 'bob' }])
      })
    )
  })

  describe('owners', () => {
    const users = [
      {
        github_com_login: 'alice',
        github_com_enterprise_roles: ['Owner'],
        github_com_verified_domain_emails: ['alice@acme.test'],
        github_com_two_factor_auth: true,
        github_com_saml_name_id: 'alice@acme.test',
      },
      {
        github_com_login: 'bob',
        github_com_enterprise_roles: ['Member'],
        github_com_verified_domain_emails: [],
        github_com_two_factor_auth: false,
        github_com_saml_name_id: null,
      },
    ]

    it.effect('list returns only owners', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['owners', 'list', 'acme'], {
          github: { routes: { 'GET /enterprises/{enterprise}/consumed-licenses': { users } } },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.owners.list')
        expect(env.result).toMatchObject([{ login: 'alice' }])
      })
    )

    it.effect('add in json mode without --yes gates with a re-run fix', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['owners', 'add', 'acme', 'carol'], { github: {} })
        expect(env.ok).toBe(false)
        expect(env.command).toBe('enterprise.owners.add')
        expect(env.fix).toContain('--yes')
      })
    )

    it.effect('add with --yes adds the owner', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['owners', 'add', 'acme', 'carol', '--yes'], {
          github: { routes: { 'PUT /enterprises/{enterprise}/owners/{username}': {} } },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.owners.add')
        expect(env.result).toMatchObject({ username: 'carol', added: true })
      })
    )

    it.effect('remove with --yes removes the owner', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['owners', 'remove', 'acme', 'carol', '--yes'], {
          github: { routes: { 'DELETE /enterprises/{enterprise}/owners/{username}': {} } },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.owners.remove')
        expect(env.result).toMatchObject({ username: 'carol', removed: true })
      })
    )
  })

  describe('billing', () => {
    const usagePayload = {
      usageItems: [{ product: 'actions', sku: 'Actions Linux', unitType: 'Minutes', quantity: 1000, netAmount: 8 }],
    }

    it.effect('usage emits the structured summary', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['billing', 'usage', 'acme'], {
          github: { routes: { 'GET /enterprises/{enterprise}/settings/billing/usage': usagePayload } },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.billing.usage')
        expect(env.result).toMatchObject({ enterprise: 'acme', total_cost: 8 })
      })
    )

    it.effect('actions emits the structured summary', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['billing', 'actions', 'acme'], {
          github: { routes: { 'GET /enterprises/{enterprise}/settings/billing/usage': usagePayload } },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.billing.actions')
        expect(env.result).toMatchObject({ enterprise: 'acme' })
      })
    )

    it.effect('packages emits the raw payload', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['billing', 'packages', 'acme'], {
          github: {
            routes: { 'GET /enterprises/{enterprise}/billing/packages': { total_gigabytes_bandwidth_used: 10 } },
          },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.billing.packages')
        expect(env.result).toMatchObject({ total_gigabytes_bandwidth_used: 10 })
      })
    )

    it.effect('shared-storage emits the raw payload', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['billing', 'shared-storage', 'acme'], {
          github: {
            routes: { 'GET /enterprises/{enterprise}/billing/shared-storage': { days_left_in_billing_cycle: 20 } },
          },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.billing.shared-storage')
        expect(env.result).toMatchObject({ days_left_in_billing_cycle: 20 })
      })
    )
  })
})
