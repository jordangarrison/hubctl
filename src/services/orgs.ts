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

export interface OrgsShape {
  readonly list: Effect.Effect<ReadonlyArray<OrgListItem>, GithubError>
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

      return { list }
    })
  )
}
