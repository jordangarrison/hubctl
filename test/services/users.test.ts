import { assert, describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'

import { NotFoundError } from '../../src/github/errors'
import { DecodeError } from '../../src/schema/decode'
import { Users } from '../../src/services/users'
import { FakeGithub } from '../helpers/fake-github'

// Users depends only on Github. Over FakeGithub canned routes the service shapes
// each payload to mirror the Ruby `Hubctl::Users` data, and surfaces typed
// GithubErrors in the `E` channel.

const userPayload = {
  login: 'octocat',
  id: 1,
  name: 'The Octocat',
  email: 'octo@github.com',
  bio: 'A cat that codes',
  company: 'GitHub',
  location: 'San Francisco',
  blog: 'https://github.blog',
  type: 'User',
  site_admin: false,
  public_repos: 8,
  public_gists: 2,
  followers: 100,
  following: 5,
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2021-01-01T00:00:00Z',
  html_url: 'https://github.com/octocat',
}

const currentUserPayload = {
  login: 'octocat',
  name: 'The Octocat',
  email: 'octo@github.com',
  company: 'GitHub',
  plan: { name: 'pro' },
  owned_private_repos: 3,
  collaborators: 4,
  disk_usage: 256,
}

describe('Users service', () => {
  describe('show', () => {
    const showLayer = Users.layer.pipe(
      Layer.provide(FakeGithub.layer({ routes: { 'GET /users/{username}': userPayload } }))
    )

    it.effect('returns the full user detail shape', () =>
      Effect.gen(function* () {
        const users = yield* Users
        const detail = yield* users.show('octocat')
        expect(detail).toEqual({
          login: 'octocat',
          name: 'The Octocat',
          email: 'octo@github.com',
          bio: 'A cat that codes',
          company: 'GitHub',
          location: 'San Francisco',
          blog: 'https://github.blog',
          public_repos: 8,
          public_gists: 2,
          followers: 100,
          following: 5,
          created_at: '2020-01-01T00:00:00Z',
          updated_at: '2021-01-01T00:00:00Z',
          url: 'https://github.com/octocat',
        })
      }).pipe(Effect.provide(showLayer))
    )

    it.effect('passes the username to the route params', () =>
      Effect.gen(function* () {
        const users = yield* Users
        const detail = yield* users.show('octocat')
        expect(detail.login).toBe('octocat')
      }).pipe(
        Effect.provide(
          Users.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /users/{username}': (params: Record<string, unknown>) =>
                    params.username === 'octocat' ? userPayload : { ...userPayload, login: 'WRONG' },
                },
              })
            )
          )
        )
      )
    )

    it.effect('a mismatched user payload fails as a DecodeError, not a thrown defect', () =>
      Effect.gen(function* () {
        const users = yield* Users
        const exit = yield* Effect.exit(users.show('octocat'))
        expect(Exit.isFailure(exit)).toBe(true)
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        assert(error instanceof DecodeError)
        expect(error.code).toBe('decode_error')
      }).pipe(
        Effect.provide(
          Users.layer.pipe(
            Layer.provide(
              FakeGithub.layer({ routes: { 'GET /users/{username}': { ...userPayload, followers: null } } })
            )
          )
        )
      )
    )

    it.effect('surfaces NotFoundError on a 404', () =>
      Effect.gen(function* () {
        const users = yield* Users
        const exit = yield* Effect.exit(users.show('ghost'))
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(NotFoundError)
      }).pipe(
        Effect.provide(Users.layer.pipe(Layer.provide(FakeGithub.layer({ fail: { 'GET /users/{username}': 404 } }))))
      )
    )
  })

  describe('whoami', () => {
    it.effect('returns the current-user info shape', () =>
      Effect.gen(function* () {
        const users = yield* Users
        const result = yield* users.whoami
        expect(result).toEqual({
          login: 'octocat',
          name: 'The Octocat',
          email: 'octo@github.com',
          company: 'GitHub',
          plan: 'pro',
          private_repos: 3,
          collaborators: 4,
          disk_usage: '256 KB',
        })
      }).pipe(
        Effect.provide(
          Users.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { 'GET /user': currentUserPayload } })))
        )
      )
    )

    it.effect('surfaces AuthError when /user 401s', () =>
      Effect.gen(function* () {
        const users = yield* Users
        const exit = yield* Effect.exit(users.whoami)
        expect(Exit.isFailure(exit)).toBe(true)
      }).pipe(Effect.provide(Users.layer.pipe(Layer.provide(FakeGithub.layer({ fail: { 'GET /user': 401 } })))))
    )
  })

  describe('list', () => {
    const memberPayload = {
      login: 'octocat',
      id: 1,
      type: 'User',
      site_admin: false,
      html_url: 'https://github.com/octocat',
    }

    it.effect('lists org members via GET /orgs/{org}/members', () =>
      Effect.gen(function* () {
        const users = yield* Users
        const result = yield* users.list('acme', {})
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
          Users.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { 'GET /orgs/{org}/members': [memberPayload] } })))
        )
      )
    )

    it.effect('forwards a non-all role filter as the role param', () =>
      Effect.gen(function* () {
        const users = yield* Users
        const result = yield* users.list('acme', { role: 'admin' })
        expect(result[0]?.login).toBe('octocat')
      }).pipe(
        Effect.provide(
          Users.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /orgs/{org}/members': (params: Record<string, unknown>) =>
                    params.org === 'acme' && params.role === 'admin' ? [memberPayload] : [],
                },
              })
            )
          )
        )
      )
    )
  })

  describe('invite', () => {
    it.effect('invites by email via POST /orgs/{org}/invitations, surfacing role and inviter', () =>
      Effect.gen(function* () {
        const users = yield* Users
        const result = yield* users.invite('acme', 'new@person.com', {})
        expect(result).toEqual({
          id: 99,
          invited: 'new@person.com',
          role: 'direct_member',
          inviter: 'admin-octo',
        })
      }).pipe(
        Effect.provide(
          Users.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'POST /orgs/{org}/invitations': (params: Record<string, unknown>) =>
                    params.email === 'new@person.com'
                      ? { id: 99, role: 'direct_member', inviter: { login: 'admin-octo' } }
                      : { id: 0 },
                },
              })
            )
          )
        )
      )
    )

    it.effect('resolves a username to an invitee_id before inviting, surfacing role and inviter', () =>
      Effect.gen(function* () {
        const users = yield* Users
        const result = yield* users.invite('acme', 'octocat', { role: 'admin' })
        expect(result).toEqual({ id: 99, invited: 'octocat', role: 'admin', inviter: 'admin-octo' })
      }).pipe(
        Effect.provide(
          Users.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /users/{username}': { id: 1 },
                  'POST /orgs/{org}/invitations': (params: Record<string, unknown>) =>
                    params.invitee_id === 1 && params.role === 'admin'
                      ? { id: 99, role: 'admin', inviter: { login: 'admin-octo' } }
                      : { id: 0 },
                },
              })
            )
          )
        )
      )
    )

    it.effect('surfaces null role/inviter when the response omits them', () =>
      Effect.gen(function* () {
        const users = yield* Users
        const result = yield* users.invite('acme', 'new@person.com', {})
        expect(result).toEqual({ id: 99, invited: 'new@person.com', role: null, inviter: null })
      }).pipe(
        Effect.provide(
          Users.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { 'POST /orgs/{org}/invitations': { id: 99 } } })))
        )
      )
    )
  })

  describe('remove', () => {
    it.effect('removes a member via DELETE /orgs/{org}/members/{username}', () =>
      Effect.gen(function* () {
        const users = yield* Users
        const result = yield* users.remove('acme', 'octocat')
        expect(result).toEqual({ org: 'acme', user: 'octocat', removed: true })
      }).pipe(
        Effect.provide(
          Users.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { 'DELETE /orgs/{org}/members/{username}': {} } })))
        )
      )
    )
  })
})
