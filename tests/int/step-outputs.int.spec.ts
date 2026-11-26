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

const produceTask: TaskConfig<string> = {
  slug: 'produce-step',
  label: 'Produce',
  handler: () => Promise.resolve({ output: { greeting: 'hello', nested: { count: 3 } }, state: 'succeeded' }),
}

// Inputs the consume step received at runtime.
const consumedInputs: Array<Record<string, unknown>> = []
const consumeTask: TaskConfig<string> = {
  slug: 'consume-step',
  label: 'Consume',
  handler: ({ input }) => {
    consumedInputs.push(input as Record<string, unknown>)
    return Promise.resolve({ output: {}, state: 'succeeded' })
  },
}

/** A posts afterChange workflow: `produce`, then `consume` reading produce's output. */
const createWorkflow = async (payload: Payload) => {
  const trigger = await payload.create({
    collection: 'automation-triggers',
    data: { name: 'posts afterChange', type: 'collection-hook', collectionSlug: 'posts', hook: 'afterChange' },
  })
  const produce = await payload.create({
    collection: 'automation-steps',
    data: { name: 'produce', type: produceTask.slug },
  })
  const consume = await payload.create({
    collection: 'automation-steps',
    data: {
      name: 'consume',
      type: consumeTask.slug,
      config: { greeting: '{{steps.produce.output.greeting}}', count: '{{steps.produce.output.nested.count}}' },
    },
  })
  await payload.create({
    collection: 'workflows',
    data: {
      name: 'produce then consume',
      slug: `produce-consume-${uniqueId()}`,
      triggers: [trigger.id],
      steps: [
        { step: produce.id, slug: 'produce', stepName: 'produce' },
        { step: consume.id, slug: 'consume', stepName: 'consume', dependencies: [{ slug: 'produce' }] },
      ],
    },
  })
}

type StoredRun = {
  status: string
  stepResults?: Array<{ output?: Record<string, unknown>; stepName?: string }>
}

describe('step outputs', () => {
  let dbFile: string
  let payload: Payload | undefined

  afterEach(async () => {
    if (payload) {
      await payload.destroy()
      payload = undefined
    }
    removeDbFile(dbFile)
  })

  const cases: Array<[string, { deleteJobOnComplete?: boolean } | undefined]> = [
    ["with Payload's default jobs config (deleteJobOnComplete: true)", undefined],
    ['with jobs.deleteJobOnComplete: false', { deleteJobOnComplete: false }],
  ]

  it.each(cases)('passes a step output to later steps and stores it on the run %s', async (_label, jobs) => {
    dbFile = path.join(os.tmpdir(), `payload-automation-outputs-${uniqueId()}.db`)
    payload = await getPayload({
      config: buildTestConfig({
        dbFile,
        jobs: jobs ? { ...jobs, tasks: [] } : undefined,
        pluginOptions: { steps: [noopTask, produceTask, consumeTask] },
      }),
      key: uniqueId(),
    })
    consumedInputs.length = 0
    await createWorkflow(payload)

    await payload.create({ collection: 'posts', data: {} })

    const { docs } = await payload.find({ collection: 'workflow-runs', depth: 0 })
    expect(docs).toHaveLength(1)
    const run = docs[0] as unknown as StoredRun
    expect(run.status).toBe('completed')
    const produced = run.stepResults?.find((r) => r.stepName === 'produce')
    expect(produced?.output).toEqual({ greeting: 'hello', nested: { count: 3 } })
    expect(consumedInputs).toEqual([{ greeting: 'hello', count: 3 }])
  })
})
