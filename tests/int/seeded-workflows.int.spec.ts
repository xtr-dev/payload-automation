import fs from 'fs'
import os from 'os'
import path from 'path'
import { Forbidden, getPayload } from 'payload'
import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildTestConfig } from './build-test-config.js'
import type { SeedWorkflow } from '../../src/plugin/config-types.js'

const workflowV1: SeedWorkflow = {
  slug: 'test-seeded-workflow',
  name: 'Test Seeded Workflow',
  description: 'Version 1',
  triggers: [
    {
      type: 'collection-hook',
      parameters: { collectionSlug: 'posts', hook: 'afterChange' },
    },
  ],
  steps: [
    {
      name: 'Step One',
      type: 'noop-step',
      input: { message: 'v1' },
    },
  ],
}

const workflowV2: SeedWorkflow = {
  slug: 'test-seeded-workflow',
  name: 'Test Seeded Workflow (Updated)',
  description: 'Version 2',
  triggers: [
    {
      type: 'collection-hook',
      parameters: { collectionSlug: 'posts', hook: 'afterDelete' },
    },
  ],
  steps: [
    {
      name: 'Step Two',
      type: 'noop-step',
      input: { message: 'v2' },
    },
  ],
}

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const newDbFile = () => path.join(os.tmpdir(), `payload-automation-test-${uniqueId()}.db`)

// getPayload() caches instances process-wide by `key` (default 'default') and
// destroy() does not clear that cache, so reusing the default key across
// tests silently hands back a previous, already-destroyed instance instead
// of initializing against the new config. Each call needs its own key.
const getTestPayload = (config: ReturnType<typeof buildTestConfig>) =>
  getPayload({ config, key: uniqueId() })

const removeDbFile = (dbFile: string) => {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbFile}${suffix}`
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}

describe('seeded workflow reconciliation', () => {
  let dbFile: string
  let payload: Payload | undefined

  beforeEach(() => {
    dbFile = newDbFile()
  })

  afterEach(async () => {
    if (payload) {
      await payload.destroy()
      payload = undefined
    }
    removeDbFile(dbFile)
  })

  it('updates the existing slug and its related records when the seed definition changes on restart', async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows: [workflowV1] }))

    const initial = await payload.find({
      collection: 'workflows',
      where: { slug: { equals: workflowV1.slug } },
      depth: 0,
      overrideAccess: true,
    })
    expect(initial.docs).toHaveLength(1)
    const firstVersion = initial.docs[0] as Record<string, any>
    const originalTriggerId = firstVersion.triggers[0]
    const originalStepId = firstVersion.steps[0].step

    await payload.destroy()
    payload = undefined

    // Restart against the same database with an updated definition under the same slug.
    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows: [workflowV2] }))

    const afterReseed = await payload.find({
      collection: 'workflows',
      where: { slug: { equals: workflowV2.slug } },
      depth: 0,
      overrideAccess: true,
    })
    // Reconciling must not create a second workflow for the same slug.
    expect(afterReseed.docs).toHaveLength(1)

    const updated = afterReseed.docs[0] as Record<string, any>
    expect(updated.id).toBe(firstVersion.id)
    expect(updated.name).toBe(workflowV2.name)
    expect(updated.description).toBe(workflowV2.description)
    expect(updated.readOnly).toBe(true)

    const newTriggerId = updated.triggers[0]
    const newStepId = updated.steps[0].step
    expect(newTriggerId).not.toBe(originalTriggerId)
    expect(newStepId).not.toBe(originalStepId)

    const newTrigger = await payload.findByID({
      collection: 'automation-triggers',
      id: newTriggerId,
      overrideAccess: true,
    })
    expect(newTrigger.hook).toBe('afterDelete')

    // The records the previous version referenced must be gone, not orphaned.
    await expect(
      payload.findByID({ collection: 'automation-triggers', id: originalTriggerId, overrideAccess: true })
    ).rejects.toThrow()
    await expect(
      payload.findByID({ collection: 'automation-steps', id: originalStepId, overrideAccess: true })
    ).rejects.toThrow()
  })
})

describe('workflow readOnly access control', () => {
  let dbFile: string
  let payload: Payload

  beforeEach(async () => {
    dbFile = newDbFile()
    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows: [workflowV1] }))
  })

  afterEach(async () => {
    await payload.destroy()
    removeDbFile(dbFile)
  })

  const findSeeded = async () => {
    const result = await payload.find({
      collection: 'workflows',
      where: { slug: { equals: workflowV1.slug } },
      overrideAccess: true,
    })
    return result.docs[0] as Record<string, any>
  }

  it('refuses to update a persisted read-only workflow even when the request omits readOnly', async () => {
    const seeded = await findSeeded()
    expect(seeded.readOnly).toBe(true)

    await expect(
      payload.update({
        collection: 'workflows',
        id: seeded.id,
        // Deliberately omits `readOnly` - the persisted value must still govern access.
        data: { name: 'Hacked name' },
        overrideAccess: false,
      })
    ).rejects.toThrow(Forbidden)
  })

  it('refuses to delete a persisted read-only workflow', async () => {
    const seeded = await findSeeded()

    await expect(
      payload.delete({
        collection: 'workflows',
        id: seeded.id,
        overrideAccess: false,
      })
    ).rejects.toThrow(Forbidden)
  })

  it('leaves ordinary, non-read-only workflows editable and deletable', async () => {
    const created = await payload.create({
      collection: 'workflows',
      data: {
        slug: 'user-created-workflow',
        name: 'User Workflow',
      },
      overrideAccess: true,
    })
    expect(created.readOnly).toBe(false)

    const updated = await payload.update({
      collection: 'workflows',
      id: created.id,
      data: { name: 'Renamed by user' },
      overrideAccess: false,
    })
    expect(updated.name).toBe('Renamed by user')

    await expect(
      payload.delete({
        collection: 'workflows',
        id: created.id,
        overrideAccess: false,
      })
    ).resolves.toBeTruthy()
  })
})
