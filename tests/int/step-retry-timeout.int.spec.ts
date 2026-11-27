import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload, type Payload, type TaskConfig } from 'payload'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildTestConfig, noopTask } from './build-test-config.js'
import { resolveRetryPolicy } from '../../src/core/workflow-executor.js'
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls until `condition` holds; fails the test when it does not within `timeoutMs`. */
const waitFor = async (condition: () => boolean, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('waitFor: condition not met in time')
    }
    await wait(25)
  }
}

// Start time (epoch ms) of every call of the flaky and slow tasks, per `label` input.
const calls = new Map<string, number[]>()
const recordCall = (label: string): number => {
  const times = calls.get(label) ?? []
  times.push(Date.now())
  calls.set(label, times)
  return times.length
}
const callCount = (label: string) => calls.get(label)?.length ?? 0

/** Fails its first `failures` calls (counted per `label`), then succeeds. */
const flakyTask: TaskConfig<string> = {
  slug: 'flaky-step',
  label: 'Flaky',
  handler: ({ input }) => {
    const { failures = 0, label = 'flaky' } = input as { failures?: number; label?: string }
    const call = recordCall(label)
    if (call <= failures) {
      return Promise.reject(new Error(`${label} failure ${call}`))
    }
    return Promise.resolve({ output: { call }, state: 'succeeded' })
  },
}

// Labels of slow-task calls whose handler ran to its end.
const slowFinished: string[] = []
/** Succeeds after `ms` milliseconds. */
const slowTask: TaskConfig<string> = {
  slug: 'slow-step',
  label: 'Slow',
  handler: async ({ input }) => {
    const { label = 'slow', ms = 0 } = input as { label?: string; ms?: number }
    recordCall(label)
    await wait(ms)
    slowFinished.push(label)
    return { output: { slept: ms }, state: 'succeeded' }
  },
}

/** Like the flaky task, but with Payload-level retries on the task itself. */
const payloadRetriesTask: TaskConfig<string> = {
  slug: 'payload-retries-step',
  label: 'Task with Payload retries',
  retries: 3,
  handler: ({ input }) => {
    const { label = 'payload-retries' } = input as { label?: string }
    recordCall(label)
    return Promise.reject(new Error('always fails'))
  },
}

type StoredStepResult = {
  attempts?: null | number
  completedAt?: null | string
  error?: null | string
  lastError?: null | string
  nextRetryAt?: null | string
  output?: null | Record<string, unknown>
  retryCount?: null | number
  slug?: null | string
  status?: null | string
}

type StoredRun = {
  error?: null | string
  id: number | string
  logs?: Array<{ level?: string; message?: string }> | null
  status: string
  stepResults?: StoredStepResult[]
}

type StepSpec = {
  /** `config` of the `automation-steps` document (the task's input). */
  config: Record<string, unknown>
  dependencies?: string[]
  /** Retry fields of the `automation-steps` document. */
  retry?: { maxRetries?: number; retryDelay?: number; retryOnFailure?: boolean }
  slug: string
  type: string
}

