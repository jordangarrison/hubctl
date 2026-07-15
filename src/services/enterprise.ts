import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'
import * as Order from 'effect/Order'
import * as P from 'effect/Predicate'
import * as R from 'effect/Record'
import * as Schema from 'effect/Schema'

import { Github } from '../github/client'
import { ValidationError } from '../github/errors'
import type { GithubError } from '../github/errors'
import { decode } from '../schema/decode'

// Domain service for the `enterprise` command group. This file currently
// implements the `billing` path (Task 7.1's regression baseline); the remaining
// subcommands (orgs/members/owners/licenses/audit-log/sso/stats) land in Task
// 7.2. Mirrors lib/hubctl/enterprise.rb#billing: it pulls the unified usage
// billing API, groups `usageItems` by product, and shapes a structured summary
// (the JSON envelope body) plus a flattened category/metric/value table.

// A single line item from `GET /enterprises/{enterprise}/settings/billing/usage`.
// `quantity`/`netAmount` are optional on the wire (the Ruby treats a missing
// value as 0), so we decode them as optional and default during aggregation.
const UsageItem = Schema.Struct({
  product: Schema.String,
  sku: Schema.String,
  unitType: Schema.String,
  quantity: Schema.optional(Schema.Finite),
  netAmount: Schema.optional(Schema.Finite),
})

const BillingUsage = Schema.Struct({
  usageItems: Schema.optional(Schema.Array(UsageItem)),
})

const decodeBillingUsage = decode(BillingUsage, 'enterprise billing usage')

type UsageItem = typeof UsageItem.Type

// Per-runner-type rollup within the Actions section (keyed by SKU).
export interface RunnerBreakdown {
  readonly minutes: number
  readonly cost: number
  readonly percentage: number
}

export interface ActionsBilling {
  readonly total_minutes: number
  readonly total_cost: number
  readonly runner_breakdown: Record<string, RunnerBreakdown>
}

export interface PackagesBilling {
  readonly total_storage_gb_hours: number
  readonly total_data_transfer_gb: number
  readonly total_cost: number
}

export interface CopilotBilling {
  readonly total_user_months: number
  readonly total_cost: number
}

// Structured billing summary (lib/hubctl/enterprise.rb `billing_summary`).
// Product sections are present only when the enterprise has matching usage.
export interface BillingSummary {
  readonly kind: 'summary'
  readonly enterprise: string
  readonly total_cost: number
  readonly actions?: ActionsBilling
  readonly packages?: PackagesBilling
  readonly copilot?: CopilotBilling
}

// No usage recorded: the Ruby short-circuits with an info message and emits no
// body. The CLI maps this to an `ok:true` envelope carrying the empty marker.
export interface BillingEmpty {
  readonly kind: 'empty'
  readonly enterprise: string
}

export type BillingResult = BillingSummary | BillingEmpty

// A flattened table row (lib/hubctl/enterprise.rb#flatten_billing_summary).
export interface BillingRow {
  readonly category: string
  readonly metric: string
  readonly value: string
}

// === Organizations ===

// Row shape for `enterprise orgs list` (lib/hubctl/enterprise.rb#organizations
// `org_data`). Nullable wire fields collapse to the Ruby defaults.
export interface EnterpriseOrg {
  readonly login: string
  readonly id: number
  readonly description: string
  readonly public_repos: number
  readonly private_repos: number
  readonly plan: string
  readonly billing_email: string
  readonly members_count: number
  readonly teams_count: number
  readonly created_at: string
  readonly url: string
}

export interface OrganizationsInput {
  readonly perPage?: number
}

export interface CreateOrgInput {
  readonly displayName?: string
  readonly description?: string
  readonly billingEmail?: string
}

// Summary returned after creating an org (lib/hubctl/enterprise.rb#create_org
// surfaces `id`/`html_url`).
export interface CreatedOrg {
  readonly id: number
  readonly login: string
  readonly url: string
}

// Confirmation of an org transfer into / removal from the enterprise.
export interface TransferResult {
  readonly enterprise: string
  readonly organization: string
  readonly transferred: boolean
}

export interface RemoveOrgResult {
  readonly enterprise: string
  readonly organization: string
  readonly removed: boolean
}

// === Members & owners ===

// Shaped member/owner row (lib/hubctl/github_client.rb#transform_member_data).
// `id`/`avatar_url` are always null in the consumed-licenses port (the wire
// payload doesn't carry them); `email` is the first verified domain email.
export interface EnterpriseMember {
  readonly login: string
  readonly id: null
  readonly role: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly email: string | null
  readonly two_factor_disabled: boolean
  readonly saml_identity: string
  readonly avatar_url: null
}

export type EnterpriseMemberRole = 'all' | 'admin' | 'owner' | 'member' | 'billing_manager'

export interface MembersInput {
  readonly role?: EnterpriseMemberRole
  readonly twoFaDisabled?: boolean
}

// Confirmation of adding / removing an enterprise owner.
export interface AddOwnerResult {
  readonly enterprise: string
  readonly username: string
  readonly added: boolean
}

export interface RemoveOwnerResult {
  readonly enterprise: string
  readonly username: string
  readonly removed: boolean
}

// === Audit log ===

// Shaped audit-log entry (lib/hubctl/enterprise.rb#audit_log `audit_data`).
// `timestamp`/`created_at` are epoch-ms numbers on the wire; the other fields
// are optional strings.
export interface AuditLogEntry {
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly timestamp: number | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly action: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly actor: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly user: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly repo: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly org: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly created_at: number | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly document_id: string | null
}

export type AuditOrder = 'asc' | 'desc'

export interface AuditLogInput {
  readonly order?: AuditOrder
  readonly phrase?: string
  readonly after?: string
  readonly before?: string
  readonly perPage?: number
}

