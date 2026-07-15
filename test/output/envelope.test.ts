import { describe, expect, it } from '@effect/vitest'
import * as Schema from 'effect/Schema'

import { Envelope, makeErr, makeOk } from '../../src/output/envelope'

describe('envelope', () => {
  it('makeOk builds an ok envelope', () => {
    const e = makeOk('repos.list', [{ name: 'x' }], ['hubctl repos show <repo>'])
    expect(e.ok).toBe(true)
    expect(e.command).toBe('repos.list')
    expect(e.result).toEqual([{ name: 'x' }])
    expect(e.next_actions).toEqual(['hubctl repos show <repo>'])
    expect(e.error).toBeNull()
    expect(e.fix).toBeNull()
  })
  it('makeErr builds an error envelope with a fix', () => {
    const e = makeErr('repos.show', { code: 'not_found', message: 'missing' }, 'Check the name')
    expect(e.ok).toBe(false)
    expect(e.result).toBeNull()
    expect(e.error?.code).toBe('not_found')
    expect(e.fix).toBe('Check the name')
  })
  it('envelopes satisfy the Schema', () => {
    const decode = Schema.decodeUnknownSync(Envelope(Schema.Unknown))
    expect(() => decode(makeOk('c', null, []))).not.toThrow()
  })
})
