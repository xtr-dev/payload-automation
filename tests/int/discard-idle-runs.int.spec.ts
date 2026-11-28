import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload, type Config, type Payload, type TaskConfig } from 'payload'
import { afterEach, describe, expect, it } from 'vitest'

import { buildTestConfig, noopTask } from './build-test-config.js'
import { retryWorkflowRun } from '../../src/core/retry-workflow-run.js'
import { runScheduledTriggers } from '../../src/core/scheduled-triggers.js'
import { triggerWorkflowById } from '../../src/core/trigger-custom-workflow.js'
import type { SeedWorkflow, WorkflowsPluginConfig } from '../../src/plugin/config-types.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const removeDbFile = (dbFile: string) => {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbFile}${suffix}`
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}

// How many items the next call of the release task reports as handled.
let pendingItems = 0
/** Stands in for a polling step: reports how much work it found. */
const releaseTask: TaskConfig<string> = {
  slug: 'release-step',
  label: 'Release',
  handler: () => Promise.resolve({ output: { released: pendingItems }, state: 'succeeded' }),
}

const failingTask: TaskConfig<string> = {
  slug: 'failing-step',
  label: 'Failing',
  handler: () => Promise.resolve({ errorMessage: 'step exploded', state: 'failed' }),
}

const IDLE = 'steps.release.output.released = 0'

type StoredRun = { id: number | string; status: string }

