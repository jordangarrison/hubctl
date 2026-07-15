import { describe, expect, it } from '@effect/vitest'

import {
  AuthError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  toGithubError,
} from '../../src/github/errors'

// Build an Octokit-shaped error: numeric `status` + `response.headers`.
const octokitError = (status: number, headers: Record<string, string> = {}, body?: unknown): unknown => ({
  status,
  message: 'boom',
  response: { headers, data: body },
})

describe('toGithubError', () => {
  it('maps 401 to AuthError with a token fix', () => {
    const err = toGithubError(octokitError(401))
    expect(err).toBeInstanceOf(AuthError)
    expect(err._tag).toBe('AuthError')
    expect(err.fix).toContain('GITHUB_TOKEN')
    expect(err.fix).toContain('hubctl config init')
  })

  it('maps 404 to NotFoundError with an access fix', () => {
    const err = toGithubError(octokitError(404))
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err._tag).toBe('NotFoundError')
    expect(err.fix).toContain('Check the name')
    expect(err.fix).toContain('access')
  })

  it('maps 403 scope errors to ForbiddenError with a scope fix', () => {
    const err = toGithubError(octokitError(403, { 'x-ratelimit-remaining': '37' }))
    expect(err).toBeInstanceOf(ForbiddenError)
    expect(err._tag).toBe('ForbiddenError')
    expect(err.fix).toContain('scope')
    expect(err.fix).toContain('github.com/settings/tokens')
  })

  it('403 with x-accepted-oauth-scopes names the missing + current scopes in the fix', () => {
    const err = toGithubError(
      octokitError(403, {
        'x-accepted-oauth-scopes': 'admin:enterprise',
        'x-oauth-scopes': 'repo, read:org',
        'x-ratelimit-remaining': '50',
      })
    )
    expect(err).toBeInstanceOf(ForbiddenError)
    // the accepted/required scope
    expect(err.fix).toContain('admin:enterprise')
    // the token's current scopes
    expect(err.fix).toContain('repo, read:org')
  })

  it('maps 403 with x-ratelimit-remaining: 0 to RateLimitError', () => {
    const reset = '1750000000'
    const err = toGithubError(octokitError(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }))
    expect(err).toBeInstanceOf(RateLimitError)
    expect(err._tag).toBe('RateLimitError')
    expect(err.fix).toContain('Rate limit')
    // reset time is surfaced
    expect(err.message + err.fix).toMatch(/reset/iu)
  })

  it('maps 429 to RateLimitError', () => {
    const err = toGithubError(octokitError(429))
    expect(err).toBeInstanceOf(RateLimitError)
    expect(err._tag).toBe('RateLimitError')
    expect(err.fix).toContain('Rate limit')
  })

  it('maps 422 to ValidationError surfacing GitHub field messages', () => {
    const err = toGithubError(
      octokitError(
        422,
        {},
        {
          message: 'Validation Failed',
          errors: [
            { field: 'name', code: 'missing_field', message: 'name is required' },
            { field: 'visibility', code: 'invalid', message: 'visibility is invalid' },
          ],
        }
      )
    )
    expect(err).toBeInstanceOf(ValidationError)
    expect(err._tag).toBe('ValidationError')
    expect(err.message).toContain('name is required')
    expect(err.message).toContain('visibility is invalid')
  })

  it('falls back to ValidationError for unknown/non-Octokit shapes', () => {
    const err = toGithubError({ message: 'totally unexpected' })
    expect(err._tag).toBe('ValidationError')
  })
})
