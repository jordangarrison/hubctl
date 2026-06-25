import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { billingPayload, enterpriseCommand } from '../../src/cli/enterprise'
import type { BillingResult } from '../../src/services/enterprise'
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
      expect(names).toContain('show')
      expect(names).toContain('orgs')
    })
  )

  describe('show', () => {
    it.effect('emits the enterprise detail resolved via the org endpoint', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['show', 'acme'], {
          github: {
            routes: {
              'GET /orgs/{org}': {
                login: 'acme',
                name: 'Acme Inc',
                description: 'The Acme enterprise',
                plan: { name: 'enterprise' },
                created_at: '2020-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            },
          },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.show')
        expect(env.result).toMatchObject({ login: 'acme', name: 'Acme Inc', plan: 'enterprise' })
      })
    )

    it.effect('fails when the org is not an enterprise account', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['show', 'acme'], {
          github: {
            routes: {
              'GET /orgs/{org}': {
                login: 'acme',
                name: 'Acme Inc',
                description: null,
                plan: { name: 'free' },
                created_at: '2020-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            },
          },
        })
        expect(env.ok).toBe(false)
        expect(env.command).toBe('enterprise.show')
      })
    )
  })

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

  describe('billing payload shaping (mode branch)', () => {
    const summary: BillingResult = {
      kind: 'summary',
      enterprise: 'acme',
      total_cost: 16,
      actions: {
        total_minutes: 1500,
        total_cost: 16,
        runner_breakdown: {
          'Actions Linux': { minutes: 1000, cost: 8, percentage: 66.7 },
          'Actions Windows': { minutes: 500, cost: 8, percentage: 33.3 },
        },
      },
    }

    it('json mode keeps the structured summary', () => {
      expect(billingPayload('json', summary)).toBe(summary)
    })

    it('pretty mode flattens into category/metric/value rows', () => {
      const rows = billingPayload('pretty', summary)
      expect(rows).toContainEqual({ category: 'Enterprise', metric: 'Total Cost', value: '$16.0' })
      expect(rows).toContainEqual({
        category: 'Actions - Actions Linux',
        metric: 'Minutes (Share)',
        value: '1000 (66.7%)',
      })
    })

    it('json mode keeps the empty marker', () => {
      const empty: BillingResult = { kind: 'empty', enterprise: 'acme' }
      expect(billingPayload('json', empty)).toEqual({ kind: 'empty', enterprise: 'acme' })
    })

    it('pretty mode renders the empty-usage message', () => {
      const empty: BillingResult = { kind: 'empty', enterprise: 'acme' }
      expect(billingPayload('pretty', empty)).toEqual({
        message: 'No billing usage data found for enterprise acme',
      })
    })
  })

  describe('licenses', () => {
    it.effect('emits the raw consumed-licenses payload', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['licenses', 'acme'], {
          github: {
            routes: { 'GET /enterprises/{enterprise}/consumed-licenses': { total_seats_consumed: 5 } },
          },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.licenses')
        expect(env.result).toMatchObject({ total_seats_consumed: 5 })
      })
    )
  })

  describe('audit-log', () => {
    const auditRoute = 'GET /enterprises/{enterprise}/audit-log'
    const entries = [
      {
        '@timestamp': 1_700_000_000_000,
        action: 'repo.create',
        actor: 'alice',
        user: 'bob',
        repo: 'acme/widgets',
        org: 'acme',
        created_at: 1_700_000_000_000,
        _document_id: 'abc123',
      },
    ]

    // audit-log streams NDJSON: one `{type:'audit-entry', ...}` line per entry,
    // then a terminal envelope whose `result` is the array of those tagged
    // events (so a non-streaming consumer parses the final line). `runCli`
    // returns the parsed terminal (last) line.
    it.effect('emits shaped audit entries as the terminal envelope result', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['audit-log', 'acme'], {
          github: { routes: { [auditRoute]: entries } },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.audit-log')
        expect(env.result).toMatchObject([{ type: 'audit-entry', action: 'repo.create', actor: 'alice' }])
      })
    )

    it.effect('forwards --order/--phrase/--after/--before', () =>
      Effect.gen(function* () {
        const env = yield* runCli(
          enterpriseCommand,
          ['audit-log', 'acme', '--order', 'asc', '--phrase', 'action:repo.create', '--after', 'a', '--before', 'b'],
          {
            github: {
              routes: {
                [auditRoute]: (params: Record<string, unknown>) =>
                  params.order === 'asc' &&
                  params.phrase === 'action:repo.create' &&
                  params.after === 'a' &&
                  params.before === 'b'
                    ? entries
                    : [{ ...entries[0], action: 'WRONG' }],
              },
            },
          }
        )
        expect(env.ok).toBe(true)
        expect(env.result).toMatchObject([{ type: 'audit-entry', action: 'repo.create' }])
      })
    )
  })

  describe('sso', () => {
    const auth = {
      login: 'alice',
      saml_identity: { username: 'alice@acme.test', name_id: 'alice@acme.test' },
      last_used: '2024-01-01T00:00:00Z',
      credential_authorized_at: '2023-01-01T00:00:00Z',
      credential_expires_at: '2025-01-01T00:00:00Z',
      organization_count: 3,
    }

    it.effect('list emits shaped rows', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['sso', 'list', 'acme'], {
          github: { routes: { 'GET /enterprises/{enterprise}/sso/authorizations': [auth] } },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.sso.list')
        expect(env.result).toMatchObject([{ login: 'alice', saml_identity: 'alice@acme.test' }])
      })
    )

    it.effect('show emits the detail', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['sso', 'show', 'acme', 'alice'], {
          github: { routes: { 'GET /enterprises/{enterprise}/sso/authorizations/{login}': auth } },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.sso.show')
        expect(env.result).toMatchObject({ login: 'alice', organization_count: 3 })
      })
    )

    it.effect('remove in json mode without --yes gates with a re-run fix', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['sso', 'remove', 'acme', 'alice'], { github: {} })
        expect(env.ok).toBe(false)
        expect(env.command).toBe('enterprise.sso.remove')
        expect(env.fix).toContain('--yes')
      })
    )

    it.effect('remove with --yes removes the authorization', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['sso', 'remove', 'acme', 'alice', '--yes'], {
          github: { routes: { 'DELETE /enterprises/{enterprise}/sso/authorizations/{login}': {} } },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.sso.remove')
        expect(env.result).toMatchObject({ login: 'alice', removed: true })
      })
    )
  })

  describe('stats', () => {
    it.effect('emits the labeled stats report sections', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['stats', 'acme'], {
          github: {
            routes: {
              'GET /enterprises/{enterprise}/stats/all': {
                repos: { total_repos: 100, root_repos: 80, fork_repos: 20, org_repos: 60 },
                pulls: { total_pulls: 200, merged_pulls: 150, mergeable_pulls: 30, unmergeable_pulls: 20 },
              },
            },
          },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.stats')
        expect(env.result).toMatchObject({
          repos: { total_repos: 100, root_repos: 80, fork_repos: 20, org_repos: 60 },
          pull_requests: { total_pulls: 200, merged_pulls: 150, mergeable_pulls: 30, unmergeable_pulls: 20 },
        })
      })
    )
  })

  describe('security-analysis', () => {
    it.effect('get emits the current settings', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['security-analysis', 'get', 'acme'], {
          github: {
            routes: {
              'GET /enterprises/{enterprise}/code_security_analysis': {
                dependency_graph_enabled_for_new_repositories: true,
              },
            },
          },
        })
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.security-analysis.get')
        expect(env.result).toMatchObject({ dependency_graph_enabled_for_new_repositories: true })
      })
    )

    it.effect('update in json mode without --yes gates with a re-run fix', () =>
      Effect.gen(function* () {
        const env = yield* runCli(enterpriseCommand, ['security-analysis', 'update', 'acme', '--dependency-graph'], {
          github: {},
        })
        expect(env.ok).toBe(false)
        expect(env.command).toBe('enterprise.security-analysis.update')
        expect(env.fix).toContain('--yes')
      })
    )

    it.effect('update with --yes PATCHes the supplied flags', () => {
      const captured: { params?: Record<string, unknown> } = {}
      return Effect.gen(function* () {
        const env = yield* runCli(
          enterpriseCommand,
          ['security-analysis', 'update', 'acme', '--dependency-graph', '--secret-scanning', '--yes'],
          {
            github: {
              routes: {
                'PATCH /enterprises/{enterprise}/code_security_analysis': (params: Record<string, unknown>) => {
                  captured.params = params
                  return {}
                },
              },
            },
          }
        )
        expect(env.ok).toBe(true)
        expect(env.command).toBe('enterprise.security-analysis.update')
        expect(env.result).toMatchObject({ updated: true })
        expect(captured.params?.dependency_graph_enabled_for_new_repositories).toBe(true)
        expect(captured.params?.secret_scanning_enabled_for_new_repositories).toBe(true)
      })
    })
  })
})
