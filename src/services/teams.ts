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

// Row shape for `teams list` (lib/hubctl/teams.rb#list `team_data`).
export interface TeamListItem {
  readonly id: number
  readonly name: string
  readonly slug: string
  readonly description: string
  readonly privacy: string
  readonly permission: string
  readonly members_count: number
  readonly repos_count: number
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

export interface TeamsShape {
  readonly list: (org: string) => Effect.Effect<ReadonlyArray<TeamListItem>, GithubError>
  readonly create: (org: string, name: string, input: CreateInput) => Effect.Effect<CreatedTeam, GithubError>
}

// Raw team payload fields read by `list`. `description` is nullable on the wire;
// the contract collapses it to '-' (matching the Ruby).
const TeamSummary = Schema.Struct({
  id: Schema.Finite,
  name: Schema.String,
  slug: Schema.String,
  description: Schema.NullOr(Schema.String),
  privacy: Schema.String,
  permission: Schema.String,
  members_count: Schema.Finite,
  repos_count: Schema.Finite,
})
const decodeSummaries = Schema.decodeUnknownSync(Schema.Array(TeamSummary))

const toListItem = (team: typeof TeamSummary.Type): TeamListItem => ({
  id: team.id,
  name: team.name,
  slug: team.slug,
  description: team.description ?? '-',
  privacy: team.privacy,
  permission: team.permission,
  members_count: team.members_count,
  repos_count: team.repos_count,
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

      return { list, create }
    })
  )
}
