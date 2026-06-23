import { describe, expect, it } from 'vitest'

import { VERSION } from '../src/version'

describe('version', () => {
  it('exposes a semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/u)
  })
})
