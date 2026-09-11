import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'

import { Github } from '../github/client'
import type { GithubError } from '../github/errors'
import { decode } from '../schema/decode'

// Domain service for the `teams` command group. Depends only on `Github`;
// mirrors the data shaping in lib/hubctl/teams.rb so the JSON envelope matches
// the Ruby tool's output fields. Each method maps a GitHub REST route through
// `Github.request`/`paginate` and reshapes the raw payload.

export type TeamPrivacy = 'secret' | 'closed'
export type TeamPermission = 'pull' | 'triage' | 'push' | 'maintain' | 'admin'
export type TeamRole = 'member' | 'maintainer'
// Repository permission granted to a team (GitHub's `permission` body value on
// the add-or-update team repository endpoint). Same ladder as `TeamPermission`.
export type RepoPermission = 'pull' | 'triage' | 'push' | 'maintain' | 'admin'

// Row shape for `teams list` (lib/hubctl/teams.rb#list `team_data`). The list
// endpoint (GET /orgs/{org}/teams) does NOT return members_count/repos_count —
// only the detail endpoint does — so those collapse to '-' when absent.
export interface TeamListItem {
  readonly id: number
  readonly name: string
  readonly slug: string
  readonly description: string
  readonly privacy: string
  readonly permission: string
  readonly members_count: number | '-'
  readonly repos_count: number | '-'
}

// Full detail shape for `teams show` (lib/hubctl/teams.rb#show `team_details`).
export interface TeamDetail {
  readonly id: number
  readonly name: string
  readonly slug: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly description: string | null
  readonly privacy: string
  readonly permission: string
  readonly members_count: number
  readonly repos_count: number
  readonly created_at: string
  readonly updated_at: string
  readonly url: string
}

export interface CreateInput {
  readonly description?: string
  readonly privacy: TeamPrivacy
  readonly permission: TeamPermission
}

// Summary returned after creating a team (lib/hubctl/teams.rb#create surfaces
// `id`/`name`/`slug`/`privacy`/`permission`).
export interface CreatedTeam {
  readonly id: number
  readonly name: string
  readonly slug: string
  readonly privacy: string
  readonly permission: string
}

// Row shape for `teams members` (lib/hubctl/teams.rb#members `member_data`).
export interface TeamMember {
  readonly login: string
  readonly id: number
  readonly type: string
  readonly site_admin: boolean
  readonly url: string
}

// Outcome of adding a user (lib/hubctl/teams.rb#add_member). `state`/`role` are
// read back from the membership endpoint's response.
export interface AddResult {
  readonly team: string
  readonly user: string
  readonly role: string
  readonly state: string
}

// Outcome of removing a user (lib/hubctl/teams.rb#remove_member).
export interface RemoveResult {
  readonly team: string
  readonly user: string
  readonly removed: boolean
}

// Row shape for `teams repo-access list`: a repository the team can access, with
// the team's effective permission on it (GET /orgs/{org}/teams/{team_slug}/repos).
export interface TeamRepo {
  readonly name: string
  readonly full_name: string
  readonly private: boolean
  readonly permission: string
}

// Outcome of granting/updating a team's access to a repository.
export interface RepoAccessResult {
  readonly team: string
  readonly owner: string
  readonly repo: string
  readonly permission: string
  readonly granted: boolean
}

// Outcome of revoking a team's access to a repository.
export interface RepoAccessRemoveResult {
  readonly team: string
  readonly owner: string
  readonly repo: string
  readonly removed: boolean
}

export interface TeamsShape {
  readonly list: (org: string) => Effect.Effect<ReadonlyArray<TeamListItem>, GithubError>
  readonly show: (org: string, team: string) => Effect.Effect<TeamDetail, GithubError>
  readonly create: (org: string, name: string, input: CreateInput) => Effect.Effect<CreatedTeam, GithubError>
  readonly members: (org: string, team: string) => Effect.Effect<ReadonlyArray<TeamMember>, GithubError>
  readonly add: (org: string, team: string, user: string, role: TeamRole) => Effect.Effect<AddResult, GithubError>
  readonly remove: (org: string, team: string, user: string) => Effect.Effect<RemoveResult, GithubError>
  // List the repositories a team can access, with the team's effective permission.
  readonly repoAccess: (org: string, team: string) => Effect.Effect<ReadonlyArray<TeamRepo>, GithubError>
  // Grant or update a team's permission on a repository (owner is usually the org).
  readonly grantRepo: (
    org: string,
    team: string,
    owner: string,
    repo: string,
    permission: RepoPermission
  ) => Effect.Effect<RepoAccessResult, GithubError>
  // Revoke a team's access to a repository entirely.
  readonly removeRepo: (
    org: string,
    team: string,
    owner: string,
    repo: string
  ) => Effect.Effect<RepoAccessRemoveResult, GithubError>
}

