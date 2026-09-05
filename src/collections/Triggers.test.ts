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

describe('automation-triggers webhookSecret field access', () => {
  const getWebhookSecretField = () => {
    const fields = createTriggersCollection({ steps: [] }).fields
    return fields.find((field) => 'name' in field && field.name === 'webhookSecret') as
      | {
          access?: {
            create?: (args: { req: { user: unknown } }) => boolean
            read?: () => boolean
            update?: (args: { req: { user: unknown } }) => boolean
          }
        }
      | undefined
  }

  it('is not readable through the collection access, even though the collection itself is public', () => {
    expect(getWebhookSecretField()?.access?.read?.()).toBe(false)
  })

  // The collection's own access is `() => true` for every operation, so
  // without these overrides an anonymous PATCH/POST could set the secret to
  // a value of the caller's own choosing without ever needing to read the
  // original one.
  it('rejects create and update from a request with no authenticated user', () => {
    const field = getWebhookSecretField()
    const anonymousReq = { user: null }

    expect(field?.access?.create?.({ req: anonymousReq })).toBe(false)
    expect(field?.access?.update?.({ req: anonymousReq })).toBe(false)
  })

  it('allows create and update from a request with an authenticated user', () => {
    const field = getWebhookSecretField()
    const authenticatedReq = { user: { id: 'admin-1' } }

    expect(field?.access?.create?.({ req: authenticatedReq })).toBe(true)
    expect(field?.access?.update?.({ req: authenticatedReq })).toBe(true)
  })
})
