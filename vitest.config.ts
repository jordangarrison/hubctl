import { defineConfig, mergeConfig } from 'vitest/config'

import { baseConfig } from './vitest.base'

// Default suite. E2E (compiled-binary smoke) is excluded here and runs via
// vitest.e2e.config.ts (`bun run test:e2e`).
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/**/*.test.ts'],
      exclude: ['test/e2e/**', '**/node_modules/**', '**/dist/**'],
    },
  })
)
