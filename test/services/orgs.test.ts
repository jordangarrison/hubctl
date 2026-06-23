import { describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'

import { NotFoundError } from '../../src/github/errors'
import { Orgs } from '../../src/services/orgs'
import { FakeGithub } from '../helpers/fake-github'

// Orgs depends only on Github. Over FakeGithub canned routes the service shapes
// each payload to mirror the Ruby `Hubctl::Orgs` data, and surfaces typed
// GithubErrors in the `E` channel.

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

describe('Orgs service', () => {
  describe('list', () => {
    it.effect('lists the authenticated user orgs via GET /user/orgs', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.list
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          login: 'acme',
          id: 42,
          description: 'Acme Corp',
          public_repos: 10,
          public_gists: 2,
          followers: 100,
          following: 5,
          url: 'https://github.com/acme',
        })
      }).pipe(
        Effect.provide(Orgs.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { 'GET /user/orgs': [orgSummary] } }))))
      )
    )

    it.effect('defaults a missing description to "-"', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.list
        expect(result[0]?.description).toBe('-')
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(
            Layer.provide(FakeGithub.layer({ routes: { 'GET /user/orgs': [{ ...orgSummary, description: null }] } }))
          )
        )
      )
    )
  })

  describe('show', () => {
    const showLayer = Orgs.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { 'GET /orgs/{org}': orgDetail } })))

    it.effect('returns the full organization detail shape', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const detail = yield* orgs.show('acme')
        expect(detail).toEqual({
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
          plan: 'enterprise',
          private_gists: 1,
          total_private_repos: 7,
          owned_private_repos: 6,
          disk_usage: '2048 KB',
          created_at: '2020-01-01T00:00:00Z',
          updated_at: '2021-01-01T00:00:00Z',
          url: 'https://github.com/acme',
        })
      }).pipe(Effect.provide(showLayer))
    )

    it.effect('passes the org to the route params', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const detail = yield* orgs.show('acme')
        expect(detail.login).toBe('acme')
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /orgs/{org}': (params: Record<string, unknown>) =>
                    params.org === 'acme' ? orgDetail : { ...orgDetail, login: 'WRONG' },
                },
              })
            )
          )
        )
      )
    )

    it.effect('surfaces NotFoundError on a 404', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const exit = yield* Effect.exit(orgs.show('missing'))
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(NotFoundError)
      }).pipe(Effect.provide(Orgs.layer.pipe(Layer.provide(FakeGithub.layer({ fail: { 'GET /orgs/{org}': 404 } })))))
    )
  })
})
