import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

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
})