describe('step retries and workflow timeout', () => {
  let dbFile: string
  let payload: Payload

  const init = async (pluginOptions: Partial<WorkflowsPluginConfig> = {}) => {
    payload = await getPayload({
      config: buildTestConfig({
        dbFile,
        pluginOptions: { steps: [noopTask, flakyTask, slowTask, payloadRetriesTask], ...pluginOptions },
      }),
      key: uniqueId(),
    })
  }

  /** Creates a workflow on posts afterChange with the given steps and workflow settings. */
  const createWorkflow = async (settings: Record<string, unknown>, steps: StepSpec[]) => {
    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'posts afterChange', type: 'collection-hook', collectionSlug: 'posts', hook: 'afterChange' },
    })
    const workflowSteps = []
    for (const spec of steps) {
      const step = await payload.create({
        collection: 'automation-steps',
        data: { name: spec.slug, type: spec.type, config: spec.config, ...spec.retry },
      })
      workflowSteps.push({
        step: step.id,
        slug: spec.slug,
        stepName: spec.slug,
        dependencies: (spec.dependencies ?? []).map((slug) => ({ slug })),
      })
    }
    await payload.create({
      collection: 'workflows',
      data: {
        name: 'retry test',
        slug: `retry-${uniqueId()}`,
        triggers: [trigger.id],
        steps: workflowSteps,
        ...settings,
      },
    })
  }

  const onlyRun = async (): Promise<StoredRun> => {
    const { docs } = await payload.find({ collection: 'workflow-runs', depth: 0 })
    expect(docs).toHaveLength(1)
    return docs[0] as unknown as StoredRun
  }

  /** Fires the trigger (inline mode: the run is finished when this returns) and returns the run. */
  const fire = async (): Promise<StoredRun> => {
    await payload.create({ collection: 'posts', data: {} })
    return onlyRun()
  }

  const step = (run: StoredRun, slug: string) => run.stepResults?.find((result) => result.slug === slug)

  beforeEach(() => {
    dbFile = path.join(os.tmpdir(), `payload-automation-retry-${uniqueId()}.db`)
    calls.clear()
    slowFinished.length = 0
  })

  afterEach(async () => {
    await payload?.destroy()
    removeDbFile(dbFile)
  })

  describe('resolveRetryPolicy', () => {
    it('uses the step settings when the step has retryOnFailure', () => {
      expect(resolveRetryPolicy(
        { retryOnFailure: true, maxRetries: 5, retryDelay: 20 },
        { errorHandling: 'retry', maxRetries: 1, retryDelay: 1 },
      )).toEqual({ maxRetries: 5, retryDelay: 20 })
      expect(resolveRetryPolicy({ retryOnFailure: true }, { errorHandling: 'stop' }))
        .toEqual({ maxRetries: 3, retryDelay: 1000 })
      // An explicit 0 is a value, not "empty": it switches retries off.
      expect(resolveRetryPolicy(
        { retryOnFailure: true, maxRetries: 0, retryDelay: 0 },
        { errorHandling: 'retry', maxRetries: 4 },
      )).toEqual({ maxRetries: 0, retryDelay: 0 })
    })

    it("falls back to the workflow settings only with errorHandling 'retry'", () => {
      // Step numbers are ignored without retryOnFailure (they keep their admin defaults).
      const stepWithoutRetry = { retryOnFailure: false, maxRetries: 3, retryDelay: 1000 }
      expect(resolveRetryPolicy(stepWithoutRetry, { errorHandling: 'retry', maxRetries: 2, retryDelay: 50 }))
        .toEqual({ maxRetries: 2, retryDelay: 50 })
      expect(resolveRetryPolicy(stepWithoutRetry, { errorHandling: 'retry' }))
        .toEqual({ maxRetries: 3, retryDelay: 1000 })
      for (const errorHandling of ['stop', 'continue', null, undefined]) {
        expect(resolveRetryPolicy(stepWithoutRetry, { errorHandling, maxRetries: 2, retryDelay: 50 }))
          .toEqual({ maxRetries: 0, retryDelay: 0 })
      }
    })
  })

  describe('step retryOnFailure', () => {
    it('retries a failing step until it succeeds and records the attempts', async () => {
      await init()
      await createWorkflow({ errorHandling: 'stop' }, [
        {
          slug: 'flaky',
          type: flakyTask.slug,
          config: { failures: 2, label: 'flaky' },
          retry: { retryOnFailure: true, maxRetries: 3, retryDelay: 10 },
        },
        { slug: 'after', type: flakyTask.slug, config: { label: 'after' }, dependencies: ['flaky'] },
      ])

      const run = await fire()

      expect(run.status).toBe('completed')
      expect(callCount('flaky')).toBe(3)
      expect(step(run, 'flaky')).toMatchObject({
        status: 'succeeded',
        attempts: 3,
        retryCount: 2,
        lastError: 'flaky failure 2',
        output: { call: 3 },
      })
      expect(step(run, 'flaky')?.error ?? null).toBeNull()
      // The dependent step ran once the retried step had succeeded.
      expect(step(run, 'after')).toMatchObject({ status: 'succeeded', attempts: 1, retryCount: 0 })

      const messages = (run.logs ?? []).map((log) => log.message)
      expect(messages).toContain('Step "flaky" failed on attempt 1 of 4: flaky failure 1. Retrying in 10 ms')
      expect(messages).toContain('Step "flaky" failed on attempt 2 of 4: flaky failure 2. Retrying in 10 ms')
    })

    it("fails the step after the last retry, and only then applies errorHandling 'stop'", async () => {
      await init()
      await createWorkflow({ errorHandling: 'stop' }, [
        {
          slug: 'flaky',
          type: flakyTask.slug,
          config: { failures: 99, label: 'flaky' },
          retry: { retryOnFailure: true, maxRetries: 2, retryDelay: 5 },
        },
        { slug: 'after', type: flakyTask.slug, config: { label: 'after' }, dependencies: ['flaky'] },
      ])

      const run = await fire()

      expect(callCount('flaky')).toBe(3)
      expect(run.status).toBe('failed')
      expect(run.error).toBe('flaky failure 3')
      expect(step(run, 'flaky')).toMatchObject({
        status: 'failed',
        attempts: 3,
        retryCount: 2,
        error: 'flaky failure 3',
        lastError: 'flaky failure 3',
      })
      expect(step(run, 'after')?.status).toBe('pending')
      expect(callCount('after')).toBe(0)
    })

    it("with errorHandling 'continue', skips dependents only after the last retry failed", async () => {
      await init()
      await createWorkflow({ errorHandling: 'continue' }, [
        {
          slug: 'flaky',
          type: flakyTask.slug,
          config: { failures: 99, label: 'flaky' },
          retry: { retryOnFailure: true, maxRetries: 1, retryDelay: 5 },
        },
        { slug: 'dependent', type: flakyTask.slug, config: { label: 'dependent' }, dependencies: ['flaky'] },
        { slug: 'independent', type: flakyTask.slug, config: { label: 'independent' } },
      ])

      const run = await fire()

      expect(run.status).toBe('completed')
      expect(step(run, 'flaky')).toMatchObject({ status: 'failed', attempts: 2 })
      expect(step(run, 'dependent')).toMatchObject({
        status: 'skipped',
        output: { reason: 'Dependency "flaky" failed', skipped: true },
      })
      expect(step(run, 'independent')).toMatchObject({ status: 'succeeded', attempts: 1 })
      expect(callCount('dependent')).toBe(0)
    })

    it('waits retryDelay between attempts', async () => {
      await init()
      await createWorkflow({ errorHandling: 'stop' }, [
        {
          slug: 'flaky',
          type: flakyTask.slug,
          config: { failures: 2, label: 'flaky' },
          retry: { retryOnFailure: true, maxRetries: 2, retryDelay: 200 },
        },
      ])

      const run = await fire()

      expect(run.status).toBe('completed')
      const times = calls.get('flaky')!
      expect(times).toHaveLength(3)
      // Timers may fire a few ms early; anything close to 200 ms shows the wait happened.
      expect(times[1] - times[0]).toBeGreaterThanOrEqual(190)
      expect(times[2] - times[1]).toBeGreaterThanOrEqual(190)
      expect(times[2] - times[0]).toBeLessThan(3000)
    })

    it("does not retry without retryOnFailure under errorHandling 'stop' or 'continue'", async () => {
      await init()
      await createWorkflow({ errorHandling: 'stop', maxRetries: 5, retryDelay: 1 }, [
        {
          slug: 'flaky',
          type: flakyTask.slug,
          config: { failures: 1, label: 'flaky' },
          // The numbers alone do nothing while retryOnFailure is off.
          retry: { retryOnFailure: false, maxRetries: 5, retryDelay: 1 },
        },
      ])

      const stopped = await fire()
      expect(callCount('flaky')).toBe(1)
      expect(stopped.status).toBe('failed')
      expect(step(stopped, 'flaky')).toMatchObject({ status: 'failed', attempts: 1, retryCount: 0 })

      await payload.delete({ collection: 'workflow-runs', where: { id: { exists: true } } })
      await payload.update({
        collection: 'workflows',
        where: { id: { exists: true } },
        data: { errorHandling: 'continue' },
      })
      calls.clear()

      const continued = await fire()
      expect(callCount('flaky')).toBe(1)
      expect(continued.status).toBe('completed')
      expect(step(continued, 'flaky')).toMatchObject({ status: 'failed', attempts: 1, retryCount: 0 })
    })

    it('cancels the job of a failed attempt when the task has Payload-level retries', async () => {
      await init()
      await createWorkflow({ errorHandling: 'stop' }, [
        { slug: 'own-retries', type: payloadRetriesTask.slug, config: { label: 'own-retries' } },
      ])

      const run = await fire()
      expect(run.status).toBe('failed')
      expect(callCount('own-retries')).toBe(1)

      // Payload left the job queued for another try; a job runner must not
      // run it again behind the workflow run's back.
      await payload.jobs.run()
      expect(callCount('own-retries')).toBe(1)
    })
  })

  describe("workflow errorHandling 'retry'", () => {
    it('retries steps without their own setting using the workflow settings', async () => {
      await init()
      await createWorkflow({ errorHandling: 'retry', maxRetries: 2, retryDelay: 5 }, [
        { slug: 'flaky', type: flakyTask.slug, config: { failures: 2, label: 'flaky' } },
      ])

      const run = await fire()

      expect(run.status).toBe('completed')
      expect(callCount('flaky')).toBe(3)
      expect(step(run, 'flaky')).toMatchObject({ status: 'succeeded', attempts: 3, lastError: 'flaky failure 2' })
    })

    it('fails the run, like stop, when a step still fails after the last retry', async () => {
      await init()
      await createWorkflow({ errorHandling: 'retry', maxRetries: 2, retryDelay: 5 }, [
        { slug: 'flaky', type: flakyTask.slug, config: { failures: 99, label: 'flaky' } },
        { slug: 'later', type: flakyTask.slug, config: { label: 'later' }, dependencies: ['flaky'] },
      ])

      const run = await fire()

      expect(callCount('flaky')).toBe(3)
      expect(run.status).toBe('failed')
      expect(step(run, 'flaky')).toMatchObject({ status: 'failed', attempts: 3, error: 'flaky failure 3' })
      expect(step(run, 'later')?.status).toBe('pending')
      expect(callCount('later')).toBe(0)
    })

    it("lets a step's own retry setting override the workflow's, including maxRetries 0", async () => {
      await init()
      await createWorkflow({ errorHandling: 'retry', maxRetries: 5, retryDelay: 5 }, [
        {
          slug: 'own',
          type: flakyTask.slug,
          config: { failures: 1, label: 'own' },
          retry: { retryOnFailure: true, maxRetries: 1, retryDelay: 5 },
        },
        {
          slug: 'never',
          type: flakyTask.slug,
          config: { failures: 99, label: 'never' },
          dependencies: ['own'],
          retry: { retryOnFailure: true, maxRetries: 0, retryDelay: 5 },
        },
      ])

      const run = await fire()

      expect(step(run, 'own')).toMatchObject({ status: 'succeeded', attempts: 2 })
      expect(callCount('never')).toBe(1)
      expect(step(run, 'never')).toMatchObject({ status: 'failed', attempts: 1 })
      expect(run.status).toBe('failed')
    })
  })

  // The durations below are long on purpose. One step attempt costs several
  // database round trips, which can take hundreds of milliseconds on a busy
  // machine, and each test needs its timeout to fall inside a specific phase.
  describe('workflow timeout', () => {
    it('fails the run and the running step, and ignores the step finishing later', async () => {
      await init()
      await createWorkflow({ errorHandling: 'stop', timeout: 1500 }, [
        { slug: 'slow', type: slowTask.slug, config: { label: 'slow', ms: 6000 } },
        { slug: 'after', type: flakyTask.slug, config: { label: 'after' }, dependencies: ['slow'] },
      ])

      const run = await fire()
      // The run ended on the timeout, not when the step's handler returned.
      expect(slowFinished).toEqual([])

      const timeoutError = 'Step timed out: the workflow exceeded its timeout of 1500 ms while this step was running'
      expect(run.status).toBe('failed')
      expect(run.error).toBe('Workflow timed out after 1500 ms')
      expect(step(run, 'slow')).toMatchObject({ status: 'failed', attempts: 1, error: timeoutError })
      expect(step(run, 'after')?.status).toBe('pending')

      // The handler cannot be interrupted. Let it finish, then check that its
      // success changed nothing and did not start the dependent step.
      await waitFor(() => slowFinished.length > 0)
      await wait(500)
      const later = await onlyRun()
      expect(later.status).toBe('failed')
      expect(step(later, 'slow')).toMatchObject({ status: 'failed', error: timeoutError })
      expect(step(later, 'slow')?.output ?? null).toBeNull()
      expect(step(later, 'after')?.status).toBe('pending')
      expect(callCount('after')).toBe(0)
    })

    it("fails the run on timeout with errorHandling 'continue' too", async () => {
      await init()
      await createWorkflow({ errorHandling: 'continue', timeout: 2500 }, [
        { slug: 'quick', type: flakyTask.slug, config: { label: 'quick' } },
        { slug: 'slow', type: slowTask.slug, config: { label: 'slow', ms: 6000 }, dependencies: ['quick'] },
        { slug: 'after', type: flakyTask.slug, config: { label: 'after' }, dependencies: ['slow'] },
      ])

      const run = await fire()

      expect(run.status).toBe('failed')
      expect(run.error).toBe('Workflow timed out after 2500 ms')
      expect(step(run, 'quick')?.status).toBe('succeeded')
      expect(step(run, 'slow')?.status).toBe('failed')
      expect(step(run, 'after')?.status).toBe('pending')
      await waitFor(() => slowFinished.length > 0)
      await wait(500)
      expect(callCount('after')).toBe(0)
    })

    it('stops retrying when the timeout passes during a retry wait', async () => {
      await init()
      await createWorkflow({ errorHandling: 'stop', timeout: 2000 }, [
        {
          slug: 'flaky',
          type: flakyTask.slug,
          config: { failures: 99, label: 'flaky' },
          retry: { retryOnFailure: true, maxRetries: 5, retryDelay: 4000 },
        },
      ])

      const run = await fire()

      expect(run.status).toBe('failed')
      expect(run.error).toBe('Workflow timed out after 2000 ms')
      expect(step(run, 'flaky')).toMatchObject({
        status: 'failed',
        attempts: 1,
        error: 'Step timed out: the workflow exceeded its timeout of 2000 ms while this step was running',
      })

      // The retry that was due 4 s after the first attempt never starts.
      await wait(4500 - (Date.now() - calls.get('flaky')![0]))
      expect(callCount('flaky')).toBe(1)
    })

    it('has no limit with timeout 0', async () => {
      await init()
      await createWorkflow({ errorHandling: 'stop', timeout: 0 }, [
        { slug: 'slow', type: slowTask.slug, config: { label: 'slow', ms: 300 } },
      ])

      const run = await fire()

      expect(run.status).toBe('completed')
      expect(step(run, 'slow')).toMatchObject({ status: 'succeeded', output: { slept: 300 } })
    })
  })

  describe("execution.mode 'queue'", () => {
    /** Jobs a job runner may still pick up (failed step attempts stay stored with `hasError`). */
    const pendingJobs = async () => {
      const { docs } = await payload.find({
        collection: 'payload-jobs',
        where: { and: [{ completedAt: { exists: false } }, { hasError: { not_equals: true } }] },
      })
      return docs as unknown as Array<{ taskSlug?: string; waitUntil?: null | string }>
    }

    it('hands a long retry delay to the jobs queue instead of sleeping in the job', async () => {
      await init({ execution: { mode: 'queue', maxInProcessRetryDelay: 20 } })
      await createWorkflow({ errorHandling: 'stop' }, [
        { slug: 'before', type: flakyTask.slug, config: { label: 'before' } },
        {
          slug: 'flaky',
          type: flakyTask.slug,
          config: { failures: 1, label: 'flaky' },
          dependencies: ['before'],
          retry: { retryOnFailure: true, maxRetries: 2, retryDelay: 4000 },
        },
        { slug: 'after', type: flakyTask.slug, config: { label: 'after' }, dependencies: ['flaky'] },
      ])
      await payload.create({ collection: 'posts', data: {} })

      await payload.jobs.run()
      const returnedAt = Date.now()

      const paused = await onlyRun()
      expect(paused.status).toBe('pending')
      expect(step(paused, 'before')?.status).toBe('succeeded')
      expect(step(paused, 'flaky')).toMatchObject({ status: 'pending', attempts: 1, lastError: 'flaky failure 1' })
      const nextRetryAt = new Date(step(paused, 'flaky')!.nextRetryAt!).getTime()
      // The job returned without waiting for the retry.
      expect(returnedAt).toBeLessThan(nextRetryAt)
      expect(nextRetryAt - calls.get('flaky')![0]).toBeGreaterThanOrEqual(3990)
      expect((paused.logs ?? []).some((log) => log.message?.startsWith('Workflow run paused until'))).toBe(true)

      // The resume job waits in the queue with Payload's waitUntil.
      const jobs = await pendingJobs()
      expect(jobs).toHaveLength(1)
      expect(jobs[0].taskSlug).toBe('automation-workflow-run')
      expect(new Date(jobs[0].waitUntil!).getTime()).toBe(nextRetryAt)

      // Before the retry is due, a job runner finds nothing to do.
      await payload.jobs.run()
      expect(callCount('flaky')).toBe(1)
      expect((await onlyRun()).status).toBe('pending')

      await wait(nextRetryAt - Date.now() + 100)
      await payload.jobs.run()

      const done = await onlyRun()
      expect(done.status).toBe('completed')
      expect(callCount('before')).toBe(1)
      expect(callCount('flaky')).toBe(2)
      expect(step(done, 'before')).toMatchObject({ status: 'succeeded', attempts: 1 })
      expect(step(done, 'flaky')).toMatchObject({ status: 'succeeded', attempts: 2, lastError: 'flaky failure 1' })
      expect(step(done, 'flaky')?.nextRetryAt ?? null).toBeNull()
      expect(step(done, 'after')).toMatchObject({ status: 'succeeded', attempts: 1 })
      expect((done.logs ?? []).map((log) => log.message)).toContain('Workflow execution resumed')
    })

    it('fails a paused run when the workflow timeout passed while it waited', async () => {
      await init({ execution: { mode: 'queue', maxInProcessRetryDelay: 20 } })
      await createWorkflow({ errorHandling: 'stop', timeout: 4000 }, [
        {
          slug: 'flaky',
          type: flakyTask.slug,
          config: { failures: 1, label: 'flaky' },
          retry: { retryOnFailure: true, maxRetries: 2, retryDelay: 5000 },
        },
      ])
      await payload.create({ collection: 'posts', data: {} })

      await payload.jobs.run()
      const paused = await onlyRun()
      expect(paused.status).toBe('pending')

      await wait(new Date(step(paused, 'flaky')!.nextRetryAt!).getTime() - Date.now() + 100)
      await payload.jobs.run()

      const run = await onlyRun()
      expect(run.status).toBe('failed')
      expect(run.error).toBe('Workflow timed out after 4000 ms')
      expect(callCount('flaky')).toBe(1)
      expect(step(run, 'flaky')?.nextRetryAt ?? null).toBeNull()
    })

    it('sleeps through a short retry delay inside the job', async () => {
      await init({ execution: { mode: 'queue' } })
      await createWorkflow({ errorHandling: 'stop' }, [
        {
          slug: 'flaky',
          type: flakyTask.slug,
          config: { failures: 1, label: 'flaky' },
          retry: { retryOnFailure: true, maxRetries: 1, retryDelay: 50 },
        },
      ])
      await payload.create({ collection: 'posts', data: {} })

      await payload.jobs.run()

      const run = await onlyRun()
      expect(run.status).toBe('completed')
      expect(step(run, 'flaky')).toMatchObject({ status: 'succeeded', attempts: 2 })
    })
  })
})