// One bounded page of audit-log entries plus the `after` cursor for the next
// page (parsed from the response `Link` header). `nextAfter` is `None` when the
// response carries no `rel="next"` link, i.e. the caller has reached the end.
export interface AuditLogPage {
  readonly entries: ReadonlyArray<AuditLogEntry>
  readonly nextAfter: O.Option<string>
}

// === SAML SSO ===

// Row shape for `enterprise sso list` (lib/hubctl/enterprise.rb SamlSso#list).
export interface SsoAuthorization {
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly login: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly saml_identity: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly name_id: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly last_used: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly credential_authorized_at: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly credential_expires_at: string | null
}

// Detail shape for `enterprise sso show` (lib/hubctl/enterprise.rb SamlSso#show).
export interface SsoAuthorizationDetail {
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly login: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly saml_identity_username: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly saml_identity_name_id: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly last_used: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly credential_authorized_at: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly credential_expires_at: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly organization_count: number | null
}

export interface RemoveSsoResult {
  readonly enterprise: string
  readonly login: string
  readonly removed: boolean
}

// === Security analysis ===

export interface SecurityAnalysisInput {
  readonly dependencyGraphEnabled?: boolean
  readonly secretScanningEnabled?: boolean
  readonly secretScanningPushProtectionEnabled?: boolean
}

export interface UpdateSecurityResult {
  readonly enterprise: string
  readonly updated: boolean
}

// === Detail (show) ===

// Enterprise detail (lib/hubctl/github_client.rb#enterprise +
// lib/hubctl/enterprise.rb#show). Enterprise Cloud has no
// `/enterprises/{enterprise}` detail endpoint, so the Ruby resolves the account
// via `GET /orgs/{org}`, requires `plan.name == 'enterprise'`, and surfaces the
// populated subset (the other CLI fields are nil on this workaround path).
export interface EnterpriseDetail {
  readonly login: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly name: string | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly description: string | null
  readonly plan: string
  readonly created_at: string
  readonly updated_at: string
}

// === Stats ===

// Labeled stats report sections (lib/hubctl/enterprise.rb#stats). Each section
// is present only when the raw `/stats/all` payload carries it, and carries the
// exact field set the Ruby report prints.
export interface ReposStats {
  readonly total_repos: number
  readonly root_repos: number
  readonly fork_repos: number
  readonly org_repos: number
}
export interface HooksStats {
  readonly total_hooks: number
  readonly active_hooks: number
  readonly inactive_hooks: number
}
export interface PagesStats {
  readonly total_pages: number
}
export interface OrgsStats {
  readonly total_orgs: number
  readonly disabled_orgs: number
  readonly total_teams: number
  readonly total_team_members: number
}
export interface UsersStats {
  readonly total_users: number
  readonly admin_users: number
  readonly suspended_users: number
}
export interface PullRequestsStats {
  readonly total_pulls: number
  readonly merged_pulls: number
  readonly mergeable_pulls: number
  readonly unmergeable_pulls: number
}
export interface IssuesStats {
  readonly total_issues: number
  readonly open_issues: number
  readonly closed_issues: number
}
export interface MilestonesStats {
  readonly total_milestones: number
  readonly open_milestones: number
  readonly closed_milestones: number
}
export interface GistsStats {
  readonly total_gists: number
  readonly private_gists: number
  readonly public_gists: number
}

export interface EnterpriseStats {
  readonly repos?: ReposStats
  readonly hooks?: HooksStats
  readonly pages?: PagesStats
  readonly orgs?: OrgsStats
  readonly users?: UsersStats
  readonly pull_requests?: PullRequestsStats
  readonly issues?: IssuesStats
  readonly milestones?: MilestonesStats
  readonly gists?: GistsStats
}

export interface EnterpriseShape {
  readonly billing: (enterprise: string) => Effect.Effect<BillingResult, GithubError>
  // Enterprise detail via the org-endpoint workaround (lib/hubctl/enterprise.rb
  // #show). Fails with a ValidationError when the resolved org is not an
  // enterprise account.
  readonly show: (enterprise: string) => Effect.Effect<EnterpriseDetail, GithubError>
  readonly listSsoAuthorizations: (enterprise: string) => Effect.Effect<ReadonlyArray<SsoAuthorization>, GithubError>
  readonly showSsoAuthorization: (
    enterprise: string,
    login: string
  ) => Effect.Effect<SsoAuthorizationDetail, GithubError>
  readonly removeSsoAuthorization: (enterprise: string, login: string) => Effect.Effect<RemoveSsoResult, GithubError>
  // One bounded page of the audit log (lib/hubctl/enterprise.rb#audit_log).
  // Fetches a SINGLE request (default per_page 30) — never auto-paginates the
  // whole retention window — and surfaces the next-page `after` cursor from the
  // response `Link` header so callers page deliberately with `--after`.
  readonly auditLog: (enterprise: string, input: AuditLogInput) => Effect.Effect<AuditLogPage, GithubError>
  // Raw packages/shared-storage billing payloads (lib/hubctl/github_client.rb
  // #enterprise_packages_billing / #enterprise_shared_storage_billing). The Ruby
  // emits these verbatim, so the port surfaces the decoded object as-is.
  readonly packagesBilling: (enterprise: string) => Effect.Effect<Record<string, unknown>, GithubError>
  readonly sharedStorageBilling: (enterprise: string) => Effect.Effect<Record<string, unknown>, GithubError>
  // Raw consumed-licenses payload (lib/hubctl/github_client.rb
  // #enterprise_consumed_licenses) — a single page, emitted verbatim.
  readonly consumedLicenses: (enterprise: string) => Effect.Effect<Record<string, unknown>, GithubError>
  // Labeled enterprise statistics report (lib/hubctl/enterprise.rb#stats): the
  // raw `/stats/all` payload shaped into the Ruby's labeled sections, present
  // sections only.
  readonly stats: (enterprise: string) => Effect.Effect<EnterpriseStats, GithubError>
  // Security-analysis settings get/update (lib/hubctl/enterprise.rb#security).
  // `securityAnalysis` returns the raw settings; `updateSecurityAnalysis` PATCHes
  // the supplied flags and confirms.
  readonly securityAnalysis: (enterprise: string) => Effect.Effect<Record<string, unknown>, GithubError>
  readonly updateSecurityAnalysis: (
    enterprise: string,
    input: SecurityAnalysisInput
  ) => Effect.Effect<UpdateSecurityResult, GithubError>
  readonly members: (
    enterprise: string,
    input: MembersInput
  ) => Effect.Effect<ReadonlyArray<EnterpriseMember>, GithubError>
  readonly owners: (enterprise: string) => Effect.Effect<ReadonlyArray<EnterpriseMember>, GithubError>
  readonly addOwner: (enterprise: string, username: string) => Effect.Effect<AddOwnerResult, GithubError>
  readonly removeOwner: (enterprise: string, username: string) => Effect.Effect<RemoveOwnerResult, GithubError>
  readonly organizations: (
    enterprise: string,
    input: OrganizationsInput
  ) => Effect.Effect<ReadonlyArray<EnterpriseOrg>, GithubError>
  readonly createOrganization: (
    enterprise: string,
    login: string,
    input: CreateOrgInput
  ) => Effect.Effect<CreatedOrg, GithubError>
  readonly transferOrganization: (enterprise: string, org: string) => Effect.Effect<TransferResult, GithubError>
  readonly removeOrganization: (enterprise: string, org: string) => Effect.Effect<RemoveOrgResult, GithubError>
}

