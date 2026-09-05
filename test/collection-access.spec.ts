import { expect, describe, it } from 'vitest'

import type { Payload } from 'payload'

import { asUser, createTestPayload } from './utils/test-payload.js'

const AUTOMATION_COLLECTIONS = [
  'workflows',
  'automation-triggers',
  'automation-steps',
  'workflow-runs',
] as const

const expectForbidden = async (operation: Promise<unknown>): Promise<void> => {
  await expect(operation).rejects.toMatchObject({ status: 403 })
}

/**
 * Seeds one document per automation collection through the Local API with
 * default access (overrideAccess: true), the way plugin internals
 * (seeder, executor, usage counts) create their records.
 */
const seedAutomationDocuments = async (payload: Payload) => {
  const step = await payload.create({
    collection: 'automation-steps',
    data: {
      name: 'Call HTTP endpoint',
      type: 'http-request-step',
      config: { url: 'https://example.com/api', headers: { Authorization: 'Bearer s3cr3t' } },
    },
  })

  const trigger = await payload.create({
    collection: 'automation-triggers',
    data: { name: 'Manual trigger', type: 'manual' },
  })

  const workflow = await payload.create({
    collection: 'workflows',
    data: {
      name: 'Seeded workflow',
      slug: 'seeded-workflow',
      triggers: [trigger.id],
      steps: [
        {
          step: step.id,
          slug: 'call-http-endpoint',
          stepName: 'Call HTTP endpoint',
          inputOverrides: {},
        },
      ],
    },
  })

  const run = await payload.create({
    collection: 'workflow-runs',
    data: {
      workflow: workflow.id,
      status: 'running',
      startedAt: new Date().toISOString(),
      triggeredBy: 'test-suite',
    },
  })

  return { step, trigger, workflow, run }
}

