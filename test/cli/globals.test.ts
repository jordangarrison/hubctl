import { describe, expect, it } from '@effect/vitest'

import { globalsToMode, resolveGlobalMode, stripModeFlags } from '../../src/cli/globals'
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
  it('--no-color (color=false) stays pretty on an interactive TTY (color is independent of mode)', () => {
    expect(globalsToMode({ json: false, pretty: false, color: false, yes: false }, {}, true)).toBe('pretty')
  })
  it('--no-color does not override an explicit --json', () => {
    expect(globalsToMode({ json: true, pretty: false, color: false, yes: false }, {}, true)).toBe('json')
  })
  it('--no-color does not override an explicit --pretty when piped', () => {
    expect(globalsToMode({ json: false, pretty: true, color: false, yes: false }, {}, false)).toBe('pretty')
  })
})

describe('stripModeFlags', () => {
  it('removes the mode/color flags the parser does not declare', () => {
    expect(stripModeFlags(['--json', 'version'])).toEqual(['version'])
    expect(stripModeFlags(['--pretty', 'repos', 'list'])).toEqual(['repos', 'list'])
    expect(stripModeFlags(['--no-color', 'orgs', 'list'])).toEqual(['orgs', 'list'])
  })
  it('keeps --yes (destructive subcommands declare it) and positional args', () => {
    expect(stripModeFlags(['repos', 'archive', 'octo/repo', '--yes', '--json'])).toEqual([
      'repos',
      'archive',
      'octo/repo',
      '--yes',
    ])
  })
  it('leaves a normal invocation untouched', () => {
    expect(stripModeFlags(['enterprise', 'billing', 'usage', '--enterprise', 'acme'])).toEqual([
      'enterprise',
      'billing',
      'usage',
      '--enterprise',
      'acme',
    ])
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
