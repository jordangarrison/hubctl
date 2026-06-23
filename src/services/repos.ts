import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'
import type { PlatformError } from 'effect/PlatformError'
import * as Schema from 'effect/Schema'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

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

// Full detail shape for `repos show` (lib/hubctl/repos.rb#show `repo_details`).
export interface RepoDetail {
  readonly name: string
  readonly full_name: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly description: string | null
  readonly private: boolean
  readonly fork: boolean
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly language: string | null
  readonly size: string
  readonly stars: number
  readonly watchers: number
  readonly forks: number
  readonly open_issues: number
  readonly default_branch: string
  readonly created_at: string
  readonly updated_at: string
  readonly pushed_at: string
  readonly clone_url: string
  readonly ssh_url: string
  readonly html_url: string
}

export interface CreateInput {
  readonly org?: string
  readonly description?: string
  readonly private: boolean
  readonly init: boolean
  readonly gitignore?: string
  readonly license?: string
}

// Summary returned after creating a repo (lib/hubctl/repos.rb#create surfaces
// `full_name`/`clone_url`/`html_url`).
export interface CreatedRepo {
  readonly name: string
  readonly full_name: string
  readonly private: boolean
  readonly clone_url: string
  readonly html_url: string
}

export interface CloneInput {
  readonly path?: string
  readonly depth?: number
}

// Outcome of a clone: the resolved git invocation (a single string for agents),
// the clone URL, where it landed, and git's exit code. The raw git output is
// intentionally NOT captured into the envelope (design "do not stream git output
// into the envelope").
export interface CloneResult {
  readonly command: string
  readonly clone_url: string
  readonly target_path: string
  readonly exit_code: number
}