// Raw team payload fields read by `list`. `description` is nullable on the wire;
// the contract collapses it to '-' (matching the Ruby). members_count/repos_count
// are NOT returned by GET /orgs/{org}/teams (only the detail endpoint returns
// them), so they are optional here and collapse to '-' when absent.
const TeamSummary = Schema.Struct({
  id: Schema.Finite,
  name: Schema.String,
  slug: Schema.String,
  description: Schema.NullOr(Schema.String),
  privacy: Schema.String,
  permission: Schema.String,
  members_count: Schema.optional(Schema.Finite),
  repos_count: Schema.optional(Schema.Finite),
})
const decodeSummaries = decode(Schema.Array(TeamSummary), 'teams list item')

const toListItem = (team: typeof TeamSummary.Type): TeamListItem => ({
  id: team.id,
  name: team.name,
  slug: team.slug,
  description: team.description ?? '-',
  privacy: team.privacy,
  permission: team.permission,
  members_count: team.members_count ?? '-',
  repos_count: team.repos_count ?? '-',
})

// Full team payload for `show`, read from the detail endpoint
// (GET /orgs/{org}/teams/{team_slug}) which — unlike the list endpoint —
// returns members_count/repos_count/created_at/updated_at/html_url.
const TeamFull = Schema.Struct({
  id: Schema.Finite,
  name: Schema.String,
  slug: Schema.String,
  description: Schema.NullOr(Schema.String),
  privacy: Schema.String,
  permission: Schema.String,
  members_count: Schema.Finite,
  repos_count: Schema.Finite,
  created_at: Schema.String,
  updated_at: Schema.String,
  html_url: Schema.String,
})
const decodeFull = decode(TeamFull, 'team detail')

const toDetail = (team: typeof TeamFull.Type): TeamDetail => ({
  id: team.id,
  name: team.name,
  slug: team.slug,
  description: team.description,
  privacy: team.privacy,
  permission: team.permission,
  members_count: team.members_count,
  repos_count: team.repos_count,
  created_at: team.created_at,
  updated_at: team.updated_at,
  url: team.html_url,
})

// Created-team summary fields (lib/hubctl/teams.rb#create).
const TeamCreated = Schema.Struct({
  id: Schema.Finite,
  name: Schema.String,
  slug: Schema.String,
  privacy: Schema.String,
  permission: Schema.String,
})
const decodeCreated = decode(TeamCreated, 'created team')

