import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { reposCommand } from '../../src/cli/repos'
import { runCli } from '../helpers/run-cli'

// Command-level tests: drive the real `Command.runWith` over the network-free
// test layer (FakeGithub + captured stdout) and assert on the emitted envelope.

const repoPayload = {
  name: 'hello',
  full_name: 'octocat/hello',
  private: false,
  description: 'A test repo',
  language: 'TypeScript',
  stargazers_count: 42,
  forks_count: 3,
  updated_at: '2021-01-01T00:00:00Z',
}

const RepoListItem = Schema.Struct({
  name: Schema.String,
  full_name: Schema.String,
  // `private` is GitHub's wire field name; the is*-prefix idiom doesn't apply.
  // eslint-disable-next-line effect/require-is-prefix-for-boolean-schema-field
  private: Schema.Boolean,
  description: Schema.String,
  language: Schema.String,
  stars: Schema.Finite,
  forks: Schema.Finite,
  updated: Schema.String,
})
const decodeList = Schema.decodeUnknownSync(Schema.Array(RepoListItem))

const GroupTree = Schema.Struct({
  commands: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
})
const decodeGroup = Schema.decodeUnknownSync(GroupTree)

describe('repos command', () => {
  it.effect('with no subcommand lists its subcommands', () =>
    Effect.gen(function* () {
      const env = yield* runCli(reposCommand, [])
      expect(env.ok).toBe(true)
      expect(env.command).toBe('repos')

      const tree = decodeGroup(env.result)
      const names = tree.commands.map((c) => c.name)
      expect(names).toContain('list')
    })
  )

  describe('list', () => {
    it.effect('emits a repos.list envelope with shaped rows and next_actions', () =>
      Effect.gen(function* () {
        const env = yield* runCli(reposCommand, ['list'], { github: { routes: { 'GET /user/repos': [repoPayload] } } })

        expect(env.ok).toBe(true)
        expect(env.command).toBe('repos.list')
        expect(env.error).toBeNull()

        const rows = decodeList(env.result)
        expect(rows).toHaveLength(1)
        expect(rows[0]?.name).toBe('hello')
        expect(rows[0]?.stars).toBe(42)

        expect(env.next_actions).toContain('hubctl repos show <repo>')
        expect(env.next_actions).toContain('hubctl repos archive <repo> --yes')
      })
    )

    it.effect('uses the org route when --org is passed', () =>
      Effect.gen(function* () {
        const env = yield* runCli(reposCommand, ['list', '--org', 'acme'], {
          github: { routes: { 'GET /orgs/{org}/repos': [repoPayload] } },
        })

        expect(env.ok).toBe(true)
        const rows = decodeList(env.result)
        expect(rows[0]?.name).toBe('hello')
      })
    )

    it.effect('surfaces an ok:false envelope with a fix when the org 404s', () =>
      Effect.gen(function* () {
        const env = yield* runCli(reposCommand, ['list', '--org', 'missing'], {
          github: { fail: { 'GET /orgs/{org}/repos': 404 } },
        })

        expect(env.ok).toBe(false)
        expect(env.command).toBe('repos.list')
        expect(env.result).toBeNull()
        expect(env.error?.code).toBe('NotFoundError')
        expect(env.fix).not.toBeNull()
      })
    )
  })
})
