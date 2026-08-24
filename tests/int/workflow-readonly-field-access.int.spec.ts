import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildTestConfig } from './build-test-config.js'
import type { SeedWorkflow } from '../../src/plugin/config-types.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const newDbFile = () => path.join(os.tmpdir(), `payload-automation-readonly-${uniqueId()}.db`)

// getPayload() caches instances process-wide by `key` (default 'default') and
// destroy() does not clear that cache, so each call needs its own key.
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

const seededWorkflow: SeedWorkflow = {
  slug: 'seeded-readonly-workflow',
  name: 'Seeded ReadOnly Workflow',
  description: 'Created by seedWorkflows onInit',
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
      input: {},
    },
  ],
}

const relationId = (value: unknown): string | number => {
  if (typeof value === 'string' || typeof value === 'number') {
    return value
  }
  if (value !== null && typeof value === 'object' && 'id' in value) {
    const nested = (value as { id: unknown }).id
    if (typeof nested === 'string' || typeof nested === 'number') {
      return nested
    }
  }
  throw new Error(`expected a relationship id, got ${JSON.stringify(value)}`)
}

const expectForbidden = (operation: Promise<unknown>) =>
  expect(operation).rejects.toMatchObject({ status: 403 })

describe('workflows.readOnly field and collection access', () => {
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

  it('strips readOnly:true on Local API create when overrideAccess is false, so an unauthenticated caller cannot freeze a trigger', async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile }))

    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: {
        name: 'victim-trigger',
        type: 'collection-hook',
        collectionSlug: 'posts',
        hook: 'afterChange',
      },
      overrideAccess: false,
    })

    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'attacker workflow',
        slug: `attacker-${uniqueId()}`,
        readOnly: true,
        triggers: [trigger.id],
      },
      overrideAccess: false,
    })

    expect((workflow as { readOnly?: boolean }).readOnly).toBe(false)

    const updatedTrigger = await payload.update({
      collection: 'automation-triggers',
      id: trigger.id,
      data: { name: 'victim-trigger-renamed' },
      overrideAccess: false,
    })
    expect((updatedTrigger as { name?: string }).name).toBe('victim-trigger-renamed')
  })

  it('keeps readOnly:true on Local API create when overrideAccess is left at its default, matching the seeder', async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile }))

    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'seeded-style workflow',
        slug: `seeded-style-${uniqueId()}`,
        readOnly: true,
      },
    })

    expect((workflow as { readOnly?: boolean }).readOnly).toBe(true)
  })

  it('seedWorkflows onInit still persists readOnly:true', async () => {
    payload = await getTestPayload(
      buildTestConfig({ dbFile, seedWorkflows: [seededWorkflow] }),
    )

    const workflows = await payload.find({
      collection: 'workflows',
      where: { slug: { equals: seededWorkflow.slug } },
      overrideAccess: true,
    })
    expect(workflows.docs).toHaveLength(1)
    expect((workflows.docs[0] as { readOnly?: boolean }).readOnly).toBe(true)
  })

  it('strips readOnly:true on Local API update when overrideAccess is false', async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile }))

    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'mutable workflow',
        slug: `mutable-${uniqueId()}`,
        readOnly: false,
      },
      overrideAccess: false,
    })

    const updated = await payload.update({
      collection: 'workflows',
      id: workflow.id,
      data: { readOnly: true, name: 'still mutable' },
      overrideAccess: false,
    })

    expect((updated as { readOnly?: boolean }).readOnly).toBe(false)
    expect((updated as { name?: string }).name).toBe('still mutable')
  })

  it('refuses update and delete of a stored readOnly workflow even when the request body omits readOnly', async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile }))

    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'immutable workflow',
        slug: `immutable-${uniqueId()}`,
        readOnly: true,
      },
    })

    await expect(
      payload.update({
        collection: 'workflows',
        id: workflow.id,
        data: { name: 'renamed' },
        overrideAccess: false,
      }),
    ).rejects.toMatchObject({ status: 403 })

    await expect(
      payload.delete({
        collection: 'workflows',
        id: workflow.id,
        overrideAccess: false,
      }),
    ).rejects.toMatchObject({ status: 403 })

    const stillThere = await payload.findByID({
      collection: 'workflows',
      id: workflow.id,
      overrideAccess: true,
    })
    expect((stillThere as { name?: string }).name).toBe('immutable workflow')
    expect((stillThere as { readOnly?: boolean }).readOnly).toBe(true)
  })

  it("refuses update and delete of a seeded workflow's trigger and step, while an unreferenced sibling still updates and bulk delete skips the frozen ids", async () => {
    payload = await getTestPayload(
      buildTestConfig({ dbFile, seedWorkflows: [seededWorkflow] }),
    )

    const seeded = await payload.find({
      collection: 'workflows',
      where: { slug: { equals: seededWorkflow.slug } },
      depth: 0,
      overrideAccess: true,
    })
    expect(seeded.docs).toHaveLength(1)

    const workflow = seeded.docs[0] as {
      triggers?: unknown[]
      steps?: Array<{ step?: unknown }>
    }
    const frozenTriggerId = relationId(workflow.triggers?.[0])
    const frozenStepId = relationId(workflow.steps?.[0]?.step)

    const frozenTrigger = await payload.findByID({
      collection: 'automation-triggers',
      id: frozenTriggerId,
      overrideAccess: true,
    })
    const frozenStep = await payload.findByID({
      collection: 'automation-steps',
      id: frozenStepId,
      overrideAccess: true,
    })
    const frozenTriggerName = (frozenTrigger as { name?: string }).name
    const frozenStepName = (frozenStep as { name?: string }).name

    const siblingTrigger = await payload.create({
      collection: 'automation-triggers',
      data: {
        name: 'unreferenced-trigger',
        type: 'collection-hook',
        collectionSlug: 'posts',
        hook: 'afterChange',
      },
      overrideAccess: false,
    })
    const siblingStep = await payload.create({
      collection: 'automation-steps',
      data: {
        name: 'unreferenced-step',
        type: 'noop-step',
        config: {},
      },
      overrideAccess: false,
    })

    await expectForbidden(
      payload.update({
        collection: 'automation-triggers',
        id: frozenTriggerId,
        data: { name: 'frozen-trigger-renamed' },
        overrideAccess: false,
      }),
    )
    await expectForbidden(
      payload.delete({
        collection: 'automation-triggers',
        id: frozenTriggerId,
        overrideAccess: false,
      }),
    )
    await expectForbidden(
      payload.update({
        collection: 'automation-steps',
        id: frozenStepId,
        data: { name: 'frozen-step-renamed' },
        overrideAccess: false,
      }),
    )
    await expectForbidden(
      payload.delete({
        collection: 'automation-steps',
        id: frozenStepId,
        overrideAccess: false,
      }),
    )

    const updatedSiblingTrigger = await payload.update({
      collection: 'automation-triggers',
      id: siblingTrigger.id,
      data: { name: 'unreferenced-trigger-renamed' },
      overrideAccess: false,
    })
    expect((updatedSiblingTrigger as { name?: string }).name).toBe(
      'unreferenced-trigger-renamed',
    )

    const updatedSiblingStep = await payload.update({
      collection: 'automation-steps',
      id: siblingStep.id,
      data: { name: 'unreferenced-step-renamed' },
      overrideAccess: false,
    })
    expect((updatedSiblingStep as { name?: string }).name).toBe(
      'unreferenced-step-renamed',
    )

    const triggerBulk = await payload.delete({
      collection: 'automation-triggers',
      where: { id: { in: [frozenTriggerId, siblingTrigger.id] } },
      overrideAccess: false,
    })
    const deletedTriggerIds = new Set(
      triggerBulk.docs.map((doc) => String(doc.id)),
    )
    expect(deletedTriggerIds.has(String(siblingTrigger.id))).toBe(true)
    expect(deletedTriggerIds.has(String(frozenTriggerId))).toBe(false)

    const stepBulk = await payload.delete({
      collection: 'automation-steps',
      where: { id: { in: [frozenStepId, siblingStep.id] } },
      overrideAccess: false,
    })
    const deletedStepIds = new Set(stepBulk.docs.map((doc) => String(doc.id)))
    expect(deletedStepIds.has(String(siblingStep.id))).toBe(true)
    expect(deletedStepIds.has(String(frozenStepId))).toBe(false)

    const triggerStillThere = await payload.findByID({
      collection: 'automation-triggers',
      id: frozenTriggerId,
      overrideAccess: true,
    })
    expect((triggerStillThere as { name?: string }).name).toBe(frozenTriggerName)

    const stepStillThere = await payload.findByID({
      collection: 'automation-steps',
      id: frozenStepId,
      overrideAccess: true,
    })
    expect((stepStillThere as { name?: string }).name).toBe(frozenStepName)
  })
})
