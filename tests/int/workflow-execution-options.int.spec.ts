import fs from 'fs'
import os from 'os'
import path from 'path'
import { createLocalReq, getPayload, type Payload, type TaskConfig } from 'payload'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildTestConfig, noopTask } from './build-test-config.js'
import { WorkflowExecutor } from '../../src/core/workflow-executor.js'
import type { WorkflowsPluginConfig } from '../../src/plugin/config-types.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const newDbFile = () => path.join(os.tmpdir(), `payload-automation-execution-${uniqueId()}.db`)

// getPayload() caches instances process-wide by `key`, so each test needs its own key.
const getTestPayload = (dbFile: string, pluginOptions?: Partial<WorkflowsPluginConfig>) =>
  getPayload({ config: buildTestConfig({ dbFile, pluginOptions }), key: uniqueId() })

const removeDbFile = (dbFile: string) => {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbFile}${suffix}`
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}

let countingCalls = 0
const countingTask: TaskConfig<string> = {
  slug: 'counting-step',
  label: 'Counting',
  handler: () => {
    countingCalls++
    return Promise.resolve({ output: {}, state: 'succeeded' })
  },
}

/** Creates a workflow with one step (no-op by default) that fires on posts afterChange. */
const createPostsWorkflow = async (payload: Payload, stepType: string = noopTask.slug) => {
  const trigger = await payload.create({
    collection: 'automation-triggers',
    data: { name: 'posts afterChange', type: 'collection-hook', collectionSlug: 'posts', hook: 'afterChange' },
  })
  const step = await payload.create({
    collection: 'automation-steps',
    data: { name: 'noop', type: stepType },
  })
  await payload.create({
    collection: 'workflows',
    data: {
      name: 'on posts afterChange',
      slug: `on-posts-${uniqueId()}`,
      triggers: [trigger.id],
      steps: [{ step: step.id, slug: 'noop', stepName: 'noop' }],
    },
  })
}

type StoredRun = {
  status: string
  stepResults?: Array<{ status?: string }>
  triggerData?: { doc?: { id?: unknown }; req?: Record<string, unknown> }
  context?: { trigger?: { req?: Record<string, unknown> } }
  inputs?: { req?: Record<string, unknown> }
  triggeredBy: string
}

const onlyRun = async (payload: Payload): Promise<StoredRun> => {
  const { docs } = await payload.find({ collection: 'workflow-runs', depth: 0 })
  expect(docs).toHaveLength(1)
  return docs[0] as unknown as StoredRun
}

describe('workflow execution options', () => {
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

  it('runs steps inside the triggering call by default', async () => {
    payload = await getTestPayload(dbFile)
    await createPostsWorkflow(payload)

    await payload.create({ collection: 'posts', data: {} })

    const run = await onlyRun(payload)
    expect(run.status).toBe('completed')
    expect(run.stepResults?.[0]?.status).toBe('succeeded')
  })

  it("with execution.mode 'queue', records a pending run and runs the steps when the job queue is processed", async () => {
    payload = await getTestPayload(dbFile, { execution: { mode: 'queue' } })
    await createPostsWorkflow(payload)

    const post = await payload.create({ collection: 'posts', data: {} })

    const pending = await onlyRun(payload)
    expect(pending.status).toBe('pending')
    expect(pending.stepResults?.[0]?.status).toBe('pending')

    await payload.jobs.run()

    const done = await onlyRun(payload)
    expect(done.status).toBe('completed')
    expect(done.stepResults?.[0]?.status).toBe('succeeded')
    expect(done.triggerData?.doc?.id).toBe(post.id)

    // Processing the queue again must not run the same workflow run twice.
    await payload.jobs.run()
    expect((await onlyRun(payload)).status).toBe('completed')
  })

  // Under SQLite the two runners happen to serialize, so this also passes
  // without the conditional claim; it guards the outcome, not the race itself.
  it('runs a queued run once when two job runners pick it up at the same time', async () => {
    payload = await getTestPayload(dbFile, {
      execution: { mode: 'queue' },
      steps: [noopTask, countingTask],
    })
    countingCalls = 0
    await createPostsWorkflow(payload, countingTask.slug)
    await payload.create({ collection: 'posts', data: {} })
    const pending = await onlyRun(payload)

    const runner = () =>
      createLocalReq({}, payload!).then((req) =>
        new WorkflowExecutor(payload!, payload!.logger).executeQueuedRun(
          (pending as unknown as { id: number | string }).id,
          req,
        ),
      )
    await Promise.all([runner(), runner()])

    expect(countingCalls).toBe(1)
    expect((await onlyRun(payload)).status).toBe('completed')
  })

  it("with execution.queue, queues the run on that queue only", async () => {
    payload = await getTestPayload(dbFile, { execution: { mode: 'queue', queue: 'automation' } })
    await createPostsWorkflow(payload)
    await payload.create({ collection: 'posts', data: {} })

    await payload.jobs.run()
    expect((await onlyRun(payload)).status).toBe('pending')

    await payload.jobs.run({ queue: 'automation' })
    expect((await onlyRun(payload)).status).toBe('completed')
  })

  it('stores req.user on the run by default', async () => {
    payload = await getTestPayload(dbFile)
    await createPostsWorkflow(payload)
    const user = await payload.create({
      collection: 'users',
      data: { email: 'editor@example.com', password: 'test-password' },
    })

    await payload.create({ collection: 'posts', data: {}, user })

    const run = await onlyRun(payload)
    expect(run.triggeredBy).toBe('editor@example.com')
    expect(run.triggerData?.req?.user).toMatchObject({ email: 'editor@example.com' })
  })

  it('with stripUserData, keeps the user out of the stored run', async () => {
    payload = await getTestPayload(dbFile, { stripUserData: true })
    await createPostsWorkflow(payload)
    const user = await payload.create({
      collection: 'users',
      data: { email: 'editor@example.com', password: 'test-password' },
    })

    await payload.create({ collection: 'posts', data: {}, user })

    const run = await onlyRun(payload)
    expect(run.status).toBe('completed')
    expect(run.triggeredBy).toBe(`users:${user.id}`)
    expect(run.triggerData?.req).toBeDefined()
    expect(run.triggerData?.req?.user).toBeUndefined()
    expect(run.context?.trigger?.req?.user).toBeUndefined()
    expect(run.inputs?.req?.user).toBeUndefined()
    expect(JSON.stringify(run)).not.toContain('editor@example.com')
  })
})