describe('discardRunWhen', () => {
  let dbFile: string
  let payload: Payload

  const init = async (
    options: {
      jobs?: Config['jobs']
      pluginOptions?: Partial<WorkflowsPluginConfig>
      seedWorkflows?: SeedWorkflow[]
    } = {},
  ) => {
    dbFile = path.join(os.tmpdir(), `payload-automation-discard-${uniqueId()}.db`)
    payload = await getPayload({
      config: buildTestConfig({
        dbFile,
        jobs: options.jobs,
        pluginOptions: { steps: [noopTask, releaseTask, failingTask], ...options.pluginOptions },
        seedWorkflows: options.seedWorkflows,
      }),
      key: uniqueId(),
    })
  }

  afterEach(async () => {
    await payload.destroy()
    removeDbFile(dbFile)
    pendingItems = 0
  })

  /** Creates a workflow with a `release` step, optionally followed by a failing step. */
  const createWorkflow = async ({
    discardRunWhen,
    errorHandling = 'stop',
    triggerType = 'manual',
    withFailingStep = false,
  }: {
    discardRunWhen?: string
    errorHandling?: 'continue' | 'stop'
    triggerType?: 'manual' | 'scheduled'
    withFailingStep?: boolean
  } = {}) => {
    const trigger = await payload.create({
      collection: 'automation-triggers',
      data:
        triggerType === 'scheduled'
          ? { name: 'hourly', type: 'scheduled', schedule: '0 * * * *' }
          : { name: 'manual', type: 'manual' },
    })
    if (triggerType === 'scheduled') {
      await payload.update({
        collection: 'automation-triggers',
        id: trigger.id,
        data: { lastFiredAt: '2026-03-01T10:00:00.000Z' },
      })
    }
    const release = await payload.create({
      collection: 'automation-steps',
      data: { name: 'release', type: releaseTask.slug },
    })
    const failing = await payload.create({
      collection: 'automation-steps',
      data: { name: 'failing', type: failingTask.slug },
    })
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'release unpaid orders',
        slug: `release-${uniqueId()}`,
        discardRunWhen,
        errorHandling,
        triggers: [trigger.id],
        steps: [
          { step: release.id, slug: 'release', stepName: 'release' },
          ...(withFailingStep ? [{ step: failing.id, slug: 'failing', stepName: 'failing' }] : []),
        ],
      },
    })
    return { triggerId: trigger.id, workflowId: String(workflow.id) }
  }

  const allRuns = async () =>
    (await payload.find({ collection: 'workflow-runs', depth: 0, pagination: false })).docs as unknown as StoredRun[]

  it('keeps every run when the workflow has no discardRunWhen expression', async () => {
    await init()
    const { workflowId } = await createWorkflow()

    const result = await triggerWorkflowById(payload, workflowId, 'manual')

    expect(result.discarded).toBeUndefined()
    expect(await allRuns()).toMatchObject([{ status: 'completed' }])
  })

  it('stores no run for a scheduled tick that had nothing to do, and stores the ticks that did something', async () => {
    await init()
    const { triggerId, workflowId } = await createWorkflow({ discardRunWhen: IDLE, triggerType: 'scheduled' })

    pendingItems = 0
    const idle = await runScheduledTriggers(payload, { now: new Date('2026-03-01T11:00:05.000Z') })

    expect(idle).toMatchObject([{ discarded: true, status: 'triggered' }])
    expect(String(idle[0].workflowId)).toBe(workflowId)
    expect(await allRuns()).toHaveLength(0)
    // The occurrence still counts as fired, so it is not fired again.
    const trigger = await payload.findByID({ collection: 'automation-triggers', id: triggerId, depth: 0 })
    expect(trigger.lastFiredAt).toBe('2026-03-01T11:00:05.000Z')

    pendingItems = 2
    const busy = await runScheduledTriggers(payload, { now: new Date('2026-03-01T12:00:05.000Z') })

    expect(busy).toMatchObject([{ status: 'triggered' }])
    expect(busy[0].discarded).toBeUndefined()
    const runs = await allRuns()
    expect(runs).toMatchObject([{ status: 'completed' }])
    expect(String(runs[0].id)).toBe(String(busy[0].runId))
  })

  it('reports a discarded run to the caller of triggerWorkflowById', async () => {
    await init()
    const { workflowId } = await createWorkflow({ discardRunWhen: IDLE })

    const result = await triggerWorkflowById(payload, workflowId, 'manual')

    expect(result).toMatchObject({ discarded: true, status: 'triggered', workflowId })
    expect(await allRuns()).toHaveLength(0)
  })

  it('keeps a failed run even when the expression is true', async () => {
    await init()
    const { workflowId } = await createWorkflow({ discardRunWhen: IDLE, withFailingStep: true })

    const result = await triggerWorkflowById(payload, workflowId, 'manual')

    expect(result.status).toBe('failed')
    expect(result.discarded).toBeUndefined()
    expect(await allRuns()).toMatchObject([{ status: 'failed' }])
  })

  it("keeps a run that completed with a failed step under errorHandling 'continue'", async () => {
    await init()
    const { workflowId } = await createWorkflow({
      discardRunWhen: IDLE,
      errorHandling: 'continue',
      withFailingStep: true,
    })

    const result = await triggerWorkflowById(payload, workflowId, 'manual')

    expect(result.discarded).toBeUndefined()
    expect(await allRuns()).toMatchObject([{ status: 'completed' }])
  })

  it('keeps the run when the expression cannot be evaluated', async () => {
    await init()
    const { workflowId } = await createWorkflow({ discardRunWhen: 'steps.release.output.released = = 0' })

    const result = await triggerWorkflowById(payload, workflowId, 'manual')

    expect(result.discarded).toBeUndefined()
    expect(await allRuns()).toMatchObject([{ status: 'completed' }])
  })

  it('discards a queued run once the job runner has run its steps', async () => {
    await init({ pluginOptions: { execution: { mode: 'queue' } } })
    const { workflowId } = await createWorkflow({ discardRunWhen: IDLE })

    const result = await triggerWorkflowById(payload, workflowId, 'manual')
    // Only queued so far: nothing has decided whether the run is idle.
    expect(result.discarded).toBeUndefined()
    expect(await allRuns()).toMatchObject([{ status: 'pending' }])

    await payload.jobs.run()

    expect(await allRuns()).toHaveLength(0)
  })

  it('deletes the step jobs of a discarded run when jobs are kept (jobs.deleteJobOnComplete: false)', async () => {
    await init({ jobs: { deleteJobOnComplete: false, tasks: [] } })
    const { workflowId } = await createWorkflow({ discardRunWhen: IDLE })

    // A run that is kept, so its step job must survive the discard below.
    pendingItems = 2
    const kept = await triggerWorkflowById(payload, workflowId, 'manual')
    pendingItems = 0
    const result = await triggerWorkflowById(payload, workflowId, 'manual')

    expect(result.discarded).toBe(true)
    expect(await allRuns()).toMatchObject([{ status: 'completed' }])
    const jobs = await payload.find({ collection: 'payload-jobs', depth: 0 })
    expect(jobs.docs).toHaveLength(1)
    expect(String((jobs.docs[0] as unknown as { automationWorkflowRun: unknown }).automationWorkflowRun)).toBe(
      String(kept.runId),
    )
  })

  it('deletes the step jobs of a discarded queued run without failing the job that ran it', async () => {
    await init({
      jobs: { deleteJobOnComplete: false, tasks: [] },
      pluginOptions: { execution: { mode: 'queue' }, steps: [noopTask, releaseTask, failingTask] },
    })
    const { workflowId } = await createWorkflow({ discardRunWhen: IDLE })

    await triggerWorkflowById(payload, workflowId, 'manual')
    await payload.jobs.run()

    expect(await allRuns()).toHaveLength(0)
    // Only the job that ran the steps is left, and it completed normally.
    const jobs = await payload.find({ collection: 'payload-jobs', depth: 0 })
    expect(jobs.docs).toHaveLength(1)
    expect(jobs.docs[0]).toMatchObject({ hasError: false, taskSlug: 'automation-workflow-run' })
    expect(jobs.docs[0].completedAt).toBeTruthy()
  })

  it('keeps the run that retryWorkflowRun returns', async () => {
    await init()
    const { workflowId } = await createWorkflow()
    const first = await triggerWorkflowById(payload, workflowId, 'manual')
    await payload.update({ collection: 'workflows', id: workflowId, data: { discardRunWhen: IDLE } })

    const retried = await retryWorkflowRun(payload, first.runId)

    expect(retried.status).toBe('completed')
    expect((await allRuns()).map((run) => String(run.id)).sort()).toEqual(
      [String(first.runId), String(retried.id)].sort(),
    )
  })

  it('can be declared on a seeded workflow and is updated in place when it changes', async () => {
    const seeded: SeedWorkflow = {
      slug: 'seeded-release',
      name: 'Seeded release',
      triggers: [{ type: 'manual' }],
      steps: [{ name: 'Release', slug: 'release', type: releaseTask.slug }],
      discardRunWhen: IDLE,
    }
    await init({ seedWorkflows: [seeded] })
    const findSeeded = async () =>
      (await payload.find({ collection: 'workflows', where: { slug: { equals: seeded.slug } }, depth: 0 }))
        .docs[0] as unknown as { discardRunWhen?: null | string; id: number | string }
    const created = await findSeeded()
    expect(created.discardRunWhen).toBe(IDLE)

    const result = await triggerWorkflowById(payload, String(created.id), 'manual')
    expect(result.discarded).toBe(true)

    // A restart with a changed definition, against the same database.
    await payload.destroy()
    payload = await getPayload({
      config: buildTestConfig({
        dbFile,
        pluginOptions: { steps: [noopTask, releaseTask, failingTask] },
        seedWorkflows: [{ ...seeded, discardRunWhen: 'steps.release.output.released < 5' }],
      }),
      key: uniqueId(),
    })
    const updated = await findSeeded()
    expect(updated.id).toBe(created.id)
    expect(updated.discardRunWhen).toBe('steps.release.output.released < 5')
  })
})
