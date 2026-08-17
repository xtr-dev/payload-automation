import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildTestConfig } from './build-test-config.js'
import type { SeedWorkflow } from '../../src/plugin/config-types.js'

const singleTriggerWorkflow: SeedWorkflow = {
  slug: 'test-seeded-workflow',
  name: 'Test Seeded Workflow',
  description: 'A workflow seeded once at boot',
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

const allTriggerTypesWorkflow: SeedWorkflow = {
  slug: 'test-all-trigger-types',
  name: 'Test All Trigger Types',
  triggers: [
    { type: 'collection-hook', parameters: { collectionSlug: 'posts', hook: 'afterChange' } },
    { type: 'global-hook', parameters: { globalSlug: 'settings', hook: 'afterChange' } },
    { type: 'scheduled', parameters: { schedule: '0 9 * * *' } },
    { type: 'webhook', parameters: { webhookPath: 'my-webhook' } },
  ],
  steps: [
    {
      name: 'Step One',
      type: 'noop-step',
      input: {},
    },
  ],
}

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const newDbFile = () => path.join(os.tmpdir(), `payload-automation-test-${uniqueId()}.db`)

// getPayload() caches instances process-wide by `key` (default 'default') and
// destroy() does not clear that cache, so reusing the default key across
// calls silently hands back a previous, already-destroyed instance instead
// of initializing against the new config. Each call needs its own key -
// including the second call that simulates a server restart against the
// same database file.
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

describe('seedWorkflows', () => {
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

  it('creates the workflow, trigger and step records on first boot', async () => {
    payload = await getTestPayload(
      buildTestConfig({ dbFile, seedWorkflows: [singleTriggerWorkflow] })
    )

    const workflows = await payload.find({
      collection: 'workflows',
      where: { slug: { equals: singleTriggerWorkflow.slug } },
      depth: 0,
      overrideAccess: true,
    })
    expect(workflows.docs).toHaveLength(1)

    const triggers = await payload.find({ collection: 'automation-triggers', overrideAccess: true })
    expect(triggers.docs).toHaveLength(1)

    const steps = await payload.find({ collection: 'automation-steps', overrideAccess: true })
    expect(steps.docs).toHaveLength(1)

    const workflow = workflows.docs[0] as Record<string, any>
    expect(workflow.readOnly).toBe(true)
    expect(workflow.triggers).toEqual([triggers.docs[0].id])
    expect(workflow.steps).toHaveLength(1)
    expect(workflow.steps[0].step).toBe(steps.docs[0].id)
  })

  it('does not create duplicate records when onInit runs again against the same database', async () => {
    payload = await getTestPayload(
      buildTestConfig({ dbFile, seedWorkflows: [singleTriggerWorkflow] })
    )

    await payload.destroy()
    payload = undefined

    // Simulate a server restart: same database file, same seed config, a
    // fresh Payload instance running onInit again.
    payload = await getTestPayload(
      buildTestConfig({ dbFile, seedWorkflows: [singleTriggerWorkflow] })
    )

    const workflows = await payload.find({
      collection: 'workflows',
      where: { slug: { equals: singleTriggerWorkflow.slug } },
      overrideAccess: true,
    })
    expect(workflows.docs).toHaveLength(1)

    const triggers = await payload.find({ collection: 'automation-triggers', overrideAccess: true })
    expect(triggers.docs).toHaveLength(1)

    const steps = await payload.find({ collection: 'automation-steps', overrideAccess: true })
    expect(steps.docs).toHaveLength(1)
  })

  it('maps trigger parameters to the correct fields for each trigger type', async () => {
    payload = await getTestPayload(
      buildTestConfig({ dbFile, seedWorkflows: [allTriggerTypesWorkflow] })
    )

    const triggers = await payload.find({
      collection: 'automation-triggers',
      sort: 'createdAt',
      overrideAccess: true,
    })
    expect(triggers.docs).toHaveLength(4)
    const [collectionHook, globalHook, scheduled, webhook] = triggers.docs as Record<string, any>[]

    expect(collectionHook.type).toBe('collection-hook')
    expect(collectionHook.collectionSlug).toBe('posts')
    expect(collectionHook.hook).toBe('afterChange')

    expect(globalHook.type).toBe('global-hook')
    expect(globalHook.globalSlug).toBe('settings')
    expect(globalHook.hook).toBe('afterChange')

    expect(scheduled.type).toBe('scheduled')
    expect(scheduled.schedule).toBe('0 9 * * *')

    expect(webhook.type).toBe('webhook')
    expect(webhook.webhookPath).toBe('my-webhook')
  })
})