export interface ReposShape {
  readonly list: (input: ListInput) => Effect.Effect<ReadonlyArray<RepoListItem>, GithubError>
  readonly show: (repo: string) => Effect.Effect<RepoDetail, GithubError>
  readonly create: (name: string, input: CreateInput) => Effect.Effect<CreatedRepo, GithubError>
  // `clone` shells out to git, so it additionally requires the platform
  // `ChildProcessSpawner` and can fail with a `PlatformError` if the spawn fails.
  readonly clone: (
    repo: string,
    input: CloneInput
  ) => Effect.Effect<CloneResult, GithubError | PlatformError, ChildProcessSpawner.ChildProcessSpawner>
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

// Full repo payload for `show`. `description`/`language` stay nullable on the
// wire (the detail view shows them verbatim, unlike the list's '-' default).
const RepoFull = Schema.Struct({
  name: Schema.String,
  full_name: Schema.String,
  description: Schema.NullOr(Schema.String),
  // `private`/`fork` are GitHub's wire field names; the is*-prefix idiom doesn't apply.
  // eslint-disable-next-line effect/require-is-prefix-for-boolean-schema-field
  private: Schema.Boolean,
  // eslint-disable-next-line effect/require-is-prefix-for-boolean-schema-field
  fork: Schema.Boolean,
  language: Schema.NullOr(Schema.String),
  size: Schema.Finite,
  stargazers_count: Schema.Finite,
  watchers_count: Schema.Finite,
  forks_count: Schema.Finite,
  open_issues_count: Schema.Finite,
  default_branch: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  pushed_at: Schema.String,
  clone_url: Schema.String,
  ssh_url: Schema.String,
  html_url: Schema.String,
})

const decodeFull = Schema.decodeUnknownSync(RepoFull)

// Created-repo summary fields (lib/hubctl/repos.rb#create).
const RepoCreated = Schema.Struct({
  name: Schema.String,
  full_name: Schema.String,
  // eslint-disable-next-line effect/require-is-prefix-for-boolean-schema-field
  private: Schema.Boolean,
  clone_url: Schema.String,
  html_url: Schema.String,
})

const decodeCreated = Schema.decodeUnknownSync(RepoCreated)

// Just the `clone_url` the `clone` flow needs from the repo payload.
const RepoCloneUrl = Schema.Struct({ clone_url: Schema.String })
const decodeCloneUrl = Schema.decodeUnknownSync(RepoCloneUrl)

// Basename of an "owner/name(.git)" repo argument, dropping any trailing `.git`
// — mirrors the Ruby `File.basename(repo, '.git')` default clone target.
const basename = (repo: string): string => {
  const slash = repo.lastIndexOf('/')
  const tail = slash === -1 ? repo : repo.slice(slash + 1)
  return tail.endsWith('.git') ? tail.slice(0, -'.git'.length) : tail
}

// Build the `git clone` argv (mirrors the Ruby clone_cmd assembly): an optional
// `--depth N`, the clone URL, and an optional explicit target path.
const cloneArgs = (cloneUrl: string, input: CloneInput): ReadonlyArray<string> => [
  'clone',
  ...(input.depth === undefined ? [] : ['--depth', String(input.depth)]),
  cloneUrl,
  ...(input.path === undefined ? [] : [input.path]),
]

// Build the create-repo request body, mirroring the Ruby `create_options`
// assembly: always send `description`/`private`/`auto_init`, and only include
// the gitignore/license templates when the caller supplied them.
const createBody = (name: string, input: CreateInput): Record<string, unknown> => ({
  name,
  ...(input.description === undefined ? {} : { description: input.description }),
  private: input.private,
  auto_init: input.init,
  ...(input.gitignore === undefined ? {} : { gitignore_template: input.gitignore }),
  ...(input.license === undefined ? {} : { license_template: input.license }),
})

const toDetail = (repo: typeof RepoFull.Type): RepoDetail => ({
  name: repo.name,
  full_name: repo.full_name,
  description: repo.description,
  private: repo.private,
  fork: repo.fork,
  language: repo.language,
  size: `${repo.size} KB`,
  stars: repo.stargazers_count,
  watchers: repo.watchers_count,
  forks: repo.forks_count,
  open_issues: repo.open_issues_count,
  default_branch: repo.default_branch,
  created_at: repo.created_at,
  updated_at: repo.updated_at,
  pushed_at: repo.pushed_at,
  clone_url: repo.clone_url,
  ssh_url: repo.ssh_url,
  html_url: repo.html_url,
})

// Split an "owner/name" repo argument into the `{ owner, repo }` route params
// GitHub's REST endpoints expect. A bare name (no slash) leaves `owner` empty —
// the request then 404s, surfacing the same NotFoundError the Ruby tool reports.
const splitRepo = (repo: string): { owner: string; repo: string } => {
  const slash = repo.indexOf('/')
  return slash === -1 ? { owner: '', repo } : { owner: repo.slice(0, slash), repo: repo.slice(slash + 1) }
}

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

      const show: ReposShape['show'] = (repo) =>
        github
          .request('GET /repos/{owner}/{repo}', splitRepo(repo))
          .pipe(Effect.map(decodeFull), Effect.map(toDetail), Effect.withSpan('Repos.show'))

      const create: ReposShape['create'] = (name, input) => {
        const org = O.fromNullishOr(input.org)
        const body = createBody(name, input)
        const effect = O.isSome(org)
          ? github.request('POST /orgs/{org}/repos', { org: org.value, ...body })
          : github.request('POST /user/repos', body)
        return effect.pipe(Effect.map(decodeCreated), Effect.withSpan('Repos.create'))
      }

      const clone: ReposShape['clone'] = (repo, input) =>
        github.request('GET /repos/{owner}/{repo}', splitRepo(repo)).pipe(
          Effect.map(decodeCloneUrl),
          Effect.flatMap((detail) => {
            const args = cloneArgs(detail.clone_url, input)
            const targetPath = input.path ?? basename(repo)
            return ChildProcessSpawner.ChildProcessSpawner.pipe(
              Effect.flatMap((spawner) => spawner.exitCode(ChildProcess.make('git', args))),
              Effect.map((exitCode) => ({
                command: `git ${args.join(' ')}`,
                clone_url: detail.clone_url,
                target_path: targetPath,
                exit_code: Number(exitCode),
              }))
            )
          }),
          Effect.withSpan('Repos.clone')
        )

      return { list, show, create, clone }
    })
  )
}
