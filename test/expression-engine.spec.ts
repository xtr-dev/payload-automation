import { describe, expect, it } from 'vitest'

import { evaluate } from '../src/core/expression-engine.js'

describe('evaluate', () => {
  it('keeps the timebox isolated between overlapping cached evaluations', async () => {
    const expression = '$map([1..50000], function($value) { $value * $value })'

    // Start the long evaluation first. A timebox shared by cached expressions
    // would then be overwritten by the short call, causing this evaluation's
    // inner jsonata hooks to throw with the short call's deadline.
    const long = evaluate(expression, { trigger: {}, steps: {} }, { timeout: 10_000 })
    const short = evaluate(expression, { trigger: {}, steps: {} }, { timeout: 1 })

    await expect(short).rejects.toThrow('Expression evaluation timed out after 1ms')
    await expect(long).resolves.toHaveLength(50000)
  })

  it('stops non-terminating recursion with a depth error instead of overflowing the stack', async () => {
    const expression = '($f := function($n) { 1 + $f($n + 1) }; $f(0))'

    await expect(evaluate(expression, { trigger: {}, steps: {} })).rejects.toThrow(
      'exceeded maximum recursion depth',
    )
  })

  it('still evaluates ordinary expressions', async () => {
    await expect(evaluate('trigger.doc.title & "!"', { trigger: { doc: { title: 'Hi' } }, steps: {} })).resolves.toBe('Hi!')
  })
})
