import { assert, describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'

import { NotFoundError } from '../../src/github/errors'
import { DecodeError } from '../../src/schema/decode'
import { Orgs } from '../../src/services/orgs'
import { FakeGithub } from '../helpers/fake-github'

// Orgs depends only on Github. Over FakeGithub canned routes the service shapes
// each payload to mirror the Ruby `Hubctl::Orgs` data, and surfaces typed
// GithubErrors in the `E` channel.

// The real `GET /user/orgs` payload is MINIMAL: login/id/description/url and a
// set of *_url fields — NO per-org counts and NO html_url (those live only on the
// `GET /orgs/{org}` detail). The fixture mirrors that so the decode stays honest.
const orgSummary = {
  login: 'acme',
  id: 42,
  description: 'Acme Corp',
  url: 'https://api.github.com/orgs/acme',
}

const orgDetail = {
  login: 'acme',
  id: 42,
  name: 'Acme Corporation',
  company: 'Acme',
  blog: 'https://acme.example',
  location: 'Springfield',
  email: 'hi@acme.example',
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

const memberPayload = {
  login: 'octocat',
  id: 1,
  type: 'User',
  site_admin: false,
  html_url: 'https://github.com/octocat',
}

const repoPayload = {
  name: 'widget',
  private: false,
  description: 'A widget',
  language: 'Ruby',
  stargazers_count: 12,
  forks_count: 3,
  updated_at: '2021-06-01T00:00:00Z',
}

// The team LIST endpoint (`GET /orgs/{org}/teams`) omits members_count/repos_count
// (only the team detail returns them); the fixture mirrors that.
const teamPayload = {
  name: 'Core',
  slug: 'core',
  description: 'Core team',
  privacy: 'closed',
}

const currentUser = {
  login: 'octocat',
  name: 'The Octocat',
  plan: { name: 'pro' },
}

describe('Orgs service', () => {
  describe('list', () => {
    it.effect('lists the authenticated user orgs via GET /user/orgs', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.list
        expect(result).toHaveLength(1)
        // The list endpoint omits the counts and html_url, so they surface as null
        // (the Ruby read the absent keys and rendered nil).
        expect(result[0]).toEqual({
          login: 'acme',
          id: 42,
          description: 'Acme Corp',
          public_repos: null,
          public_gists: null,
          followers: null,
          following: null,
          url: null,
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
          bio: null,
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

    it.effect('a mismatched org detail fails as a DecodeError, not a thrown defect', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const exit = yield* Effect.exit(orgs.show('acme'))
        expect(Exit.isFailure(exit)).toBe(true)
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        assert(error instanceof DecodeError)
        expect(error.code).toBe('decode_error')
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(
            Layer.provide(FakeGithub.layer({ routes: { 'GET /orgs/{org}': { ...orgDetail, created_at: null } } }))
          )
        )
      )
    )
  })

  describe('members', () => {
    it.effect('lists members via GET /orgs/{org}/members and shapes each row', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.members('acme', {})
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
          Orgs.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { 'GET /orgs/{org}/members': [memberPayload] } })))
        )
      )
    )

    it.effect('forwards role when not "all"', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.members('acme', { role: 'admin' })
        expect(result[0]?.login).toBe('octocat')
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /orgs/{org}/members': (params: Record<string, unknown>) =>
                    params.role === 'admin' ? [memberPayload] : [{ ...memberPayload, login: 'WRONG' }],
                },
              })
            )
          )
        )
      )
    )

    it.effect('sends filter=2fa_disabled when twoFaDisabled is set', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.members('acme', { twoFaDisabled: true })
        expect(result[0]?.login).toBe('octocat')
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /orgs/{org}/members': (params: Record<string, unknown>) =>
                    params.filter === '2fa_disabled' ? [memberPayload] : [{ ...memberPayload, login: 'WRONG' }],
                },
              })
            )
          )
        )
      )
    )
  })

  describe('repos', () => {
    it.effect('lists org repos via GET /orgs/{org}/repos and shapes each row', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.repos('acme', { type: 'all', sort: 'updated' })
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          name: 'widget',
          private: false,
          description: 'A widget',
          language: 'Ruby',
          stars: 12,
          forks: 3,
          updated: '2021-06-01T00:00:00Z',
        })
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { 'GET /orgs/{org}/repos': [repoPayload] } })))
        )
      )
    )

    it.effect('defaults missing description/language to "-"', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.repos('acme', { type: 'all', sort: 'updated' })
        expect(result[0]?.description).toBe('-')
        expect(result[0]?.language).toBe('-')
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: { 'GET /orgs/{org}/repos': [{ ...repoPayload, description: null, language: null }] },
              })
            )
          )
        )
      )
    )

    it.effect('omits the type param when type is "all" but forwards sort', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.repos('acme', { type: 'all', sort: 'pushed' })
        expect(result[0]?.name).toBe('widget')
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /orgs/{org}/repos': (params: Record<string, unknown>) =>
                    params.type === undefined && params.sort === 'pushed'
                      ? [repoPayload]
                      : [{ ...repoPayload, name: 'WRONG' }],
                },
              })
            )
          )
        )
      )
    )

    it.effect('forwards type when not "all"', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.repos('acme', { type: 'private', sort: 'updated' })
        expect(result[0]?.name).toBe('widget')
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /orgs/{org}/repos': (params: Record<string, unknown>) =>
                    params.type === 'private' ? [repoPayload] : [{ ...repoPayload, name: 'WRONG' }],
                },
              })
            )
          )
        )
      )
    )
  })

  describe('teams', () => {
    it.effect('lists org teams via GET /orgs/{org}/teams and shapes each row', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.teams('acme')
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          name: 'Core',
          slug: 'core',
          description: 'Core team',
          privacy: 'closed',
          members_count: '-',
          repos_count: '-',
        })
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { 'GET /orgs/{org}/teams': [teamPayload] } })))
        )
      )
    )

    it.effect('defaults a missing description to "-"', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.teams('acme')
        expect(result[0]?.description).toBe('-')
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(
            Layer.provide(
              FakeGithub.layer({ routes: { 'GET /orgs/{org}/teams': [{ ...teamPayload, description: null }] } })
            )
          )
        )
      )
    )
  })

  describe('info', () => {
    const infoRoutes = { 'GET /user': currentUser, 'GET /user/orgs': [orgSummary] }

    it.effect('combines GET /user and GET /user/orgs into the info shape', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.info
        expect(result).toEqual({
          login: 'octocat',
          name: 'The Octocat',
          plan: 'pro',
          organizations: [{ index: 1, login: 'acme', description: 'Acme Corp' }],
        })
      }).pipe(Effect.provide(Orgs.layer.pipe(Layer.provide(FakeGithub.layer({ routes: infoRoutes })))))
    )

    it.effect('numbers multiple org memberships and defaults a missing description', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.info
        expect(result.organizations).toEqual([
          { index: 1, login: 'acme', description: 'Acme Corp' },
          { index: 2, login: 'beta', description: 'No description' },
        ])
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /user': currentUser,
                  'GET /user/orgs': [orgSummary, { ...orgSummary, login: 'beta', description: null }],
                },
              })
            )
          )
        )
      )
    )
  })
})
