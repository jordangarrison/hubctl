import { describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as O from 'effect/Option'

import { Github, makeGithub } from '../../src/github/client'
import { AuthError } from '../../src/github/errors'

// A fake Octokit-shaped object: `request` and `paginate` are the only surfaces
// the Github service touches, so tests inject canned/throwing implementations
// and never reach the network.
interface FakeOctokit {
  readonly request: (route: string, params?: Record<string, unknown>) => Promise<{ data: unknown }>
  readonly paginate: (route: string, params?: Record<string, unknown>) => Promise<ReadonlyArray<unknown>>
}

const fakeOctokit = (overrides: Partial<FakeOctokit>): FakeOctokit => ({
  request: () => Promise.resolve({ data: undefined }),
  paginate: () => Promise.resolve([]),
  ...overrides,
})

// Mirrors @octokit/request-error: a real network failure rejects with an Error
// instance carrying a numeric `status`, which `toGithubError` switches on. This
// deliberately untyped/raw-Error shape is the boundary we wrap, so the Effect
// "tagged error" lint is suppressed for this fixture only.
// eslint-disable-next-line effect/avoid-untagged-errors
const octokitError = (status: number, message: string): Error => Object.assign(new Error(message), { status })

describe('Github service', () => {
  const requestOctokit = fakeOctokit({
    request: (route) => {
      expect(route).toBe('GET /user')
      return Promise.resolve({ data: { login: 'octocat' } })
    },
  })

  it.effect('request returns the response payload (.data)', () =>
    Effect.gen(function* () {
      const github = yield* Github
      const user = yield* github.request('GET /user', {})
      expect(user).toEqual({ login: 'octocat' })
    }).pipe(Effect.provide(makeGithub(requestOctokit)))
  )

  const unauthorizedOctokit = fakeOctokit({
    request: () => Promise.reject(octokitError(401, 'Bad credentials')),
  })

  it.effect('a thrown Octokit 401 surfaces as AuthError in the E channel', () =>
    Effect.gen(function* () {
      const github = yield* Github
      // `Effect.exit` keeps the typed `GithubError` in the Cause while leaving the
      // assertion effect's own error channel `never` (a bare `Effect.flip` would
      // surface the wrapped payload type `unknown` in `E`, which the language
      // service rejects).
      const exit = yield* Effect.exit(github.request('GET /user', {}))
      expect(Exit.isFailure(exit)).toBe(true)
      const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
      expect(error).toBeInstanceOf(AuthError)
      expect(error?._tag).toBe('AuthError')
    }).pipe(Effect.provide(makeGithub(unauthorizedOctokit)))
  )

  const paginateOctokit = fakeOctokit({
    paginate: (route) => {
      expect(route).toBe('GET /user/repos')
      return Promise.resolve([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    },
  })

  it.effect('paginate returns all items across pages', () =>
    Effect.gen(function* () {
      const github = yield* Github
      const repos = yield* github.paginate('GET /user/repos', {})
      expect(repos).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    }).pipe(Effect.provide(makeGithub(paginateOctokit)))
  )
})
