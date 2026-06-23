import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'

import { Github } from '../github/client'
import type { GithubError } from '../github/errors'

// Domain service for the `orgs` command group. Depends only on `Github`;
// mirrors the data shaping in lib/hubctl/orgs.rb so the JSON envelope matches
// the Ruby tool's output fields. Each method maps a GitHub REST route through
// `Github.request`/`paginate` and reshapes the raw payload.

// Row shape for `orgs list` (lib/hubctl/orgs.rb#list `org_data`).
export interface OrgListItem {
  readonly login: string
  readonly id: number
  readonly description: string
  readonly public_repos: number
  readonly public_gists: number
  readonly followers: number
  readonly following: number
  readonly url: string
}

// Full detail shape for `orgs show` (lib/hubctl/orgs.rb#show `org_details`).
export interface OrgDetail {
  readonly login: string
  readonly id: number
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly name: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly company: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly blog: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly location: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly email: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly bio: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly description: string | null
  readonly public_repos: number
  readonly public_gists: number
  readonly followers: number
  readonly following: number
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly collaborators: number | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly billing_email: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly plan: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly private_gists: number | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly total_private_repos: number | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly owned_private_repos: number | null
  readonly disk_usage: string
  readonly created_at: string
  readonly updated_at: string
  readonly url: string
}

// Row shape for `orgs members` (lib/hubctl/orgs.rb#members `member_data`).
export interface OrgMember {
  readonly login: string
  readonly id: number
  readonly type: string
  readonly site_admin: boolean
  readonly url: string
}

export type MemberRole = 'all' | 'admin' | 'member'

export interface MembersInput {
  readonly role?: MemberRole
  readonly twoFaDisabled?: boolean
}

// Row shape for `orgs repos` (lib/hubctl/orgs.rb#repos `repo_data`).
export interface OrgRepo {
  readonly name: string
  readonly private: boolean
  readonly description: string
  readonly language: string
  readonly stars: number
  readonly forks: number
  readonly updated: string
}

export type OrgRepoType = 'all' | 'public' | 'private' | 'forks' | 'sources' | 'member'
export type OrgRepoSort = 'created' | 'updated' | 'pushed' | 'full_name'

export interface ReposInput {
  readonly type: OrgRepoType
  readonly sort: OrgRepoSort
}

// Row shape for `orgs teams` (lib/hubctl/orgs.rb#teams `team_data`).
export interface OrgTeam {
  readonly name: string
  readonly slug: string
  readonly description: string
  readonly privacy: string
  readonly members_count: number
  readonly repos_count: number
}

// A single numbered org membership in the `orgs info` view.
export interface OrgMembership {
  readonly index: number
  readonly login: string
  readonly description: string
}

// Combined identity + memberships shape for `orgs info`
// (lib/hubctl/orgs.rb#info).
export interface OrgInfo {
  readonly login: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly name: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly plan: string | null
  readonly organizations: ReadonlyArray<OrgMembership>
}

export interface OrgsShape {
  readonly list: Effect.Effect<ReadonlyArray<OrgListItem>, GithubError>
  readonly show: (org: string) => Effect.Effect<OrgDetail, GithubError>
  readonly members: (org: string, input: MembersInput) => Effect.Effect<ReadonlyArray<OrgMember>, GithubError>
  readonly repos: (org: string, input: ReposInput) => Effect.Effect<ReadonlyArray<OrgRepo>, GithubError>
  readonly teams: (org: string) => Effect.Effect<ReadonlyArray<OrgTeam>, GithubError>
  readonly info: Effect.Effect<OrgInfo, GithubError>
}

// Raw org summary fields read by `list`. `description` is nullable on the wire;
// the contract collapses it to '-' (matching the Ruby).
const OrgSummary = Schema.Struct({
  login: Schema.String,
  id: Schema.Finite,
  description: Schema.NullOr(Schema.String),
  public_repos: Schema.Finite,
  public_gists: Schema.Finite,
  followers: Schema.Finite,
  following: Schema.Finite,
  html_url: Schema.String,
})
const decodeSummaries = Schema.decodeUnknownSync(Schema.Array(OrgSummary))

