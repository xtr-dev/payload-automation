import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload } from 'payload'
import type { Payload, TaskConfig } from 'payload'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildTestConfig, noopTask } from './build-test-config.js'
import { retryWorkflowRun } from '../../src/exports/server.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const newDbFile = () => path.join(os.tmpdir(), `payload-automation-retry-${uniqueId()}.db`)

const removeDbFile = (dbFile: string) => {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbFile}${suffix}`
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}

// Shared with the task handlers below; reset per test.
const calls = { counted: 0, flaky: 0 }
let flakyShouldFail = true

const countingTask: TaskConfig<string> = {
  slug: 'counting-step',
  label: 'Counting',
  handler: () => {
    calls.counted++
    return Promise.resolve({ output: { count: calls.counted }, state: 'succeeded' })
  },
}

const flakyTask: TaskConfig<string> = {
  slug: 'flaky-step',
  label: 'Flaky',
  retries: 0,
  handler: () => {
    calls.flaky++
    if (flakyShouldFail) {
      throw new Error('flaky step failed')
    }
    return Promise.resolve({ output: { ok: true }, state: 'succeeded' })
  },
}

/** posts afterChange → counting step → flaky step (depends on counting). */
const createWorkflow = async (payload: Payload) => {
  const trigger = await payload.create({
    collection: 'automation-triggers',
    data: { name: 'posts afterChange', type: 'collection-hook', collectionSlug: 'posts', hook: 'afterChange' },
  })
  const counting = await payload.create({
    collection: 'automation-steps',
    data: { name: 'count', type: countingTask.slug },
  })
  const flaky = await payload.create({
    collection: 'automation-steps',
    data: { name: 'flaky', type: flakyTask.slug },
  })
  return payload.create({
    collection: 'workflows',
    data: {
      name: 'retry me',
      slug: `retry-me-${uniqueId()}`,
      errorHandling: 'stop',
      triggers: [trigger.id],
      steps: [
        { step: counting.id, slug: 'count', stepName: 'count' },
        { step: flaky.id, slug: 'flaky', stepName: 'flaky', dependencies: [{ slug: 'count' }] },
      ],
    },
  })
}

type StoredRun = {
  id: number | string
  status: string
  stepResults?: Array<{ status?: string; output?: Record<string, unknown> }>
  triggerData?: { doc?: { id?: unknown } }
}

const failedRun = async (payload: Payload): Promise<StoredRun> => {
  const { docs } = await payload.find({ collection: 'workflow-runs', depth: 0 })
  expect(docs).toHaveLength(1)
  const run = docs[0] as unknown as StoredRun
  expect(run.status).toBe('failed')
  return run
}

describe('retryWorkflowRun', () => {
  let dbFile: string
  let payload: Payload | undefined

  beforeEach(async () => {
    dbFile = newDbFile()
    calls.counted = 0
    calls.flaky = 0
    flakyShouldFail = true
    payload = await getPayload({
      config: buildTestConfig({ dbFile, pluginOptions: { steps: [noopTask, countingTask, flakyTask] } }),
      key: uniqueId(),
    })
  })

  afterEach(async () => {
    if (payload) {
      await payload.destroy()
      payload = undefined
    }
    removeDbFile(dbFile)
  })

  it('re-runs every step from the stored triggerData and returns the new run', async () => {
    await createWorkflow(payload!)
    const post = await payload!.create({ collection: 'posts', data: {} })
    const original = await failedRun(payload!)
    expect(calls).toEqual({ counted: 1, flaky: 1 })

    flakyShouldFail = false
    const retried = (await retryWorkflowRun(payload!, original.id)) as unknown as StoredRun

    expect(retried.id).not.toBe(original.id)
    expect(retried.status).toBe('completed')
    expect(retried.stepResults?.map((r) => r.status)).toEqual(['succeeded', 'succeeded'])
    expect(retried.triggerData?.doc?.id).toBe(post.id)
    expect(calls).toEqual({ counted: 2, flaky: 2 })

    // The original run is left as it was.
    const reloaded = await payload!.findByID({ collection: 'workflow-runs', id: original.id })
    expect(reloaded.status).toBe('failed')
  })

  it('with resumeFromFailedStep, skips steps that already succeeded and keeps their output', async () => {
    await createWorkflow(payload!)
    await payload!.create({ collection: 'posts', data: {} })
    const original = await failedRun(payload!)

    flakyShouldFail = false
    const retried = (await retryWorkflowRun(payload!, original.id, {
      resumeFromFailedStep: true,
    })) as unknown as StoredRun

    expect(retried.status).toBe('completed')
    expect(calls).toEqual({ counted: 1, flaky: 2 })
    expect(retried.stepResults?.[0]?.status).toBe('succeeded')
    expect(retried.stepResults?.[0]?.output).toEqual(original.stepResults?.[0]?.output)
  })

  it('returns a failed run instead of throwing when a step fails again', async () => {
    await createWorkflow(payload!)
    await payload!.create({ collection: 'posts', data: {} })
    const original = await failedRun(payload!)

    const retried = (await retryWorkflowRun(payload!, original.id)) as unknown as StoredRun

    expect(retried.id).not.toBe(original.id)
    expect(retried.status).toBe('failed')
  })

  it('refuses to retry a run that is still running', async () => {
    const workflow = await createWorkflow(payload!)
    const running = await payload!.create({
      collection: 'workflow-runs',
      data: { workflow: workflow.id, status: 'running', startedAt: new Date().toISOString(), triggeredBy: 'test' },
    })

    await expect(retryWorkflowRun(payload!, running.id)).rejects.toThrow(/still running/)
  })
})
