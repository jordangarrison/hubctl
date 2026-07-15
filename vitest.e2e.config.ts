import { defineConfig, mergeConfig } from 'vitest/config'

import { baseConfig } from './vitest.base'

// E2E suite: drives the COMPILED dist/hubctl binary as a subprocess. Kept out of
// the default suite (each test boots the binary; requires a prior `bun run
// build:local`). Non-interactive JSON output means no PTY is needed.
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/e2e/**/*.test.ts'],
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  })
)
