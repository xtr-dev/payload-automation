import { describe, expect, it } from 'vitest'

import { evaluate } from './expression-engine.js'

describe('evaluate', () => {
  it('keeps the timebox isolated between overlapping cached evaluations', async () => {
    const expression = '$map([1..50000], function($value) { $value * $value })'

    const first = evaluate(expression, { trigger: {}, steps: {} }, { timeout: 1 })
    const second = evaluate(expression, { trigger: {}, steps: {} }, { timeout: 10_000 })

    await expect(first).rejects.toThrow('Expression evaluation timed out after 1ms')
    await expect(second).resolves.toHaveLength(50000)
  })
})
