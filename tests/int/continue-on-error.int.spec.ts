import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload, type Payload, type TaskConfig } from 'payload'
import { afterEach, describe, expect, it } from 'vitest'

import { buildTestConfig, noopTask } from './build-test-config.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const removeDbFile = (dbFile: string) => {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbFile}${suffix}`
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}

const failTask: TaskConfig<string> = {
  slug: 'fail-step',
  label: 'Fail',
  handler: () => Promise.reject(new Error('deliberate failure')),
}

// Labels of the record steps that ran, in the order they ran.
const ranSteps: string[] = []
const recordTask: TaskConfig<string> = {
  slug: 'record-step',
  label: 'Record',
  handler: ({ input }) => {
    ranSteps.push(String((input as { label?: unknown }).label))
    return Promise.resolve({ output: {}, state: 'succeeded' })
  },
}

type StoredRun = {
  status: string
  stepResults?: Array<{ output?: Record<string, unknown>; status?: string; stepName?: string }>
}

describe("errorHandling: 'continue'", () => {
  let dbFile: string
  let payload: Payload | undefined

  afterEach(async () => {
    if (payload) {
      await payload.destroy()
      payload = undefined
    }
    removeDbFile(dbFile)
  })

  it('skips the dependents of a failed step and runs the independent steps', async () => {
    dbFile = path.join(os.tmpdir(), `payload-automation-continue-${uniqueId()}.db`)
    payload = await getPayload({
      config: buildTestConfig({
        dbFile,
        pluginOptions: { steps: [noopTask, failTask, recordTask] },
      }),
      key: uniqueId(),
    })
    ranSteps.length = 0

    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'posts afterChange', type: 'collection-hook', collectionSlug: 'posts', hook: 'afterChange' },
    })
    const fail = await payload.create({
      collection: 'automation-steps',
      data: { name: 'fail', type: failTask.slug },
    })
    const record = (label: string) =>
      payload!.create({
        collection: 'automation-steps',
        data: { name: label, type: recordTask.slug, config: { label } },
      })
    const dependent = await record('dependent')
    const grandchild = await record('grandchild')
    const independent = await record('independent')
    const onFailure = await record('on-failure')

    await payload.create({
      collection: 'workflows',
      data: {
        name: 'continue on error',
        slug: `continue-${uniqueId()}`,
        errorHandling: 'continue',
        triggers: [trigger.id],
        steps: [
          { step: fail.id, slug: 'fail', stepName: 'fail' },
          { step: dependent.id, slug: 'dependent', stepName: 'dependent', dependencies: [{ slug: 'fail' }] },
          { step: grandchild.id, slug: 'grandchild', stepName: 'grandchild', dependencies: [{ slug: 'dependent' }] },
          { step: independent.id, slug: 'independent', stepName: 'independent' },
          {
            step: onFailure.id,
            slug: 'on-failure',
            stepName: 'on-failure',
            condition: "steps.fail.state = 'failed'",
            dependencies: [{ slug: 'fail' }],
          },
        ],
      },
    })

    await payload.create({ collection: 'posts', data: {} })

    const { docs } = await payload.find({ collection: 'workflow-runs', depth: 0 })
    expect(docs).toHaveLength(1)
    const run = docs[0] as unknown as StoredRun
    expect(run.status).toBe('completed')

    const bySlug = (slug: string) => run.stepResults?.find((r) => r.stepName === slug)
    expect(bySlug('fail')?.status).toBe('failed')
    expect(bySlug('independent')?.status).toBe('succeeded')
    expect(bySlug('dependent')?.status).toBe('skipped')
    expect(bySlug('dependent')?.output).toEqual({ reason: 'Dependency "fail" failed', skipped: true })
    expect(bySlug('grandchild')?.status).toBe('skipped')
    expect(bySlug('grandchild')?.output).toEqual({
      reason: 'Dependency "dependent" was skipped because a step it depends on failed',
      skipped: true,
    })
    // A dependent with its own condition is decided by that condition.
    expect(bySlug('on-failure')?.status).toBe('succeeded')

    expect(ranSteps.sort()).toEqual(['independent', 'on-failure'])
  })
})
