import { describe, expect, it } from 'vitest'

import pkg from '../package.json' with { type: 'json' }
import { VERSION } from '../src/version'

describe('version', () => {
  it('exposes a semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/u)
  })

  it('falls back to the package.json version outside a compiled build', () => {
    // In dev/test the `HUBCTL_VERSION` define is absent, so `VERSION` must equal
    // the literal fallback, which is kept in lockstep with package.json. The
    // compiled binary overrides this via scripts/compile.ts (`define`).
    expect(VERSION).toBe(pkg.version)
  })
})
