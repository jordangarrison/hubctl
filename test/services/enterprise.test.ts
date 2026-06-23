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
})