// Ruby `Float#round(n)`: half-up to `n` decimals. JS `Math.round` is half-up for
// positives, which is all billing amounts ever are.
const round = (value: number, digits: number): number => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

// Render a number the way Ruby interpolates a `Float` into a string: an integral
// value still shows a single trailing `.0` (e.g. `8.0`, `208.0`), otherwise the
// natural decimal form. Costs in the Ruby summary are always Floats, so they
// carry the `.0`; integer quantities (minutes, storage) are rendered plain via
// `String(...)` at the call site.
const rubyFloat = (value: number): string => (Number.isInteger(value) ? `${value}.0` : String(value))

const sumBy = (items: ReadonlyArray<UsageItem>, pick: (item: UsageItem) => number): number =>
  Arr.reduce(items, 0, (acc, item) => acc + pick(item))

const qty = (item: UsageItem): number => item.quantity ?? 0
const amt = (item: UsageItem): number => item.netAmount ?? 0

const buildActions = (items: ReadonlyArray<UsageItem>): ActionsBilling => {
  const minuteItems = items.filter((item) => item.unitType === 'Minutes')
  const totalMinutes = sumBy(minuteItems, qty)
  const totalCost = sumBy(items, amt)

  // Group minute items by SKU, accumulating minutes + cost (the Ruby
  // runner_breakdown loop), then attach the share-of-total percentage and
  // re-round per-SKU cost (the Ruby `data[:cost].round(2)`).
  const accumulated = Arr.reduce(minuteItems, R.empty<string, RunnerBreakdown>(), (acc, item) => {
    const prior = R.get(acc, item.sku).pipe(O.getOrElse(() => ({ minutes: 0, cost: 0, percentage: 0 })))
    return R.set(acc, item.sku, { minutes: prior.minutes + qty(item), cost: prior.cost + amt(item), percentage: 0 })
  })
  const runner_breakdown = R.map(accumulated, (data) => ({
    minutes: data.minutes,
    cost: round(data.cost, 2),
    percentage: totalMinutes > 0 ? round((data.minutes / totalMinutes) * 100, 1) : 0,
  }))

  return {
    total_minutes: totalMinutes,
    total_cost: round(totalCost, 2),
    runner_breakdown,
  }
}

const buildPackages = (items: ReadonlyArray<UsageItem>): PackagesBilling => ({
  total_storage_gb_hours: round(
    sumBy(
      items.filter((item) => item.sku.includes('storage')),
      qty
    ),
    2
  ),
  total_data_transfer_gb: round(
    sumBy(
      items.filter((item) => item.sku.includes('transfer')),
      qty
    ),
    2
  ),
  total_cost: round(sumBy(items, amt), 2),
})

const buildCopilot = (items: ReadonlyArray<UsageItem>): CopilotBilling => ({
  total_user_months: round(sumBy(items, qty), 2),
  total_cost: round(sumBy(items, amt), 2),
})

const summarize = (enterprise: string, items: ReadonlyArray<UsageItem>): BillingSummary => {
  const actions = items.filter((item) => item.product === 'actions')
  const packages = items.filter((item) => item.product === 'packages')
  const copilot = items.filter((item) => item.product === 'copilot')

  return {
    kind: 'summary',
    enterprise,
    total_cost: round(sumBy(items, amt), 2),
    ...(actions.length > 0 ? { actions: buildActions(actions) } : {}),
    ...(packages.length > 0 ? { packages: buildPackages(packages) } : {}),
    ...(copilot.length > 0 ? { copilot: buildCopilot(copilot) } : {}),
  }
}

// Flatten a structured summary into the `category/metric/value` table rows
// (lib/hubctl/enterprise.rb#flatten_billing_summary). Runner breakdown rows are
// sorted by minutes descending.
// Sort runner-breakdown entries by minutes descending (the Ruby
// `sort_by { |_, data| -data[:minutes] }`).
const byMinutesDesc = Order.mapInput(
  Order.flip(Order.Number),
  (entry: readonly [string, RunnerBreakdown]) => entry[1].minutes
)

