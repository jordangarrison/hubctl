// Canned enterprise billing payload mirroring the `usageItems` shape returned by
// `GET /enterprises/{enterprise}/settings/billing/usage` (the unified billing
// API the Ruby `enterprise_actions_billing` hits). This is the exact payload the
// Ruby regression spec (spec/unit/enterprise_billing_spec.rb) asserts against, so
// it encodes the parity contract for the Effect port.

export const sampleUsageItemsPayload = {
  usageItems: [
    {
      product: 'actions',
      sku: 'Actions Linux',
      unitType: 'Minutes',
      quantity: 1000,
      netAmount: 8,
    },
    {
      product: 'actions',
      sku: 'Actions Windows',
      unitType: 'Minutes',
      quantity: 500,
      netAmount: 8,
    },
    {
      product: 'packages',
      sku: 'packages-storage',
      unitType: 'GB-hours',
      quantity: 100,
      netAmount: 2,
    },
    {
      product: 'copilot',
      sku: 'copilot-business',
      unitType: 'user-months',
      quantity: 10,
      netAmount: 190,
    },
  ],
} as const

// An enterprise with no recorded usage — the Ruby tool short-circuits with an
// "info" message and emits no table/JSON body.
export const emptyUsageItemsPayload = { usageItems: [] } as const
