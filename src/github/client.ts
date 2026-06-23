import { Octokit } from '@octokit/core'
import { paginateRest } from '@octokit/plugin-paginate-rest'
import { retry } from '@octokit/plugin-retry'
import { throttling } from '@octokit/plugin-throttling'
import * as Config_ from 'effect/Config'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'

import { Config } from '../services/config'
import type { GithubError } from './errors'
import { toGithubError } from './errors'

// The only Octokit surfaces the Github service touches: `request` (single call,
// returns `{ data }`) and `paginate` (auto-follows `Link` headers, returns all
// items). Keeping the dependency this narrow lets tests inject a fake without a
// network and keeps Octokit from leaking past this boundary (design "Octokit is
// wrapped, not exposed").
export interface OctokitLike {
  readonly request: (
    route: string,
    params?: Record<string, unknown>
  ) => Promise<{ data: unknown; headers?: Record<string, unknown> }>
  readonly paginate: (route: string, params?: Record<string, unknown>) => Promise<ReadonlyArray<unknown>>
}

// Wrapped Github surface every domain service depends on. `request` yields the
// response payload (`.data`); `paginate` yields every item across pages. Both
// map any Octokit-shaped failure into the typed `GithubError` ADT.
// A raw response surface: the decoded payload plus the response headers (lower-
// cased by Octokit). Needed where a header carries data the body does not — e.g.
// the `x-oauth-scopes` header on `GET /user`, which is how a token's granted
// scopes are reported (mirrors the Ruby `scopes`).
export interface RawResponse {
  readonly data: unknown
  readonly headers: Record<string, unknown>
}

export interface GithubShape {
  readonly request: (route: string, params?: Record<string, unknown>) => Effect.Effect<unknown, GithubError>
  // Like `request`, but yields the payload AND response headers. Same typed-error
  // mapping; used by the rare caller (Auth) that must read a response header.
  readonly requestRaw: (route: string, params?: Record<string, unknown>) => Effect.Effect<RawResponse, GithubError>
  readonly paginate: (
    route: string,
    params?: Record<string, unknown>
  ) => Effect.Effect<ReadonlyArray<unknown>, GithubError>
}

export interface GithubLayerOptions {
  readonly token: string
  readonly baseUrl?: string
}

// Octokit assembled with the plugins hubctl relies on. `throttling`'s rate-limit
// handlers must be supplied; we let Octokit retry once on a primary/secondary
// limit, then give up (the typed RateLimitError surfaces from `toGithubError`).
const HubctlOctokit = Octokit.plugin(paginateRest, throttling, retry)

const buildOctokit = (options: GithubLayerOptions): OctokitLike => {
  const octokit = new HubctlOctokit({
    auth: options.token,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    throttle: {
      onRateLimit: (_retryAfter, _opts, _octokit, retryCount) => retryCount < 1,
      onSecondaryRateLimit: (_retryAfter, _opts, _octokit, retryCount) => retryCount < 1,
    },
  })
  return octokit satisfies OctokitLike
}

// Turn an Octokit-like object into the `GithubShape`. `Effect.tryPromise` funnels
// every rejection through `toGithubError`, so failures land in the typed `E`
// channel rather than throwing.
const shapeFromOctokit = (octokit: OctokitLike): GithubShape => ({
  request: (route, params) =>
    Effect.map(
      Effect.tryPromise({
        try: () => octokit.request(route, params),
        catch: toGithubError,
      }),
      (response) => response.data
    ),
  requestRaw: (route, params) =>
    Effect.map(
      Effect.tryPromise({
        try: () => octokit.request(route, params),
        catch: toGithubError,
      }),
      (response) => ({ data: response.data, headers: response.headers ?? {} })
    ),
  paginate: (route, params) =>
    Effect.tryPromise({
      try: () => octokit.paginate(route, params),
      catch: toGithubError,
    }),
})

export class Github extends Context.Service<Github, GithubShape>()('Github') {
  // Build the service from a real Octokit assembled with the pagination,
  // throttling and retry plugins. Token (and optional baseUrl, e.g. GHES via
  // HUBCTL_GITHUB_BASE_URL) are injected so this never hard-codes credentials;
  // Phase 3 sources the token from `Config`.
  static readonly layer = (options: GithubLayerOptions): Layer.Layer<Github> =>
    Layer.succeed(Github, shapeFromOctokit(buildOctokit(options)))
}

// Test seam: build a `Github` layer over any Octokit-like object (a fake in
// tests, a plugged Octokit in production via `Github.layer`).
export const makeGithub = (octokit: OctokitLike): Layer.Layer<Github> =>
  Layer.succeed(Github, shapeFromOctokit(octokit))

// Optional GHES/base-URL override (e.g. `HUBCTL_GITHUB_BASE_URL` for an
// Enterprise Server instance or the e2e mock server). Read once at layer
// construction; absence falls back to Octokit's default github.com.
const baseUrlConfig = Effect.orElseSucceed(Config_.option(Config_.string('HUBCTL_GITHUB_BASE_URL')), () =>
  O.none<string>()
)

// Production `Github` layer that sources its token from the `Config` service —
// the design's `effect: const token = yield* Config.githubToken` wiring, but
// with token resolution DEFERRED to the first request rather than performed at
// layer construction. Building Octokit lazily (memoized via `Effect.cached`)
// keeps the layer total: it never fails up front, so token-free commands
// (`version`, the root command tree) still run, and a missing/invalid token
// surfaces as a typed `AuthError` from the request itself — exactly where the
// top-level handler can turn it into an `ok:false` envelope.
export const githubFromConfig: Layer.Layer<Github, never, Config> = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* Config
    const baseUrl = yield* baseUrlConfig

    // Resolve the token + build the plugged Octokit at most once, on first use.
    const octokitOnce = yield* Effect.cached(
      config.githubToken.pipe(
        Effect.map((token) => buildOctokit({ token, ...(O.isSome(baseUrl) ? { baseUrl: baseUrl.value } : {}) }))
      )
    )

    // Each surface first resolves (the memoized) Octokit, then delegates to the
    // shared `shapeFromOctokit` mapping so token-resolution `AuthError`s and
    // Octokit rejections both land in the typed `E` channel.
    const shape: GithubShape = {
      request: (route, params) =>
        octokitOnce.pipe(Effect.flatMap((octokit) => shapeFromOctokit(octokit).request(route, params))),
      requestRaw: (route, params) =>
        octokitOnce.pipe(Effect.flatMap((octokit) => shapeFromOctokit(octokit).requestRaw(route, params))),
      paginate: (route, params) =>
        octokitOnce.pipe(Effect.flatMap((octokit) => shapeFromOctokit(octokit).paginate(route, params))),
    }

    return Layer.succeed(Github, shape)
  })
)