describe('automation collection access control', { timeout: 15000 }, () => {
  it('refuses every operation for anonymous requests on all automation collections', async () => {
    const payload = await createTestPayload()
    const { run } = await seedAutomationDocuments(payload)

    for (const slug of AUTOMATION_COLLECTIONS) {
      await expectForbidden(
        payload.create({
          collection: slug,
          data: {},
          overrideAccess: false,
        }) as Promise<unknown>,
      )
      await expectForbidden(
        payload.find({ collection: slug, overrideAccess: false }) as Promise<unknown>,
      )
    }

    // forge + wipe on workflow-runs (create and read asserted in the loop above)
    await expectForbidden(
      payload.update({
        collection: 'workflow-runs',
        id: run.id,
        data: { status: 'completed' },
        overrideAccess: false,
      }) as Promise<unknown>,
    )
    await expectForbidden(
      payload.delete({ collection: 'workflow-runs', id: run.id, overrideAccess: false }) as Promise<unknown>,
    )
  })

  it('refuses a user from a non-admin auth collection, including the workflows SSRF path', async () => {
    const payload = await createTestPayload()
    const customer = await payload.create({
      collection: 'customers',
      data: { email: 'customer@example.com', password: 'customer-password' },
    })

    for (const slug of AUTOMATION_COLLECTIONS) {
      await expectForbidden(
        payload.create({
          collection: slug,
          data: {},
          overrideAccess: false,
          user: asUser(customer, 'customers'),
        }) as Promise<unknown>,
      )
      await expectForbidden(
        payload.find({
          collection: slug,
          overrideAccess: false,
          user: asUser(customer, 'customers'),
        }) as Promise<unknown>,
      )
    }

    // The realistic attack: a customer session creating an enabled workflow
    // that would later execute HTTP requests with the app's privileges.
    await expectForbidden(
      payload.create({
        collection: 'workflows',
        data: {
          name: 'Exfiltrate',
          slug: 'exfiltrate',
          enabled: true,
          steps: [
            {
              stepName: 'Post secrets',
              slug: 'post-secrets',
              inputOverrides: {},
            },
          ],
        },
        overrideAccess: false,
        user: asUser(customer, 'customers'),
      }) as Promise<unknown>,
    )
  })

  it('allows an admin user collection member to read and write all automation collections', async () => {
    const payload = await createTestPayload()
    const admin = await payload.create({
      collection: 'users',
      data: { email: 'admin@example.com', password: 'admin-password' },
    })
    const user = asUser(admin, 'users')

    const step = await payload.create({
      collection: 'automation-steps',
      data: { name: 'Call HTTP endpoint', type: 'http-request-step', config: {} },
      overrideAccess: false,
      user,
    })

    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'Manual trigger', type: 'manual' },
      overrideAccess: false,
      user,
    })

    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Admin workflow',
        slug: 'admin-workflow',
        triggers: [trigger.id],
        steps: [{ step: step.id, slug: 'call-http-endpoint', stepName: 'Call HTTP endpoint' }],
      },
      overrideAccess: false,
      user,
    })

    const run = await payload.create({
      collection: 'workflow-runs',
      data: {
        workflow: workflow.id,
        status: 'running',
        startedAt: new Date().toISOString(),
        triggeredBy: 'admin-user',
      },
      overrideAccess: false,
      user,
    })

    for (const slug of AUTOMATION_COLLECTIONS) {
      const result = await payload.find({
        collection: slug,
        overrideAccess: false,
        user,
      })
      expect(result.totalDocs).toBeGreaterThan(0)
    }

    await payload.update({
      collection: 'workflows',
      id: workflow.id,
      data: { name: 'Renamed by admin' },
      overrideAccess: false,
      user,
    })
    const renamed = await payload.findByID({ collection: 'workflows', id: workflow.id })
    expect(renamed.name).toBe('Renamed by admin')

    await payload.delete({ collection: 'workflow-runs', id: run.id, overrideAccess: false, user })
    await expect(
      payload.findByID({ collection: 'workflow-runs', id: run.id }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('keeps plugin internals working: Local API seeding and execution writes need no user', async () => {
    const payload = await createTestPayload()
    const seeded = await seedAutomationDocuments(payload)

    // The seeder and executor rely on default Local API access; the run must
    // still be writable afterwards (usage counts, status transitions).
    await payload.update({
      collection: 'workflow-runs',
      id: seeded.run.id,
      data: { status: 'completed', completedAt: new Date().toISOString() },
    })
    const run = await payload.findByID({ collection: 'workflow-runs', id: seeded.run.id })
    expect(run.status).toBe('completed')
  })

  it('locks stored read-only workflows against update and delete, even for admins', async () => {
    const payload = await createTestPayload()
    const admin = await payload.create({
      collection: 'users',
      data: { email: 'admin@example.com', password: 'admin-password' },
    })
    const user = asUser(admin, 'users')

    const readOnly = await payload.create({
      collection: 'workflows',
      data: { name: 'Seeded template', slug: 'seeded-template', readOnly: true },
    })
    const editable = await payload.create({
      collection: 'workflows',
      data: { name: 'Editable workflow', slug: 'editable-workflow' },
    })

    // Echoing readOnly: false in the body must not unlock the stored document.
    await expectForbidden(
      payload.update({
        collection: 'workflows',
        id: readOnly.id,
        data: { name: 'Tampered', readOnly: false },
        overrideAccess: false,
        user,
      }) as Promise<unknown>,
    )
    await expectForbidden(
      payload.update({
        collection: 'workflows',
        id: readOnly.id,
        data: { name: 'Tampered' },
        overrideAccess: false,
        user,
      }) as Promise<unknown>,
    )
    await expectForbidden(
      payload.delete({ collection: 'workflows', id: readOnly.id, overrideAccess: false, user }) as Promise<unknown>,
    )

    // The lock is per-document: a normal workflow stays editable.
    await payload.update({
      collection: 'workflows',
      id: editable.id,
      data: { name: 'Still editable' },
      overrideAccess: false,
      user,
    })
    const renamed = await payload.findByID({ collection: 'workflows', id: editable.id })
    expect(renamed.name).toBe('Still editable')
  })

  it('honors per-operation access overrides from the plugin access option', async () => {
    const payload = await createTestPayload({
      access: {
        'automation-steps': {
          read: () => true,
        },
      },
    })

    // The override opens reads on automation-steps…
    const steps = await payload.find({ collection: 'automation-steps', overrideAccess: false })
    expect(steps.totalDocs).toBe(0)

    // …while every other operation on that collection keeps the secure default.
    await expectForbidden(
      payload.create({
        collection: 'automation-steps',
        data: { name: 'Call HTTP endpoint', type: 'http-request-step' },
        overrideAccess: false,
      }) as Promise<unknown>,
    )

    // …and the other collections are untouched.
    await expectForbidden(
      payload.find({ collection: 'workflow-runs', overrideAccess: false }) as Promise<unknown>,
    )
  })

  it('denies automation collection access when access.admin returns false on the user collection', async () => {
    const payload = await createTestPayload(
      {},
      // access.admin that denies all users (simulating role-based access control)
      () => false,
    )

    const user = await payload.create({
      collection: 'users',
      data: { email: 'editor@example.com', password: 'password' },
    })
    const userContext = asUser(user, 'users')

    // User is in admin collection but access.admin returns false, so all
    // automation operations should be forbidden.
    for (const slug of AUTOMATION_COLLECTIONS) {
      await expectForbidden(
        payload.find({
          collection: slug,
          overrideAccess: false,
          user: userContext,
        }) as Promise<unknown>,
      )
      await expectForbidden(
        payload.create({
          collection: slug,
          data: {},
          overrideAccess: false,
          user: userContext,
        }) as Promise<unknown>,
      )
    }

    // SSRF attack path: user cannot create enabled workflows
    await expectForbidden(
      payload.create({
        collection: 'workflows',
        data: {
          name: 'Exfiltrate',
          slug: 'exfiltrate',
          enabled: true,
          steps: [],
        },
        overrideAccess: false,
        user: userContext,
      }) as Promise<unknown>,
    )
  })
})
