import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildTestConfig, noopTask } from './build-test-config.js'
import { findStepResult, retryWorkflowRun } from '../../src/exports/server.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const removeDbFile = (dbFile: string) => {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbFile}${suffix}`
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}

type StoredStepResult = { slug?: null | string; status?: null | string; stepName?: null | string }
type StoredRun = { id: number | string; status: string; stepResults?: StoredStepResult[] }

/** posts afterChange → two no-op steps whose display names differ from their slugs. */
const createWorkflow = async (payload: Payload) => {
  const trigger = await payload.create({
    collection: 'automation-triggers',
    data: { name: 'posts afterChange', type: 'collection-hook', collectionSlug: 'posts', hook: 'afterChange' },
  })
  const step = await payload.create({
    collection: 'automation-steps',
    data: { name: 'noop', type: noopTask.slug },
  })
  return payload.create({
    collection: 'workflows',
    data: {
      name: 'slugged steps',
      slug: `slugged-${uniqueId()}`,
      triggers: [trigger.id],
      steps: [
        { step: step.id, slug: 'first-step', stepName: 'First step' },
        { step: step.id, slug: 'second-step', stepName: 'Second step', dependencies: [{ slug: 'first-step' }] },
      ],
    },
  })
}

describe('workflow-runs stepResults slug', () => {
  let dbFile: string
  let payload: Payload | undefined

  beforeEach(async () => {
    dbFile = path.join(os.tmpdir(), `payload-automation-step-slug-${uniqueId()}.db`)
    payload = await getPayload({ config: buildTestConfig({ dbFile }), key: uniqueId() })
  })

  afterEach(async () => {
    if (payload) {
      await payload.destroy()
      payload = undefined
    }
    removeDbFile(dbFile)
  })

  it('stores the slug of each step result on the run', async () => {
    await createWorkflow(payload!)
    await payload!.create({ collection: 'posts', data: {} })

    const { docs } = await payload!.find({ collection: 'workflow-runs', depth: 0 })
    expect(docs).toHaveLength(1)
    const run = docs[0] as unknown as StoredRun
    expect(run.status).toBe('completed')
    expect(run.stepResults?.map((r) => [r.slug, r.stepName, r.status])).toEqual([
      ['first-step', 'First step', 'succeeded'],
      ['second-step', 'Second step', 'succeeded'],
    ])

    expect(findStepResult(run.stepResults, 'second-step')?.stepName).toBe('Second step')
  })

  it('keeps the slug on a retried run', async () => {
    await createWorkflow(payload!)
    await payload!.create({ collection: 'posts', data: {} })
    const { docs } = await payload!.find({ collection: 'workflow-runs', depth: 0 })

    const retried = (await retryWorkflowRun(payload!, docs[0].id, { resumeFromFailedStep: true })) as unknown as StoredRun

    expect(retried.stepResults?.map((r) => r.slug)).toEqual(['first-step', 'second-step'])
  })
})

describe('findStepResult', () => {
  const results = [
    { slug: 'a', stepName: 'b', status: 'succeeded' },
    { slug: 'b', stepName: 'Step B', status: 'failed' },
  ]

  it('matches on slug before a step name that equals it', () => {
    expect(findStepResult(results, 'b')?.status).toBe('failed')
  })

  it('falls back to the step name for results stored without a slug', () => {
    const legacy = [
      { slug: null, stepName: 'count', status: 'succeeded' },
      { stepName: 'Send email', status: 'failed' },
    ]
    expect(findStepResult(legacy, 'count')?.status).toBe('succeeded')
    expect(findStepResult(legacy, 'send-email', 'Send email')?.status).toBe('failed')
    expect(findStepResult(legacy, 'send-email')).toBeUndefined()
  })

  it('returns undefined for a run without step results', () => {
    expect(findStepResult(undefined, 'a')).toBeUndefined()
    expect(findStepResult(null, 'a')).toBeUndefined()
  })
})
