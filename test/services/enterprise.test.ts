import { assert, describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'

import { NotFoundError, ValidationError } from '../../src/github/errors'
import { DecodeError } from '../../src/schema/decode'
import { Enterprise } from '../../src/services/enterprise'
import { FakeGithub } from '../helpers/fake-github'
import type { FakeGithubConfig } from '../helpers/fake-github'

// Domain-service tests for the non-billing enterprise surface (Task 7.2).
// Mirrors lib/hubctl/enterprise.rb + github_client.rb. Over FakeGithub canned
// routes the service shapes each Enterprise-Cloud payload to mirror the Ruby
// data, and surfaces typed GithubErrors in the `E` channel.

const enterprise = 'acme'

const withRoutes = (config: FakeGithubConfig) => Enterprise.layer.pipe(Layer.provide(FakeGithub.layer(config)))

describe('Enterprise service', () => {
  describe('organizations', () => {
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

    it.effect('lists enterprise organizations via paginate, shaping each row', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.organizations(enterprise, {})
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          login: 'acme-eng',
          id: 7,
          description: 'Engineering',
          public_repos: 12,
          private_repos: 30,
          plan: 'enterprise',
          billing_email: 'eng@acme.test',
          members_count: 50,
          teams_count: 6,
          created_at: '2020-01-01T00:00:00Z',
          url: 'https://github.com/acme-eng',
        })
      }).pipe(Effect.provide(withRoutes({ routes: { 'GET /enterprises/{enterprise}/organizations': [orgPayload] } })))
    )

    it.effect('defaults missing description/plan/billing_email/counts', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.organizations(enterprise, {})
        expect(result[0]?.description).toBe('-')
        expect(result[0]?.plan).toBe('unknown')
        expect(result[0]?.billing_email).toBe('-')
        expect(result[0]?.members_count).toBe(0)
        expect(result[0]?.teams_count).toBe(0)
      }).pipe(
        Effect.provide(
          withRoutes({
            routes: {
              'GET /enterprises/{enterprise}/organizations': [
                {
                  login: 'bare',
                  id: 1,
                  description: null,
                  public_repos: 0,
                  private_repos: 0,
                  created_at: '2020-01-01T00:00:00Z',
                  html_url: 'https://github.com/bare',
                },
              ],
            },
          })
        )
      )
    )

    it.effect('creates an organization via POST with the login and options', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.createOrganization(enterprise, 'newco', {
          displayName: 'New Co',
          description: 'desc',
          billingEmail: 'b@acme.test',
        })
        expect(result).toEqual({ id: 99, login: 'newco', url: 'https://github.com/newco' })
      }).pipe(
        Effect.provide(
          withRoutes({
            routes: {
              'POST /enterprises/{enterprise}/organizations': (params: Record<string, unknown>) =>
                params.login === 'newco' &&
                params.display_name === 'New Co' &&
                params.description === 'desc' &&
                params.billing_email === 'b@acme.test'
                  ? { id: 99, login: 'newco', html_url: 'https://github.com/newco' }
                  : { id: 0, login: 'WRONG', html_url: '' },
            },
          })
        )
      )
    )

    it.effect('transfers an organization into the enterprise', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.transferOrganization(enterprise, 'movingco')
        expect(result).toEqual({ enterprise, organization: 'movingco', transferred: true })
      }).pipe(
        Effect.provide(
          withRoutes({
            routes: {
              'POST /enterprises/{enterprise}/organizations': (params: Record<string, unknown>) =>
                params.organization === 'movingco' ? { ok: true } : { ok: false },
            },
          })
        )
      )
    )

    it.effect('removes an organization from the enterprise', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.removeOrganization(enterprise, 'oldco')
        expect(result).toEqual({ enterprise, organization: 'oldco', removed: true })
      }).pipe(Effect.provide(withRoutes({ routes: { 'DELETE /enterprises/{enterprise}/organizations/{org}': {} } })))
    )

    it.effect('surfaces NotFoundError when the enterprise 404s', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const exit = yield* Effect.exit(ent.organizations('missing', {}))
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(NotFoundError)
      }).pipe(Effect.provide(withRoutes({ fail: { 'GET /enterprises/{enterprise}/organizations': 404 } })))
    )
  })

  describe('members', () => {
    const consumedRoute = 'GET /enterprises/{enterprise}/consumed-licenses'
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

    it.effect('lists all members with shaped/transformed rows', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.members(enterprise, {})
        expect(result).toHaveLength(2)
        expect(result[0]).toEqual({
          login: 'alice',
          id: null,
          role: 'admin',
          email: 'alice@acme.test',
          two_factor_disabled: false,
          saml_identity: 'configured',
          avatar_url: null,
        })
        expect(result[1]).toEqual({
          login: 'bob',
          id: null,
          role: 'member',
          email: null,
          two_factor_disabled: true,
          saml_identity: 'none',
          avatar_url: null,
        })
      }).pipe(Effect.provide(withRoutes({ routes: { [consumedRoute]: { users } } })))
    )

    it.effect('filters by role=member (excludes owners)', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.members(enterprise, { role: 'member' })
        expect(result).toHaveLength(1)
        expect(result[0]?.login).toBe('bob')
      }).pipe(Effect.provide(withRoutes({ routes: { [consumedRoute]: { users } } })))
    )

    it.effect('filters by twoFaDisabled (excludes 2FA-enabled users)', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.members(enterprise, { twoFaDisabled: true })
        expect(result).toHaveLength(1)
        expect(result[0]?.login).toBe('bob')
      }).pipe(Effect.provide(withRoutes({ routes: { [consumedRoute]: { users } } })))
    )
  })

  describe('owners', () => {
    const consumedRoute = 'GET /enterprises/{enterprise}/consumed-licenses'
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

    it.effect('lists only owners', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.owners(enterprise)
        expect(result).toHaveLength(1)
        expect(result[0]?.login).toBe('alice')
        expect(result[0]?.role).toBe('admin')
      }).pipe(Effect.provide(withRoutes({ routes: { [consumedRoute]: { users } } })))
    )

    it.effect('adds an owner via PUT', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.addOwner(enterprise, 'carol')
        expect(result).toEqual({ enterprise, username: 'carol', added: true })
      }).pipe(Effect.provide(withRoutes({ routes: { 'PUT /enterprises/{enterprise}/owners/{username}': {} } })))
    )

    it.effect('removes an owner via DELETE', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.removeOwner(enterprise, 'carol')
        expect(result).toEqual({ enterprise, username: 'carol', removed: true })
      }).pipe(Effect.provide(withRoutes({ routes: { 'DELETE /enterprises/{enterprise}/owners/{username}': {} } })))
    )
  })

  describe('packages & shared-storage billing', () => {
    it.effect('returns the raw packages billing payload', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.packagesBilling(enterprise)
        expect(result).toEqual({ total_gigabytes_bandwidth_used: 10, total_paid_gigabytes_bandwidth_used: 2 })
      }).pipe(
        Effect.provide(
          withRoutes({
            routes: {
              'GET /enterprises/{enterprise}/billing/packages': {
                total_gigabytes_bandwidth_used: 10,
                total_paid_gigabytes_bandwidth_used: 2,
              },
            },
          })
        )
      )
    )

    it.effect('returns the raw shared-storage billing payload', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.sharedStorageBilling(enterprise)
        expect(result).toEqual({ days_left_in_billing_cycle: 20, estimated_paid_storage_for_month: 5 })
      }).pipe(
        Effect.provide(
          withRoutes({
            routes: {
              'GET /enterprises/{enterprise}/billing/shared-storage': {
                days_left_in_billing_cycle: 20,
                estimated_paid_storage_for_month: 5,
              },
            },
          })
        )
      )
    )
  })

  describe('consumedLicenses', () => {
    it.effect('returns the raw consumed-licenses payload', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.consumedLicenses(enterprise)
        expect(result).toEqual({
          total_seats_consumed: 5,
          total_seats_purchased: 10,
          users: [{ github_com_login: 'alice' }],
        })
      }).pipe(
        Effect.provide(
          withRoutes({
            routes: {
              'GET /enterprises/{enterprise}/consumed-licenses': {
                total_seats_consumed: 5,
                total_seats_purchased: 10,
                users: [{ github_com_login: 'alice' }],
              },
            },
          })
        )
      )
    )
  })

  describe('auditLog', () => {
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

    it.effect('returns shaped paged audit entries', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.auditLog(enterprise, { order: 'desc' })
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          timestamp: 1_700_000_000_000,
          action: 'repo.create',
          actor: 'alice',
          user: 'bob',
          repo: 'acme/widgets',
          org: 'acme',
          created_at: 1_700_000_000_000,
          document_id: 'abc123',
        })
      }).pipe(Effect.provide(withRoutes({ routes: { [auditRoute]: entries } })))
    )

    it.effect('forwards order/phrase/after/before query params', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.auditLog(enterprise, {
          order: 'asc',
          phrase: 'action:repo.create',
          after: 'tok-after',
          before: 'tok-before',
        })
        expect(result[0]?.action).toBe('repo.create')
      }).pipe(
        Effect.provide(
          withRoutes({
            routes: {
              [auditRoute]: (params: Record<string, unknown>) =>
                params.order === 'asc' &&
                params.phrase === 'action:repo.create' &&
                params.after === 'tok-after' &&
                params.before === 'tok-before'
                  ? entries
                  : [{ ...entries[0], action: 'WRONG' }],
            },
          })
        )
      )
    )
  })

  describe('saml sso', () => {
    const auth = {
      login: 'alice',
      saml_identity: { username: 'alice@acme.test', name_id: 'alice@acme.test' },
      last_used: '2024-01-01T00:00:00Z',
      credential_authorized_at: '2023-01-01T00:00:00Z',
      credential_expires_at: '2025-01-01T00:00:00Z',
      organization_count: 3,
    }

    it.effect('lists sso authorizations with shaped rows', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.listSsoAuthorizations(enterprise)
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          login: 'alice',
          saml_identity: 'alice@acme.test',
          name_id: 'alice@acme.test',
          last_used: '2024-01-01T00:00:00Z',
          credential_authorized_at: '2023-01-01T00:00:00Z',
          credential_expires_at: '2025-01-01T00:00:00Z',
        })
      }).pipe(Effect.provide(withRoutes({ routes: { 'GET /enterprises/{enterprise}/sso/authorizations': [auth] } })))
    )

    it.effect('shows one sso authorization with organization_count', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.showSsoAuthorization(enterprise, 'alice')
        expect(result).toEqual({
          login: 'alice',
          saml_identity_username: 'alice@acme.test',
          saml_identity_name_id: 'alice@acme.test',
          last_used: '2024-01-01T00:00:00Z',
          credential_authorized_at: '2023-01-01T00:00:00Z',
          credential_expires_at: '2025-01-01T00:00:00Z',
          organization_count: 3,
        })
      }).pipe(
        Effect.provide(withRoutes({ routes: { 'GET /enterprises/{enterprise}/sso/authorizations/{login}': auth } }))
      )
    )

    it.effect('removes one sso authorization', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.removeSsoAuthorization(enterprise, 'alice')
        expect(result).toEqual({ enterprise, login: 'alice', removed: true })
      }).pipe(
        Effect.provide(withRoutes({ routes: { 'DELETE /enterprises/{enterprise}/sso/authorizations/{login}': {} } }))
      )
    )
  })

  describe('stats', () => {
    // Mirrors lib/hubctl/enterprise.rb#stats: the Ruby reads a fixed set of
    // labeled fields per section and only emits sections present in the payload.
    // The service shapes the raw `/stats/all` payload into that same labeled
    // report (present sections only, picking the Ruby's field set).
    it.effect('shapes the stats payload into the labeled report sections', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.stats(enterprise)
        expect(result).toEqual({
          repos: { total_repos: 100, root_repos: 80, fork_repos: 20, org_repos: 60 },
          hooks: { total_hooks: 5, active_hooks: 4, inactive_hooks: 1 },
          pages: { total_pages: 3 },
          orgs: { total_orgs: 10, disabled_orgs: 1, total_teams: 25, total_team_members: 300 },
          users: { total_users: 50, admin_users: 5, suspended_users: 2 },
          pull_requests: { total_pulls: 200, merged_pulls: 150, mergeable_pulls: 30, unmergeable_pulls: 20 },
          issues: { total_issues: 400, open_issues: 100, closed_issues: 300 },
          milestones: { total_milestones: 15, open_milestones: 5, closed_milestones: 10 },
          gists: { total_gists: 40, private_gists: 12, public_gists: 28 },
        })
      }).pipe(
        Effect.provide(
          withRoutes({
            routes: {
              'GET /enterprises/{enterprise}/stats/all': {
                repos: { total_repos: 100, root_repos: 80, fork_repos: 20, org_repos: 60 },
                hooks: { total_hooks: 5, active_hooks: 4, inactive_hooks: 1 },
                pages: { total_pages: 3 },
                orgs: { total_orgs: 10, disabled_orgs: 1, total_teams: 25, total_team_members: 300 },
                users: { total_users: 50, admin_users: 5, suspended_users: 2 },
                pulls: { total_pulls: 200, merged_pulls: 150, mergeable_pulls: 30, unmergeable_pulls: 20 },
                issues: { total_issues: 400, open_issues: 100, closed_issues: 300 },
                milestones: { total_milestones: 15, open_milestones: 5, closed_milestones: 10 },
                gists: { total_gists: 40, private_gists: 12, public_gists: 28 },
              },
            },
          })
        )
      )
    )

    it.effect('omits sections absent from the payload', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.stats(enterprise)
        expect(result).toEqual({
          repos: { total_repos: 100, root_repos: 80, fork_repos: 20, org_repos: 60 },
          users: { total_users: 50, admin_users: 5, suspended_users: 2 },
        })
      }).pipe(
        Effect.provide(
          withRoutes({
            routes: {
              'GET /enterprises/{enterprise}/stats/all': {
                repos: { total_repos: 100, root_repos: 80, fork_repos: 20, org_repos: 60 },
                users: { total_users: 50, admin_users: 5, suspended_users: 2 },
              },
            },
          })
        )
      )
    )
  })

  describe('show', () => {
    // Mirrors lib/hubctl/github_client.rb#enterprise + lib/hubctl/enterprise.rb#show:
    // Enterprise Cloud has no /enterprises/{enterprise} detail endpoint, so the
    // Ruby resolves the enterprise via GET /orgs/{org}, requires plan.name ==
    // 'enterprise', and surfaces the populated subset.
    it.effect('resolves the enterprise via the org endpoint and shapes the detail', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.show(enterprise)
        expect(result).toEqual({
          login: 'acme',
          name: 'Acme Inc',
          description: 'The Acme enterprise',
          plan: 'enterprise',
          created_at: '2020-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        })
      }).pipe(
        Effect.provide(
          withRoutes({
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
          })
        )
      )
    )

    it.effect('a mismatched org detail payload fails as a DecodeError, not a thrown defect', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const exit = yield* Effect.exit(ent.show(enterprise))
        expect(Exit.isFailure(exit)).toBe(true)
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        assert(error instanceof DecodeError)
        expect(error.code).toBe('decode_error')
      }).pipe(
        Effect.provide(
          withRoutes({
            routes: {
              // `login` is a required non-null string; null breaks the schema so
              // the decode must surface a typed DecodeError, not a thrown defect.
              'GET /orgs/{org}': {
                login: null,
                name: 'Acme Inc',
                description: 'The Acme enterprise',
                plan: { name: 'enterprise' },
                created_at: '2020-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            },
          })
        )
      )
    )

    it.effect('fails with a ValidationError when the org is not an enterprise account', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const exit = yield* Effect.exit(ent.show(enterprise))
        expect(Exit.isFailure(exit)).toBe(true)
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(ValidationError)
      }).pipe(
        Effect.provide(
          withRoutes({
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
          })
        )
      )
    )
  })

  describe('security analysis', () => {
    const settingsRoute = 'GET /enterprises/{enterprise}/code_security_analysis'
    const updateRoute = 'PATCH /enterprises/{enterprise}/code_security_analysis'

    it.effect('gets the current security analysis settings', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.securityAnalysis(enterprise)
        expect(result).toEqual({
          dependency_graph_enabled_for_new_repositories: true,
          secret_scanning_enabled_for_new_repositories: false,
          secret_scanning_push_protection_enabled_for_new_repositories: false,
        })
      }).pipe(
        Effect.provide(
          withRoutes({
            routes: {
              [settingsRoute]: {
                dependency_graph_enabled_for_new_repositories: true,
                secret_scanning_enabled_for_new_repositories: false,
                secret_scanning_push_protection_enabled_for_new_repositories: false,
              },
            },
          })
        )
      )
    )

    it.effect('updates security analysis settings via PATCH and forwards the supplied flags', () => {
      const captured: { params?: Record<string, unknown> } = {}
      return Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.updateSecurityAnalysis(enterprise, {
          dependencyGraphEnabled: true,
          secretScanningEnabled: true,
        })
        expect(result).toEqual({ enterprise, updated: true })
        expect(captured.params?.dependency_graph_enabled_for_new_repositories).toBe(true)
        expect(captured.params?.secret_scanning_enabled_for_new_repositories).toBe(true)
      }).pipe(
        Effect.provide(
          withRoutes({
            routes: {
              [updateRoute]: (params: Record<string, unknown>) => {
                captured.params = params
                return {}
              },
            },
          })
        )
      )
    })
  })
})
