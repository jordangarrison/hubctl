import { describe, expect, it } from '@effect/vitest'

import { globalsToMode, resolveGlobalMode } from '../../src/cli/globals'
import type { Globals } from '../../src/cli/globals'

const base: Globals = { json: false, pretty: false, color: true, yes: false }

describe('globalsToMode', () => {
  it('--json wins over everything', () => {
    expect(globalsToMode({ json: true, pretty: true, color: true, yes: false }, {}, true)).toBe('json')
  })
  it('--pretty forces pretty even when piped', () => {
    expect(globalsToMode({ json: false, pretty: true, color: true, yes: false }, {}, false)).toBe('pretty')
  })
  it('NO_COLOR/CI/non-TTY default to json', () => {
    expect(globalsToMode(base, { CI: '1' }, true)).toBe('json')
    expect(globalsToMode(base, {}, false)).toBe('json')
  })
  it('interactive TTY defaults to pretty', () => {
    expect(globalsToMode(base, {}, true)).toBe('pretty')
  })
  it('--no-color (color=false) forces json even on an interactive TTY', () => {
    expect(globalsToMode({ json: false, pretty: false, color: false, yes: false }, {}, true)).toBe('json')
  })
})

const setTTY = (value: boolean): void => {
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
}

describe('resolveGlobalMode', () => {
  it('reads process env + isTTY at the edge and resolves through the pure helper', () => {
    const original = process.stdout.isTTY

    setTTY(false)
    expect(resolveGlobalMode(base)).toBe('json')

    setTTY(true)
    expect(resolveGlobalMode({ ...base, json: true })).toBe('json')

    Object.defineProperty(process.stdout, 'isTTY', { value: original, configurable: true })
  })
})
