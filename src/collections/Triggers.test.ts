import { describe, expect, it } from 'vitest'

import { hashWebhookSecret } from '../utils/webhook.js'
import { createTriggersCollection } from './Triggers.js'

// The beforeChange hook is a pure validation function — no db or request
// access — so it's exercised directly rather than through a live Payload
// instance, which this repo has no harness for yet.
const validate = createTriggersCollection({ steps: [] }).hooks?.beforeChange?.[0] as unknown as (args: {
  data: Record<string, unknown>
  operation: 'create' | 'update'
  originalDoc?: Record<string, unknown>
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

describe('automation-triggers webhook secret storage', () => {
  const findField = (name: string) =>
    createTriggersCollection({ steps: [] }).fields.find(
      (field) => 'name' in field && field.name === name
    ) as Record<string, any> | undefined

  // Payload's admin UI omits fields the user cannot read, so a read-denied
  // secret field could never be filled in from /admin.
  it('keeps the secret input readable for the admin UI, but virtual and blanked on read', () => {
    const field = findField('webhookSecret')
    expect(field?.access?.read).toBeUndefined()
    expect(field?.virtual).toBe(true)
    expect(field?.hooks?.afterRead?.[0]({ value: 'leaked' })).toBeNull()
  })

  it('stores the hash in a hidden field that clients cannot write', () => {
    const field = findField('webhookSecretHash')
    expect(field?.hidden).toBe(true)
    expect(field?.access?.create()).toBe(false)
    expect(field?.access?.update()).toBe(false)
  })

  it('hashes a submitted secret and drops the plaintext', async () => {
    const result = await validate({
      data: { type: 'webhook', webhookPath: 'orders', webhookSecret: 's3cret' },
      operation: 'create',
    })
    expect(result.webhookSecretHash).toBe(hashWebhookSecret('s3cret'))
    expect(result).not.toHaveProperty('webhookSecret')
  })

  it('requires a secret when creating a webhook trigger', async () => {
    await expect(
      validate({ data: { type: 'webhook', webhookPath: 'orders' }, operation: 'create' })
    ).rejects.toThrow('Webhook secret is required for webhook triggers')
  })

  it('keeps the stored hash when an update leaves the secret empty', async () => {
    const storedHash = hashWebhookSecret('old')
    const result = await validate({
      data: { type: 'webhook', webhookPath: 'orders', webhookSecret: '' },
      operation: 'update',
      originalDoc: { type: 'webhook', webhookPath: 'orders', webhookSecretHash: storedHash },
    })
    expect(result.webhookSecretHash ?? storedHash).toBe(storedHash)
  })

  it('rotates the secret on a partial update that only sends a new one', async () => {
    const result = await validate({
      data: { webhookSecret: 'new' },
      operation: 'update',
      originalDoc: { type: 'webhook', webhookPath: 'orders', webhookSecretHash: hashWebhookSecret('old') },
    })
    expect(result.webhookSecretHash).toBe(hashWebhookSecret('new'))
  })
})
