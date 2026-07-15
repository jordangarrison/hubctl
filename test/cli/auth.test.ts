import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { authCommand } from '../../src/cli/auth'
import { runCli } from '../helpers/run-cli'

// A good `GET /user` + `GET /rate_limit` pair (plus the `x-oauth-scopes` header)
// so the `auth` command can report identity, rate limit and token scopes —
// mirroring the Ruby `auth` command (lib/hubctl/cli.rb).
const goodGithub = {
  routes: {
    'GET /user': { login: 'octocat', name: 'The Octocat' },
    'GET /rate_limit': { rate: { limit: 5000, remaining: 4999, reset: 1_700_000_000, used: 1 } },
  },
  headers: { 'GET /user': { 'x-oauth-scopes': 'repo, read:org, admin:org' } },
}

const AuthResult = Schema.Struct({
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  rateLimit: Schema.Struct({
    limit: Schema.Finite,
    remaining: Schema.Finite,
    reset: Schema.Finite,
    used: Schema.Finite,
  }),
  scopes: Schema.Array(Schema.String),
})
const decodeAuth = Schema.decodeUnknownSync(AuthResult)

describe('auth command', () => {
  it.effect('emits an ok envelope with login, name, rate limit and scopes', () =>
    Effect.gen(function* () {
      const env = yield* runCli(() => authCommand(), ['auth'], { github: goodGithub })

      expect(env.ok).toBe(true)
      expect(env.command).toBe('auth')
      expect(env.error).toBeNull()

      const result = decodeAuth(env.result)
      expect(result.login).toBe('octocat')
      expect(result.name).toBe('The Octocat')
      expect(result.rateLimit.remaining).toBe(4999)
      expect(result.scopes).toEqual(['repo', 'read:org', 'admin:org'])
    })
  )

  it.effect('surfaces a fail envelope when the token is unauthorized', () =>
    Effect.gen(function* () {
      const env = yield* runCli(() => authCommand(), ['auth'], { github: { fail: { 'GET /user': 401 } } })

      expect(env.ok).toBe(false)
      expect(env.command).toBe('auth')
      expect(env.error?.code).toBe('AuthError')
    })
  )
})