// Build the create-team request body, mirroring the Ruby `team_options`
// assembly: always send `name`/`privacy`/`permission`, and only include the
// description when the caller supplied one.
const createBody = (name: string, input: CreateInput): Record<string, unknown> => ({
  name,
  privacy: input.privacy,
  permission: input.permission,
  ...(input.description === undefined ? {} : { description: input.description }),
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
const decodeMembers = decode(Schema.Array(Member), 'team member')

const toMember = (member: typeof Member.Type): TeamMember => ({
  login: member.login,
  id: member.id,
  type: member.type,
  site_admin: member.site_admin,
  url: member.html_url,
})

// The membership endpoint response carries the resulting `state`/`role`.
const Membership = Schema.Struct({ state: Schema.String, role: Schema.String })
const decodeMembership = decode(Membership, 'team membership')

// Raw repo payload fields read by `repoAccess`. GitHub returns each repo with a
// `role_name` (the team's effective permission, e.g. "read"/"write"/"admin") and
// a `permissions` map; `role_name` is the authoritative label so we prefer it and
// fall back to the highest granted bit in `permissions` when it is absent.
const TeamRepoRaw = Schema.Struct({
  name: Schema.String,
  full_name: Schema.String,
  // `private` is GitHub's wire field name; the is*-prefix idiom doesn't apply.
  // eslint-disable-next-line effect/require-is-prefix-for-boolean-schema-field
  private: Schema.Boolean,
  role_name: Schema.optional(Schema.String),
  permissions: Schema.optional(
    Schema.Struct({
      // eslint-disable-next-line effect/require-is-prefix-for-boolean-schema-field
      admin: Schema.Boolean,
      maintain: Schema.optional(Schema.Boolean),
      // eslint-disable-next-line effect/require-is-prefix-for-boolean-schema-field
      push: Schema.Boolean,
      triage: Schema.optional(Schema.Boolean),
      // eslint-disable-next-line effect/require-is-prefix-for-boolean-schema-field
      pull: Schema.Boolean,
    })
  ),
})
const decodeTeamRepos = decode(Schema.Array(TeamRepoRaw), 'team repo list')

// Collapse a `permissions` map to a single highest-privilege label, checked from
// the top of the ladder down. Absent map ⇒ '-'.
const highestPermission = (permissions: typeof TeamRepoRaw.Type.permissions): string => {
  if (permissions === undefined) {
    return '-'
  }
  if (permissions.admin) {
    return 'admin'
  }
  if (permissions.maintain === true) {
    return 'maintain'
  }
  if (permissions.push) {
    return 'push'
  }
  if (permissions.triage === true) {
    return 'triage'
  }
  if (permissions.pull) {
    return 'pull'
  }
  return '-'
}

const toTeamRepo = (repo: typeof TeamRepoRaw.Type): TeamRepo => ({
  name: repo.name,
  full_name: repo.full_name,
  private: repo.private,
  permission: repo.role_name ?? highestPermission(repo.permissions),
})

export class Teams extends Context.Service<Teams, TeamsShape>()('Teams') {
  static readonly layer: Layer.Layer<Teams, never, Github> = Layer.effect(
    Teams,
    Effect.gen(function* () {
      const github = yield* Github

      const list: TeamsShape['list'] = (org) =>
        github.paginate('GET /orgs/{org}/teams', { org }).pipe(
          Effect.flatMap(decodeSummaries),
          Effect.map((teams) => teams.map(toListItem)),
          Effect.withSpan('Teams.list')
        )

      // `show` reads the team detail endpoint (which returns the
      // members_count/repos_count/timestamps the list endpoint omits) rather than
      // scanning the list, surfacing the same NotFoundError the Ruby reports when
      // the slug is unknown.
      const show: TeamsShape['show'] = (org, team) =>
        github
          .request('GET /orgs/{org}/teams/{team_slug}', { org, team_slug: team })
          .pipe(Effect.flatMap(decodeFull), Effect.map(toDetail), Effect.withSpan('Teams.show'))

      const create: TeamsShape['create'] = (org, name, input) =>
        github
          .request('POST /orgs/{org}/teams', { org, ...createBody(name, input) })
          .pipe(Effect.flatMap(decodeCreated), Effect.withSpan('Teams.create'))

      const members: TeamsShape['members'] = (org, team) =>
        github.paginate('GET /orgs/{org}/teams/{team_slug}/members', { org, team_slug: team }).pipe(
          Effect.flatMap(decodeMembers),
          Effect.map((list_) => list_.map(toMember)),
          Effect.withSpan('Teams.members')
        )

      // Preserve the Ruby's newer org-based membership endpoint (equivalent to
      // octokit.js addOrUpdateMembershipForUserInOrg): a PUT against the team's
      // org+slug route, which can both invite to the org and add to the team.
      const add: TeamsShape['add'] = (org, team, user, role) =>
        github
          .request('PUT /orgs/{org}/teams/{team_slug}/memberships/{username}', {
            org,
            team_slug: team,
            username: user,
            role,
          })
          .pipe(
            Effect.flatMap((raw) =>
              Effect.map(decodeMembership(raw), (membership) => ({
                team,
                user,
                role: membership.role,
                state: membership.state,
              }))
            ),
            Effect.withSpan('Teams.add')
          )

      const remove: TeamsShape['remove'] = (org, team, user) =>
        github
          .request('DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}', {
            org,
            team_slug: team,
            username: user,
          })
          .pipe(Effect.as({ team, user, removed: true }), Effect.withSpan('Teams.remove'))

      const repoAccess: TeamsShape['repoAccess'] = (org, team) =>
        github.paginate('GET /orgs/{org}/teams/{team_slug}/repos', { org, team_slug: team }).pipe(
          Effect.flatMap(decodeTeamRepos),
          Effect.map((list_) => list_.map(toTeamRepo)),
          Effect.withSpan('Teams.repoAccess')
        )

      // PUT add-or-update returns 204 No Content, so there is no body to decode;
      // echo the request inputs back as the result (mirrors `add`/`remove`).
      const grantRepo: TeamsShape['grantRepo'] = (org, team, owner, repo, permission) =>
        github
          .request('PUT /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}', {
            org,
            team_slug: team,
            owner,
            repo,
            permission,
          })
          .pipe(Effect.as({ team, owner, repo, permission, granted: true }), Effect.withSpan('Teams.grantRepo'))

      const removeRepo: TeamsShape['removeRepo'] = (org, team, owner, repo) =>
        github
          .request('DELETE /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}', { org, team_slug: team, owner, repo })
          .pipe(Effect.as({ team, owner, repo, removed: true }), Effect.withSpan('Teams.removeRepo'))

      return { list, show, create, members, add, remove, repoAccess, grantRepo, removeRepo }
    })
  )
}
