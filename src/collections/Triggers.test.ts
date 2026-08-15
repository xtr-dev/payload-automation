import { describe, expect, it } from 'vitest'

import { createTriggersCollection } from './Triggers.js'

// The beforeChange hook is a pure validation function — no db or request
// access — so it's exercised directly rather than through a live Payload
// instance, which this repo has no harness for yet.
const validate = createTriggersCollection({ steps: [] }).hooks?.beforeChange?.[0] as unknown as (args: {
  data: Record<string, unknown>
  operation: 'create' | 'update'
}) => Promise<Record<string, unknown>>

describe('automation-triggers webhookPath validation', () => {
  it('rejects a path containing a slash between segments', async () => {
    await expect(
      validate({
        data: { type: 'webhook', webhookPath: 'my/webhook', webhookSecret: 'secret' },
        operation: 'create',
      })
    ).rejects.toThrow('Webhook path must be a single path segment without whitespace')
  })

  it('rejects a path containing whitespace', async () => {
    await expect(
      validate({
        data: { type: 'webhook', webhookPath: 'my webhook', webhookSecret: 'secret' },
        operation: 'create',
      })
    ).rejects.toThrow('Webhook path must be a single path segment without whitespace')
  })

  it('accepts a valid single path segment', async () => {
    const result = await validate({
      data: { type: 'webhook', webhookPath: 'my-webhook', webhookSecret: 'secret' },
      operation: 'create',
    })
    expect(result.webhookPath).toBe('my-webhook')
  })

  it('accepts and normalizes a leading/trailing slash, matching what the webhook endpoint accepts', async () => {
    const result = await validate({
      data: { type: 'webhook', webhookPath: '/my-webhook/', webhookSecret: 'secret' },
      operation: 'create',
    })
    expect(result.webhookPath).toBe('my-webhook')
  })

  it('rejects a path that is only slashes', async () => {
    await expect(
      validate({
        data: { type: 'webhook', webhookPath: '///', webhookSecret: 'secret' },
        operation: 'create',
      })
    ).rejects.toThrow('Webhook path must be a single path segment without whitespace')
  })
})
