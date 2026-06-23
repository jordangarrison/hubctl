import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'
import * as Schema from 'effect/Schema'

import { Github } from '../github/client'
import type { GithubError } from '../github/errors'

// Domain service for the `repos` command group. Depends only on `Github`;
// mirrors the data shaping in lib/hubctl/repos.rb so the JSON envelope matches
// the Ruby tool's output fields. Each method maps a GitHub REST route through
// `Github.request`/`paginate` and reshapes the raw payload.

export type RepoType = 'all' | 'public' | 'private' | 'forks' | 'sources' | 'member'
export type RepoSort = 'created' | 'updated' | 'pushed' | 'full_name'
export type RepoDirection = 'asc' | 'desc'

export interface ListInput {
  readonly org?: string
  readonly type: RepoType
  readonly sort: RepoSort
  readonly direction: RepoDirection
}

// Row shape for `repos list` (lib/hubctl/repos.rb#list `repo_data`).
export interface RepoListItem {
  readonly name: string
  readonly full_name: string
  readonly private: boolean
  readonly description: string
  readonly language: string
  readonly stars: number
  readonly forks: number
  readonly updated: string
}

export interface ReposShape {
  readonly list: (input: ListInput) => Effect.Effect<ReadonlyArray<RepoListItem>, GithubError>
}

// Raw repo payload fields we read. `description`/`language` are nullable on the
// GitHub API; the wire contract collapses them to '-' (matching the Ruby).
const RepoSummary = Schema.Struct({
  name: Schema.String,
  full_name: Schema.String,
  // `private` is GitHub's wire field name; the is*-prefix idiom doesn't apply.
  // eslint-disable-next-line effect/require-is-prefix-for-boolean-schema-field
  private: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
  language: Schema.NullOr(Schema.String),
  stargazers_count: Schema.Finite,
  forks_count: Schema.Finite,
  updated_at: Schema.String,
})

const decodeSummaries = Schema.decodeUnknownSync(Schema.Array(RepoSummary))

const toListItem = (repo: typeof RepoSummary.Type): RepoListItem => ({
  name: repo.name,
  full_name: repo.full_name,
  private: repo.private,
  description: repo.description ?? '-',
  language: repo.language ?? '-',
  stars: repo.stargazers_count,
  forks: repo.forks_count,
  updated: repo.updated_at,
})

// GitHub's repo list treats `type=all` as the default; the Ruby omits the param
// in that case (`options[:type] == 'all' ? nil : options[:type]`), so we mirror
// that and only send an explicit non-`all` type.
const listParams = (input: ListInput): Record<string, unknown> => ({
  sort: input.sort,
  direction: input.direction,
  ...(input.type === 'all' ? {} : { type: input.type }),
})

export class Repos extends Context.Service<Repos, ReposShape>()('Repos') {
  static readonly layer: Layer.Layer<Repos, never, Github> = Layer.effect(
    Repos,
    Effect.gen(function* () {
      const github = yield* Github

      const list: ReposShape['list'] = (input) => {
        const org = O.fromNullishOr(input.org)
        const route = O.isSome(org) ? 'GET /orgs/{org}/repos' : 'GET /user/repos'
        const params = O.isSome(org) ? { org: org.value, ...listParams(input) } : listParams(input)
        return github.paginate(route, params).pipe(
          Effect.map(decodeSummaries),
          Effect.map((repos) => repos.map(toListItem)),
          Effect.withSpan('Repos.list')
        )
      }

      return { list }
    })
  )
}