const actionsRows = (actions: ActionsBilling): ReadonlyArray<BillingRow> => [
  { category: 'Actions', metric: 'Total Minutes', value: String(actions.total_minutes) },
  { category: 'Actions', metric: 'Total Cost', value: `$${rubyFloat(actions.total_cost)}` },
  ...Arr.flatMap(Arr.sort(R.toEntries(actions.runner_breakdown), byMinutesDesc), ([sku, data]) => [
    { category: `Actions - ${sku}`, metric: 'Minutes (Share)', value: `${data.minutes} (${data.percentage}%)` },
    { category: `Actions - ${sku}`, metric: 'Cost', value: `$${rubyFloat(data.cost)}` },
  ]),
]

const packagesRows = (packages: PackagesBilling): ReadonlyArray<BillingRow> => [
  { category: 'Packages', metric: 'Storage (GB-hours)', value: String(packages.total_storage_gb_hours) },
  { category: 'Packages', metric: 'Data Transfer (GB)', value: String(packages.total_data_transfer_gb) },
  { category: 'Packages', metric: 'Total Cost', value: `$${rubyFloat(packages.total_cost)}` },
]

const copilotRows = (copilot: CopilotBilling): ReadonlyArray<BillingRow> => [
  { category: 'Copilot', metric: 'User-Months', value: String(copilot.total_user_months) },
  { category: 'Copilot', metric: 'Total Cost', value: `$${rubyFloat(copilot.total_cost)}` },
]

export const flattenBilling = (summary: BillingSummary): ReadonlyArray<BillingRow> => [
  { category: 'Enterprise', metric: 'Name', value: summary.enterprise },
  { category: 'Enterprise', metric: 'Total Cost', value: `$${rubyFloat(summary.total_cost)}` },
  ...(summary.actions === undefined ? [] : actionsRows(summary.actions)),
  ...(summary.packages === undefined ? [] : packagesRows(summary.packages)),
  ...(summary.copilot === undefined ? [] : copilotRows(summary.copilot)),
]

// Raw enterprise-org payload fields read by `organizations`. Several are
// nullable/absent on the wire; the contract collapses them to the Ruby defaults.
const EnterpriseOrgRaw = Schema.Struct({
  login: Schema.String,
  id: Schema.Finite,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  public_repos: Schema.optional(Schema.NullOr(Schema.Finite)),
  private_repos: Schema.optional(Schema.NullOr(Schema.Finite)),
  plan: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  billing_email: Schema.optional(Schema.NullOr(Schema.String)),
  members_count: Schema.optional(Schema.NullOr(Schema.Finite)),
  teams_count: Schema.optional(Schema.NullOr(Schema.Finite)),
  created_at: Schema.String,
  html_url: Schema.String,
})
const decodeEnterpriseOrgs = decode(Schema.Array(EnterpriseOrgRaw), 'enterprise orgs list')

const toEnterpriseOrg = (org: typeof EnterpriseOrgRaw.Type): EnterpriseOrg => ({
  login: org.login,
  id: org.id,
  description: org.description ?? '-',
  public_repos: org.public_repos ?? 0,
  private_repos: org.private_repos ?? 0,
  plan: org.plan?.name ?? 'unknown',
  billing_email: org.billing_email ?? '-',
  members_count: org.members_count ?? 0,
  teams_count: org.teams_count ?? 0,
  created_at: org.created_at,
  url: org.html_url,
})

// Created-org summary fields (lib/hubctl/enterprise.rb#create_org).
const CreatedOrgRaw = Schema.Struct({ id: Schema.Finite, login: Schema.String, html_url: Schema.String })
const decodeCreatedOrg = decode(CreatedOrgRaw, 'created org')

const toCreatedOrg = (org: typeof CreatedOrgRaw.Type): CreatedOrg => ({
  id: org.id,
  login: org.login,
  url: org.html_url,
})

// Build the create-org request body (lib/hubctl/enterprise.rb#create_org
// `org_options` merge): always send `login`, include display/description/billing
// only when supplied.
const createOrgBody = (login: string, input: CreateOrgInput): Record<string, unknown> => ({
  login,
  ...(input.displayName === undefined ? {} : { display_name: input.displayName }),
  ...(input.description === undefined ? {} : { description: input.description }),
  ...(input.billingEmail === undefined ? {} : { billing_email: input.billingEmail }),
})

// Decode an arbitrary JSON object into a plain record (the raw billing payloads
// the Ruby emits verbatim).
const RawObject = Schema.Record(Schema.String, Schema.Unknown)
const decodeRawObject = decode(RawObject, 'raw billing object')

// === Detail (show) helpers ===

// Org payload read by `show` (the Enterprise-Cloud workaround). `plan.name`
// drives the enterprise-account gate; the other fields are surfaced verbatim.
const EnterpriseDetailRaw = Schema.Struct({
  login: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  plan: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  created_at: Schema.String,
  updated_at: Schema.String,
})
const decodeEnterpriseDetail = decode(EnterpriseDetailRaw, 'enterprise detail')

// === Stats helpers ===

