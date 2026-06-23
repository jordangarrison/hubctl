import { describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'

import { NotFoundError } from '../../src/github/errors'
import { Teams } from '../../src/services/teams'
import { FakeGithub } from '../helpers/fake-github'

// Teams depends only on Github. Over FakeGithub canned routes the service shapes
// each payload to mirror the Ruby `Hubctl::Teams` data, and surfaces typed
// GithubErrors in the `E` channel. `add` preserves the Ruby's newer org-based
// membership endpoint (PUT /orgs/{org}/teams/{team_slug}/memberships/{username}).

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

describe('Teams service', () => {
  describe('list', () => {
    it.effect('lists org teams via GET /orgs/{org}/teams', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const result = yield* teams.list('acme')
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          id: 7,
          name: 'Core',
          slug: 'core',
          description: 'Core maintainers',
          privacy: 'closed',
          permission: 'push',
          members_count: 4,
          repos_count: 12,
        })
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { 'GET /orgs/{org}/teams': [teamPayload] } })))
        )
      )
    )

    it.effect('defaults a missing description to "-"', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const result = yield* teams.list('acme')
        expect(result[0]?.description).toBe('-')
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(
              FakeGithub.layer({ routes: { 'GET /orgs/{org}/teams': [{ ...teamPayload, description: null }] } })
            )
          )
        )
      )
    )

    it.effect('surfaces NotFoundError when the org 404s', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const exit = yield* Effect.exit(teams.list('missing'))
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(NotFoundError)
      }).pipe(
        Effect.provide(Teams.layer.pipe(Layer.provide(FakeGithub.layer({ fail: { 'GET /orgs/{org}/teams': 404 } }))))
      )
    )
  })
})
