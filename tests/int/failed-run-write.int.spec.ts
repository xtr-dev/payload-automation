import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload, type CollectionBeforeChangeHook, type Config, type Payload, type TaskConfig } from 'payload'
import { afterEach, describe, expect, it } from 'vitest'

import { buildTestConfig, noopTask } from './build-test-config.js'
import { triggerWorkflowById } from '../../src/core/trigger-custom-workflow.js'
import type { WorkflowsPluginConfig } from '../../src/plugin/config-types.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const removeDbFile = (dbFile: string) => {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbFile}${suffix}`
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}

/**
 * Deletes its own step document while the run is in progress. From then on
 * the run's step results point at a document that no longer exists, and a SQL
 * database rejects every write that includes them with a foreign key error.
 */
const selfDeletingTask: TaskConfig<string> = {
  slug: 'self-deleting-step',
  label: 'Self-deleting',
  handler: async ({ req }) => {
    const { docs } = await req.payload.find({
      collection: 'automation-steps',
      where: { type: { equals: 'self-deleting-step' } },
    })
    for (const doc of docs) {
      await req.payload.delete({ collection: 'automation-steps', id: doc.id })
    }
    return { output: {}, state: 'succeeded' }
  },
}

const failingTask: TaskConfig<string> = {
  slug: 'failing-step',
  label: 'Failing',
  handler: () => Promise.resolve({ errorMessage: 'step exploded', state: 'failed' }),
}

/** Adds a host `beforeChange` hook to the plugin's `workflow-runs` collection. */
const withRunHook =
  (hook: CollectionBeforeChangeHook): NonNullable<Config['plugins']>[number] =>
  (config) => ({
    ...config,
    collections: (config.collections ?? []).map((collection) =>
      collection.slug === 'workflow-runs'
        ? {
            ...collection,
            hooks: {
              ...collection.hooks,
              beforeChange: [...(collection.hooks?.beforeChange ?? []), hook],
            },
          }
        : collection,
    ),
  })

type StoredRun = {
  completedAt?: null | string
  error?: null | string
  id: number | string
  status: string
  stepResults?: unknown[]
}

describe('recording a failed run when the write itself is rejected', () => {
  let dbFile: string
  let payload: Payload

  const init = async (
    options: {
      extraPlugins?: Config['plugins']
      jobs?: Config['jobs']
      pluginOptions?: Partial<WorkflowsPluginConfig>
    } = {},
  ) => {
    dbFile = path.join(os.tmpdir(), `payload-automation-failed-write-${uniqueId()}.db`)
    payload = await getPayload({
      config: buildTestConfig({
        dbFile,
        extraPlugins: options.extraPlugins,
        jobs: options.jobs,
        pluginOptions: { steps: [noopTask, selfDeletingTask, failingTask], ...options.pluginOptions },
      }),
      key: uniqueId(),
    })
  }

  afterEach(async () => {
    await payload.destroy()
    removeDbFile(dbFile)
  })

  const createWorkflow = async (stepType: string) => {
    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'manual', type: 'manual' },
    })
    const step = await payload.create({
      collection: 'automation-steps',
      data: { name: 'only', type: stepType },
    })
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'failed write',
        slug: `failed-write-${uniqueId()}`,
        triggers: [trigger.id],
        steps: [{ step: step.id, slug: 'only', stepName: 'only' }],
      },
    })
    return String(workflow.id)
  }

  const onlyRun = async (): Promise<StoredRun> => {
    const { docs } = await payload.find({ collection: 'workflow-runs', depth: 0, pagination: false })
    expect(docs).toHaveLength(1)
    return docs[0] as unknown as StoredRun
  }

  /**
   * MongoDB has no foreign keys: it stores a step result that points at a
   * deleted step document, so the write the self-deleting step is meant to
   * break succeeds there and the run completes normally.
   */
  const skipWithoutForeignKeys = (skip: (note?: string) => void) => {
    if (payload.db.name === 'mongoose') {
      skip('MongoDB accepts a reference to a deleted document')
    }
  }

  it('ends the run as failed when the database rejects its step results', async ({ skip }) => {
    await init()
    skipWithoutForeignKeys(skip)
    const workflowId = await createWorkflow(selfDeletingTask.slug)

    const result = await triggerWorkflowById(payload, workflowId, 'manual')

    expect(result.status).toBe('failed')
    const run = await onlyRun()
    expect(run.status).toBe('failed')
    expect(run.completedAt).toBeTruthy()
    // The stored error carries the database's reason, so the cause can be
    // found without the step results that could not be stored.
    // The wording is the database's own: SQLite says "FOREIGN KEY constraint
    // failed", Postgres "violates foreign key constraint".
    expect(run.error).toMatch(/could not be stored: .*foreign key constraint/i)
  })

  it('stores status and error when a host hook rejects the run details', async () => {
    await init({
      extraPlugins: [
        withRunHook(({ data }) => {
          if (data.status === 'failed' && data.stepResults) {
            throw new Error('audit service unavailable')
          }
          return data
        }),
      ],
    })
    const workflowId = await createWorkflow(failingTask.slug)

    const result = await triggerWorkflowById(payload, workflowId, 'manual')

    expect(result).toMatchObject({ error: 'step exploded', status: 'failed' })
    const run = await onlyRun()
    expect(run.status).toBe('failed')
    expect(run.error).toContain('step exploded')
    expect(run.error).toContain('could not be stored: audit service unavailable')
  })

  it('still ends the run as failed when a host hook rejects every write', async () => {
    await init({
      extraPlugins: [
        withRunHook(({ data, operation }) => {
          if (operation === 'update' && data.status === 'failed') {
            throw new Error('runs are frozen')
          }
          return data
        }),
      ],
    })
    const workflowId = await createWorkflow(failingTask.slug)

    const result = await triggerWorkflowById(payload, workflowId, 'manual')

    // The caller gets the step's error, not the error of the rejected write.
    expect(result).toMatchObject({ error: 'step exploded', status: 'failed' })
    const run = await onlyRun()
    expect(run.status).toBe('failed')
    expect(run.completedAt).toBeTruthy()
    expect(run.error).toContain('step exploded')
    expect(run.error).toContain('runs are frozen')
  })

  it('ends a queued run as failed without failing the job that ran it', async ({ skip }) => {
    await init({ pluginOptions: { execution: { mode: 'queue' } } })
    skipWithoutForeignKeys(skip)
    const workflowId = await createWorkflow(selfDeletingTask.slug)

    await triggerWorkflowById(payload, workflowId, 'manual')
    expect((await onlyRun()).status).toBe('pending')
    await payload.jobs.run()

    const run = await onlyRun()
    expect(run.status).toBe('failed')
    expect(run.error).toContain('could not be stored')
  })

  it('stores the full details when the failed write is accepted', async () => {
    await init()
    const workflowId = await createWorkflow(failingTask.slug)

    await triggerWorkflowById(payload, workflowId, 'manual')

    const run = await onlyRun()
    expect(run).toMatchObject({ error: 'step exploded', status: 'failed' })
    expect(run.stepResults).toMatchObject([{ error: 'step exploded', status: 'failed' }])
  })
})
