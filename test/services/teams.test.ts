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

const memberPayload = {
  login: 'octocat',
  id: 1,
  type: 'User',
  site_admin: false,
  html_url: 'https://github.com/octocat',
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

  describe('create', () => {
    const created = { id: 99, name: 'Squad', slug: 'squad', privacy: 'closed', permission: 'pull' }

    it.effect('creates a team via POST /orgs/{org}/teams and returns the summary', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const result = yield* teams.create('acme', 'Squad', { privacy: 'closed', permission: 'pull' })
        expect(result).toEqual({ id: 99, name: 'Squad', slug: 'squad', privacy: 'closed', permission: 'pull' })
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { 'POST /orgs/{org}/teams': created } })))
        )
      )
    )

    it.effect('forwards name, privacy and permission and an optional description', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const result = yield* teams.create('acme', 'Squad', {
          privacy: 'secret',
          permission: 'admin',
          description: 'a squad',
        })
        expect(result.slug).toBe('squad')
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'POST /orgs/{org}/teams': (params: Record<string, unknown>) =>
                    params.org === 'acme' &&
                    params.name === 'Squad' &&
                    params.privacy === 'secret' &&
                    params.permission === 'admin' &&
                    params.description === 'a squad'
                      ? created
                      : { ...created, slug: 'WRONG' },
                },
              })
            )
          )
        )
      )
    )
  })

  describe('members', () => {
    it.effect('lists team members via GET /orgs/{org}/teams/{team_slug}/members', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const result = yield* teams.members('acme', 'core')
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          login: 'octocat',
          id: 1,
          type: 'User',
          site_admin: false,
          url: 'https://github.com/octocat',
        })
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /orgs/{org}/teams/{team_slug}/members': (params: Record<string, unknown>) =>
                    params.org === 'acme' && params.team_slug === 'core' ? [memberPayload] : [],
                },
              })
            )
          )
        )
      )
    )

    it.effect('surfaces NotFoundError when the team 404s', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const exit = yield* Effect.exit(teams.members('acme', 'missing'))
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(NotFoundError)
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(FakeGithub.layer({ fail: { 'GET /orgs/{org}/teams/{team_slug}/members': 404 } }))
          )
        )
      )
    )
  })

  describe('add', () => {
    it.effect('adds a user via the org-based membership endpoint with the role', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const result = yield* teams.add('acme', 'core', 'octocat', 'maintainer')
        expect(result).toEqual({ team: 'core', user: 'octocat', role: 'maintainer', state: 'active' })
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'PUT /orgs/{org}/teams/{team_slug}/memberships/{username}': (params: Record<string, unknown>) =>
                    params.org === 'acme' &&
                    params.team_slug === 'core' &&
                    params.username === 'octocat' &&
                    params.role === 'maintainer'
                      ? { state: 'active', role: 'maintainer' }
                      : { state: 'WRONG', role: 'WRONG' },
                },
              })
            )
          )
        )
      )
    )
  })
})
