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

const memberPayload = {
  login: 'octocat',
  id: 1,
  type: 'User',
  site_admin: false,
  html_url: 'https://github.com/octocat',
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

  describe('invite', () => {
    const invitation = { id: 7, login: 'newbie', email: null, role: 'direct_member' }

    it.effect('invites by email via POST /orgs/{org}/invitations with the email body', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.invite('acme', 'person@example.com', {})
        expect(result.invited).toBe('person@example.com')
        expect(result.id).toBe(7)
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'POST /orgs/{org}/invitations': (params: Record<string, unknown>) =>
                    params.email === 'person@example.com' ? invitation : { ...invitation, id: -1 },
                },
              })
            )
          )
        )
      )
    )

    it.effect('invites by username: looks up the user id then posts invitee_id', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.invite('acme', 'newbie', {})
        expect(result.invited).toBe('newbie')
        expect(result.id).toBe(7)
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /users/{username}': { id: 99, login: 'newbie' },
                  'POST /orgs/{org}/invitations': (params: Record<string, unknown>) =>
                    params.invitee_id === 99 ? invitation : { ...invitation, id: -1 },
                },
              })
            )
          )
        )
      )
    )

    it.effect('forwards role and team ids when provided', () =>
      Effect.gen(function* () {
        const orgs = yield* Orgs
        const result = yield* orgs.invite('acme', 'person@example.com', { role: 'admin', teamIds: [1, 2] })
        expect(result.id).toBe(7)
      }).pipe(
        Effect.provide(
          Orgs.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'POST /orgs/{org}/invitations': (params: Record<string, unknown>) =>
                    params.role === 'admin' && Array.isArray(params.team_ids) && params.team_ids.length === 2
                      ? invitation
                      : { ...invitation, id: -1 },
                },
              })
            )
          )
        )
      )
    )
  })
})
