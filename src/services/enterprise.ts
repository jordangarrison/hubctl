import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'
import * as Order from 'effect/Order'
import * as R from 'effect/Record'
import * as Schema from 'effect/Schema'

import { Github } from '../github/client'
import type { GithubError } from '../github/errors'

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

const decodeBillingUsage = Schema.decodeUnknownSync(BillingUsage)

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

export interface EnterpriseShape {
  readonly billing: (enterprise: string) => Effect.Effect<BillingResult, GithubError>
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
const decodeEnterpriseOrgs = Schema.decodeUnknownSync(Schema.Array(EnterpriseOrgRaw))

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
const decodeCreatedOrg = Schema.decodeUnknownSync(CreatedOrgRaw)

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

export class Enterprise extends Context.Service<Enterprise, EnterpriseShape>()('Enterprise') {
  static readonly layer: Layer.Layer<Enterprise, never, Github> = Layer.effect(
    Enterprise,
    Effect.gen(function* () {
      const github = yield* Github

      const billing: EnterpriseShape['billing'] = (enterprise) =>
        github.request('GET /enterprises/{enterprise}/settings/billing/usage', { enterprise }).pipe(
          Effect.map(decodeBillingUsage),
          Effect.map((usage): BillingResult => {
            const items = usage.usageItems ?? []
            return items.length === 0 ? { kind: 'empty', enterprise } : summarize(enterprise, items)
          }),
          Effect.withSpan('Enterprise.billing')
        )

      const organizations: EnterpriseShape['organizations'] = (enterprise, input) =>
        github
          .paginate('GET /enterprises/{enterprise}/organizations', {
            enterprise,
            ...(input.perPage === undefined ? {} : { per_page: input.perPage }),
          })
          .pipe(
            Effect.map(decodeEnterpriseOrgs),
            Effect.map((orgs) => orgs.map(toEnterpriseOrg)),
            Effect.withSpan('Enterprise.organizations')
          )

      const createOrganization: EnterpriseShape['createOrganization'] = (enterprise, login, input) =>
        github
          .request('POST /enterprises/{enterprise}/organizations', { enterprise, ...createOrgBody(login, input) })
          .pipe(
            Effect.map(decodeCreatedOrg),
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

      return { billing, organizations, createOrganization, transferOrganization, removeOrganization }
    })
  )
}
