import { describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as O from 'effect/Option'

import { NotFoundError } from '../../src/github/errors'
import { Enterprise, flattenBilling } from '../../src/services/enterprise'
import { emptyUsageItemsPayload, sampleUsageItemsPayload } from '../fixtures/enterprise/billing-usage'
import { FakeGithub } from '../helpers/fake-github'

// Parity regression for enterprise billing, ported from
// spec/unit/enterprise_billing_spec.rb. The Ruby `Hubctl::Enterprise#billing`
// pulls `GET /enterprises/{enterprise}/settings/billing/usage` (the unified
// usageItems billing API), groups items by product, and emits either a
// structured JSON summary or a flattened `category/metric/value` table. The
// Effect `Enterprise.billing` service reproduces that transform; over
// FakeGithub the canned payload exercises the same shaping a live call would.

const enterprise = 'dummy-enterprise'

const billingRoute = 'GET /enterprises/{enterprise}/settings/billing/usage'

const withBilling = (payload: unknown) =>
  Enterprise.layer.pipe(Layer.provide(FakeGithub.layer({ routes: { [billingRoute]: payload } })))

describe('Enterprise billing service', () => {
  describe('when fetching billing information successfully', () => {
    const layer = withBilling(sampleUsageItemsPayload)

    it.effect('produces the structured JSON billing summary', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.billing(enterprise)
        expect(result.kind).toBe('summary')
        if (result.kind !== 'summary') {
          return
        }
        expect(result.enterprise).toBe(enterprise)
        expect(result.total_cost).toBe(208)
        expect(result.actions).toEqual({
          total_minutes: 1500,
          total_cost: 16,
          runner_breakdown: {
            'Actions Linux': { minutes: 1000, cost: 8, percentage: 66.7 },
            'Actions Windows': { minutes: 500, cost: 8, percentage: 33.3 },
          },
        })
        expect(result.packages).toEqual({
          total_storage_gb_hours: 100,
          total_data_transfer_gb: 0,
          total_cost: 2,
        })
        expect(result.copilot).toEqual({
          total_user_months: 10,
          total_cost: 190,
        })
      }).pipe(Effect.provide(layer))
    )

    it.effect('flattens the summary into a category/metric/value table', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.billing(enterprise)
        expect(result.kind).toBe('summary')
        if (result.kind !== 'summary') {
          return
        }
        const rows = flattenBilling(result)
        // Mirrors the Ruby `array_including` assertions; runner breakdown rows are
        // sorted by minutes descending (Actions Linux before Actions Windows).
        expect(rows).toContainEqual({ category: 'Enterprise', metric: 'Name', value: enterprise })
        expect(rows).toContainEqual({ category: 'Enterprise', metric: 'Total Cost', value: '$208.0' })
        expect(rows).toContainEqual({ category: 'Actions', metric: 'Total Minutes', value: '1500' })
        expect(rows).toContainEqual({ category: 'Actions', metric: 'Total Cost', value: '$16.0' })
        expect(rows).toContainEqual({
          category: 'Actions - Actions Linux',
          metric: 'Minutes (Share)',
          value: '1000 (66.7%)',
        })
        expect(rows).toContainEqual({ category: 'Actions - Actions Linux', metric: 'Cost', value: '$8.0' })
        expect(rows).toContainEqual({
          category: 'Actions - Actions Windows',
          metric: 'Minutes (Share)',
          value: '500 (33.3%)',
        })
        expect(rows).toContainEqual({ category: 'Actions - Actions Windows', metric: 'Cost', value: '$8.0' })
        expect(rows).toContainEqual({ category: 'Packages', metric: 'Storage (GB-hours)', value: '100' })
        expect(rows).toContainEqual({ category: 'Packages', metric: 'Data Transfer (GB)', value: '0' })
        expect(rows).toContainEqual({ category: 'Packages', metric: 'Total Cost', value: '$2.0' })
        expect(rows).toContainEqual({ category: 'Copilot', metric: 'User-Months', value: '10' })
        expect(rows).toContainEqual({ category: 'Copilot', metric: 'Total Cost', value: '$190.0' })
      }).pipe(Effect.provide(layer))
    )
  })

  describe('when no usage data is available', () => {
    it.effect('reports an empty result and emits no body', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const result = yield* ent.billing(enterprise)
        expect(result).toEqual({ kind: 'empty', enterprise })
      }).pipe(Effect.provide(withBilling(emptyUsageItemsPayload)))
    )
  })

  describe('error handling', () => {
    it.effect('surfaces a typed GithubError when the billing API fails', () =>
      Effect.gen(function* () {
        const ent = yield* Enterprise
        const exit = yield* Effect.exit(ent.billing(enterprise))
        expect(Exit.isFailure(exit)).toBe(true)
        const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        expect(error).toBeInstanceOf(NotFoundError)
      }).pipe(Effect.provide(Enterprise.layer.pipe(Layer.provide(FakeGithub.layer({ fail: { [billingRoute]: 404 } })))))
    )
  })
})
