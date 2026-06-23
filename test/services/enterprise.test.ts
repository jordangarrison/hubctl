import { describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'

import { NotFoundError } from '../../src/github/errors'
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
})
