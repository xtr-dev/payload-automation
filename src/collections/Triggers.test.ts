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

  it('rejects a webhook trigger with no path at all', async () => {
    await expect(
      validate({
        data: { type: 'webhook', webhookSecret: 'secret' },
        operation: 'create',
      })
    ).rejects.toThrow('Webhook path is required for webhook triggers')
  })
})

describe('automation-triggers required-field validation', () => {
  it('rejects a collection-hook trigger with no collectionSlug', async () => {
    await expect(
      validate({
        data: { type: 'collection-hook', hook: 'afterChange' },
        operation: 'create',
      })
    ).rejects.toThrow('Collection is required for collection hook triggers')
  })

  it('rejects a global-hook trigger with no globalSlug', async () => {
    await expect(
      validate({
        data: { type: 'global-hook', hook: 'afterChange' },
        operation: 'create',
      })
    ).rejects.toThrow('Global is required for global hook triggers')
  })

  it('rejects a collection-hook trigger with no hook type', async () => {
    await expect(
      validate({
        data: { type: 'collection-hook', collectionSlug: 'posts' },
        operation: 'create',
      })
    ).rejects.toThrow('Hook type is required')
  })

  it('rejects a global-hook trigger with no hook type', async () => {
    await expect(
      validate({
        data: { type: 'global-hook', globalSlug: 'settings' },
        operation: 'create',
      })
    ).rejects.toThrow('Hook type is required')
  })

  it('rejects a scheduled trigger with no schedule', async () => {
    await expect(
      validate({
        data: { type: 'scheduled' },
        operation: 'create',
      })
    ).rejects.toThrow('Schedule is required for scheduled triggers')
  })

  it('rejects a webhook trigger with no webhookSecret', async () => {
    await expect(
      validate({
        data: { type: 'webhook', webhookPath: 'my-webhook' },
        operation: 'create',
      })
    ).rejects.toThrow('Webhook secret is required for webhook triggers')
  })
})
