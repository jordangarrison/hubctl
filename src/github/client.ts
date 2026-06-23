import { Octokit } from '@octokit/core'
import { paginateRest } from '@octokit/plugin-paginate-rest'
import { retry } from '@octokit/plugin-retry'
import { throttling } from '@octokit/plugin-throttling'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import type { GithubError } from './errors'
import { toGithubError } from './errors'

// The only Octokit surfaces the Github service touches: `request` (single call,
// returns `{ data }`) and `paginate` (auto-follows `Link` headers, returns all
// items). Keeping the dependency this narrow lets tests inject a fake without a
// network and keeps Octokit from leaking past this boundary (design "Octokit is
// wrapped, not exposed").
export interface OctokitLike {
  readonly request: (route: string, params?: Record<string, unknown>) => Promise<{ data: unknown }>
  readonly paginate: (route: string, params?: Record<string, unknown>) => Promise<ReadonlyArray<unknown>>
}

// Wrapped Github surface every domain service depends on. `request` yields the
// response payload (`.data`); `paginate` yields every item across pages. Both
// map any Octokit-shaped failure into the typed `GithubError` ADT.
export interface GithubShape {
  readonly request: (route: string, params?: Record<string, unknown>) => Effect.Effect<unknown, GithubError>
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
