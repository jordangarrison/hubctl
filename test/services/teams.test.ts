import { assert, describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'

import { NotFoundError } from '../../src/github/errors'
import { DecodeError } from '../../src/schema/decode'
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

    // GET /orgs/{org}/teams (the list endpoint) does NOT return members_count or
    // repos_count — only the detail endpoint does. The list schema must tolerate
    // their absence and render '-' rather than throwing a decode defect.
    it.effect('decodes list rows that OMIT members_count/repos_count and renders "-"', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const result = yield* teams.list('acme')
        expect(result[0]?.members_count).toBe('-')
        expect(result[0]?.repos_count).toBe('-')
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /orgs/{org}/teams': [
                    {
                      id: 7,
                      name: 'Core',
                      slug: 'core',
                      description: 'Core maintainers',
                      privacy: 'closed',
                      permission: 'push',
                    },
                  ],
                },
              })
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

  describe('show', () => {
    const detailPayload = {
      id: 7,
      name: 'Core',
      slug: 'core',
      description: 'Core maintainers',
      privacy: 'closed',
      permission: 'push',
      members_count: 4,
      repos_count: 12,
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2021-02-02T00:00:00Z',
      html_url: 'https://github.com/orgs/acme/teams/core',
    }

    it.effect('fetches a team detail via GET /orgs/{org}/teams/{team_slug}', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const result = yield* teams.show('acme', 'core')
        expect(result).toEqual({
          id: 7,
          name: 'Core',
          slug: 'core',
          description: 'Core maintainers',
          privacy: 'closed',
          permission: 'push',
          members_count: 4,
          repos_count: 12,
          created_at: '2020-01-01T00:00:00Z',
          updated_at: '2021-02-02T00:00:00Z',
          url: 'https://github.com/orgs/acme/teams/core',
        })
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /orgs/{org}/teams/{team_slug}': (params: Record<string, unknown>) =>
                    params.org === 'acme' && params.team_slug === 'core'
                      ? detailPayload
                      : { ...detailPayload, slug: 'WRONG' },
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
        const exit = yield* Effect.exit(teams.show('acme', 'missing'))
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(NotFoundError)
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(Layer.provide(FakeGithub.layer({ fail: { 'GET /orgs/{org}/teams/{team_slug}': 404 } })))
        )
      )
    )

    // members_count is a required Schema.Finite on the detail schema; a payload
    // that omits it must fail in the typed E channel as a DecodeError, NOT throw
    // an uncaught defect that escapes the envelope.
    it.effect('a mismatched team detail fails as a DecodeError, not a thrown defect', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const exit = yield* Effect.exit(teams.show('acme', 'core'))
        expect(Exit.isFailure(exit)).toBe(true)
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        assert(error instanceof DecodeError)
        expect(error.code).toBe('decode_error')
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /orgs/{org}/teams/{team_slug}': {
                    id: 7,
                    name: 'Core',
                    slug: 'core',
                    description: 'Core maintainers',
                    privacy: 'closed',
                    permission: 'push',
                    repos_count: 12,
                    created_at: '2020-01-01T00:00:00Z',
                    updated_at: '2021-02-02T00:00:00Z',
                    html_url: 'https://github.com/orgs/acme/teams/core',
                  },
                },
              })
            )
          )
        )
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

  describe('remove', () => {
    it.effect('removes a user via DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const result = yield* teams.remove('acme', 'core', 'octocat')
        expect(result).toEqual({ team: 'core', user: 'octocat', removed: true })
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(
              FakeGithub.layer({ routes: { 'DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}': {} } })
            )
          )
        )
      )
    )

    it.effect('surfaces NotFoundError on a 404', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const exit = yield* Effect.exit(teams.remove('acme', 'core', 'ghost'))
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(NotFoundError)
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(
              FakeGithub.layer({ fail: { 'DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}': 404 } })
            )
          )
        )
      )
    )
  })

  describe('repoAccess', () => {
    const repoPayload = {
      name: 'orbit',
      full_name: 'acme/orbit',
      private: true,
      role_name: 'write',
      permissions: { admin: false, maintain: false, push: true, triage: true, pull: true },
    }

    it.effect('lists team repos via GET /orgs/{org}/teams/{team_slug}/repos and prefers role_name', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const result = yield* teams.repoAccess('acme', 'core')
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({ name: 'orbit', full_name: 'acme/orbit', private: true, permission: 'write' })
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /orgs/{org}/teams/{team_slug}/repos': (params: Record<string, unknown>) =>
                    params.org === 'acme' && params.team_slug === 'core' ? [repoPayload] : [],
                },
              })
            )
          )
        )
      )
    )

    // When the API omits `role_name`, the effective permission is derived from the
    // highest granted bit in the `permissions` map (push here ⇒ 'push').
    it.effect('falls back to the highest permission bit when role_name is absent', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const result = yield* teams.repoAccess('acme', 'core')
        expect(result[0]?.permission).toBe('push')
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /orgs/{org}/teams/{team_slug}/repos': [
                    {
                      name: 'orbit',
                      full_name: 'acme/orbit',
                      private: true,
                      permissions: { admin: false, maintain: false, push: true, triage: true, pull: true },
                    },
                  ],
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
        const exit = yield* Effect.exit(teams.repoAccess('acme', 'missing'))
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(NotFoundError)
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(FakeGithub.layer({ fail: { 'GET /orgs/{org}/teams/{team_slug}/repos': 404 } }))
          )
        )
      )
    )
  })

  describe('grantRepo', () => {
    // The PUT returns 204 (no body) and `grantRepo` echoes its arguments, so we
    // capture the wire params in a closure to assert they were forwarded (route
    // key names, permission body) rather than relying on the echoed result alone.
    it.effect('grants access via PUT and forwards the wire params', () => {
      let captured: Record<string, unknown> = {}
      return Effect.gen(function* () {
        const teams = yield* Teams
        const result = yield* teams.grantRepo('acme', 'core', 'acme', 'orbit', 'push')
        expect(result).toEqual({ team: 'core', owner: 'acme', repo: 'orbit', permission: 'push', granted: true })
        expect(captured).toMatchObject({
          org: 'acme',
          team_slug: 'core',
          owner: 'acme',
          repo: 'orbit',
          permission: 'push',
        })
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'PUT /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}': (params: Record<string, unknown>) => {
                    captured = params
                    return {}
                  },
                },
              })
            )
          )
        )
      )
    })

    it.effect('surfaces NotFoundError on a 404', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const exit = yield* Effect.exit(teams.grantRepo('acme', 'core', 'acme', 'ghost', 'pull'))
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(NotFoundError)
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(FakeGithub.layer({ fail: { 'PUT /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}': 404 } }))
          )
        )
      )
    )
  })

  describe('removeRepo', () => {
    it.effect('removes access via DELETE and echoes the inputs', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const result = yield* teams.removeRepo('acme', 'core', 'acme', 'orbit')
        expect(result).toEqual({ team: 'core', owner: 'acme', repo: 'orbit', removed: true })
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(
              FakeGithub.layer({ routes: { 'DELETE /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}': {} } })
            )
          )
        )
      )
    )

    it.effect('surfaces NotFoundError on a 404', () =>
      Effect.gen(function* () {
        const teams = yield* Teams
        const exit = yield* Effect.exit(teams.removeRepo('acme', 'core', 'acme', 'ghost'))
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(NotFoundError)
      }).pipe(
        Effect.provide(
          Teams.layer.pipe(
            Layer.provide(
              FakeGithub.layer({ fail: { 'DELETE /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}': 404 } })
            )
          )
        )
      )
    )
  })
})
