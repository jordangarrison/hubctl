import type * as Layer from 'effect/Layer'
import * as O from 'effect/Option'
import * as P from 'effect/Predicate'
import * as R from 'effect/Record'

import type { Github, OctokitLike } from '../../src/github/client'
import { makeGithub } from '../../src/github/client'

// Network-free Github layer for tests. `FakeGithub.layer({ routes, fail })`
// builds an `OctokitLike` over canned data and hands it to the real
// `makeGithub`, so every fake response still flows through the production
// `shapeFromOctokit` → `toGithubError` mapping. That keeps fixtures honest:
// forcing a route to "fail" with a status exercises the exact same error
// translation a real Octokit rejection would, landing a typed `GithubError`
// in the `E` channel. Reusable by all later phases (Auth, repos, …).

// A canned response for a route: either a fixed value or a function of the
// call params. `request` returns the value as the payload (`.data`);
// `paginate` expects the value to be the flat array of items across all pages.
export type FakeResponse = unknown | ((params: Record<string, unknown>) => unknown)

// A forced failure for a route: either an HTTP status code (turned into an
// Octokit-shaped error so `toGithubError` maps it like the real thing) or a
// pre-built Octokit-shaped error object to control headers/body precisely.
export type FakeFailure = number | Record<string, unknown>

export interface FakeGithubConfig {
  // Map of route string (e.g. 'GET /user', 'GET /orgs/{org}/repos') to its
  // canned response. The same map serves `request` (returns the value) and
  // `paginate` (returns the value as a flat array of items).
  readonly routes?: Record<string, FakeResponse>
  // Map of route string to a forced failure. Takes precedence over `routes`,
  // so a test can stub a normally-canned route into an error path.
  readonly fail?: Record<string, FakeFailure>
  // Map of route string to canned response headers (lower-cased, as Octokit
  // returns them). Surfaced by `requestRaw` — e.g. `x-oauth-scopes` on
  // `GET /user`, which is how Auth reads a token's granted scopes.
  readonly headers?: Record<string, Record<string, unknown>>
}

// Mirrors @octokit/request-error: a rejected request carries a numeric
// `status` (plus optional `response.headers`/`response.data`) that
// `toGithubError` switches on. Building a raw augmented Error is the untyped
// network boundary we deliberately fake, so the tagged-error lint is
// suppressed for these fixtures only.
const statusError = (status: number): unknown =>
  // eslint-disable-next-line effect/avoid-untagged-errors
  Object.assign(new Error(`GitHub request failed with status ${status}`), { status })

// A loud, obvious failure for missing/misconfigured fixtures — surfaced as a
// rejection so a test fails clearly instead of seeing a silent `undefined`.
const loudError = (message: string): unknown =>
  // eslint-disable-next-line effect/avoid-untagged-errors
  new Error(message)

const toError = (failure: FakeFailure): unknown => (P.isNumber(failure) ? statusError(failure) : failure)

const resolve = (response: FakeResponse, params: Record<string, unknown>): unknown =>
  P.isFunction(response) ? response(params) : response

const fakeOctokit = (config: FakeGithubConfig): OctokitLike => {
  const routes = config.routes ?? {}
  const fail = config.fail ?? {}
  const headers = config.headers ?? {}

  // Resolve a route to its canned payload, or throw the forced/loud error.
  // Throwing inside the async bodies below lands the rejection in
  // `Effect.tryPromise`'s `catch` → `toGithubError`.
  const lookup = (kind: string, route: string, params: Record<string, unknown>): unknown => {
    const failure = R.get(fail, route)
    if (O.isSome(failure)) {
      throw toError(failure.value)
    }
    const response = R.get(routes, route)
    if (O.isSome(response)) {
      return resolve(response.value, params)
    }
    throw loudError(
      `FakeGithub: no ${kind} fixture for route '${route}'. Add it to FakeGithub.layer({ routes }) or { fail }.`
    )
  }

  const headersFor = (route: string): Record<string, unknown> => O.getOrElse(R.get(headers, route), () => ({}))

  return {
    request: (route, params) =>
      Promise.resolve({ data: lookup('request', route, params ?? {}), headers: headersFor(route) }),
    paginate: (route, params) => {
      const value = lookup('paginate', route, params ?? {})
      if (!Array.isArray(value)) {
        throw loudError(`FakeGithub: paginate fixture for '${route}' must be an array`)
      }
      return Promise.resolve(value)
    },
  }
}

export const FakeGithub = {
  layer: (config: FakeGithubConfig = {}): Layer.Layer<Github> => makeGithub(fakeOctokit(config)),
} as const
