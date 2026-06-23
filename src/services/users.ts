import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'

import { Github } from '../github/client'
import type { GithubError } from '../github/errors'

// Domain service for the `users` command group. Depends only on `Github`;
// mirrors the data shaping in lib/hubctl/users.rb so the JSON envelope matches
// the Ruby tool's output fields. Each method maps a GitHub REST route through
// `Github.request`/`paginate` and reshapes the raw payload.

// Full detail shape for `users show` (lib/hubctl/users.rb#show `user_details`).
export interface UserDetail {
  readonly login: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly name: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly email: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly bio: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly company: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly location: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly blog: string | null
  readonly public_repos: number
  readonly public_gists: number
  readonly followers: number
  readonly following: number
  readonly created_at: string
  readonly updated_at: string
  readonly url: string
}

// Current-user info shape for `users whoami` (lib/hubctl/users.rb#whoami).
export interface WhoamiInfo {
  readonly login: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly name: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly email: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly company: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly plan: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly private_repos: number | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly collaborators: number | null
  readonly disk_usage: string
}

// Row shape for `users list` (lib/hubctl/users.rb#list `user_data`).
export interface UserListItem {
  readonly login: string
  readonly id: number
  readonly type: string
  readonly site_admin: boolean
  readonly url: string
}

export type UserRole = 'all' | 'admin' | 'member'

export interface ListInput {
  readonly role?: UserRole
}

export interface InviteInput {
  readonly role?: string
  readonly teamIds?: ReadonlyArray<number>
}

// Outcome of an invitation (lib/hubctl/users.rb#invite via github_client).
export interface InviteResult {
  readonly id: number
  readonly invited: string
}

// Outcome of removing a member (lib/hubctl/users.rb#remove).
export interface RemoveResult {
  readonly org: string
  readonly user: string
  readonly removed: boolean
}

export interface UsersShape {
  readonly show: (username: string) => Effect.Effect<UserDetail, GithubError>
  readonly whoami: Effect.Effect<WhoamiInfo, GithubError>
  readonly list: (org: string, input: ListInput) => Effect.Effect<ReadonlyArray<UserListItem>, GithubError>
  readonly invite: (org: string, target: string, input: InviteInput) => Effect.Effect<InviteResult, GithubError>
  readonly remove: (org: string, user: string) => Effect.Effect<RemoveResult, GithubError>
}

// Full user payload for `show`. Profile fields are nullable on the GitHub API;
// the detail view shows them verbatim (matching the Ruby).
const UserFull = Schema.Struct({
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  bio: Schema.NullOr(Schema.String),
  company: Schema.NullOr(Schema.String),
  location: Schema.NullOr(Schema.String),
  blog: Schema.NullOr(Schema.String),
  public_repos: Schema.Finite,
  public_gists: Schema.Finite,
  followers: Schema.Finite,
  following: Schema.Finite,
  created_at: Schema.String,
  updated_at: Schema.String,
  html_url: Schema.String,
})
const decodeFull = Schema.decodeUnknownSync(UserFull)

const toDetail = (user: typeof UserFull.Type): UserDetail => ({
  login: user.login,
  name: user.name,
  email: user.email,
  bio: user.bio,
  company: user.company,
  location: user.location,
  blog: user.blog,
  public_repos: user.public_repos,
  public_gists: user.public_gists,
  followers: user.followers,
  following: user.following,
  created_at: user.created_at,
  updated_at: user.updated_at,
  url: user.html_url,
})

// Current-user payload for `whoami`. Many fields are present only for the
// authenticated user and may be null; `plan` is a nested object whose `name`
// the Ruby surfaces.
const CurrentUser = Schema.Struct({
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  company: Schema.NullOr(Schema.String),
  plan: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  owned_private_repos: Schema.optional(Schema.NullOr(Schema.Finite)),
  collaborators: Schema.optional(Schema.NullOr(Schema.Finite)),
  disk_usage: Schema.optional(Schema.NullOr(Schema.Finite)),
})
const decodeCurrent = Schema.decodeUnknownSync(CurrentUser)