// Raw `/stats/all` payload. Every section is optional; within a present
// section the Ruby reads a fixed field set, treating absent numbers as 0.
const Num = Schema.optional(Schema.NullOr(Schema.Finite))
const StatsRaw = Schema.Struct({
  repos: Schema.optional(
    Schema.NullOr(Schema.Struct({ total_repos: Num, root_repos: Num, fork_repos: Num, org_repos: Num }))
  ),
  hooks: Schema.optional(Schema.NullOr(Schema.Struct({ total_hooks: Num, active_hooks: Num, inactive_hooks: Num }))),
  pages: Schema.optional(Schema.NullOr(Schema.Struct({ total_pages: Num }))),
  orgs: Schema.optional(
    Schema.NullOr(Schema.Struct({ total_orgs: Num, disabled_orgs: Num, total_teams: Num, total_team_members: Num }))
  ),
  users: Schema.optional(Schema.NullOr(Schema.Struct({ total_users: Num, admin_users: Num, suspended_users: Num }))),
  pulls: Schema.optional(
    Schema.NullOr(Schema.Struct({ total_pulls: Num, merged_pulls: Num, mergeable_pulls: Num, unmergeable_pulls: Num }))
  ),
  issues: Schema.optional(Schema.NullOr(Schema.Struct({ total_issues: Num, open_issues: Num, closed_issues: Num }))),
  milestones: Schema.optional(
    Schema.NullOr(Schema.Struct({ total_milestones: Num, open_milestones: Num, closed_milestones: Num }))
  ),
  gists: Schema.optional(Schema.NullOr(Schema.Struct({ total_gists: Num, private_gists: Num, public_gists: Num }))),
})
const decodeStats = decode(StatsRaw, 'enterprise stats')

// Emit `{ [key]: shape(section) }` only when the section is present, otherwise
// an empty fragment — the spread builds the labeled report (present sections
// only), mirroring the Ruby per-section `if stats[:section]` guards in #stats.
// Absent numeric fields default to 0 within `shape` (the Ruby interpolates a nil
// field as the zero/empty value).
const section = <S, T>(raw: S, key: string, shape: (s: NonNullable<S>) => T): Record<string, T> =>
  O.match(O.fromNullishOr(raw), { onNone: () => ({}), onSome: (s) => ({ [key]: shape(s) }) })

// Shape the raw payload into the Ruby's labeled report (lib/hubctl/enterprise.rb
// #stats). The Ruby emits a section only when present; the wire `pulls` section
// is surfaced as `pull_requests` (the Ruby report's label).
const toStats = (raw: typeof StatsRaw.Type): EnterpriseStats => ({
  ...section(raw.repos, 'repos', (s) => ({
    total_repos: s.total_repos ?? 0,
    root_repos: s.root_repos ?? 0,
    fork_repos: s.fork_repos ?? 0,
    org_repos: s.org_repos ?? 0,
  })),
  ...section(raw.hooks, 'hooks', (s) => ({
    total_hooks: s.total_hooks ?? 0,
    active_hooks: s.active_hooks ?? 0,
    inactive_hooks: s.inactive_hooks ?? 0,
  })),
  ...section(raw.pages, 'pages', (s) => ({ total_pages: s.total_pages ?? 0 })),
  ...section(raw.orgs, 'orgs', (s) => ({
    total_orgs: s.total_orgs ?? 0,
    disabled_orgs: s.disabled_orgs ?? 0,
    total_teams: s.total_teams ?? 0,
    total_team_members: s.total_team_members ?? 0,
  })),
  ...section(raw.users, 'users', (s) => ({
    total_users: s.total_users ?? 0,
    admin_users: s.admin_users ?? 0,
    suspended_users: s.suspended_users ?? 0,
  })),
  ...section(raw.pulls, 'pull_requests', (s) => ({
    total_pulls: s.total_pulls ?? 0,
    merged_pulls: s.merged_pulls ?? 0,
    mergeable_pulls: s.mergeable_pulls ?? 0,
    unmergeable_pulls: s.unmergeable_pulls ?? 0,
  })),
  ...section(raw.issues, 'issues', (s) => ({
    total_issues: s.total_issues ?? 0,
    open_issues: s.open_issues ?? 0,
    closed_issues: s.closed_issues ?? 0,
  })),
  ...section(raw.milestones, 'milestones', (s) => ({
    total_milestones: s.total_milestones ?? 0,
    open_milestones: s.open_milestones ?? 0,
    closed_milestones: s.closed_milestones ?? 0,
  })),
  ...section(raw.gists, 'gists', (s) => ({
    total_gists: s.total_gists ?? 0,
    private_gists: s.private_gists ?? 0,
    public_gists: s.public_gists ?? 0,
  })),
})

// === SAML SSO helpers ===

const SamlIdentity = Schema.Struct({
  username: Schema.optional(Schema.NullOr(Schema.String)),
  name_id: Schema.optional(Schema.NullOr(Schema.String)),
})

const SsoAuthRaw = Schema.Struct({
  login: Schema.optional(Schema.NullOr(Schema.String)),
  saml_identity: Schema.optional(Schema.NullOr(SamlIdentity)),
  last_used: Schema.optional(Schema.NullOr(Schema.String)),
  credential_authorized_at: Schema.optional(Schema.NullOr(Schema.String)),
  credential_expires_at: Schema.optional(Schema.NullOr(Schema.String)),
  organization_count: Schema.optional(Schema.NullOr(Schema.Finite)),
})
const decodeSsoAuths = decode(Schema.Array(SsoAuthRaw), 'sso authorizations list')
const decodeSsoAuth = decode(SsoAuthRaw, 'sso authorization')

const toSsoAuthorization = (auth: typeof SsoAuthRaw.Type): SsoAuthorization => ({
  login: auth.login ?? null,
  saml_identity: auth.saml_identity?.username ?? null,
  name_id: auth.saml_identity?.name_id ?? null,
  last_used: auth.last_used ?? null,
  credential_authorized_at: auth.credential_authorized_at ?? null,
  credential_expires_at: auth.credential_expires_at ?? null,
})

