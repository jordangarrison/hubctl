import { describe, expect, it } from '@effect/vitest'

import { resolveMode } from '../../src/output/mode'

describe('resolveMode', () => {
  it('--json wins over everything', () => {
    expect(resolveMode({ json: true, pretty: true, env: {}, isTTY: true })).toBe('json')
  })
  it('--pretty forces pretty even when piped', () => {
    expect(resolveMode({ json: false, pretty: true, env: {}, isTTY: false })).toBe('pretty')
  })
  it('NO_COLOR/CI/non-TTY default to json', () => {
    expect(resolveMode({ json: false, pretty: false, env: { CI: '1' }, isTTY: true })).toBe('json')
    expect(resolveMode({ json: false, pretty: false, env: {}, isTTY: false })).toBe('json')
  })
  it('interactive TTY defaults to pretty', () => {
    expect(resolveMode({ json: false, pretty: false, env: {}, isTTY: true })).toBe('pretty')
  })
})
