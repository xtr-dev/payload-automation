import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildTestConfig, noopTask } from './build-test-config.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const newDbFile = () => path.join(os.tmpdir(), `payload-automation-trigger-cache-${uniqueId()}.db`)

// getPayload() caches instances process-wide by `key`, so each test needs its own key.
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

/** Counts the payload.find calls against automation-triggers made after the spy is installed. */
const spyOnTriggerQueries = (payload: Payload) => {
  const spy = vi.spyOn(payload, 'find')
  return () => spy.mock.calls.filter(([args]) => args.collection === 'automation-triggers').length
}

const createWorkflowFor = async (payload: Payload, hook: string) => {
  const trigger = await payload.create({
    collection: 'automation-triggers',
    data: { name: `posts ${hook}`, type: 'collection-hook', collectionSlug: 'posts', hook },
  })
  const step = await payload.create({
    collection: 'automation-steps',
    data: { name: 'noop', type: noopTask.slug },
  })
  await payload.create({
    collection: 'workflows',
    data: {
      name: `on posts ${hook}`,
      slug: `on-posts-${hook}-${uniqueId()}`,
      triggers: [trigger.id],
      steps: [{ step: step.id, slug: 'noop', stepName: 'noop' }],
    },
  })
  return trigger
}

const runCount = async (payload: Payload) =>
  (await payload.count({ collection: 'workflow-runs' })).totalDocs

describe('collection trigger hooks use a cached trigger lookup', () => {
  let dbFile: string
  let payload: Payload | undefined

  beforeEach(() => {
    dbFile = newDbFile()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (payload) {
      await payload.destroy()
      payload = undefined
    }
    removeDbFile(dbFile)
  })

  it('does not query automation-triggers on every read when no trigger listens to afterRead', async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile }))
    await createWorkflowFor(payload, 'afterChange')
    const post = await payload.create({ collection: 'posts', data: {} })

    const triggerQueries = spyOnTriggerQueries(payload)
    for (let i = 0; i < 5; i++) {
      await payload.findByID({ collection: 'posts', id: post.id })
    }
    await payload.find({ collection: 'posts' })

    // The create above already loaded the trigger list, so the reads reuse it.
    expect(triggerQueries()).toBe(0)
  })

  it('picks up a trigger created after the list was cached', async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile }))
    const post = await payload.create({ collection: 'posts', data: {} })
    await payload.findByID({ collection: 'posts', id: post.id })
    expect(await runCount(payload)).toBe(0)

    await createWorkflowFor(payload, 'afterRead')
    await payload.findByID({ collection: 'posts', id: post.id })

    expect(await runCount(payload)).toBe(1)
  })

  it('reloads the trigger list after a trigger is deleted', async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile }))
    const trigger = await createWorkflowFor(payload, 'afterChange')
    await payload.create({ collection: 'posts', data: {} })
    expect(await runCount(payload)).toBe(1)

    // Only the trigger is deleted; the workflow is left as it is.
    await payload.delete({ collection: 'automation-triggers', id: trigger.id })
    const triggerQueries = spyOnTriggerQueries(payload)
    await payload.create({ collection: 'posts', data: {} })

    // The deleted trigger is gone from the cache: the list was reloaded once
    // (afterChange and afterRead of the create share it) and nothing fired.
    expect(triggerQueries()).toBe(1)
    expect(await runCount(payload)).toBe(1)
  })

  it("follows an edit to a trigger's hook", async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile }))
    const trigger = await createWorkflowFor(payload, 'afterChange')
    const post = await payload.create({ collection: 'posts', data: {} })
    expect(await runCount(payload)).toBe(1)

    // afterDelete rather than afterRead, because create also runs afterRead.
    await payload.update({ collection: 'automation-triggers', id: trigger.id, data: { hook: 'afterDelete' } })

    await payload.create({ collection: 'posts', data: {} })
    expect(await runCount(payload)).toBe(1)

    await payload.delete({ collection: 'posts', id: post.id })
    expect(await runCount(payload)).toBe(2)
  })

  it('queries on every hook call when triggerCacheTTL is 0', async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile, pluginOptions: { triggerCacheTTL: 0 } }))
    const post = await payload.create({ collection: 'posts', data: {} })

    const triggerQueries = spyOnTriggerQueries(payload)
    for (let i = 0; i < 3; i++) {
      await payload.findByID({ collection: 'posts', id: post.id })
    }

    expect(triggerQueries()).toBe(3)
  })
})