const toWhoami = (user: typeof CurrentUser.Type): WhoamiInfo => ({
  login: user.login,
  name: user.name,
  email: user.email,
  company: user.company,
  plan: user.plan?.name ?? null,
  private_repos: user.owned_private_repos ?? null,
  collaborators: user.collaborators ?? null,
  disk_usage: `${user.disk_usage ?? 0} KB`,
})

// Raw member payload fields read by `list`.
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

const toListItem = (member: typeof Member.Type): UserListItem => ({
  login: member.login,
  id: member.id,
  type: member.type,
  site_admin: member.site_admin,
  url: member.html_url,
})

// GitHub's member list treats `role=all` as the default; the Ruby omits the
// param in that case, so we mirror that and only send an explicit non-`all` role.
const listParams = (input: ListInput): Record<string, unknown> =>
  input.role === undefined || input.role === 'all' ? {} : { role: input.role }

// The user-lookup payload for inviting by username (only the numeric id matters).
const UserId = Schema.Struct({ id: Schema.Finite })
const decodeUserId = Schema.decodeUnknownSync(UserId)

// The invitation response carries the new invitation id.
const Invitation = Schema.Struct({ id: Schema.Finite })
const decodeInvitation = Schema.decodeUnknownSync(Invitation)

// Extra invitation body fields (role/team_ids) only included when supplied,
// mirroring the Ruby's options merge.
const inviteOptions = (input: InviteInput): Record<string, unknown> => ({
  ...(input.role === undefined ? {} : { role: input.role }),
  ...(input.teamIds === undefined ? {} : { team_ids: input.teamIds }),
})

// Whether the invite target looks like an email (vs a username) — mirrors the
// Ruby `email_or_username.include?('@')` branch.
const isEmail = (target: string): boolean => target.includes('@')

export class Users extends Context.Service<Users, UsersShape>()('Users') {
  static readonly layer: Layer.Layer<Users, never, Github> = Layer.effect(
    Users,
    Effect.gen(function* () {
      const github = yield* Github

      const show: UsersShape['show'] = (username) =>
        github
          .request('GET /users/{username}', { username })
          .pipe(Effect.map(decodeFull), Effect.map(toDetail), Effect.withSpan('Users.show'))

      const whoami: UsersShape['whoami'] = github
        .request('GET /user')
        .pipe(Effect.map(decodeCurrent), Effect.map(toWhoami), Effect.withSpan('Users.whoami'))

      const list: UsersShape['list'] = (org, input) =>
        github.paginate('GET /orgs/{org}/members', { org, ...listParams(input) }).pipe(
          Effect.map(decodeMembers),
          Effect.map((members) => members.map(toListItem)),
          Effect.withSpan('Users.list')
        )

      const invite: UsersShape['invite'] = (org, target, input) => {
        const options = inviteOptions(input)
        const body: Effect.Effect<Record<string, unknown>, GithubError> = isEmail(target)
          ? Effect.succeed({ email: target, ...options })
          : github
              .request('GET /users/{username}', { username: target })
              .pipe(Effect.map((raw) => ({ invitee_id: decodeUserId(raw).id, ...options })))
        return body.pipe(
          Effect.flatMap((payload) => github.request('POST /orgs/{org}/invitations', { org, ...payload })),
          Effect.map((raw) => ({ id: decodeInvitation(raw).id, invited: target })),
          Effect.withSpan('Users.invite')
        )
      }

      const remove: UsersShape['remove'] = (org, user) =>
        github
          .request('DELETE /orgs/{org}/members/{username}', { org, username: user })
          .pipe(Effect.as({ org, user, removed: true }), Effect.withSpan('Users.remove'))

      return { show, whoami, list, invite, remove }
    })
  )
}
