import { describe, expect, it } from 'vitest'

import { createLocalReq, type Payload } from 'payload'

import { webhookEndpoint } from '../src/plugin/webhook-endpoint.js'
import { hashWebhookSecret } from '../src/utils/webhook.js'
import { asUser, createTestPayload } from './utils/test-payload.js'

/**
 * Calls the webhook endpoint handler the way Payload's router would: a real
 * PayloadRequest with the route parameter, headers and an empty body.
 */
const callWebhook = async (
  payload: Payload,
  webhookPath: string,
  headers: Record<string, string> = {},
): Promise<Response> => {
  const req = await createLocalReq({}, payload)
  Object.assign(req, {
    headers: new Headers(headers),
    json: () => Promise.resolve({ orderId: 'abc-123' }),
    routeParams: { webhookPath },
    url: `http://localhost/api/automation/webhooks/${webhookPath}`,
  })
  return webhookEndpoint.handler(req)
}

const createAdmin = async (payload: Payload) => {
  const admin = await payload.create({
    collection: 'users',
    data: { email: 'admin@example.com', password: 'admin-password' },
  })
  return asUser(admin, 'users')
}

describe('webhook triggers', { timeout: 30000 }, () => {
  it('lets an admin set and rotate the secret, stores only its hash and never returns it', async () => {
    const payload = await createTestPayload()
    const user = await createAdmin(payload)

    const created = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'Orders', type: 'webhook', webhookPath: 'orders', webhookSecret: 'first-secret' },
      overrideAccess: false,
      user,
    })
    expect(created.webhookSecret ?? null).toBeNull()
    expect(created).not.toHaveProperty('webhookSecretHash')

    const read = await payload.findByID({
      collection: 'automation-triggers',
      id: created.id,
      overrideAccess: false,
      user,
    })
    expect(JSON.stringify(read)).not.toContain('first-secret')
    expect(JSON.stringify(read)).not.toContain(hashWebhookSecret('first-secret'))

    const stored = await payload.findByID({
      collection: 'automation-triggers',
      id: created.id,
      showHiddenFields: true,
    })
    expect(stored.webhookSecretHash).toBe(hashWebhookSecret('first-secret'))

    // Saving without a secret (as the admin form does when the field is left
    // empty) keeps the current one.
    await payload.update({
      collection: 'automation-triggers',
      id: created.id,
      data: { name: 'Orders renamed', webhookSecret: '' },
      overrideAccess: false,
      user,
    })
    const kept = await payload.findByID({
      collection: 'automation-triggers',
      id: created.id,
      showHiddenFields: true,
    })
    expect(kept.webhookSecretHash).toBe(hashWebhookSecret('first-secret'))

    // A partial update with only a new secret rotates it.
    await payload.update({
      collection: 'automation-triggers',
      id: created.id,
      data: { webhookSecret: 'second-secret' },
      overrideAccess: false,
      user,
    })
    const rotated = await payload.findByID({
      collection: 'automation-triggers',
      id: created.id,
      showHiddenFields: true,
    })
    expect(rotated.webhookSecretHash).toBe(hashWebhookSecret('second-secret'))

    // A client cannot plant a hash of its own.
    await payload.update({
      collection: 'automation-triggers',
      id: created.id,
      data: { webhookSecretHash: hashWebhookSecret('attacker') },
      overrideAccess: false,
      user,
    })
    const untouched = await payload.findByID({
      collection: 'automation-triggers',
      id: created.id,
      showHiddenFields: true,
    })
    expect(untouched.webhookSecretHash).toBe(hashWebhookSecret('second-secret'))
  })

  it('refuses to create a webhook trigger without a secret', async () => {
    const payload = await createTestPayload()
    const user = await createAdmin(payload)

    await expect(
      payload.create({
        collection: 'automation-triggers',
        data: { name: 'Open', type: 'webhook', webhookPath: 'open' },
        overrideAccess: false,
        user,
      }),
    ).rejects.toThrow('Webhook secret is required for webhook triggers')
  })

  it('reaches a trigger past the first 100 webhook triggers and authenticates against the hash', async () => {
    const payload = await createTestPayload()

    for (let index = 0; index < 105; index += 1) {
      await payload.create({
        collection: 'automation-triggers',
        data: {
          name: `Webhook ${index}`,
          type: 'webhook',
          webhookPath: `hook-${index}`,
          webhookSecret: `secret-${index}`,
        },
      })
    }
    const last = await payload.find({
      collection: 'automation-triggers',
      where: { webhookPath: { equals: 'hook-104' } },
    })
    await payload.create({
      collection: 'workflows',
      data: { name: 'Last hook', slug: 'last-hook', enabled: true, triggers: [last.docs[0].id], steps: [] },
    })

    expect((await callWebhook(payload, 'hook-104', { 'x-webhook-secret': 'wrong' })).status).toBe(401)
    expect((await callWebhook(payload, 'missing')).status).toBe(404)

    const response = await callWebhook(payload, 'hook-104', { 'x-webhook-secret': 'secret-104' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.workflows).toHaveLength(1)
    expect(body.workflows[0]).toMatchObject({ status: 'triggered', workflowName: 'Last hook' })

    const runs = await payload.find({ collection: 'workflow-runs' })
    expect(runs.totalDocs).toBe(1)
    expect(JSON.stringify(runs.docs[0])).not.toContain(hashWebhookSecret('secret-104'))
    expect(JSON.stringify(runs.docs[0])).not.toContain('secret-104')

    // The oldest trigger is reachable too, whichever end a default sort would
    // have cut off. It has no workflow, so it authenticates and runs nothing.
    const first = await callWebhook(payload, 'hook-0', { authorization: 'Bearer secret-0' })
    expect(first.status).toBe(200)
    expect((await first.json()).workflows).toEqual([])
  })
})
