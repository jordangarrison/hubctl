import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'

import { Github } from '../github/client'
import type { GithubError } from '../github/errors'

// Domain service for the `teams` command group. Depends only on `Github`;
// mirrors the data shaping in lib/hubctl/teams.rb so the JSON envelope matches
// the Ruby tool's output fields. Each method maps a GitHub REST route through
// `Github.request`/`paginate` and reshapes the raw payload.

export type TeamPrivacy = 'secret' | 'closed'
export type TeamPermission = 'pull' | 'triage' | 'push' | 'maintain' | 'admin'
export type TeamRole = 'member' | 'maintainer'

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

export interface TeamsShape {
  readonly list: (org: string) => Effect.Effect<ReadonlyArray<TeamListItem>, GithubError>
  readonly create: (org: string, name: string, input: CreateInput) => Effect.Effect<CreatedTeam, GithubError>
  readonly members: (org: string, team: string) => Effect.Effect<ReadonlyArray<TeamMember>, GithubError>
  readonly add: (org: string, team: string, user: string, role: TeamRole) => Effect.Effect<AddResult, GithubError>
  readonly remove: (org: string, team: string, user: string) => Effect.Effect<RemoveResult, GithubError>
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
const decodeSummaries = Schema.decodeUnknownSync(Schema.Array(TeamSummary))

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

// Created-team summary fields (lib/hubctl/teams.rb#create).
const TeamCreated = Schema.Struct({
  id: Schema.Finite,
  name: Schema.String,
  slug: Schema.String,
  privacy: Schema.String,
  permission: Schema.String,
})
const decodeCreated = Schema.decodeUnknownSync(TeamCreated)

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
const decodeMembers = Schema.decodeUnknownSync(Schema.Array(Member))

const toMember = (member: typeof Member.Type): TeamMember => ({
  login: member.login,
  id: member.id,
  type: member.type,
  site_admin: member.site_admin,
  url: member.html_url,
})

// The membership endpoint response carries the resulting `state`/`role`.
const Membership = Schema.Struct({ state: Schema.String, role: Schema.String })
const decodeMembership = Schema.decodeUnknownSync(Membership)

export class Teams extends Context.Service<Teams, TeamsShape>()('Teams') {
  static readonly layer: Layer.Layer<Teams, never, Github> = Layer.effect(
    Teams,
    Effect.gen(function* () {
      const github = yield* Github

      const list: TeamsShape['list'] = (org) =>
        github.paginate('GET /orgs/{org}/teams', { org }).pipe(
          Effect.map(decodeSummaries),
          Effect.map((teams) => teams.map(toListItem)),
          Effect.withSpan('Teams.list')
        )

      const create: TeamsShape['create'] = (org, name, input) =>
        github
          .request('POST /orgs/{org}/teams', { org, ...createBody(name, input) })
          .pipe(Effect.map(decodeCreated), Effect.withSpan('Teams.create'))

      const members: TeamsShape['members'] = (org, team) =>
        github.paginate('GET /orgs/{org}/teams/{team_slug}/members', { org, team_slug: team }).pipe(
          Effect.map(decodeMembers),
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
            Effect.map((raw) => {
              const membership = decodeMembership(raw)
              return { team, user, role: membership.role, state: membership.state }
            }),
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

      return { list, create, members, add, remove }
    })
  )
}