// Full org payload for `show`. Many fields are nullable on the GitHub API (and
// only present for orgs the caller administers); the detail view shows them
// verbatim (unlike the list's '-' default).
const OrgFull = Schema.Struct({
  login: Schema.String,
  id: Schema.Finite,
  name: Schema.NullOr(Schema.String),
  company: Schema.NullOr(Schema.String),
  blog: Schema.NullOr(Schema.String),
  location: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  bio: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  public_repos: Schema.Finite,
  public_gists: Schema.Finite,
  followers: Schema.Finite,
  following: Schema.Finite,
  collaborators: Schema.optional(Schema.NullOr(Schema.Finite)),
  billing_email: Schema.optional(Schema.NullOr(Schema.String)),
  plan: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  private_gists: Schema.optional(Schema.NullOr(Schema.Finite)),
  total_private_repos: Schema.optional(Schema.NullOr(Schema.Finite)),
  owned_private_repos: Schema.optional(Schema.NullOr(Schema.Finite)),
  disk_usage: Schema.optional(Schema.NullOr(Schema.Finite)),
  created_at: Schema.String,
  updated_at: Schema.String,
  html_url: Schema.String,
})
const decodeFull = Schema.decodeUnknownSync(OrgFull)

const toDetail = (org: typeof OrgFull.Type): OrgDetail => ({
  login: org.login,
  id: org.id,
  name: org.name,
  company: org.company,
  blog: org.blog,
  location: org.location,
  email: org.email,
  bio: org.bio,
  description: org.description,
  public_repos: org.public_repos,
  public_gists: org.public_gists,
  followers: org.followers,
  following: org.following,
  collaborators: org.collaborators ?? null,
  billing_email: org.billing_email ?? null,
  plan: org.plan?.name ?? null,
  private_gists: org.private_gists ?? null,
  total_private_repos: org.total_private_repos ?? null,
  owned_private_repos: org.owned_private_repos ?? null,
  disk_usage: `${org.disk_usage ?? 0} KB`,
  created_at: org.created_at,
  updated_at: org.updated_at,
  url: org.html_url,
})

// Raw member payload fields read by `members`.
const Member = Schema.Struct({
  login: Schema.String,
  id: Schema.Finite,
  type: Schema.String,
  // `site_admin` is GitHub's wire field name; the is*-prefix idiom doesn't apply.
  // eslint-disable-next-line effect/require-is-prefix-for-boolean-schema-field
  site_admin: Schema.Boolean,
  html_url: Schema.String,
})
const decodeMembers = Schema.decodeUnknownSync(Schema.Array(Member))

const toMember = (member: typeof Member.Type): OrgMember => ({
  login: member.login,
  id: member.id,
  type: member.type,
  site_admin: member.site_admin,
  url: member.html_url,
})

// GitHub's member list treats `role=all` as the default; the Ruby omits the
// param in that case, so we mirror that and only send an explicit non-`all`
// role. `--2fa-disabled` maps to the `filter=2fa_disabled` query param.
const memberParams = (input: MembersInput): Record<string, unknown> => ({
  ...(input.role === undefined || input.role === 'all' ? {} : { role: input.role }),
  ...(input.twoFaDisabled === true ? { filter: '2fa_disabled' } : {}),
})

const toListItem = (org: typeof OrgSummary.Type): OrgListItem => ({
  login: org.login,
  id: org.id,
  description: org.description ?? '-',
  public_repos: org.public_repos,
  public_gists: org.public_gists,
  followers: org.followers,
  following: org.following,
  url: org.html_url,
})

// Raw org-repo payload fields read by `repos`. `description`/`language` are
// nullable on the wire; the contract collapses them to '-' (matching the Ruby).
const OrgRepoRaw = Schema.Struct({
  name: Schema.String,
  // `private` is GitHub's wire field name; the is*-prefix idiom doesn't apply.
  // eslint-disable-next-line effect/require-is-prefix-for-boolean-schema-field
  private: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
  language: Schema.NullOr(Schema.String),
  stargazers_count: Schema.Finite,
  forks_count: Schema.Finite,
  updated_at: Schema.String,
})
const decodeRepos = Schema.decodeUnknownSync(Schema.Array(OrgRepoRaw))