const toSsoAuthorizationDetail = (auth: typeof SsoAuthRaw.Type): SsoAuthorizationDetail => ({
  login: auth.login ?? null,
  saml_identity_username: auth.saml_identity?.username ?? null,
  saml_identity_name_id: auth.saml_identity?.name_id ?? null,
  last_used: auth.last_used ?? null,
  credential_authorized_at: auth.credential_authorized_at ?? null,
  credential_expires_at: auth.credential_expires_at ?? null,
  organization_count: auth.organization_count ?? null,
})

// Build the security-analysis update body (lib/hubctl/enterprise.rb#security
// `update_options` merge): include only the flags the caller supplied.
const securityUpdateBody = (input: SecurityAnalysisInput): Record<string, unknown> => ({
  ...(input.dependencyGraphEnabled === undefined
    ? {}
    : { dependency_graph_enabled_for_new_repositories: input.dependencyGraphEnabled }),
  ...(input.secretScanningEnabled === undefined
    ? {}
    : { secret_scanning_enabled_for_new_repositories: input.secretScanningEnabled }),
  ...(input.secretScanningPushProtectionEnabled === undefined
    ? {}
    : { secret_scanning_push_protection_enabled_for_new_repositories: input.secretScanningPushProtectionEnabled }),
})

// === Audit-log helpers ===

// Raw audit-log entry fields read by `auditLog`. All optional/nullable on the
// wire; the transform fills absent fields with null (mirroring the Ruby
// hash-access defaults). The GitHub Enterprise audit-log API returns the
// timestamp/document id under the prefixed wire keys `@timestamp` (integer ms)
// and `_document_id` (string); the shaped output exposes them as the bare
// `timestamp`/`document_id` names (see `toAuditEntry`).
const AuditEntryRaw = Schema.Struct({
  '@timestamp': Schema.optional(Schema.NullOr(Schema.Finite)),
  action: Schema.optional(Schema.NullOr(Schema.String)),
  actor: Schema.optional(Schema.NullOr(Schema.String)),
  user: Schema.optional(Schema.NullOr(Schema.String)),
  repo: Schema.optional(Schema.NullOr(Schema.String)),
  org: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.optional(Schema.NullOr(Schema.Finite)),
  _document_id: Schema.optional(Schema.NullOr(Schema.String)),
})
const decodeAuditEntries = decode(Schema.Array(AuditEntryRaw), 'audit log entries')

const toAuditEntry = (entry: typeof AuditEntryRaw.Type): AuditLogEntry => ({
  timestamp: entry['@timestamp'] ?? null,
  action: entry.action ?? null,
  actor: entry.actor ?? null,
  user: entry.user ?? null,
  repo: entry.repo ?? null,
  org: entry.org ?? null,
  created_at: entry.created_at ?? null,
  document_id: entry['_document_id'] ?? null,
})

// Build the audit-log query params (lib/hubctl/enterprise.rb#audit_log
// `audit_options`): always send `order` AND a bounded `per_page` (default 30,
// so a single request never tries to drain the whole retention window);
// include phrase/after/before only when supplied.
const auditParams = (input: AuditLogInput): Record<string, unknown> => ({
  order: input.order ?? 'desc',
  per_page: input.perPage ?? 30,
  ...(input.phrase === undefined ? {} : { phrase: input.phrase }),
  ...(input.after === undefined ? {} : { after: input.after }),
  ...(input.before === undefined ? {} : { before: input.before }),
})

// Extract the next-page `after` cursor from the response `Link` header: find the
// `rel="next"` URL, then pull its `after` query param. `None` when there is no
// next page (no Link header / no `rel="next"` / no `after`).
const nextAfterCursor = (headers: Record<string, unknown>): O.Option<string> =>
  O.fromNullishOr(headers.link).pipe(
    O.filter(P.isString),
    O.flatMap((link) => O.fromNullishOr(/<(?<url>[^>]*)>;\s*rel="next"/u.exec(link)?.groups?.url)),
    O.flatMap((url) => O.fromNullishOr(/[?&]after=(?<after>[^&]+)/u.exec(url)?.groups?.after)),
    O.map((cursor) => decodeURIComponent(cursor))
  )

// === Members & owners helpers ===

// Raw consumed-license user record (lib/hubctl/github_client.rb consumed-licenses
// payload). All fields are optional/nullable on the wire; the transform applies
// the Ruby defaults.
const ConsumedUser = Schema.Struct({
  github_com_login: Schema.optional(Schema.NullOr(Schema.String)),
  github_com_enterprise_roles: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  github_com_verified_domain_emails: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  github_com_two_factor_auth: Schema.optional(Schema.NullOr(Schema.Boolean)),
  github_com_saml_name_id: Schema.optional(Schema.NullOr(Schema.String)),
})

const ConsumedLicenses = Schema.Struct({
  users: Schema.optional(Schema.NullOr(Schema.Array(ConsumedUser))),
})
const decodeConsumedLicenses = decode(ConsumedLicenses, 'consumed licenses page')

type ConsumedUser = typeof ConsumedUser.Type

// Number of users per consumed-licenses page; matches the Ruby `per_page: 100`
// and the `< 100 ⇒ last page` termination condition.
const LICENSE_PAGE_SIZE = 100
// Safety break mirroring the Ruby `break if page > 50`.
const LICENSE_MAX_PAGES = 50

const roles = (user: ConsumedUser): ReadonlyArray<string> => user.github_com_enterprise_roles ?? []

const twoFaEnabled = (user: ConsumedUser): boolean => user.github_com_two_factor_auth ?? false

const isOwner = (user: ConsumedUser): boolean => roles(user).includes('Owner')

// Map enterprise roles to the displayed role (lib/hubctl#determine_user_role).
const determineRole = (user: ConsumedUser): string => {
  const r = roles(user)
  if (r.includes('Owner')) {
    return 'admin'
  }
  if (r.includes('Member')) {
    return 'member'
  }
  if (r.includes('Outside collaborator')) {
    return 'collaborator'
  }
  if (r.includes('Pending invitation')) {
    return 'pending'
  }
  return 'unknown'
}

