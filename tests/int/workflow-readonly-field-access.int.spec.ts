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
})
