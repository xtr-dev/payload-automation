import { describe, expect, it, vi } from 'vitest'

import {
  ValidationError,
  parseJsonOrObject,
  validateRequired,
  withErrorHandling,
} from '../src/utils/validation.js'

describe('validation utilities', () => {
  it('accepts required fields whose values are false or zero', () => {
    expect(() => validateRequired({ enabled: false, retries: 0 }, ['enabled', 'retries'])).not.toThrow()
  })

  it('reports the missing required field', () => {
    expect(() => validateRequired({ name: null }, ['name'])).toThrow(
      new ValidationError('name is required')
    )
  })

  it('parses JSON strings and preserves object inputs', () => {
    const object = { workflow: 'publish' }

    expect(parseJsonOrObject('{"workflow":"publish"}', 'parameters')).toEqual(object)
    expect(parseJsonOrObject(object, 'parameters')).toBe(object)
  })

  it('turns thrown handler errors into failed step outcomes', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('provider unavailable'))

    await expect(withErrorHandling(handler)({ id: 'step-1' })).resolves.toEqual({
      errorMessage: 'provider unavailable',
      state: 'failed',
    })
  })

  it('returns successful handler output unchanged', async () => {
    const output = { documentId: 'doc-1' }
    const handler = vi.fn().mockResolvedValue(output)

    await expect(withErrorHandling(handler)({ id: 'step-1' })).resolves.toEqual({
      output,
      state: 'succeeded',
    })
  })
})