const transformMember = (user: ConsumedUser): EnterpriseMember => ({
  login: user.github_com_login ?? '',
  id: null,
  role: determineRole(user),
  email: user.github_com_verified_domain_emails?.[0] ?? null,
  two_factor_disabled: !twoFaEnabled(user),
  saml_identity:
    user.github_com_saml_name_id !== undefined && user.github_com_saml_name_id !== null ? 'configured' : 'none',
  avatar_url: null,
})

// Apply the role filter (lib/hubctl#filter_by_role): admin/owner ⇒ owners only;
// member ⇒ Members that aren't also Owners; anything else ⇒ no filtering.
const filterByRole = (users: ReadonlyArray<ConsumedUser>, role: MembersInput['role']): ReadonlyArray<ConsumedUser> => {
  if (role === 'admin' || role === 'owner') {
    return users.filter(isOwner)
  }
  if (role === 'member') {
    return users.filter((user) => roles(user).includes('Member') && !isOwner(user))
  }
  return users
}

// Filter members by role + 2FA (lib/hubctl#filter_members_by_options).
const filterMembers = (allUsers: ReadonlyArray<ConsumedUser>, input: MembersInput): ReadonlyArray<ConsumedUser> => {
  const byRole = filterByRole(allUsers, input.role)
  return input.twoFaDisabled === true ? byRole.filter((user) => !twoFaEnabled(user)) : byRole
}

