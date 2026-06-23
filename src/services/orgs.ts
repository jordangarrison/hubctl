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

export interface InviteInput {
  readonly role?: string
  readonly teamIds?: ReadonlyArray<number>
}

// Outcome of an invitation (lib/hubctl/orgs.rb#invite via github_client).
export interface InviteResult {
  readonly id: number
  readonly invited: string
}

export interface OrgsShape {
  readonly list: Effect.Effect<ReadonlyArray<OrgListItem>, GithubError>
  readonly show: (org: string) => Effect.Effect<OrgDetail, GithubError>
  readonly members: (org: string, input: MembersInput) => Effect.Effect<ReadonlyArray<OrgMember>, GithubError>
  readonly invite: (org: string, target: string, input: InviteInput) => Effect.Effect<InviteResult, GithubError>
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

      const invite: OrgsShape['invite'] = (org, target, input) => {
        const options = inviteOptions(input)
        const body: Effect.Effect<Record<string, unknown>, GithubError> = isEmail(target)
          ? Effect.succeed({ email: target, ...options })
          : github
              .request('GET /users/{username}', { username: target })
              .pipe(Effect.map((raw) => ({ invitee_id: decodeUserId(raw).id, ...options })))
        return body.pipe(
          Effect.flatMap((payload) => github.request('POST /orgs/{org}/invitations', { org, ...payload })),
          Effect.map((raw) => ({ id: decodeInvitation(raw).id, invited: target })),
          Effect.withSpan('Orgs.invite')
        )
      }

      return { list, show, members, invite }
    })
  )
}
