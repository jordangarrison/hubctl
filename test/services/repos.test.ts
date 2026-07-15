import { assert, describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'

import { NotFoundError } from '../../src/github/errors'
import { DecodeError } from '../../src/schema/decode'
import { GitCloneError, Repos } from '../../src/services/repos'
import { FakeGithub } from '../helpers/fake-github'
import { FakeSpawner } from '../helpers/fake-spawner'
import type { SpawnerCapture } from '../helpers/fake-spawner'

// Repos depends only on Github (clone additionally needs a git runner, exercised
// in the command test). Over FakeGithub canned routes the service shapes each
// payload to mirror the Ruby `Hubctl::Repos` data, and surfaces typed
// GithubErrors in the `E` channel.

const repoPayload = {
  name: 'hello',
  full_name: 'octocat/hello',
  private: false,
  description: 'A test repo',
  language: 'TypeScript',
  fork: false,
  size: 128,
  stargazers_count: 42,
  watchers_count: 7,
  forks_count: 3,
  open_issues_count: 1,
  default_branch: 'main',
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2021-01-01T00:00:00Z',
  pushed_at: '2021-02-01T00:00:00Z',
  clone_url: 'https://github.com/octocat/hello.git',
  ssh_url: 'git@github.com:octocat/hello.git',
  html_url: 'https://github.com/octocat/hello',
  topics: ['cli', 'effect'],
}

// A valid repo summary payload with the required `full_name` field omitted, used
// to exercise the decode-error path.
const { full_name: _omitted, ...brokenRepoPayload } = repoPayload

const withTopics = (names: ReadonlyArray<string>) =>
  Repos.layer.pipe(
    Layer.provide(
      FakeGithub.layer({
        routes: {
          'GET /repos/{owner}/{repo}/topics': { names },
          'PUT /repos/{owner}/{repo}/topics': (params: Record<string, unknown>) => ({ names: params.names }),
        },
      })
    )
  )

describe('Repos service', () => {
  describe('list', () => {
    it.effect('lists the authenticated user repos via GET /user/repos', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const result = yield* repos.list({ type: 'all', sort: 'updated', direction: 'desc' })
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          name: 'hello',
          full_name: 'octocat/hello',
          private: false,
          description: 'A test repo',
          language: 'TypeScript',
          stars: 42,
          forks: 3,
          updated: '2021-01-01T00:00:00Z',
        })
      }).pipe(
        Effect.provide(
          Repos.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { 'GET /user/repos': [repoPayload] } })))
        )
      )
    )

    it.effect('lists org repos via GET /orgs/{org}/repos when org is set', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const result = yield* repos.list({ org: 'acme', type: 'all', sort: 'updated', direction: 'desc' })
        expect(result).toHaveLength(1)
        expect(result[0]?.name).toBe('hello')
      }).pipe(
        Effect.provide(
          Repos.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { 'GET /orgs/{org}/repos': [repoPayload] } })))
        )
      )
    )

    it.effect('defaults missing description/language to "-"', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const result = yield* repos.list({ type: 'all', sort: 'updated', direction: 'desc' })
        expect(result[0]?.description).toBe('-')
        expect(result[0]?.language).toBe('-')
      }).pipe(
        Effect.provide(
          Repos.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /user/repos': [{ ...repoPayload, description: null, language: null }],
                },
              })
            )
          )
        )
      )
    )

    it.effect('surfaces NotFoundError when the org 404s', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const exit = yield* Effect.exit(repos.list({ org: 'missing', type: 'all', sort: 'updated', direction: 'desc' }))
        expect(Exit.isFailure(exit)).toBe(true)
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(NotFoundError)
      }).pipe(
        Effect.provide(Repos.layer.pipe(Layer.provide(FakeGithub.layer({ fail: { 'GET /orgs/{org}/repos': 404 } }))))
      )
    )

    it.effect('a mismatched repo summary fails as a DecodeError, not a thrown defect', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        // `full_name` is a required Schema.String; omitting it must surface a
        // typed DecodeError in the E channel, not an uncaught defect.
        const exit = yield* Effect.exit(repos.list({ type: 'all', sort: 'updated', direction: 'desc' }))
        expect(Exit.isFailure(exit)).toBe(true)
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        assert(error instanceof DecodeError)
        expect(error.code).toBe('decode_error')
      }).pipe(
        Effect.provide(
          Repos.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /user/repos': [brokenRepoPayload],
                },
              })
            )
          )
        )
      )
    )
  })

  describe('show', () => {
    const showLayer = Repos.layer.pipe(
      Layer.provide(FakeGithub.layer({ routes: { 'GET /repos/{owner}/{repo}': repoPayload } }))
    )

    it.effect('returns the full repository detail shape', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const detail = yield* repos.show('octocat/hello')
        expect(detail).toEqual({
          name: 'hello',
          full_name: 'octocat/hello',
          description: 'A test repo',
          private: false,
          fork: false,
          language: 'TypeScript',
          size: '128 KB',
          stars: 42,
          watchers: 7,
          forks: 3,
          open_issues: 1,
          default_branch: 'main',
          created_at: '2020-01-01T00:00:00Z',
          updated_at: '2021-01-01T00:00:00Z',
          pushed_at: '2021-02-01T00:00:00Z',
          clone_url: 'https://github.com/octocat/hello.git',
          ssh_url: 'git@github.com:octocat/hello.git',
          html_url: 'https://github.com/octocat/hello',
        })
      }).pipe(Effect.provide(showLayer))
    )

    it.effect('passes owner/repo split to the route params', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const detail = yield* repos.show('octocat/hello')
        expect(detail.name).toBe('hello')
      }).pipe(
        Effect.provide(
          Repos.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'GET /repos/{owner}/{repo}': (params: Record<string, unknown>) =>
                    params.owner === 'octocat' && params.repo === 'hello'
                      ? repoPayload
                      : { ...repoPayload, name: 'WRONG' },
                },
              })
            )
          )
        )
      )
    )

    it.effect('surfaces NotFoundError on a 404', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const exit = yield* Effect.exit(repos.show('octocat/missing'))
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(NotFoundError)
      }).pipe(
        Effect.provide(
          Repos.layer.pipe(Layer.provide(FakeGithub.layer({ fail: { 'GET /repos/{owner}/{repo}': 404 } })))
        )
      )
    )
  })

  describe('create', () => {
    const created = {
      name: 'newrepo',
      full_name: 'octocat/newrepo',
      private: true,
      clone_url: 'https://github.com/octocat/newrepo.git',
      html_url: 'https://github.com/octocat/newrepo',
    }

    it.effect('creates a personal repo via POST /user/repos and returns the summary', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const result = yield* repos.create('newrepo', { private: true, init: true })
        expect(result).toEqual({
          name: 'newrepo',
          full_name: 'octocat/newrepo',
          private: true,
          clone_url: 'https://github.com/octocat/newrepo.git',
          html_url: 'https://github.com/octocat/newrepo',
        })
      }).pipe(
        Effect.provide(Repos.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { 'POST /user/repos': created } }))))
      )
    )

    it.effect('creates an org repo via POST /orgs/{org}/repos when org is set', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const result = yield* repos.create('newrepo', { org: 'acme', private: false, init: true })
        expect(result.full_name).toBe('octocat/newrepo')
      }).pipe(
        Effect.provide(
          Repos.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'POST /orgs/{org}/repos': (params: Record<string, unknown>) =>
                    params.org === 'acme' && params.name === 'newrepo' && params.auto_init === true
                      ? created
                      : { ...created, full_name: 'WRONG' },
                },
              })
            )
          )
        )
      )
    )

    it.effect('forwards gitignore and license templates when provided', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const result = yield* repos.create('newrepo', {
          private: false,
          init: true,
          description: 'desc',
          gitignore: 'Node',
          license: 'mit',
        })
        expect(result.name).toBe('newrepo')
      }).pipe(
        Effect.provide(
          Repos.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'POST /user/repos': (params: Record<string, unknown>) =>
                    params.gitignore_template === 'Node' &&
                    params.license_template === 'mit' &&
                    params.description === 'desc'
                      ? created
                      : { ...created, name: 'WRONG' },
                },
              })
            )
          )
        )
      )
    )
  })

  describe('clone', () => {
    const githubLayer = FakeGithub.layer({
      routes: { 'GET /repos/{owner}/{repo}': repoPayload },
    })

    it.effect('resolves the clone_url, runs git clone, and returns the resolved command', () =>
      Effect.gen(function* () {
        const capture: SpawnerCapture = { commands: [] }
        const repos = yield* Repos
        const result = yield* repos.clone('octocat/hello', {}).pipe(Effect.provide(FakeSpawner.layer(capture)))

        expect(result.clone_url).toBe('https://github.com/octocat/hello.git')
        expect(result.target_path).toBe('hello')
        expect(result.exit_code).toBe(0)
        expect(result.command).toBe('git clone https://github.com/octocat/hello.git')
        expect(capture.commands).toHaveLength(1)
        expect(capture.commands[0]).toEqual(['git', 'clone', 'https://github.com/octocat/hello.git'])
      }).pipe(Effect.provide(Repos.layer.pipe(Layer.provide(githubLayer))))
    )

    it.effect('honors --depth and --path', () =>
      Effect.gen(function* () {
        const capture: SpawnerCapture = { commands: [] }
        const repos = yield* Repos
        const result = yield* repos
          .clone('octocat/hello', { depth: 1, path: 'here' })
          .pipe(Effect.provide(FakeSpawner.layer(capture)))

        expect(result.target_path).toBe('here')
        expect(result.command).toBe('git clone --depth 1 https://github.com/octocat/hello.git here')
        expect(capture.commands[0]).toEqual([
          'git',
          'clone',
          '--depth',
          '1',
          'https://github.com/octocat/hello.git',
          'here',
        ])
      }).pipe(Effect.provide(Repos.layer.pipe(Layer.provide(githubLayer))))
    )

    it.effect('succeeds with exit_code 0 when git succeeds', () =>
      Effect.gen(function* () {
        const capture: SpawnerCapture = { commands: [] }
        const repos = yield* Repos
        const result = yield* repos.clone('octocat/hello', {}).pipe(Effect.provide(FakeSpawner.layer(capture, 0)))
        expect(result.exit_code).toBe(0)
      }).pipe(Effect.provide(Repos.layer.pipe(Layer.provide(githubLayer))))
    )

    it.effect('fails (typed error) when git exits non-zero, surfacing the exit code', () =>
      Effect.gen(function* () {
        const capture: SpawnerCapture = { commands: [] }
        const repos = yield* Repos
        const exit = yield* Effect.exit(
          repos.clone('octocat/hello', {}).pipe(Effect.provide(FakeSpawner.layer(capture, 128)))
        )
        expect(Exit.isFailure(exit)).toBe(true)
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        assert(error instanceof GitCloneError)
        expect(error.exitCode).toBe(128)
      }).pipe(Effect.provide(Repos.layer.pipe(Layer.provide(githubLayer))))
    )
  })

  describe('archive', () => {
    it.effect('PATCHes the repo with archived=true and returns the result', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const result = yield* repos.archive('octocat/hello')
        expect(result).toEqual({ full_name: 'octocat/hello', archived: true })
      }).pipe(
        Effect.provide(
          Repos.layer.pipe(
            Layer.provide(
              FakeGithub.layer({
                routes: {
                  'PATCH /repos/{owner}/{repo}': (params: Record<string, unknown>) =>
                    params.owner === 'octocat' && params.repo === 'hello' && params.archived === true
                      ? { full_name: 'octocat/hello', archived: true }
                      : { full_name: 'WRONG', archived: false },
                },
              })
            )
          )
        )
      )
    )

    it.effect('surfaces NotFoundError on a 404', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const exit = yield* Effect.exit(repos.archive('octocat/missing'))
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(NotFoundError)
      }).pipe(
        Effect.provide(
          Repos.layer.pipe(Layer.provide(FakeGithub.layer({ fail: { 'PATCH /repos/{owner}/{repo}': 404 } })))
        )
      )
    )
  })

  describe('topics', () => {
    it.effect('lists current topics when no modifications are given', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const result = yield* repos.topics('octocat/hello', {})
        expect(result).toEqual({ topics: ['cli', 'effect'], modified: false })
      }).pipe(Effect.provide(withTopics(['cli', 'effect'])))
    )

    it.effect('set replaces all topics', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const result = yield* repos.topics('octocat/hello', { set: ['fresh', 'list'] })
        expect(result).toEqual({ topics: ['fresh', 'list'], modified: true })
      }).pipe(Effect.provide(withTopics(['cli', 'effect'])))
    )

    it.effect('add and remove merge against current topics and dedupe', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const result = yield* repos.topics('octocat/hello', { add: ['new', 'cli'], remove: ['effect'] })
        expect(result.modified).toBe(true)
        expect(result.topics).toEqual(['cli', 'new'])
      }).pipe(Effect.provide(withTopics(['cli', 'effect'])))
    )
  })
})