const toRepo = (repo: typeof OrgRepoRaw.Type): OrgRepo => ({
  name: repo.name,
  private: repo.private,
  description: repo.description ?? '-',
  language: repo.language ?? '-',
  stars: repo.stargazers_count,
  forks: repo.forks_count,
  updated: repo.updated_at,
})

// GitHub's org-repo list treats `type=all` as the default; the Ruby omits the
// param in that case (`options[:type] == 'all' ? nil : options[:type]`), so we
// mirror that and only send an explicit non-`all` type. `sort` is always sent.
const repoParams = (input: ReposInput): Record<string, unknown> => ({
  sort: input.sort,
  ...(input.type === 'all' ? {} : { type: input.type }),
})

// Raw team payload fields read by `teams`. `description` is nullable on the
// wire; the contract collapses it to '-' (matching the Ruby).
const TeamRaw = Schema.Struct({
  name: Schema.String,
  slug: Schema.String,
  description: Schema.NullOr(Schema.String),
  privacy: Schema.String,
  members_count: Schema.Finite,
  repos_count: Schema.Finite,
})
const decodeTeams = Schema.decodeUnknownSync(Schema.Array(TeamRaw))

const toTeam = (team: typeof TeamRaw.Type): OrgTeam => ({
  name: team.name,
  slug: team.slug,
  description: team.description ?? '-',
  privacy: team.privacy,
  members_count: team.members_count,
  repos_count: team.repos_count,
})

// The authenticated-user payload `info` reads: login, optional display name, and
// the plan name (lib/hubctl/orgs.rb#info `user[:plan][:name]`).
const CurrentUser = Schema.Struct({
  login: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  plan: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
})
const decodeCurrentUser = Schema.decodeUnknownSync(CurrentUser)

// Number each membership and default a missing description to the Ruby's
// 'No description' marker (lib/hubctl/orgs.rb#info).
const toMembership = (org: typeof OrgSummary.Type, index: number): OrgMembership => ({
  index: index + 1,
  login: org.login,
  description: org.description ?? 'No description',
})

export class Orgs extends Context.Service<Orgs, OrgsShape>()('Orgs') {
  static readonly layer: Layer.Layer<Orgs, never, Github> = Layer.effect(
    Orgs,
    Effect.gen(function* () {
      const github = yield* Github

      const list: OrgsShape['list'] = github.paginate('GET /user/orgs').pipe(
        Effect.map(decodeSummaries),
        Effect.map((orgs) => orgs.map(toListItem)),
        Effect.withSpan('Orgs.list')
      )

      const show: OrgsShape['show'] = (org) =>
        github
          .request('GET /orgs/{org}', { org })
          .pipe(Effect.map(decodeFull), Effect.map(toDetail), Effect.withSpan('Orgs.show'))

      const members: OrgsShape['members'] = (org, input) =>
        github.paginate('GET /orgs/{org}/members', { org, ...memberParams(input) }).pipe(
          Effect.map(decodeMembers),
          Effect.map((list_) => list_.map(toMember)),
          Effect.withSpan('Orgs.members')
        )

      const repos: OrgsShape['repos'] = (org, input) =>
        github.paginate('GET /orgs/{org}/repos', { org, ...repoParams(input) }).pipe(
          Effect.map(decodeRepos),
          Effect.map((list_) => list_.map(toRepo)),
          Effect.withSpan('Orgs.repos')
        )

      const teams: OrgsShape['teams'] = (org) =>
        github.paginate('GET /orgs/{org}/teams', { org }).pipe(
          Effect.map(decodeTeams),
          Effect.map((list_) => list_.map(toTeam)),
          Effect.withSpan('Orgs.teams')
        )

      const info: OrgsShape['info'] = github.request('GET /user').pipe(
        Effect.flatMap((rawUser) =>
          Effect.map(github.paginate('GET /user/orgs'), (rawOrgs) => {
            const user = decodeCurrentUser(rawUser)
            return {
              login: user.login,
              name: user.name ?? null,
              plan: user.plan?.name ?? null,
              organizations: decodeSummaries(rawOrgs).map(toMembership),
            }
          })
        ),
        Effect.withSpan('Orgs.info')
      )

      return { list, show, members, repos, teams, info }
    })
  )
}
