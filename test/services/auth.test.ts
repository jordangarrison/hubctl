import { assert, describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'

import { AuthError } from '../../src/github/errors'
import { DecodeError } from '../../src/schema/decode'
import { Auth } from '../../src/services/auth'
import { FakeGithub } from '../helpers/fake-github'

// Auth depends only on Github; over FakeGithub canned routes it resolves the
// authenticated identity (`GET /user`) and the token's rate-limit budget
// (`GET /rate_limit`). A 401 on `/user` must surface the mapped AuthError in
// the typed `E` channel (asserted via exit, like the Github client test).

describe('Auth service', () => {
  const goodAuth = Auth.layer.pipe(
    Layer.provide(
      FakeGithub.layer({
        routes: {
          'GET /user': { login: 'octocat', name: 'The Octocat', id: 583_231 },
          'GET /rate_limit': {
            rate: { limit: 5000, remaining: 4999, reset: 1_700_000_000, used: 1 },
          },
        },
        headers: { 'GET /user': { 'x-oauth-scopes': 'repo, read:org, admin:org' } },
      })
    )
  )

  it.effect('status returns login, name, rate limit and scopes on a good token', () =>
    Effect.gen(function* () {
      const auth = yield* Auth
      const status = yield* auth.status
      expect(status.login).toBe('octocat')
      expect(status.name).toBe('The Octocat')
      expect(status.rateLimit).toEqual({ limit: 5000, remaining: 4999, reset: 1_700_000_000, used: 1 })
      expect(status.scopes).toEqual(['repo', 'read:org', 'admin:org'])
    }).pipe(Effect.provide(goodAuth))
  )

  const noScopesAuth = Auth.layer.pipe(
    Layer.provide(
      FakeGithub.layer({
        routes: {
          'GET /user': { login: 'octocat', name: 'The Octocat' },
          'GET /rate_limit': { rate: { limit: 5000, remaining: 4999, reset: 1_700_000_000, used: 1 } },
        },
      })
    )
  )

  it.effect('status returns an empty scope list when the header is absent', () =>
    Effect.gen(function* () {
      const auth = yield* Auth
      const status = yield* auth.status
      expect(status.scopes).toEqual([])
    }).pipe(Effect.provide(noScopesAuth))
  )

  const unauthorizedAuth = Auth.layer.pipe(Layer.provide(FakeGithub.layer({ fail: { 'GET /user': 401 } })))

  it.effect('status surfaces AuthError when /user 401s', () =>
    Effect.gen(function* () {
      const auth = yield* Auth
      const exit = yield* Effect.exit(auth.status)
      expect(Exit.isFailure(exit)).toBe(true)
      const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
      expect(error).toBeInstanceOf(AuthError)
      expect(error?._tag).toBe('AuthError')
    }).pipe(Effect.provide(unauthorizedAuth))
  )

  // A rate-limit payload whose required `rate.limit` is null (the rest of the
  // shape valid) must fail through the typed `E` channel as a DecodeError, not
  // escape as a thrown defect from a synchronous decode.
  const mismatchedRateAuth = Auth.layer.pipe(
    Layer.provide(
      FakeGithub.layer({
        routes: {
          'GET /user': { login: 'octocat', name: 'The Octocat', id: 583_231 },
          'GET /rate_limit': {
            rate: { limit: null, remaining: 4999, reset: 1_700_000_000, used: 1 },
          },
        },
      })
    )
  )

  it.effect('a mismatched rate-limit payload fails as a DecodeError, not a thrown defect', () =>
    Effect.gen(function* () {
      const auth = yield* Auth
      const exit = yield* Effect.exit(auth.status)
      expect(Exit.isFailure(exit)).toBe(true)
      const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
      assert(error instanceof DecodeError)
      expect(error.code).toBe('decode_error')
    }).pipe(Effect.provide(mismatchedRateAuth))
  )
})