export class Enterprise extends Context.Service<Enterprise, EnterpriseShape>()('Enterprise') {
  static readonly layer: Layer.Layer<Enterprise, never, Github> = Layer.effect(
    Enterprise,
    Effect.gen(function* () {
      const github = yield* Github

      const billing: EnterpriseShape['billing'] = (enterprise) =>
        github.request('GET /enterprises/{enterprise}/settings/billing/usage', { enterprise }).pipe(
          Effect.flatMap(decodeBillingUsage),
          Effect.map((usage): BillingResult => {
            const items = usage.usageItems ?? []
            return items.length === 0 ? { kind: 'empty', enterprise } : summarize(enterprise, items)
          }),
          Effect.withSpan('Enterprise.billing')
        )

      // Replicate the Ruby `fetch_all_enterprise_users` page loop: fetch
      // `/consumed-licenses` a page at a time (per_page=100), accumulating the
      // `users` array, stopping when a page returns fewer than a full page (or
      // the 50-page safety break). The consumed-licenses payload wraps users in
      // `{ users: [] }` (not a flat array), so this uses `request` per page
      // rather than `paginate`. Leaves a clean seam for streaming later phases.
      const fetchAllUsers = (enterprise: string): Effect.Effect<ReadonlyArray<ConsumedUser>, GithubError> => {
        const fetchPage = (
          page: number,
          acc: ReadonlyArray<ConsumedUser>
        ): Effect.Effect<ReadonlyArray<ConsumedUser>, GithubError> =>
          github
            .request('GET /enterprises/{enterprise}/consumed-licenses', {
              enterprise,
              per_page: LICENSE_PAGE_SIZE,
              page,
            })
            .pipe(
              Effect.flatMap(decodeConsumedLicenses),
              Effect.map((decoded) => decoded.users ?? []),
              Effect.flatMap((users) => {
                const next = [...acc, ...users]
                if (users.length < LICENSE_PAGE_SIZE || page >= LICENSE_MAX_PAGES) {
                  return Effect.succeed(next)
                }
                return fetchPage(page + 1, next)
              })
            )
        return fetchPage(1, [])
      }

      const members: EnterpriseShape['members'] = (enterprise, input) =>
        fetchAllUsers(enterprise).pipe(
          Effect.map((users) => filterMembers(users, input).map(transformMember)),
          Effect.withSpan('Enterprise.members')
        )

      const packagesBilling: EnterpriseShape['packagesBilling'] = (enterprise) =>
        github
          .request('GET /enterprises/{enterprise}/billing/packages', { enterprise })
          .pipe(Effect.flatMap(decodeRawObject), Effect.withSpan('Enterprise.packagesBilling'))

      const sharedStorageBilling: EnterpriseShape['sharedStorageBilling'] = (enterprise) =>
        github
          .request('GET /enterprises/{enterprise}/billing/shared-storage', { enterprise })
          .pipe(Effect.flatMap(decodeRawObject), Effect.withSpan('Enterprise.sharedStorageBilling'))

      const listSsoAuthorizations: EnterpriseShape['listSsoAuthorizations'] = (enterprise) =>
        github.paginate('GET /enterprises/{enterprise}/sso/authorizations', { enterprise }).pipe(
          Effect.flatMap(decodeSsoAuths),
          Effect.map((auths) => auths.map(toSsoAuthorization)),
          Effect.withSpan('Enterprise.listSsoAuthorizations')
        )

      const showSsoAuthorization: EnterpriseShape['showSsoAuthorization'] = (enterprise, login) =>
        github
          .request('GET /enterprises/{enterprise}/sso/authorizations/{login}', { enterprise, login })
          .pipe(
            Effect.flatMap(decodeSsoAuth),
            Effect.map(toSsoAuthorizationDetail),
            Effect.withSpan('Enterprise.showSsoAuthorization')
          )

      const removeSsoAuthorization: EnterpriseShape['removeSsoAuthorization'] = (enterprise, login) =>
        github
          .request('DELETE /enterprises/{enterprise}/sso/authorizations/{login}', { enterprise, login })
          .pipe(Effect.as({ enterprise, login, removed: true }), Effect.withSpan('Enterprise.removeSsoAuthorization'))

      const auditLog: EnterpriseShape['auditLog'] = (enterprise, input) =>
        github.requestRaw('GET /enterprises/{enterprise}/audit-log', { enterprise, ...auditParams(input) }).pipe(
          Effect.flatMap((response) =>
            decodeAuditEntries(response.data).pipe(
              Effect.map((raw) => ({ entries: raw.map(toAuditEntry), nextAfter: nextAfterCursor(response.headers) }))
            )
          ),
          Effect.withSpan('Enterprise.auditLog')
        )

      const consumedLicenses: EnterpriseShape['consumedLicenses'] = (enterprise) =>
        github
          .request('GET /enterprises/{enterprise}/consumed-licenses', { enterprise })
          .pipe(Effect.flatMap(decodeRawObject), Effect.withSpan('Enterprise.consumedLicenses'))

      const stats: EnterpriseShape['stats'] = (enterprise) =>
        github
          .request('GET /enterprises/{enterprise}/stats/all', { enterprise })
          .pipe(Effect.flatMap(decodeStats), Effect.map(toStats), Effect.withSpan('Enterprise.stats'))

      // Enterprise Cloud exposes no `/enterprises/{enterprise}` detail endpoint;
      // resolve via `GET /orgs/{org}` and require `plan.name == 'enterprise'`
      // (lib/hubctl/github_client.rb#enterprise), failing with a ValidationError
      // otherwise.
      const show: EnterpriseShape['show'] = (enterprise) =>
        github.request('GET /orgs/{org}', { org: enterprise }).pipe(
          Effect.flatMap(decodeEnterpriseDetail),
          Effect.flatMap((org) =>
            org.plan?.name === 'enterprise'
              ? Effect.succeed<EnterpriseDetail>({
                  login: org.login,
                  name: org.name ?? null,
                  description: org.description ?? null,
                  plan: org.plan.name,
                  created_at: org.created_at,
                  updated_at: org.updated_at,
                })
              : Effect.fail(
                  new ValidationError({
                    message: `Organization ${enterprise} is not an enterprise account`,
                    fix: 'Provide the slug of an enterprise account',
                  })
                )
          ),
          Effect.withSpan('Enterprise.show')
        )

      const securityAnalysis: EnterpriseShape['securityAnalysis'] = (enterprise) =>
        github
          .request('GET /enterprises/{enterprise}/code_security_analysis', { enterprise })
          .pipe(Effect.flatMap(decodeRawObject), Effect.withSpan('Enterprise.securityAnalysis'))

      const updateSecurityAnalysis: EnterpriseShape['updateSecurityAnalysis'] = (enterprise, input) =>
        github
          .request('PATCH /enterprises/{enterprise}/code_security_analysis', {
            enterprise,
            ...securityUpdateBody(input),
          })
          .pipe(Effect.as({ enterprise, updated: true }), Effect.withSpan('Enterprise.updateSecurityAnalysis'))

      const owners: EnterpriseShape['owners'] = (enterprise) =>
        fetchAllUsers(enterprise).pipe(
          Effect.map((users) => users.filter(isOwner).map(transformMember)),
          Effect.withSpan('Enterprise.owners')
        )

      const addOwner: EnterpriseShape['addOwner'] = (enterprise, username) =>
        github
          .request('PUT /enterprises/{enterprise}/owners/{username}', { enterprise, username })
          .pipe(Effect.as({ enterprise, username, added: true }), Effect.withSpan('Enterprise.addOwner'))

      const removeOwner: EnterpriseShape['removeOwner'] = (enterprise, username) =>
        github
          .request('DELETE /enterprises/{enterprise}/owners/{username}', { enterprise, username })
          .pipe(Effect.as({ enterprise, username, removed: true }), Effect.withSpan('Enterprise.removeOwner'))

      const organizations: EnterpriseShape['organizations'] = (enterprise, input) =>
        github
          .paginate('GET /enterprises/{enterprise}/organizations', {
            enterprise,
            ...(input.perPage === undefined ? {} : { per_page: input.perPage }),
          })
          .pipe(
            Effect.flatMap(decodeEnterpriseOrgs),
            Effect.map((orgs) => orgs.map(toEnterpriseOrg)),
            Effect.withSpan('Enterprise.organizations')
          )

      const createOrganization: EnterpriseShape['createOrganization'] = (enterprise, login, input) =>
        github
          .request('POST /enterprises/{enterprise}/organizations', { enterprise, ...createOrgBody(login, input) })
          .pipe(
            Effect.flatMap(decodeCreatedOrg),
            Effect.map(toCreatedOrg),
            Effect.withSpan('Enterprise.createOrganization')
          )

      const transferOrganization: EnterpriseShape['transferOrganization'] = (enterprise, org) =>
        github
          .request('POST /enterprises/{enterprise}/organizations', { enterprise, organization: org })
          .pipe(
            Effect.as({ enterprise, organization: org, transferred: true }),
            Effect.withSpan('Enterprise.transferOrganization')
          )

      const removeOrganization: EnterpriseShape['removeOrganization'] = (enterprise, org) =>
        github
          .request('DELETE /enterprises/{enterprise}/organizations/{org}', { enterprise, org })
          .pipe(
            Effect.as({ enterprise, organization: org, removed: true }),
            Effect.withSpan('Enterprise.removeOrganization')
          )

      return {
        billing,
        show,
        packagesBilling,
        sharedStorageBilling,
        consumedLicenses,
        stats,
        securityAnalysis,
        updateSecurityAnalysis,
        auditLog,
        listSsoAuthorizations,
        showSsoAuthorization,
        removeSsoAuthorization,
        members,
        owners,
        addOwner,
        removeOwner,
        organizations,
        createOrganization,
        transferOrganization,
        removeOrganization,
      }
    })
  )
}
