import type { ViteUserConfig } from 'vitest/config'

// Shared vitest base consumed via mergeConfig by vitest.config.ts and
// vitest.e2e.config.ts. The threads pool starts faster than forks; these tests
// are thread-safe (no process-state mutation).
export const baseConfig: ViteUserConfig = {
  test: {
    pool: 'threads',
  },
}
