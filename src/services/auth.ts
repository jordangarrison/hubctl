import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'
import * as P from 'effect/Predicate'
import * as Schema from 'effect/Schema'

import { Github } from '../github/client'
import type { GithubError } from '../github/errors'
import { decode } from '../schema/decode'

// Identity + rate-limit status for the current token. Depends only on `Github`:
// `GET /user` yields the authenticated login/name (a 401 here flows through as
// the typed `AuthError` from the Github layer), and `GET /rate_limit` yields the
// token's current rate-limit budget. Mirrors the Ruby `current_user`/`rate_limit`
// pair in lib/hubctl/github_client.rb.

// `name` can be null on GitHub for users who never set a display name; the wire
// contract keeps it nullable rather than collapsing it to an Option here.
const User = Schema.Struct({
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
})

const RateLimit = Schema.Struct({
  limit: Schema.Finite,
  remaining: Schema.Finite,
  reset: Schema.Finite,
  used: Schema.Finite,
})

const RateLimitResponse = Schema.Struct({ rate: RateLimit })

export interface AuthStatus {
  readonly login: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly name: string | null
  readonly rateLimit: typeof RateLimit.Type
  // The token's granted OAuth scopes, parsed from the `x-oauth-scopes` response
  // header on `GET /user` (empty when the header is absent, e.g. a fine-grained
  // token). Mirrors the Ruby `scopes` reporting.
  readonly scopes: ReadonlyArray<string>
}

export interface AuthShape {
  readonly status: Effect.Effect<AuthStatus, GithubError>
}

const decodeUser = decode(User, 'authenticated user')
const decodeRateLimit = decode(RateLimitResponse, 'rate limit')

// Parse the comma-separated `x-oauth-scopes` header into a clean scope list.
// Absent/blank header → `[]`; surrounding whitespace and empty segments dropped.
const parseScopes = (headers: Record<string, unknown>): ReadonlyArray<string> =>
  O.filter(O.fromNullishOr(headers['x-oauth-scopes']), P.isString).pipe(
    O.map((raw) =>
      raw
        .split(',')
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0)
    ),
    O.getOrElse(() => [])
  )

export class Auth extends Context.Service<Auth, AuthShape>()('Auth') {
  static readonly layer: Layer.Layer<Auth, never, Github> = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const github = yield* Github

      // Sequence the two reads (preserving order: GET /user then /rate_limit),
      // then decode both payloads effectfully so a schema mismatch surfaces as a
      // typed DecodeError (clean envelope) instead of a thrown defect.
      const status: AuthShape['status'] = Effect.all(
        [github.requestRaw('GET /user'), github.request('GET /rate_limit')],
        { concurrency: 1 }
      ).pipe(
        Effect.flatMap(([userResponse, rawRate]) =>
          Effect.all([decodeUser(userResponse.data), decodeRateLimit(rawRate)], { concurrency: 1 }).pipe(
            Effect.map(([user, rate]) => ({
              login: user.login,
              name: user.name,
              rateLimit: rate.rate,
              scopes: parseScopes(userResponse.headers),
            }))
          )
        ),
        Effect.withSpan('Auth.status')
      )

      return { status }
    })
  )
}
